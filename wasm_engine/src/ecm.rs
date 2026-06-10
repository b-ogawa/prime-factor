use wasm_bindgen::prelude::*;
use crate::{Int, DoubleInt, MontgomerySpace, Xoroshiro128PlusPlus, gcd, int_from_le_slice};

#[wasm_bindgen]
pub fn pollard_p1_bytes(n_bytes: &[u8], b1: usize, primes: &[u32]) -> Option<Vec<u8>> {
    let n = int_from_le_slice(n_bytes);
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
        } else if diff == 1 {
            a_q = mont.mul(a_q, a);
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
    let n = int_from_le_slice(n_bytes);
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
    if k == 0 {
        return [mont.transform(Int::from(1)), mont.transform(Int::from(0))];
    }
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

pub(crate) fn ext_gcd_inverse_internal(a: Int, m: Int) -> Option<Int> {
    let mut t = Int::from(0);
    let mut newt = Int::from(1);
    let mut r = m;
    let mut newr = a;

    while newr != Int::from(0) {
        let quotient = r / newr;

        let temp_t = t;
        let q_newt_double = DoubleInt::from(quotient) * DoubleInt::from(newt);
        let q_newt_mod = q_newt_double % DoubleInt::from(m);
        let q_newt = Int::from_limbs(q_newt_mod.as_limbs()[..4].try_into().unwrap());
        
        t = newt;
        if temp_t >= q_newt {
            newt = temp_t - q_newt;
        } else {
            newt = m - (q_newt - temp_t);
        }

        let temp_r = r;
        r = newr;
        newr = temp_r % newr;
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

    let s2_minus_5 = if s2 >= Int::from(5) { s2 - Int::from(5) } else { (n - Int::from(5)) + s2 };
    let u = s2_minus_5 % n;
    let v = Int::from_limbs((DoubleInt::from(4) * DoubleInt::from(s) % DoubleInt::from(n)).as_limbs()[..4].try_into().unwrap());

    let u2 = Int::from_limbs((DoubleInt::from(u) * DoubleInt::from(u) % DoubleInt::from(n)).as_limbs()[..4].try_into().unwrap());
    let u3 = Int::from_limbs((DoubleInt::from(u2) * DoubleInt::from(u) % DoubleInt::from(n)).as_limbs()[..4].try_into().unwrap());

    let v2 = Int::from_limbs((DoubleInt::from(v) * DoubleInt::from(v) % DoubleInt::from(n)).as_limbs()[..4].try_into().unwrap());
    let v3 = Int::from_limbs((DoubleInt::from(v2) * DoubleInt::from(v) % DoubleInt::from(n)).as_limbs()[..4].try_into().unwrap());

    let x0 = u3;
    let z0 = v3;

    let v_u = if v >= u { v - u } else { (n - u) + v };
    let v_u2 = Int::from_limbs((DoubleInt::from(v_u) * DoubleInt::from(v_u) % DoubleInt::from(n)).as_limbs()[..4].try_into().unwrap());
    let v_u3 = Int::from_limbs((DoubleInt::from(v_u2) * DoubleInt::from(v_u) % DoubleInt::from(n)).as_limbs()[..4].try_into().unwrap());

    let three_u = Int::from_limbs((DoubleInt::from(3) * DoubleInt::from(u) % DoubleInt::from(n)).as_limbs()[..4].try_into().unwrap());
    let three_u_v = Int::from_limbs(((DoubleInt::from(three_u) + DoubleInt::from(v)) % DoubleInt::from(n)).as_limbs()[..4].try_into().unwrap());

    let term1 = Int::from_limbs((DoubleInt::from(v_u3) * DoubleInt::from(three_u_v) % DoubleInt::from(n)).as_limbs()[..4].try_into().unwrap());

    let eight_u3 = Int::from_limbs((DoubleInt::from(8) * DoubleInt::from(u3) % DoubleInt::from(n)).as_limbs()[..4].try_into().unwrap());
    let term2 = Int::from_limbs((DoubleInt::from(eight_u3) * DoubleInt::from(v) % DoubleInt::from(n)).as_limbs()[..4].try_into().unwrap());

    let a_num = if term1 >= term2 { term1 - term2 } else { (n - term2) + term1 };

    let four_u3 = Int::from_limbs((DoubleInt::from(4) * DoubleInt::from(u3) % DoubleInt::from(n)).as_limbs()[..4].try_into().unwrap());
    let a_den = Int::from_limbs((DoubleInt::from(four_u3) * DoubleInt::from(v) % DoubleInt::from(n)).as_limbs()[..4].try_into().unwrap());

    let two_a_den = Int::from_limbs((DoubleInt::from(2) * DoubleInt::from(a_den) % DoubleInt::from(n)).as_limbs()[..4].try_into().unwrap());
    let a24_num = Int::from_limbs(((DoubleInt::from(a_num) + DoubleInt::from(two_a_den)) % DoubleInt::from(n)).as_limbs()[..4].try_into().unwrap());

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
        let n = int_from_le_slice(n_bytes);
        let mont = MontgomerySpace::new(n);
        let prng = Xoroshiro128PlusPlus::new();

        let b2 = b1 * 50;
        let mut sieved = vec![true; b2 + 1];
        let mut primes = Vec::new();
        
        let limit = (b2 as f64).sqrt() as usize;
        for p in 2..=limit {
            if sieved[p] {
                let mut j = p * p;
                while j <= b2 {
                    sieved[j] = false;
                    j += p;
                }
            }
        }
        for p in 2..=b2 {
            if sieved[p] {
                primes.push(p);
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
                        if g2 == self.n {
                            // Backtrack
                            break;
                        }
                        acc = self.mont.transform(Int::from(1));
                        iters_since_check = 0;
                    }
                }
                let acc_val = self.mont.reduce(DoubleInt::from(acc));
                let g2 = gcd(acc_val, self.n);
                if g2 > Int::from(1) && g2 < self.n {
                    return Some(g2.to_le_bytes::<32>().to_vec());
                } else if g2 == self.n {
                    // Backtrack through the phase2 primes to find the exact factor
                    let mut m_current_backtrack = (first_q + d_val / 2) / d_val;
                    let mut r0_bt = montgomery_ladder(m_current_backtrack, s[0], s[1], a24_mont, &self.mont);
                    let mut r1_bt = montgomery_ladder(m_current_backtrack + 1, s[0], s[1], a24_mont, &self.mont);

                    for &q in &self.phase2_primes {
                        let m = (q + d_val / 2) / d_val;
                        let d_diff = q as isize - (m * d_val) as isize;
                        let abs_d = d_diff.unsigned_abs();

                        while m_current_backtrack < m {
                            let mut next_r1 = [Int::from(0), Int::from(0)];
                            xadd_mont_inplace(&mut r1_bt, &s, r0_bt[0], r0_bt[1], &self.mont, &mut next_r1);
                            r0_bt = r1_bt;
                            r1_bt = next_r1;
                            m_current_backtrack += 1;
                        }

                        let diff = self.mont.sub(self.mont.mul(r0_bt[0], baby_z[abs_d]), self.mont.mul(baby_x[abs_d], r0_bt[1]));
                        let diff_val = self.mont.reduce(DoubleInt::from(diff));
                        let g_bt = gcd(diff_val, self.n);
                        if g_bt > Int::from(1) && g_bt < self.n {
                            return Some(g_bt.to_le_bytes::<32>().to_vec());
                        }
                    }
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

