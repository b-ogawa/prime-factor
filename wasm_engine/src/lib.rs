use wasm_bindgen::prelude::*;
use ruint::{aliases::U256, aliases::U512};
use getrandom::getrandom;

// Replace console_log with a macro or wasm_bindgen function if needed
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);
}

// Fixed-size BigInt using ruint. Since our max is around 65 digits (~215 bits), U256 is perfect.
// For multiplications that double the size, we can use U512.
type Int = U256;
type DoubleInt = U512;

// PRNG (Xoroshiro128++)
struct Xoroshiro128PlusPlus {
    s0: u64,
    s1: u64,
}

impl Xoroshiro128PlusPlus {
    fn new() -> Self {
        let mut seed = [0u8; 16];
        getrandom(&mut seed).expect("Failed to get random seed");
        let s0 = u64::from_le_bytes(seed[0..8].try_into().unwrap());
        let s1 = u64::from_le_bytes(seed[8..16].try_into().unwrap());
        Self { s0, s1 }
    }

    fn next(&mut self) -> u64 {
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
struct MontgomerySpace {
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
        let mut r2: DoubleInt = DoubleInt::from(1) << 512;
        r2 = r2 % DoubleInt::from(n);
        let r2_limbs: [u64; 4] = r2.as_limbs()[..4].try_into().unwrap();
        let r2 = Int::from_limbs(r2_limbs);

        Self { n, n_inv, r2 }
    }

    fn transform(&self, x: Int) -> Int {
        self.mul(x, self.r2)
    }

    // Montgomery reduction: T * R^-1 mod N
    fn reduce(&self, t: DoubleInt) -> Int {
        let t_limbs: [u64; 4] = t.as_limbs()[..4].try_into().unwrap();
        let t_low = Int::from_limbs(t_limbs);
        let m = t_low.wrapping_mul(self.n_inv);
        let mn = DoubleInt::from(m).wrapping_mul(DoubleInt::from(self.n));
        let res: DoubleInt = t.wrapping_add(mn) >> 256;
        let res_limbs: [u64; 4] = res.as_limbs()[..4].try_into().unwrap();
        let mut res_int = Int::from_limbs(res_limbs);

        if res_int >= self.n || (t.wrapping_add(mn) < t) { // Handle carry out if any
            res_int = res_int.wrapping_sub(self.n);
        }
        res_int
    }

    fn mul(&self, a: Int, b: Int) -> Int {
        let t = DoubleInt::from(a).wrapping_mul(DoubleInt::from(b));
        self.reduce(t)
    }

    fn add(&self, a: Int, b: Int) -> Int {
        let (res, carry) = a.overflowing_add(b);
        if carry || res >= self.n {
            res.wrapping_sub(self.n)
        } else {
            res
        }
    }

    fn sub(&self, a: Int, b: Int) -> Int {
        if a >= b {
            a - b
        } else {
            a.wrapping_add(self.n).wrapping_sub(b)
        }
    }
}

// Math utils
fn gcd(mut a: Int, mut b: Int) -> Int {
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

#[wasm_bindgen]
pub fn is_prime_bpsw_bytes(n_bytes: &[u8]) -> bool {
    let n = Int::try_from_le_slice(n_bytes).unwrap_or(Int::from(0));
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
        let mut prng = Xoroshiro128PlusPlus::new();
        for _ in 0..10 {
            let rand_base = (Int::from(prng.next()) % (n - Int::from(2))) + Int::from(2);
            if !miller_rabin_base_mont(n, rand_base, &mont) { return false; }
        }
        if is_square(n) { return false; }
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

#[wasm_bindgen]
pub fn pollard_p1_bytes(n_bytes: &[u8], b1: usize, primes: &[u32]) -> Option<Vec<u8>> {
    let n = Int::try_from_le_slice(n_bytes).unwrap_or(Int::from(0));
    if n == Int::from(0) || n == Int::from(1) { return None; }
    let mont = MontgomerySpace::new(n);
    let mut prng = Xoroshiro128PlusPlus::new();

    let b1_big = Int::from(b1);
    let b2_big = Int::from(b1 * 10);

    let mut p1_primes = Vec::new();
    let mut p2_primes = Vec::new();

    for &p in primes {
        let p_int = Int::from(p);
        if p_int <= b1_big {
            p1_primes.push(p);
        } else if p_int <= b2_big {
            p2_primes.push(p);
        } else {
            break;
        }
    }

    let r_idx = (prng.next() as usize) % core::cmp::max(1, core::cmp::min(100, primes.len()));
    let base_prime = Int::from(*primes.get(r_idx).unwrap_or(&2));
    let mut a = mont.transform(base_prime);

    // Phase 1
    for &p in &p1_primes {
        let mut q = p as u64;
        let p_u64 = p as u64;
        while q.saturating_mul(p_u64) <= b1 as u64 {
            q *= p_u64;
        }

        let mut res = mont.transform(Int::from(1));
        let mut base_pow = a;
        let mut exp = q;
        while exp > 0 {
            if exp & 1 == 1 {
                res = mont.mul(res, base_pow);
            }
            base_pow = mont.mul(base_pow, base_pow);
            exp >>= 1;
        }
        a = res;
    }

    let res = mont.reduce(DoubleInt::from(a));
    let g1 = gcd(if res >= Int::from(1) { res - Int::from(1) } else { n - Int::from(1) }, n);

    if g1 > Int::from(1) && g1 < n {
        return Some(g1.to_le_bytes::<32>().to_vec());
    }
    if g1 == n || p2_primes.is_empty() {
        return None;
    }

    // Phase 2
    let a_val = mont.reduce(DoubleInt::from(a));
    if a_val == Int::from(1) { return None; }

    let max_gap = 200usize;
    let mut a_d = vec![mont.transform(Int::from(0)); max_gap / 2 + 1];
    let a_2 = mont.mul(a, a);
    a_d[1] = a_2;
    for i in 2..=(max_gap / 2) {
        a_d[i] = mont.mul(a_d[i - 1], a_2);
    }

    let mut current_q = p1_primes.last().cloned().unwrap_or(2) as u64;

    let mut res = mont.transform(Int::from(1));
    let mut base_pow = a;
    let mut exp = current_q;
    while exp > 0 {
        if exp & 1 == 1 {
            res = mont.mul(res, base_pow);
        }
        base_pow = mont.mul(base_pow, base_pow);
        exp >>= 1;
    }
    let mut a_q = res;

    let mut acc = mont.transform(Int::from(1));
    let mut iters_since_check = 0;

    for &next_q in &p2_primes {
        let diff = next_q as isize - current_q as isize;
        if diff as usize > max_gap {
            let mut res2 = mont.transform(Int::from(1));
            let mut base_pow2 = a;
            let mut exp2 = next_q as u64;
            while exp2 > 0 {
                if exp2 & 1 == 1 {
                    res2 = mont.mul(res2, base_pow2);
                }
                base_pow2 = mont.mul(base_pow2, base_pow2);
                exp2 >>= 1;
            }
            a_q = res2;
        } else {
            a_q = mont.mul(a_q, a_d[diff as usize / 2]);
        }
        current_q = next_q as u64;

        let one_mont = mont.transform(Int::from(1));
        let term = mont.sub(a_q, one_mont);
        acc = mont.mul(acc, term);
        iters_since_check += 1;

        if iters_since_check > 256 {
            let g2 = gcd(mont.reduce(DoubleInt::from(acc)), n);
            if g2 > Int::from(1) && g2 < n {
                return Some(g2.to_le_bytes::<32>().to_vec());
            }
            if g2 == n { break; }
            acc = mont.transform(Int::from(1));
            iters_since_check = 0;
        }
    }
    let g2 = gcd(mont.reduce(DoubleInt::from(acc)), n);
    if g2 > Int::from(1) && g2 < n {
        Some(g2.to_le_bytes::<32>().to_vec())
    } else {
        None
    }
}

#[wasm_bindgen]
pub fn pollard_brent_bytes(n_bytes: &[u8], max_iters: usize) -> Option<Vec<u8>> {
    let n = Int::try_from_le_slice(n_bytes).unwrap_or(Int::from(0));
    if n == Int::from(0) { return None; }

    let mont = MontgomerySpace::new(n);
    let mut prng = Xoroshiro128PlusPlus::new();

    let c_val = Int::from(prng.next()) % n;
    let y_val = Int::from(prng.next()) % n;

    let mut y = mont.transform(y_val);
    let c = mont.transform(c_val);
    let mut q = mont.transform(Int::from(1)); // 1 in Mont space
    let m = 100usize;
    let mut g = Int::from(1);
    let mut r = 1usize;
    let mut ys = y;
    let mut x = y;
    let mut iters = 0;

    while g == Int::from(1) {
        x = y;
        for _ in 0..r {
            let y_sq = mont.mul(y, y);
            y = mont.add(y_sq, c);
        }
        let mut k = 0;
        while k < r && g == Int::from(1) {
            ys = y;
            let limit = core::cmp::min(m, r - k);
            for _ in 0..limit {
                let y_sq = mont.mul(y, y);
                y = mont.add(y_sq, c);
                let diff = if y > x { y - x } else { x - y };
                q = mont.mul(q, diff);
            }
            g = gcd(mont.reduce(DoubleInt::from(q)), n);
            k += limit;
            iters += limit;
            if iters >= max_iters { return None; }
        }
        r *= 2;
    }

    if g == n {
        let mut backtrack_limit = 0;
        loop {
            let ys_sq = mont.mul(ys, ys);
            ys = mont.add(ys_sq, c);
            let diff = if ys > x { ys - x } else { x - ys };
            g = gcd(mont.reduce(DoubleInt::from(diff)), n);
            backtrack_limit += 1;
            if backtrack_limit > m { return None; }
            if g != Int::from(1) { break; }
        }
    }

    if g == n { None } else { Some(g.to_le_bytes::<32>().to_vec()) }
}

// Montgomery ECM operations
fn xadd_mont_inplace(r0: &mut [Int; 2], r1: &[Int; 2], xdiff: Int, zdiff: Int, mont: &MontgomerySpace, dest: &mut [Int; 2]) {
    let t1 = mont.sub(r0[0], r0[1]);
    let t2 = mont.add(r1[0], r1[1]);
    let t3 = mont.add(r0[0], r0[1]);
    let t4 = mont.sub(r1[0], r1[1]);
    let t5 = mont.mul(t1, t2);
    let t6 = mont.mul(t3, t4);
    let t7 = mont.add(t5, t6);
    let t8 = mont.sub(t5, t6);
    dest[0] = mont.mul(zdiff, mont.mul(t7, t7));
    dest[1] = mont.mul(xdiff, mont.mul(t8, t8));
}

fn xadd_mont_inplace_z1(r0: &mut [Int; 2], r1: &[Int; 2], xdiff: Int, mont: &MontgomerySpace, dest: &mut [Int; 2]) {
    let t1 = mont.sub(r0[0], r0[1]);
    let t2 = mont.add(r1[0], r1[1]);
    let t3 = mont.add(r0[0], r0[1]);
    let t4 = mont.sub(r1[0], r1[1]);
    let t5 = mont.mul(t1, t2);
    let t6 = mont.mul(t3, t4);
    let t7 = mont.add(t5, t6);
    let t8 = mont.sub(t5, t6);
    dest[0] = mont.mul(t7, t7);
    dest[1] = mont.mul(xdiff, mont.mul(t8, t8));
}

fn xdbl_mont_inplace(r: &[Int; 2], a24: Int, mont: &MontgomerySpace, dest: &mut [Int; 2]) {
    let t1 = mont.add(r[0], r[1]);
    let t2 = mont.sub(r[0], r[1]);
    let t3 = mont.mul(t1, t1);
    let t4 = mont.mul(t2, t2);
    let t5 = mont.sub(t3, t4);
    dest[0] = mont.mul(t3, t4);
    let temp = mont.add(t4, mont.mul(a24, t5));
    dest[1] = mont.mul(t5, temp);
}

fn montgomery_ladder(k: usize, x: Int, z: Int, a24: Int, mont: &MontgomerySpace) -> [Int; 2] {
    let mut r0 = [x, z];
    let mut r1 = [Int::from(0), Int::from(0)];
    xdbl_mont_inplace(&r0, a24, mont, &mut r1);

    let is_z1 = z == mont.transform(Int::from(1));
    let k_bits = 64 - k.leading_zeros() as usize;

    for i in (0..k_bits - 1).rev() {
        let mut next_r0 = [Int::from(0), Int::from(0)];
        let mut next_r1 = [Int::from(0), Int::from(0)];
        if ((k >> i) & 1) == 1 {
            if is_z1 {
                xadd_mont_inplace_z1(&mut r0, &r1, x, mont, &mut next_r0);
            } else {
                xadd_mont_inplace(&mut r0, &r1, x, z, mont, &mut next_r0);
            }
            xdbl_mont_inplace(&r1, a24, mont, &mut next_r1);
        } else {
            if is_z1 {
                xadd_mont_inplace_z1(&mut r0, &r1, x, mont, &mut next_r1);
            } else {
                xadd_mont_inplace(&mut r0, &r1, x, z, mont, &mut next_r1);
            }
            xdbl_mont_inplace(&r0, a24, mont, &mut next_r0);
        }
        r0 = next_r0;
        r1 = next_r1;
    }
    r0
}

fn ext_gcd_inverse_internal(a: Int, m: Int) -> Option<Int> {
    let mut t = Int::from(0);
    let mut newt = Int::from(1);
    let mut r = m;
    let mut newr = a;

    while newr != Int::from(0) {
        let quotient = r / newr;
        let mut temp_t = t;
        let mut temp_r = r;

        let q_newt = quotient.wrapping_mul(newt);
        t = newt;
        if temp_t >= q_newt {
            newt = temp_t - q_newt;
        } else {
            newt = m - ((q_newt - temp_t) % m);
        }

        r = newr;
        newr = temp_r - quotient * newr;
    }

    if r > Int::from(1) {
        None
    } else {
        Some(t)
    }
}

fn get_suyama_curve(sigma: Int, n: Int) -> Option<(Int, Int)> {
    let s = sigma;
    let s2_double = DoubleInt::from(s).wrapping_mul(DoubleInt::from(s)) % DoubleInt::from(n);
    let s2 = Int::from_limbs(s2_double.as_limbs()[..4].try_into().unwrap());

    let s2_minus_5 = if s2 >= Int::from(5) { s2 - Int::from(5) } else { s2 + n - Int::from(5) };
    let u = s2_minus_5 % n;
    let v = Int::from_limbs((DoubleInt::from(4) * DoubleInt::from(s) % DoubleInt::from(n)).as_limbs()[..4].try_into().unwrap());

    let u2 = Int::from_limbs((DoubleInt::from(u) * DoubleInt::from(u) % DoubleInt::from(n)).as_limbs()[..4].try_into().unwrap());
    let u3 = Int::from_limbs((DoubleInt::from(u2) * DoubleInt::from(u) % DoubleInt::from(n)).as_limbs()[..4].try_into().unwrap());

    let v2 = Int::from_limbs((DoubleInt::from(v) * DoubleInt::from(v) % DoubleInt::from(n)).as_limbs()[..4].try_into().unwrap());
    let v3 = Int::from_limbs((DoubleInt::from(v2) * DoubleInt::from(v) % DoubleInt::from(n)).as_limbs()[..4].try_into().unwrap());

    let x0 = u3;
    let z0 = v3;

    let v_u = if v >= u { v - u } else { v + n - u };
    let v_u2 = Int::from_limbs((DoubleInt::from(v_u) * DoubleInt::from(v_u) % DoubleInt::from(n)).as_limbs()[..4].try_into().unwrap());
    let v_u3 = Int::from_limbs((DoubleInt::from(v_u2) * DoubleInt::from(v_u) % DoubleInt::from(n)).as_limbs()[..4].try_into().unwrap());

    let three_u = Int::from_limbs((DoubleInt::from(3) * DoubleInt::from(u) % DoubleInt::from(n)).as_limbs()[..4].try_into().unwrap());
    let three_u_v = (three_u + v) % n;

    let term1 = Int::from_limbs((DoubleInt::from(v_u3) * DoubleInt::from(three_u_v) % DoubleInt::from(n)).as_limbs()[..4].try_into().unwrap());

    let eight_u3 = Int::from_limbs((DoubleInt::from(8) * DoubleInt::from(u3) % DoubleInt::from(n)).as_limbs()[..4].try_into().unwrap());
    let term2 = Int::from_limbs((DoubleInt::from(eight_u3) * DoubleInt::from(v) % DoubleInt::from(n)).as_limbs()[..4].try_into().unwrap());

    let a_num = if term1 >= term2 { term1 - term2 } else { term1 + n - term2 };

    let four_u3 = Int::from_limbs((DoubleInt::from(4) * DoubleInt::from(u3) % DoubleInt::from(n)).as_limbs()[..4].try_into().unwrap());
    let a_den = Int::from_limbs((DoubleInt::from(four_u3) * DoubleInt::from(v) % DoubleInt::from(n)).as_limbs()[..4].try_into().unwrap());

    let two_a_den = Int::from_limbs((DoubleInt::from(2) * DoubleInt::from(a_den) % DoubleInt::from(n)).as_limbs()[..4].try_into().unwrap());
    let a24_num = (a_num + two_a_den) % n;

    let a24_den = Int::from_limbs((DoubleInt::from(4) * DoubleInt::from(a_den) % DoubleInt::from(n)).as_limbs()[..4].try_into().unwrap());

    let z0_inv = ext_gcd_inverse_internal(z0, n)?;
    let a24_den_inv = ext_gcd_inverse_internal(a24_den, n)?;

    let a24 = Int::from_limbs((DoubleInt::from(a24_num) * DoubleInt::from(a24_den_inv) % DoubleInt::from(n)).as_limbs()[..4].try_into().unwrap());
    let x0_scaled = Int::from_limbs((DoubleInt::from(x0) * DoubleInt::from(z0_inv) % DoubleInt::from(n)).as_limbs()[..4].try_into().unwrap());
    Some((x0_scaled, a24))
}

#[wasm_bindgen]
pub struct EcmRunner {
    n: Int,
    b1: usize,
    mont: MontgomerySpace,
    prng: Xoroshiro128PlusPlus,
    phase1_powers: Vec<u64>,
    phase2_primes: Vec<usize>,
}

#[wasm_bindgen]
impl EcmRunner {
    #[wasm_bindgen(constructor)]
    pub fn new(n_bytes: &[u8], b1: usize) -> Self {
        let n = Int::try_from_le_slice(n_bytes).unwrap_or(Int::from(0));
        let mont = MontgomerySpace::new(n);
        let prng = Xoroshiro128PlusPlus::new();

        let b2 = b1 * 50;
        let mut sieved = vec![true; b2 + 1];
        let mut primes = Vec::new();
        for p in 2..=b2 {
            if sieved[p] {
                primes.push(p);
                let mut j = p * p;
                while j <= b2 {
                    sieved[j] = false;
                    j += p;
                }
            }
        }

        let mut phase1_powers = Vec::new();
        for &p in &primes {
            if p > b1 { break; }
            let mut q = p;
            while q * p <= b1 {
                q *= p;
            }
            phase1_powers.push(q as u64);
        }

        let phase2_primes: Vec<usize> = primes.iter().filter(|&&p| p > b1 && p <= b2).cloned().collect();

        EcmRunner {
            n,
            b1,
            mont,
            prng,
            phase1_powers,
            phase2_primes,
        }
    }

    pub fn run_curves(&mut self, curves_to_run: usize) -> Option<Vec<u8>> {
        if self.n == Int::from(0) || self.n == Int::from(1) { return None; }

        for _ in 0..curves_to_run {
            let sigma = Int::from(get_secure_sigma(&mut self.prng));
            if let Some((x0, a24)) = get_suyama_curve(sigma, self.n) {
                let x0_mont = self.mont.transform(x0);
                let a24_mont = self.mont.transform(a24);
                let mut p = [x0_mont, self.mont.transform(Int::from(1))];

                for &power in &self.phase1_powers {
                    p = montgomery_ladder(power as usize, p[0], p[1], a24_mont, &self.mont);
                }

                let z_val = self.mont.reduce(DoubleInt::from(p[1]));
                let g1 = gcd(z_val, self.n);
                if g1 > Int::from(1) && g1 < self.n {
                    return Some(g1.to_le_bytes::<32>().to_vec());
                }

                if g1 == self.n || self.phase2_primes.is_empty() { continue; }

                let d_val = 210usize;
                let mut baby_x = vec![Int::from(0); 106];
                let mut baby_z = vec![Int::from(0); 106];
                for d in (1..=105).step_by(2) {
                    let pt = montgomery_ladder(d, p[0], p[1], a24_mont, &self.mont);
                    baby_x[d] = pt[0];
                    baby_z[d] = pt[1];
                }

                let s = montgomery_ladder(d_val, p[0], p[1], a24_mont, &self.mont);
                let first_q = self.phase2_primes[0];
                let mut m_current = (first_q + d_val / 2) / d_val;
                let mut r0 = montgomery_ladder(m_current, s[0], s[1], a24_mont, &self.mont);
                let mut r1 = montgomery_ladder(m_current + 1, s[0], s[1], a24_mont, &self.mont);

                let mut acc = self.mont.transform(Int::from(1));
                let mut iters_since_check = 0;

                for &q in &self.phase2_primes {
                    let m = (q + d_val / 2) / d_val;
                    let d_diff = q as isize - (m * d_val) as isize;
                    let abs_d = d_diff.unsigned_abs();

                    while m_current < m {
                        let mut next_r1 = [Int::from(0), Int::from(0)];
                        xadd_mont_inplace(&mut r1, &s, r0[0], r0[1], &self.mont, &mut next_r1);
                        r0 = r1;
                        r1 = next_r1;
                        m_current += 1;
                    }

                    let diff = self.mont.sub(self.mont.mul(r0[0], baby_z[abs_d]), self.mont.mul(baby_x[abs_d], r0[1]));
                    acc = self.mont.mul(acc, diff);
                    iters_since_check += 1;

                    if iters_since_check > 256 {
                        let acc_val = self.mont.reduce(DoubleInt::from(acc));
                        let g2 = gcd(acc_val, self.n);
                        if g2 > Int::from(1) && g2 < self.n {
                            return Some(g2.to_le_bytes::<32>().to_vec());
                        }
                        if g2 == self.n { break; }
                        acc = self.mont.transform(Int::from(1));
                        iters_since_check = 0;
                    }
                }
                let acc_val = self.mont.reduce(DoubleInt::from(acc));
                let g2 = gcd(acc_val, self.n);
                if g2 > Int::from(1) && g2 < self.n {
                    return Some(g2.to_le_bytes::<32>().to_vec());
                }
            }
        }
        None
    }
}

fn get_secure_sigma(prng: &mut Xoroshiro128PlusPlus) -> u64 {
    let s = prng.next() as u32 as u64;
    if s > 5 { s } else { s + 6 }
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
    fb: Vec<u32>,
    relations: Vec<SiqsRelation>,
}

#[wasm_bindgen]
impl SiqsReducer {
    #[wasm_bindgen(constructor)]
    pub fn new(n_bytes: &[u8], fb_primes: &[u32]) -> Self {
        let n = Int::try_from_le_slice(n_bytes).unwrap_or(Int::from(0));
        SiqsReducer {
            n,
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
            id[i][i / 32] |= 1 << (i % 32);

            let rel = &self.relations[i];
            if rel.sign == -1 {
                m[i][0] |= 1;
            }

            for &f_idx in &rel.factors {
                let col_idx = (f_idx + 1) as usize;
                let w_idx = col_idx / 32;
                let b_idx = col_idx % 32;
                m[i][w_idx] ^= 1 << b_idx;
            }
        }

        let mut num_pivots = 0;
        for c in 0..num_cols {
            let w_idx = c / 32;
            let b_idx = c % 32;

            let mut r = None;
            for i in num_pivots..num_rows {
                if (m[i][w_idx] & (1 << b_idx)) != 0 {
                    r = Some(i);
                    break;
                }
            }

            if let Some(r_idx) = r {
                m.swap(num_pivots, r_idx);
                id.swap(num_pivots, r_idx);

                for i in 0..num_rows {
                    if i != num_pivots {
                        if (m[i][w_idx] & (1 << b_idx)) != 0 {
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
                if (id[i][j / 32] & (1 << (j % 32))) != 0 {
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
                let rel_x = Int::try_from_le_slice(&rel.x).unwrap_or(Int::from(0));
                let rel_b = Int::try_from_le_slice(&rel.b).unwrap_or(Int::from(0));

                let rel_a = if rel.a.is_empty() {
                    Int::from(1)
                } else {
                    Int::try_from_le_slice(&rel.a).unwrap_or(Int::from(1))
                };

                let term_prod = DoubleInt::from(rel_a).wrapping_mul(DoubleInt::from(rel_x));
                let term_mod = term_prod % DoubleInt::from(self.n);
                let mut term = Int::from_limbs(term_mod.as_limbs()[..4].try_into().unwrap());
                term = (term + rel_b) % self.n;

                let x_prod = DoubleInt::from(x_val).wrapping_mul(DoubleInt::from(term));
                let x_mod = x_prod % DoubleInt::from(self.n);
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
                            res = Int::from_limbs((res_prod % DoubleInt::from(self.n)).as_limbs()[..4].try_into().unwrap());
                        }
                        let base_prod = DoubleInt::from(base_pow).wrapping_mul(DoubleInt::from(base_pow));
                        base_pow = Int::from_limbs((base_prod % DoubleInt::from(self.n)).as_limbs()[..4].try_into().unwrap());
                        exp >>= 1;
                    }

                    let y_prod = DoubleInt::from(y_val).wrapping_mul(DoubleInt::from(res));
                    y_val = Int::from_limbs((y_prod % DoubleInt::from(self.n)).as_limbs()[..4].try_into().unwrap());
                }
            }
            if !success {
                continue;
            }

            let mut diff = if x_val >= y_val { x_val - y_val } else { x_val + self.n - y_val };
            let mut g = gcd(diff, self.n);
            if g > Int::from(1) && g < self.n {
                return Some(g.to_le_bytes::<32>().to_vec());
            }

            let sum = (x_val + y_val) % self.n;
            g = gcd(sum, self.n);
            if g > Int::from(1) && g < self.n {
                return Some(g.to_le_bytes::<32>().to_vec());
            }
        }
        None
    }
}
