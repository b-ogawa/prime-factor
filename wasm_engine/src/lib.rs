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
    let s2 = (s * s) % n;
    let s2_minus_5 = if s2 >= Int::from(5) { s2 - Int::from(5) } else { s2 + n - Int::from(5) };
    let u = s2_minus_5 % n;
    let v = (Int::from(4) * s) % n;
    let u3 = (u * u % n * u) % n;
    let v3 = (v * v % n * v) % n;
    let x0 = u3;
    let z0 = v3;

    let v_u = if v >= u { v - u } else { v + n - u };
    let v_u3 = (v_u * v_u % n * v_u) % n;
    let three_u_v = (Int::from(3) * u + v) % n;
    let term1 = (v_u3 * three_u_v) % n;
    let term2 = (Int::from(8) * u3 % n * v) % n;
    let a_num = if term1 >= term2 { term1 - term2 } else { term1 + n - term2 };
    let a_den = (Int::from(4) * u3 % n * v) % n;
    let a24_num = (a_num + Int::from(2) * a_den) % n;
    let a24_den = (Int::from(4) * a_den) % n;

    let z0_inv = ext_gcd_inverse_internal(z0, n)?;
    let a24_den_inv = ext_gcd_inverse_internal(a24_den, n)?;

    let a24 = (a24_num * a24_den_inv) % n;
    let x0_scaled = (x0 * z0_inv) % n;
    Some((x0_scaled, a24))
}

#[wasm_bindgen]
pub fn run_ecm_bytes(n_bytes: &[u8], b1: usize, max_curves: usize) -> Option<Vec<u8>> {
    let n = Int::try_from_le_slice(n_bytes).unwrap_or(Int::from(0));
    if n == Int::from(0) || n == Int::from(1) { return None; }
    let mont = MontgomerySpace::new(n);
    let mut prng = Xoroshiro128PlusPlus::new();

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
        phase1_powers.push(q);
    }

    let phase2_primes: Vec<usize> = primes.iter().filter(|&&p| p > b1 && p <= b2).cloned().collect();

    for _ in 0..max_curves {
        let sigma = Int::from(get_secure_sigma(&mut prng));
        if let Some((x0, a24)) = get_suyama_curve(sigma, n) {
            let x0_mont = mont.transform(x0);
            let a24_mont = mont.transform(a24);
            let mut p = [x0_mont, mont.transform(Int::from(1))];

            for &power in &phase1_powers {
                p = montgomery_ladder(power, p[0], p[1], a24_mont, &mont);
            }

            let z_val = mont.reduce(DoubleInt::from(p[1]));
            let g1 = gcd(z_val, n);
            if g1 > Int::from(1) && g1 < n {
                return Some(g1.to_le_bytes::<32>().to_vec());
            }

            if g1 == n || phase2_primes.is_empty() { continue; }

            let d_val = 210usize;
            let mut baby_x = vec![Int::from(0); 106];
            let mut baby_z = vec![Int::from(0); 106];
            for d in (1..=105).step_by(2) {
                let pt = montgomery_ladder(d, p[0], p[1], a24_mont, &mont);
                baby_x[d] = pt[0];
                baby_z[d] = pt[1];
            }

            let s = montgomery_ladder(d_val, p[0], p[1], a24_mont, &mont);
            let first_q = phase2_primes[0];
            let mut m_current = (first_q + d_val / 2) / d_val;
            let mut r0 = montgomery_ladder(m_current, s[0], s[1], a24_mont, &mont);
            let mut r1 = montgomery_ladder(m_current + 1, s[0], s[1], a24_mont, &mont);

            let mut acc = mont.transform(Int::from(1));
            let mut iters_since_check = 0;

            for &q in &phase2_primes {
                let m = (q + d_val / 2) / d_val;
                let d_diff = q as isize - (m * d_val) as isize;
                let abs_d = d_diff.unsigned_abs();

                while m_current < m {
                    let mut next_r1 = [Int::from(0), Int::from(0)];
                    xadd_mont_inplace(&mut r1, &s, r0[0], r0[1], &mont, &mut next_r1);
                    r0 = r1;
                    r1 = next_r1;
                    m_current += 1;
                }

                let diff = mont.sub(mont.mul(r0[0], baby_z[abs_d]), mont.mul(baby_x[abs_d], r0[1]));
                acc = mont.mul(acc, diff);
                iters_since_check += 1;

                if iters_since_check > 256 {
                    let acc_val = mont.reduce(DoubleInt::from(acc));
                    let g2 = gcd(acc_val, n);
                    if g2 > Int::from(1) && g2 < n {
                        return Some(g2.to_le_bytes::<32>().to_vec());
                    }
                    if g2 == n { break; }
                    acc = mont.transform(Int::from(1));
                    iters_since_check = 0;
                }
            }
            let acc_val = mont.reduce(DoubleInt::from(acc));
            let g2 = gcd(acc_val, n);
            if g2 > Int::from(1) && g2 < n {
                return Some(g2.to_le_bytes::<32>().to_vec());
            }
        }
    }
    None
}

fn get_secure_sigma(prng: &mut Xoroshiro128PlusPlus) -> u64 {
    let s = prng.next() as u32 as u64;
    if s > 5 { s } else { s + 6 }
}

// This is a dummy function just to ensure the file parses successfully.
// The actual logic is appended via another mechanism due to patch format issues.
