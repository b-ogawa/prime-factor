use crate::math::{gcd, int_from_le_slice, DoubleInt, Int, MontgomerySpace, Xoroshiro128PlusPlus};
use crate::check_abort;


// Montgomery ECM operations
fn xadd_mont_inplace(
    r0: &[Int; 2],
    r1: &[Int; 2],
    xdiff: Int,
    zdiff: Int,
    mont: &MontgomerySpace,
    dest: &mut [Int; 2],
) {
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

fn xadd_mont_inplace_z1(
    r0: &[Int; 2],
    r1: &[Int; 2],
    xdiff: Int,
    mont: &MontgomerySpace,
    dest: &mut [Int; 2],
) {
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

fn montgomery_ladder(k: u64, x: Int, z: Int, a24: Int, mont: &MontgomerySpace) -> [Int; 2] {
    if k == 0 {
        return [mont.transform(Int::from(1)), mont.transform(Int::from(0))];
    }
    let mut r0 = [x, z];
    let mut r1 = [Int::from(0), Int::from(0)];
    xdbl_mont_inplace(&r0, a24, mont, &mut r1);

    let is_z1 = z == mont.transform(Int::from(1));
    // k は u64 になったので、確実に 64 - leading_zeros() が機能します
    let k_bits = 64 - k.leading_zeros() as usize;

    for i in (0..k_bits - 1).rev() {
        let mut next_r0 = [Int::from(0), Int::from(0)];
        let mut next_r1 = [Int::from(0), Int::from(0)];
        if ((k >> i) & 1) == 1 {
            if is_z1 {
                xadd_mont_inplace_z1(&r0, &r1, x, mont, &mut next_r0);
            } else {
                xadd_mont_inplace(&r0, &r1, x, z, mont, &mut next_r0);
            }
            xdbl_mont_inplace(&r1, a24, mont, &mut next_r1);
        } else {
            if is_z1 {
                xadd_mont_inplace_z1(&r0, &r1, x, mont, &mut next_r1);
            } else {
                xadd_mont_inplace(&r0, &r1, x, z, mont, &mut next_r1);
            }
            xdbl_mont_inplace(&r0, a24, mont, &mut next_r0);
        }
        r0 = next_r0;
        r1 = next_r1;
    }
    r0
}


fn get_suyama_curve(sigma: Int, n: Int, mont: &MontgomerySpace) -> Result<(Int, Int), Option<Int>> {
    let s = mont.transform(sigma);
    let s2 = mont.mul(s, s);
    let five = mont.transform(Int::from(5));
    let u = mont.sub(s2, five);
    let four = mont.transform(Int::from(4));
    let v = mont.mul(four, s);

    let u2 = mont.mul(u, u);
    let u3 = mont.mul(u2, u);
    let v2 = mont.mul(v, v);
    let v3 = mont.mul(v2, v);

    let x0 = u3;
    let z0 = v3;

    let v_u = mont.sub(v, u);
    let v_u2 = mont.mul(v_u, v_u);
    let v_u3 = mont.mul(v_u2, v_u);

    let three = mont.transform(Int::from(3));
    let three_u = mont.mul(three, u);
    let three_u_v = mont.add(three_u, v);

    let term1 = mont.mul(v_u3, three_u_v); // a24_num
    
    let eight = mont.transform(Int::from(8));
    let eight_u3 = mont.mul(eight, u3);
    let term2 = mont.mul(eight_u3, v);

    let two = mont.transform(Int::from(2));
    let a24_den = mont.mul(two, term2);

    // z0 のチェック
    let z0_normal = mont.reduce(DoubleInt::from(z0));
    let g_z0 = gcd(z0_normal, n);
    if g_z0 > Int::from(1) {
        if g_z0 < n {
            return Err(Some(g_z0));
        } else {
            return Err(None);
        }
    }

    // a24_den のチェック
    let a24_den_normal = mont.reduce(DoubleInt::from(a24_den));
    let g_a24 = gcd(a24_den_normal, n);
    if g_a24 > Int::from(1) {
        if g_a24 < n {
            return Err(Some(g_a24));
        } else {
            return Err(None);
        }
    }

    let z0_inv = mont.transform(crate::math::ext_gcd_inverse(z0_normal, n).unwrap());
    let a24_den_inv = mont.transform(crate::math::ext_gcd_inverse(a24_den_normal, n).unwrap());

    let x0_scaled = mont.mul(x0, z0_inv);
    let a24 = mont.mul(term1, a24_den_inv);

    Ok((x0_scaled, a24))
}

pub struct EcmRunner {
    n: Int,
    mont: MontgomerySpace,
    prng: Xoroshiro128PlusPlus,
    phase1_powers: Vec<u64>,
    phase2_primes: Vec<usize>,
}

impl EcmRunner {
    /// ECMの実行状態を初期化する。
    pub fn new(n_bytes: &[u8], b1: usize) -> Self {
        let params = crate::config::EcmParams::default();
        let n = int_from_le_slice(n_bytes);
        
        let mont_n = if n == Int::from(0) || n == Int::from(1) || n.as_limbs()[0] & 1 == 0 {
            Int::from(3)
        } else {
            n
        };
        let mont = MontgomerySpace::new(mont_n);
        let prng = Xoroshiro128PlusPlus::new();

        let b2 = b1 * params.ecm_b2_multiplier;
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
            if p > b1 {
                break;
            }
            let mut q = p as u64;
            let p_u64 = p as u64;
            // u64 にして計算し、オーバーフロー時は saturating_mul で最大値にしてループを抜ける
            while q.saturating_mul(p_u64) <= b1 as u64 {
                q *= p_u64;
            }
            phase1_powers.push(q);
        }

        let phase2_primes: Vec<usize> = primes
            .iter()
            .filter(|&&p| p > b1 && p <= b2)
            .cloned()
            .collect();

        EcmRunner {
            n,
            mont,
            prng,
            phase1_powers,
            phase2_primes,
        }
    }

    pub fn run_curves(&mut self, curves_to_run: usize) -> Option<Vec<u8>> {
        let params = crate::config::EcmParams::default();
        if self.n == Int::from(0) || self.n == Int::from(1) {
            return None;
        }
        if self.n.as_limbs()[0] & 1 == 0 {
            return Some(Int::from(2).to_le_bytes::<32>().to_vec()); // 偶数なら即座に2を返す
        }

        for _ in 0..curves_to_run {
            if check_abort() == 1 {
                return None;
            }
            let sigma = Int::from(get_secure_sigma(&mut self.prng));
            match get_suyama_curve(sigma, self.n, &self.mont) {
                Ok((x0_mont, a24_mont)) => {
                    let mut p = [x0_mont, self.mont.transform(Int::from(1))];

                    for &power in &self.phase1_powers {
                        p = montgomery_ladder(power, p[0], p[1], a24_mont, &self.mont);
                    }

                    let z_val = self.mont.reduce(DoubleInt::from(p[1]));
                    let g1 = gcd(z_val, self.n);
                    if g1 > Int::from(1) && g1 < self.n {
                        return Some(g1.to_le_bytes::<32>().to_vec());
                    }

                    if g1 == self.n || self.phase2_primes.is_empty() {
                        continue;
                    }

                    let d_val = params.d_val;
                    let baby_size = d_val / 2 + 1;
                    let mut baby_x = vec![Int::from(0); baby_size];
                    let mut baby_z = vec![Int::from(0); baby_size];
                    for d in (1..=d_val / 2).step_by(2) {
                        let pt = montgomery_ladder(d as u64, p[0], p[1], a24_mont, &self.mont);
                        baby_x[d] = pt[0];
                        baby_z[d] = pt[1];
                    }

                    let s = montgomery_ladder(d_val as u64, p[0], p[1], a24_mont, &self.mont);
                    let first_q = self.phase2_primes[0];
                    let mut m_current = (first_q + d_val / 2) / d_val;
                    let mut r0 =
                        montgomery_ladder(m_current as u64, s[0], s[1], a24_mont, &self.mont);
                    let mut r1 =
                        montgomery_ladder((m_current + 1) as u64, s[0], s[1], a24_mont, &self.mont);

                    let mut acc = self.mont.transform(Int::from(1));
                    let mut iters_since_check = 0;

                    for &q in &self.phase2_primes {
                        let m = (q + d_val / 2) / d_val;
                        let d_diff = q as isize - (m * d_val) as isize;
                        let abs_d = d_diff.unsigned_abs();

                        while m_current < m {
                            let mut next_r1 = [Int::from(0), Int::from(0)];
                            xadd_mont_inplace(&r1, &s, r0[0], r0[1], &self.mont, &mut next_r1);
                            r0 = r1;
                            r1 = next_r1;
                            m_current += 1;
                        }

                        let diff = self.mont.sub(
                            self.mont.mul(r0[0], baby_z[abs_d]),
                            self.mont.mul(baby_x[abs_d], r0[1]),
                        );
                        acc = self.mont.mul(acc, diff);
                        iters_since_check += 1;

                        if iters_since_check > params.gcd_check_interval {
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
                        let mut r0_bt = montgomery_ladder(
                            m_current_backtrack as u64,
                            s[0],
                            s[1],
                            a24_mont,
                            &self.mont,
                        );
                        let mut r1_bt = montgomery_ladder(
                            (m_current_backtrack + 1) as u64,
                            s[0],
                            s[1],
                            a24_mont,
                            &self.mont,
                        );

                        for &q in &self.phase2_primes {
                            let m = (q + d_val / 2) / d_val;
                            let d_diff = q as isize - (m * d_val) as isize;
                            let abs_d = d_diff.unsigned_abs();

                            while m_current_backtrack < m {
                                let mut next_r1 = [Int::from(0), Int::from(0)];
                                xadd_mont_inplace(
                                    &r1_bt,
                                    &s,
                                    r0_bt[0],
                                    r0_bt[1],
                                    &self.mont,
                                    &mut next_r1,
                                );
                                r0_bt = r1_bt;
                                r1_bt = next_r1;
                                m_current_backtrack += 1;
                            }

                            let diff = self.mont.sub(
                                self.mont.mul(r0_bt[0], baby_z[abs_d]),
                                self.mont.mul(baby_x[abs_d], r0_bt[1]),
                            );
                            let diff_val = self.mont.reduce(DoubleInt::from(diff));
                            let g_bt = gcd(diff_val, self.n);
                            if g_bt > Int::from(1) && g_bt < self.n {
                                return Some(g_bt.to_le_bytes::<32>().to_vec());
                            }
                        }
                    }
                }
                Err(Some(lucky_factor)) => {
                    return Some(lucky_factor.to_le_bytes::<32>().to_vec());
                }
                Err(None) => {
                    continue;
                }
            }
        }
        None
    }
}

fn get_secure_sigma(prng: &mut Xoroshiro128PlusPlus) -> u64 {
    let s = prng.next() as u32 as u64;
    if s > 5 {
        s
    } else {
        s + 6
    }
}
