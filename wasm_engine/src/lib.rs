use wasm_bindgen::prelude::*;
use ruint::{aliases::U256, aliases::U512};
use getrandom::getrandom;

// Replace console_log with a macro or wasm_bindgen function if needed
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);
}

pub mod ecm;

// Fixed-size BigInt using ruint. Since our max is around 65 digits (~215 bits), U256 is perfect.
// For multiplications that double the size, we can use U512.
pub(crate) type Int = U256;
pub(crate) type DoubleInt = U512;

// PRNG (Xoroshiro128++)
pub(crate) struct Xoroshiro128PlusPlus {
    s0: u64,
    s1: u64,
}

impl Xoroshiro128PlusPlus {
    pub(crate) fn new() -> Self {
        let mut seed = [0u8; 16];
        getrandom(&mut seed).expect("Failed to get random seed");
        let s0 = u64::from_le_bytes(seed[0..8].try_into().unwrap());
        let s1 = u64::from_le_bytes(seed[8..16].try_into().unwrap());
        Self { s0, s1 }
    }

    pub(crate) fn next(&mut self) -> u64 {
        let s0 = self.s0;
        let mut s1 = self.s1;
        let result = s0.wrapping_add(s1).rotate_left(17).wrapping_add(s0);

        s1 ^= s0;
        self.s0 = s0.rotate_left(49) ^ s1 ^ (s1 << 21);
        self.s1 = s1.rotate_left(28);

        result
    }
}

// Montgomery Space for U256
pub(crate) struct MontgomerySpace {
    n: Int,
    n_inv: Int,
    r2: Int, // R^2 mod N, for converting *to* Montgomery space
}

impl MontgomerySpace {
    fn new(n: Int) -> Self {
        // Compute n_inv = -n^-1 mod 2^256
        let mut n_inv = n;
        for _ in 0..7 {
            n_inv = n_inv.wrapping_mul(Int::from(2)).wrapping_sub(n.wrapping_mul(n_inv).wrapping_mul(n_inv));
        }
        n_inv = !n_inv.wrapping_add(Int::from(1)); // -n_inv

        // Compute R^2 mod N
        // R = 2^256. R^2 = 2^512.
        let r: DoubleInt = DoubleInt::from(1) << 256;
        let r_mod: DoubleInt = r % DoubleInt::from(n);
        let r2: DoubleInt = r_mod.wrapping_mul(r_mod) % DoubleInt::from(n);
        let r2_limbs: [u64; 4] = r2.as_limbs()[..4].try_into().unwrap();
        let r2 = Int::from_limbs(r2_limbs);

        Self { n, n_inv, r2 }
    }

    pub(crate) fn transform(&self, x: Int) -> Int {
        self.mul(x, self.r2)
    }

    // Montgomery reduction: T * R^-1 mod N
    pub(crate) fn reduce(&self, t: DoubleInt) -> Int {
        let t_limbs: [u64; 4] = t.as_limbs()[..4].try_into().unwrap();
        let t_low = Int::from_limbs(t_limbs);
        let m = t_low.wrapping_mul(self.n_inv);
        let mn = DoubleInt::from(m).wrapping_mul(DoubleInt::from(self.n));
        
        let (sum, carry) = t.overflowing_add(mn);
        let res: DoubleInt = sum >> 256;
        let res_limbs: [u64; 4] = res.as_limbs()[..4].try_into().unwrap();
        let mut res_int = Int::from_limbs(res_limbs);

        if carry {
            // Carry out represents exactly 2^512. After shifting right by 256, it's 2^256.
            // But we operate within modulo self.n, and 2^256 = R.
            // Actually, in the standard Montgomery reduction:
            // (T + m*N) / R. If there's a carry out, we just add 1 to the MSB, which is equivalent to adding 1.
            // Wait, (T + m*N) is exactly divisible by R. The 256 lower bits are 0.
            // The value is exactly sum >> 256 + carry * (2^512 >> 256), which is + carry * 2^256.
            // Mod N, we can just subtract N. 
            // In typical U256 math, the top bit carry means the value is at least 2^256 > N.
            // So we can compute res_int = res_int.wrapping_sub(self.n) + carry bit handling.
            
            // To be entirely safe and precise without manual carry arithmetic:
            let (mut new_res, _sub_carry) = res_int.overflowing_sub(self.n);
            // Since we had a 2^256 carry out, after subtracting N, the result must be correct.
            // In U256 math, sub_carry occurs if res_int < self.n, but we know the true value is res_int + 2^256.
            // So res_int + 2^256 - self.n is exactly res_int.wrapping_sub(self.n).
            res_int = new_res;
        } else if res_int >= self.n {
            res_int = res_int - self.n;
        }
        res_int
    }

    pub(crate) fn mul(&self, a: Int, b: Int) -> Int {
        let t = DoubleInt::from(a).wrapping_mul(DoubleInt::from(b));
        self.reduce(t)
    }

    pub(crate) fn add(&self, a: Int, b: Int) -> Int {
        let (res, carry) = a.overflowing_add(b);
        if carry || res >= self.n {
            res.wrapping_sub(self.n)
        } else {
            res
        }
    }

    pub(crate) fn sub(&self, a: Int, b: Int) -> Int {
        if a >= b {
            a - b
        } else {
            a.wrapping_add(self.n).wrapping_sub(b)
        }
    }
}

// Math utils
pub(crate) fn gcd(mut a: Int, mut b: Int) -> Int {
    while b > Int::from(0) {
        let temp = b;
        b = a % b;
        a = temp;
    }
    a
}

fn is_square(n: Int) -> bool {
    if n == Int::from(0) { return true; }
    let mod16 = (n.as_limbs()[0] & 15) as u8;
    if mod16 != 0 && mod16 != 1 && mod16 != 4 && mod16 != 9 { return false; }

    let mut x = n;
    let mut y = (x + Int::from(1)) >> 1;
    while y < x {
        x = y;
        y = (x + n / x) >> 1;
    }
    x * x == n
}

fn jacobi(mut a: Int, mut n: Int) -> i32 {
    let mut t = 1;
    while a != Int::from(0) {
        while a.as_limbs()[0] % 2 == 0 {
            a >>= 1;
            let r = n.as_limbs()[0] % 8;
            if r == 3 || r == 5 { t = -t; }
        }
        core::mem::swap(&mut a, &mut n);
        if a.as_limbs()[0] % 4 == 3 && n.as_limbs()[0] % 4 == 3 { t = -t; }
        a = a % n;
    }
    if n == Int::from(1) { t } else { 0 }
}

fn strong_lucas_test(n: Int) -> bool {
    // Port of strongLucasTest from math.js
    let mut d = n + Int::from(1);
    let mut s = 0;
    while d.as_limbs()[0] & 1 == 0 {
        s += 1;
        d >>= 1;
    }
    
    // Find D
    let mut d_val = Int::from(5);
    let mut sign = 1i32;
    loop {
        // D * sign
        let mut a = d_val;
        if sign == -1 {
            a = n - d_val; // Since n is odd and d_val < n
        }
        let j = jacobi(a, n);
        if j == -1 {
            break;
        }
        if j == 0 {
            return false;
        }
        d_val = d_val + Int::from(2);
        sign = -sign;
    }
    
    let p_val = Int::from(1);
    // Q = (1 - D) / 4 mod n. Since D = d_val * sign, 1 - D = 1 - d_val * sign
    let q_val = if sign == 1 {
        // 1 - d_val mod n => n + 1 - d_val
        let num = n + Int::from(1) - d_val;
        // Divide by 4 mod n: num * 4^-1 mod n
        // Since n is odd, we can just do:
        let mut q = num;
        while q.as_limbs()[0] % 4 != 0 {
            q = q + n;
        }
        q >> 2
    } else {
        // 1 + d_val mod n
        let mut q = Int::from(1) + d_val;
        while q.as_limbs()[0] % 4 != 0 {
            q = q + n;
        }
        q >> 2
    };

    let q_val = q_val % n;

    let mut u = Int::from(1);
    let mut v = p_val;
    let mut qk = q_val;
    
    let d_bits = 256 - d.leading_zeros(); // bit length

    for i in (0..d_bits - 1).rev() {
        // U_2k = (U * V) % n
        let u_double = DoubleInt::from(u).wrapping_mul(DoubleInt::from(v)) % DoubleInt::from(n);
        let mut u_2k = Int::from_limbs(u_double.as_limbs()[..4].try_into().unwrap());
        
        // V_2k = (V * V - 2 * Qk) % n
        let v2 = DoubleInt::from(v).wrapping_mul(DoubleInt::from(v)) % DoubleInt::from(n);
        let qk2 = DoubleInt::from(qk).wrapping_mul(DoubleInt::from(2)) % DoubleInt::from(n);
        let v_2k_mod = if v2 >= qk2 { v2 - qk2 } else { v2 + DoubleInt::from(n) - qk2 };
        let mut v_2k = Int::from_limbs(v_2k_mod.as_limbs()[..4].try_into().unwrap());
        
        let qk_sq = DoubleInt::from(qk).wrapping_mul(DoubleInt::from(qk)) % DoubleInt::from(n);
        qk = Int::from_limbs(qk_sq.as_limbs()[..4].try_into().unwrap());
        
        u = u_2k;
        v = v_2k;
        
        if ((d >> i) & Int::from(1)) == Int::from(1) {
            // U_next = (P * U + V) / 2 % n
            let mut u_next = DoubleInt::from(p_val).wrapping_mul(DoubleInt::from(u)) % DoubleInt::from(n);
            u_next = (u_next + DoubleInt::from(v)) % DoubleInt::from(n);
            let mut u_next_int = Int::from_limbs(u_next.as_limbs()[..4].try_into().unwrap());
            if u_next_int.as_limbs()[0] & 1 == 1 {
                u_next = (DoubleInt::from(u_next_int) + DoubleInt::from(n)) >> 1;
                u_next_int = Int::from_limbs(u_next.as_limbs()[..4].try_into().unwrap());
            } else {
                u_next_int >>= 1;
            }
            
            // V_next = (D * U + P * V) / 2 % n
            let mut v_next_part1 = DoubleInt::from(d_val).wrapping_mul(DoubleInt::from(u)) % DoubleInt::from(n);
            if sign == -1 {
                v_next_part1 = if v_next_part1 == DoubleInt::from(0) { DoubleInt::from(0) } else { DoubleInt::from(n) - v_next_part1 };
            }
            let mut v_next_part2 = DoubleInt::from(p_val).wrapping_mul(DoubleInt::from(v)) % DoubleInt::from(n);
            let mut v_next = (v_next_part1 + v_next_part2) % DoubleInt::from(n);
            let mut v_next_int = Int::from_limbs(v_next.as_limbs()[..4].try_into().unwrap());
            if v_next_int.as_limbs()[0] & 1 == 1 {
                v_next = (DoubleInt::from(v_next_int) + DoubleInt::from(n)) >> 1;
                v_next_int = Int::from_limbs(v_next.as_limbs()[..4].try_into().unwrap());
            } else {
                v_next_int >>= 1;
            }
            
            u = u_next_int;
            v = v_next_int;
            
            let qk_q = DoubleInt::from(qk).wrapping_mul(DoubleInt::from(q_val)) % DoubleInt::from(n);
            qk = Int::from_limbs(qk_q.as_limbs()[..4].try_into().unwrap());
        }
    }
    
    if u == Int::from(0) || v == Int::from(0) {
        return true;
    }
    
    for _ in 1..s {
        let v2 = DoubleInt::from(v).wrapping_mul(DoubleInt::from(v)) % DoubleInt::from(n);
        let qk2 = DoubleInt::from(qk).wrapping_mul(DoubleInt::from(2)) % DoubleInt::from(n);
        let v_next_mod = if v2 >= qk2 { v2 - qk2 } else { v2 + DoubleInt::from(n) - qk2 };
        v = Int::from_limbs(v_next_mod.as_limbs()[..4].try_into().unwrap());
        
        let qk_sq = DoubleInt::from(qk).wrapping_mul(DoubleInt::from(qk)) % DoubleInt::from(n);
        qk = Int::from_limbs(qk_sq.as_limbs()[..4].try_into().unwrap());
        
        if v == Int::from(0) {
            return true;
        }
    }
    false
}

fn miller_rabin_base_mont(n: Int, base: Int, mont: &MontgomerySpace) -> bool {
    let mut d = n - Int::from(1);
    let mut s = 0;
    // We must check if the number is even overall, so check if the LSB of the lowest limb is 0.
    while d.as_limbs()[0] & 1 == 0 {
        d >>= 1;
        s += 1;
    }
    let a = mont.transform(base);

    let mut res = mont.transform(Int::from(1));
    let mut base_pow = a;
    let mut exp = d;
    while exp > Int::from(0) {
        if exp.as_limbs()[0] & 1 == 1 {
            res = mont.mul(res, base_pow);
        }
        base_pow = mont.mul(base_pow, base_pow);
        // Correctly shift all limbs down by 1
        let mut new_exp = exp >> 1;
        exp = new_exp;
    }

    let mut x = res;
    let one = mont.transform(Int::from(1));
    let minus_one = mont.transform(n - Int::from(1));

    if x == one || x == minus_one { return true; }

    for _ in 1..s {
        x = mont.mul(x, x);
        if x == minus_one { return true; }
        if x == one { return false; }
    }
    false
}

pub(crate) fn int_from_le_slice(bytes: &[u8]) -> Int {
    let mut padded = [0u8; 32];
    let len = core::cmp::min(bytes.len(), 32);
    padded[..len].copy_from_slice(&bytes[..len]);
    Int::try_from_le_slice(&padded).unwrap_or(Int::from(0))
}

#[wasm_bindgen]
pub fn is_prime_bpsw_bytes(n_bytes: &[u8]) -> bool {
    let n = int_from_le_slice(n_bytes);
    if n < Int::from(2) { return false; }
    if n == Int::from(2) || n == Int::from(3) || n == Int::from(5) || n == Int::from(7) { return true; }
    if n.as_limbs()[0] % 2 == 0 || n.as_limbs()[0] % 3 == 0 || n.as_limbs()[0] % 5 == 0 { return false; }

    let mont = MontgomerySpace::new(n);

    let bases = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37];
    for &b in &bases {
        let b_int = Int::from(b);
        if n <= b_int { break; }
        if !miller_rabin_base_mont(n, b_int, &mont) { return false; }
    }

    if n.as_limbs()[1] > 0 || n.as_limbs()[2] > 0 || n.as_limbs()[3] > 0 {
        if !miller_rabin_base_mont(n, Int::from(2), &mont) { return false; }
        if is_square(n) { return false; }
        return strong_lucas_test(n);
    }

    true
}

#[wasm_bindgen]
pub fn sieve_primes_wasm(max: usize) -> Vec<u32> {
    if max < 2 { return Vec::new(); }
    let mut is_prime = vec![true; max + 1];
    is_prime[0] = false;
    is_prime[1] = false;

    for i in 2..=(max as f64).sqrt() as usize {
        if is_prime[i] {
            let mut j = i * i;
            while j <= max {
                is_prime[j] = false;
                j += i;
            }
        }
    }
    is_prime.into_iter().enumerate().filter(|&(_, p)| p).map(|(i, _)| i as u32).collect()
}

// This is a dummy function just to ensure the file parses successfully.
// The actual logic is appended via another mechanism due to patch format issues.

// --- SIQS MATRIX REDUCER (WASM) ---

pub struct SiqsRelation {
    pub sign: i32,
    pub x: Vec<u8>, // Little-endian bytes
    pub b: Vec<u8>,
    pub a: Vec<u8>,
    pub factors: Vec<u32>, // Indices of the Factor Base
}

#[wasm_bindgen]
pub struct SiqsReducer {
    n: Int,
    kn: Int,
    fb: Vec<u32>,
    relations: Vec<SiqsRelation>,
}

#[wasm_bindgen]
impl SiqsReducer {
    #[wasm_bindgen(constructor)]
    pub fn new(n_bytes: &[u8], kn_bytes: &[u8], fb_primes: &[u32]) -> Self {
        let n = int_from_le_slice(n_bytes);
        let kn = int_from_le_slice(kn_bytes);
        SiqsReducer {
            n,
            kn,
            fb: fb_primes.to_vec(),
            relations: Vec::new(),
        }
    }

    pub fn add_relation(&mut self, sign: i32, x_bytes: &[u8], b_bytes: &[u8], a_bytes: &[u8], factors: &[u32]) {
        self.relations.push(SiqsRelation {
            sign,
            x: x_bytes.to_vec(),
            b: b_bytes.to_vec(),
            a: a_bytes.to_vec(),
            factors: factors.to_vec(),
        });
    }

    pub fn reduce_matrix(&self) -> Option<Vec<u8>> {
        let num_cols = self.fb.len() + 1; // Col 0: Sign, Col 1..: FB Primes
        let num_rows = self.relations.len();
        let words = (num_cols + 31) / 32;
        let id_words = (num_rows + 31) / 32;

        let mut m = vec![vec![0u32; words]; num_rows];
        let mut id = vec![vec![0u32; id_words]; num_rows];

        for i in 0..num_rows {
            id[i][i / 32] |= 1u32 << (i % 32);

            let rel = &self.relations[i];
            if rel.sign == -1 {
                m[i][0] |= 1;
            }

            for &f_idx in &rel.factors {
                let col_idx = (f_idx + 1) as usize;
                let w_idx = col_idx / 32;
                let b_idx = col_idx % 32;
                m[i][w_idx] ^= 1u32 << b_idx;
            }
        }

        let mut num_pivots = 0;
        for c in 0..num_cols {
            let w_idx = c / 32;
            let b_idx = c % 32;

            let mut r = None;
            for i in num_pivots..num_rows {
                if (m[i][w_idx] & (1u32 << b_idx)) != 0 {
                    r = Some(i);
                    break;
                }
            }

            if let Some(r_idx) = r {
                m.swap(num_pivots, r_idx);
                id.swap(num_pivots, r_idx);

                for i in 0..num_rows {
                    if i != num_pivots {
                        if (m[i][w_idx] & (1u32 << b_idx)) != 0 {
                            for w in 0..words {
                                m[i][w] ^= m[num_pivots][w];
                            }
                            for w in 0..id_words {
                                id[i][w] ^= id[num_pivots][w];
                            }
                        }
                    }
                }
                num_pivots += 1;
            }
        }

        let mut deps = Vec::new();
        for i in num_pivots..num_rows {
            let mut dep = Vec::new();
            for j in 0..num_rows {
                if (id[i][j / 32] & (1u32 << (j % 32))) != 0 {
                    dep.push(j);
                }
            }
            if !dep.is_empty() {
                deps.push(dep);
            }
        }

        self.evaluate_dependencies(&deps)
    }

    fn evaluate_dependencies(&self, deps: &[Vec<usize>]) -> Option<Vec<u8>> {
        for dep in deps {
            let mut x_val = Int::from(1);
            let mut exponent_sum = vec![0i32; self.fb.len() + 1];

            for &idx in dep {
                let rel = &self.relations[idx];
                let rel_x = int_from_le_slice(&rel.x);
                let rel_b = int_from_le_slice(&rel.b);

                let rel_a = if rel.a.is_empty() {
                    Int::from(1)
                } else {
                    int_from_le_slice(&rel.a)
                };

                let term_prod = DoubleInt::from(rel_a).wrapping_mul(DoubleInt::from(rel_x));
                let term_mod = term_prod % DoubleInt::from(self.kn);
                let term_add = (term_mod + DoubleInt::from(rel_b)) % DoubleInt::from(self.kn);
                let term = Int::from_limbs(term_add.as_limbs()[..4].try_into().unwrap());

                let x_prod = DoubleInt::from(x_val).wrapping_mul(DoubleInt::from(term));
                let x_mod = x_prod % DoubleInt::from(self.kn);
                x_val = Int::from_limbs(x_mod.as_limbs()[..4].try_into().unwrap());

                if rel.sign == -1 {
                    exponent_sum[0] += 1;
                }
                for &f_idx in &rel.factors {
                    exponent_sum[(f_idx + 1) as usize] += 1;
                }
            }

            let mut y_val = Int::from(1);
            let mut success = true;

            // Check sign exponent (index 0)
            if exponent_sum[0] % 2 != 0 {
                success = false;
            }

            for i in 1..=self.fb.len() {
                let count = exponent_sum[i];
                if count % 2 != 0 {
                    success = false;
                    break;
                }
                if count > 0 {
                    let half = count / 2;
                    let prime = Int::from(self.fb[i - 1]);

                    let mut res = Int::from(1);
                    let mut base_pow = prime;
                    let mut exp = half as u32;
                    while exp > 0 {
                        if exp & 1 == 1 {
                            let res_prod = DoubleInt::from(res).wrapping_mul(DoubleInt::from(base_pow));
                            res = Int::from_limbs((res_prod % DoubleInt::from(self.kn)).as_limbs()[..4].try_into().unwrap());
                        }
                        let base_prod = DoubleInt::from(base_pow).wrapping_mul(DoubleInt::from(base_pow));
                        base_pow = Int::from_limbs((base_prod % DoubleInt::from(self.kn)).as_limbs()[..4].try_into().unwrap());
                        exp >>= 1;
                    }

                    let y_prod = DoubleInt::from(y_val).wrapping_mul(DoubleInt::from(res));
                    y_val = Int::from_limbs((y_prod % DoubleInt::from(self.kn)).as_limbs()[..4].try_into().unwrap());
                }
            }
            if !success {
                continue;
            }

            let diff = if x_val >= y_val { x_val - y_val } else { x_val + self.kn - y_val };
            // Compute GCD against original N to avoid returning trivial k
            let mut g = gcd(diff, self.n);
            if g > Int::from(1) && g < self.n {
                return Some(g.to_le_bytes::<32>().to_vec());
            }

            let sum_double = (DoubleInt::from(x_val) + DoubleInt::from(y_val)) % DoubleInt::from(self.kn);
            let sum = Int::from_limbs(sum_double.as_limbs()[..4].try_into().unwrap());
            g = gcd(sum, self.n);
            if g > Int::from(1) && g < self.n {
                return Some(g.to_le_bytes::<32>().to_vec());
            }
        }
        None
    }
}
pub mod siqs;
