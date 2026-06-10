use wasm_bindgen::prelude::*;
use crate::{Int, DoubleInt, Xoroshiro128PlusPlus, int_from_le_slice};
use crate::ecm::ext_gcd_inverse_internal;

fn mod_inverse_u32(mut a: i64, mut m: i64) -> u32 {
    let m0 = m;
    let mut y = 0i64;
    let mut x = 1i64;
    if m == 1 { return 0; }
    while a > 1 {
        if m == 0 { return 0; }
        let q = a / m;
        let mut t = m;
        m = a % m;
        a = t;
        t = y;
        y = x - q * y;
        x = t;
    }
    if x < 0 { x += m0; }
    x as u32
}

#[wasm_bindgen]
pub struct SiqsWorker {
    n: Int,
    fb: Vec<u32>,
    fb_log: Vec<u8>,
    fb_r: Vec<Int>,
    sieve_limit: usize,
    m: usize,
    prng: Xoroshiro128PlusPlus,
    worker_id: usize,
    s_val: usize,
    kn: Int, // The target kN
    sieve: Vec<u16>, // Reused sieve array to avoid reallocation
}

#[wasm_bindgen]
impl SiqsWorker {
    #[wasm_bindgen(constructor)]
    pub fn new(kn_bytes: &[u8], fb_primes: &[u32], fb_logs: &[u8], fb_r_bytes: &[u8], sieve_limit: usize, worker_id: usize) -> Result<SiqsWorker, JsValue> {
        if sieve_limit < 100 {
            return Err(JsValue::from_str("sieve_limit must be at least 100"));
        }

        let kn = int_from_le_slice(kn_bytes);

        let digits = kn.to_string().len(); // approximation for bits is better but this matches JS
        let mut s_val = 1;
        if digits >= 24 { s_val = 2; }
        if digits >= 32 { s_val = 3; }
        if digits >= 40 { s_val = 4; }
        if digits >= 48 { s_val = 5; }
        if digits >= 56 { s_val = 6; }
        if digits >= 64 { s_val = 7; }

        if fb_primes.len() < s_val + 10 {
            return Err(JsValue::from_str("fb_primes is too small"));
        }
        if fb_primes.contains(&0) {
            return Err(JsValue::from_str("fb_primes must not contain 0"));
        }

        let fb_len = fb_primes.len();
        
        let mut fb_r = Vec::with_capacity(fb_len);
        for i in 0..fb_len {
            let start = i * 32;
            let end = start + 32;
            let r_val = if end <= fb_r_bytes.len() {
                int_from_le_slice(&fb_r_bytes[start..end])
            } else {
                Int::from(0)
            };
            fb_r.push(r_val);
        }

        let mut prng = Xoroshiro128PlusPlus::new();
        // Seed offset based on worker_id
        for _ in 0..worker_id {
            prng.next();
        }

        Ok(SiqsWorker {
            n: kn,
            fb: fb_primes.to_vec(),
            fb_log: fb_logs.to_vec(),
            fb_r,
            sieve_limit,
            m: sieve_limit / 2,
            prng,
            worker_id,
            s_val,
            kn,
            sieve: vec![0u16; sieve_limit],
        })
    }
}

#[derive(PartialEq, Eq)]
pub enum Sign {
    Positive,
    Negative,
}

pub(crate) fn evaluate_polynomial(a: Int, b: Int, c: Int, c_is_neg: bool, x: Int, x_is_neg: bool) -> (Int, Sign) {
    let ax2_double = DoubleInt::from(a) * DoubleInt::from(x) * DoubleInt::from(x);
    let bx2_double = DoubleInt::from(Int::from(2)) * DoubleInt::from(b) * DoubleInt::from(x);
    let c_double = DoubleInt::from(c);

    let mut sum = ax2_double;
    let mut val_sign = Sign::Positive;

    if x_is_neg {
        if sum >= bx2_double {
            sum = sum - bx2_double;
        } else {
            sum = bx2_double - sum;
            val_sign = Sign::Negative;
        }
    } else {
        sum = sum + bx2_double;
    }

    if c_is_neg {
        if val_sign == Sign::Positive {
            if sum >= c_double {
                sum = sum - c_double;
            } else {
                sum = c_double - sum;
                val_sign = Sign::Negative;
            }
        } else {
            sum = sum + c_double; // both negative, sum increases, sign stays negative
        }
    } else {
        if val_sign == Sign::Positive {
            sum = sum + c_double;
        } else {
            if sum >= c_double {
                sum = sum - c_double; // sign stays negative
            } else {
                sum = c_double - sum;
                val_sign = Sign::Positive;
            }
        }
    }

    let result = Int::from_limbs(sum.as_limbs()[..4].try_into().unwrap());
    (result, val_sign)
}

// Sieve core logic
#[wasm_bindgen]
impl SiqsWorker {
    pub fn step(&mut self, batch_size: usize) -> Vec<u8> {
        let mut relations_data = Vec::new();
        let mut relations_count = 0u32;
        let mut polys_searched = 0u64;

        let fb_len = self.fb.len();
        let s = self.s_val;
        let mut q_indices = vec![0usize; s];
        
        for _batch in 0..batch_size {
            // Dynamic construction of polynomial coefficient A ~ sqrt(2kN)/M
            // Newton's method for U512 (DoubleInt) square root
            let double_kn = DoubleInt::from(self.kn) * DoubleInt::from(2);
            let mut sqrt_2kn = double_kn;
            if double_kn > DoubleInt::ZERO {
                let mut y = (sqrt_2kn + DoubleInt::from(1)) >> 1;
                while y < sqrt_2kn {
                    sqrt_2kn = y;
                    y = (sqrt_2kn + double_kn / sqrt_2kn) >> 1;
                }
            }
            let target_a = sqrt_2kn / DoubleInt::from(self.m);

            // Estimate target size of each prime q_i ~ target_a ^ (1/s)
            let l_t = 512 - target_a.leading_zeros();
            let l_s = l_t / s;
            let target_q = if l_s >= 32 {
                u32::MAX
            } else {
                1u32 << l_s
            };

            // Binary search in self.fb for target_q
            let mut opt_idx = self.fb.binary_search(&target_q).unwrap_or_else(|x| x);
            if opt_idx >= fb_len {
                opt_idx = fb_len - 1;
            }

            let start_idx = core::cmp::max(10, fb_len / 10);
            let w = 40;
            let mut min_idx = if opt_idx > w { opt_idx - w } else { start_idx };
            if min_idx < start_idx { min_idx = start_idx; }
            let mut max_idx = opt_idx + w;
            if max_idx >= fb_len { max_idx = fb_len - 1; }

            if max_idx < min_idx || max_idx - min_idx + 1 < s {
                min_idx = start_idx;
                max_idx = fb_len - 1;
            }

            let mut used = vec![false; fb_len];
            let mut a_prev = DoubleInt::from(1);
            for i in 0..(s - 1) {
                loop {
                    let r = (self.prng.next() as usize % (max_idx - min_idx + 1)) + min_idx;
                    if !used[r] {
                        used[r] = true;
                        q_indices[i] = r;
                        a_prev = a_prev * DoubleInt::from(self.fb[r]);
                        break;
                    }
                }
            }

            let target_rem = if target_a > a_prev {
                let rem = target_a / a_prev;
                let limbs = rem.as_limbs();
                if limbs[1] > 0 || limbs[2] > 0 || limbs[3] > 0 || limbs[4] > 0 || limbs[5] > 0 || limbs[6] > 0 || limbs[7] > 0 {
                    u32::MAX
                } else {
                    limbs[0] as u32
                }
            } else {
                2u32
            };

            let mut last_idx = self.fb.binary_search(&target_rem).unwrap_or_else(|x| x);
            if last_idx >= fb_len {
                last_idx = fb_len - 1;
            }
            if last_idx < start_idx {
                last_idx = start_idx;
            }

            let mut best_r = last_idx;
            let mut best_diff = i64::MAX;
            for offset in 0..100 {
                for sign in &[-1, 1] {
                    let cand = last_idx as isize + offset * sign;
                    if cand >= start_idx as isize && cand < fb_len as isize {
                        let r_cand = cand as usize;
                        if !used[r_cand] {
                            let diff = (self.fb[r_cand] as i64 - target_rem as i64).abs();
                            if diff < best_diff {
                                best_diff = diff;
                                best_r = r_cand;
                            }
                        }
                    }
                }
                if best_diff == 0 { break; }
            }

            q_indices[s - 1] = best_r;
            used[best_r] = true;

            let mut a_val = Int::from(1);
            for i in 0..s {
                a_val = a_val * Int::from(self.fb[q_indices[i]]);
            }

            // Calculate B_i_prime
            let mut skip = false;
            let mut b_i_prime = vec![Int::from(0); s];
            for i in 0..s {
                let q_i = Int::from(self.fb[q_indices[i]]);
                let b_i = self.fb_r[q_indices[i]];
                let big_q_i = a_val / q_i;
                let big_q_mod = big_q_i % q_i;
                if let Some(inv_res) = ext_gcd_inverse_internal(big_q_mod, q_i) {
                    let gamma = (b_i * inv_res) % q_i;
                    b_i_prime[i] = gamma * big_q_i;
                } else {
                    skip = true;
                    break;
                }
            }
            if skip { continue; }

            let mut b_val = Int::from(0);
            for i in 0..s {
                b_val = (b_val + b_i_prime[i]) % a_val;
            }

            let mut a_inv_p = vec![0u32; fb_len];
            let mut x1_p = vec![0u32; fb_len];
            let mut x2_p = vec![0u32; fb_len];
            let mut delta_x = vec![vec![0u32; fb_len]; s];

            // Carrier-Wagstaff approach
            for j in 0..fb_len {
                let mut is_factor = false;
                for i in 0..s {
                    if q_indices[i] == j { is_factor = true; break; }
                }
                if is_factor { continue; }

                let p = self.fb[j];
                let p_int = Int::from(p);
                
                // a_inv = Product of q_i mod p, then compute modular inverse
                let mut a_mod = 1u64;
                for i in 0..s {
                    a_mod = (a_mod * (self.fb[q_indices[i]] as u64)) % (p as u64);
                }
                let a_inv_u64 = mod_inverse_u32(a_mod as i64, p as i64) as u64;
                a_inv_p[j] = a_inv_u64 as u32;

                let b_mod = b_val % p_int;
                let b_mod_u64 = b_mod.as_limbs()[0];
                let r_j = self.fb_r[j].as_limbs()[0];

                let x1_num = (r_j + p as u64 - b_mod_u64) % (p as u64);
                let x2_num = ((p as u64) * 2 - r_j - b_mod_u64) % (p as u64);

                let x1_val = ((a_inv_u64 * x1_num) % (p as u64)) as u32;
                let x2_val = ((a_inv_u64 * x2_num) % (p as u64)) as u32;

                x1_p[j] = (((x1_val as u64) + (self.m as u64)) % (p as u64)) as u32;
                x2_p[j] = (((x2_val as u64) + (self.m as u64)) % (p as u64)) as u32;

                for k in 1..s {
                    let db = (Int::from(2) * b_i_prime[k]) % p_int;
                    let db_u64 = db.as_limbs()[0];
                    delta_x[k][j] = ((a_inv_u64 * db_u64) % (p as u64)) as u32;
                }
            }

            let polys_in_a = 1 << (s - 1);
            let mut nu = vec![1i8; s];

            for poly_idx in 0..polys_in_a {
                polys_searched += 1;
                if poly_idx > 0 {
                    let mut k = 1;
                    let mut temp = poly_idx;
                    while (temp & 1) == 0 { k += 1; temp >>= 1; }
                    nu[k] = -nu[k];
                    if nu[k] == -1 {
                        let sub_val = (Int::from(2) * b_i_prime[k]) % a_val;
                        b_val = if b_val >= sub_val { b_val - sub_val } else { (a_val - sub_val) + b_val };
                        for j in 0..fb_len {
                            if a_inv_p[j] == 0 { continue; }
                            let dx = delta_x[k][j];
                            let p = self.fb[j];
                            x1_p[j] = (((x1_p[j] as u64) + (dx as u64)) % (p as u64)) as u32;
                            x2_p[j] = (((x2_p[j] as u64) + (dx as u64)) % (p as u64)) as u32;
                        }
                    } else {
                        let add_val = (Int::from(2) * b_i_prime[k]) % a_val;
                        b_val = (b_val + add_val) % a_val;
                        for j in 0..fb_len {
                            if a_inv_p[j] == 0 { continue; }
                            let dx = delta_x[k][j];
                            let p = self.fb[j];
                            x1_p[j] = if x1_p[j] >= dx { x1_p[j] - dx } else { ((x1_p[j] as u64 + p as u64) - dx as u64) as u32 };
                            x2_p[j] = if x2_p[j] >= dx { x2_p[j] - dx } else { ((x2_p[j] as u64 + p as u64) - dx as u64) as u32 };
                        }
                    }
                }

                // C = (B^2 - N) / A
                // We actually don't strictly need C if we just evaluate A*x^2 + 2Bx + C later, but let's compute it.
                // We use DoubleInt for B^2 - N
                let b2 = DoubleInt::from(b_val).wrapping_mul(DoubleInt::from(b_val));
                let c_val = if b2 >= DoubleInt::from(self.kn) {
                    let diff = b2 - DoubleInt::from(self.kn);
                    let diff_int = Int::from_limbs(diff.as_limbs()[..4].try_into().unwrap());
                    diff_int / a_val
                } else {
                    let diff = DoubleInt::from(self.kn) - b2;
                    let diff_int = Int::from_limbs(diff.as_limbs()[..4].try_into().unwrap());
                    diff_int / a_val // It's negative C, we handle sign during eval
                };
                let c_is_neg = b2 < DoubleInt::from(self.kn);

                self.sieve.fill(0);
                for j in 0..fb_len {
                    if a_inv_p[j] == 0 { continue; }
                    let p = self.fb[j] as usize;
                    let log_p = self.fb_log[j] as u16;
                    let mut idx1 = x1_p[j] as usize;
                    while idx1 < self.sieve_limit {
                        self.sieve[idx1] = self.sieve[idx1].saturating_add(log_p);
                        idx1 += p;
                    }
                    if p > 2 {
                        let mut idx2 = x2_p[j] as usize;
                        while idx2 < self.sieve_limit {
                            self.sieve[idx2] = self.sieve[idx2].saturating_add(log_p);
                            idx2 += p;
                        }
                    }
                }

                let log2_a = a_val.to_string().len() * 3; // Approx bit length. Real length: 256 - a_val.leading_zeros()
                let log2_a_actual = 256 - a_val.leading_zeros();
                let log2_m_approx = 31 - (self.m as u32).leading_zeros();
                let buffer = 8 * (31 - self.fb.last().unwrap().leading_zeros()); // log2 of max p
                let mut threshold = ((log2_a_actual as i32 + 2 * log2_m_approx as i32) * 8) - buffer as i32;
                if threshold < 0 { threshold = 0; }
                let threshold_u16 = core::cmp::min(65535, threshold) as u16;

                for i in 0..self.sieve_limit {
                    if self.sieve[i] >= threshold_u16 {
                        let x = if i >= self.m {
                            Int::from(i - self.m)
                        } else {
                            Int::from(self.m - i)
                        };
                        let x_is_neg = i < self.m;

                        let x_i64 = (i as i64) - (self.m as i64);
                        
                        let (mut temp, val_sign_enum) = evaluate_polynomial(a_val, b_val, c_val, c_is_neg, x, x_is_neg);
                        let val_sign = if val_sign_enum == Sign::Positive { 1i32 } else { -1i32 };

                        let mut factors = Vec::new();
                        for j in 0..fb_len {
                            let p = Int::from(self.fb[j]);
                            while temp > Int::from(0) && (temp % p) == Int::from(0) {
                                factors.push(j as u32);
                                temp = temp / p;
                            }
                        }

                        if temp == Int::from(1) {
                            for k in 0..s {
                                factors.push(q_indices[k] as u32);
                            }
                            let flags = if val_sign == 1 { 2u8 } else { 0u8 };
                            relations_data.push(flags);
                            relations_data.extend_from_slice(&x_i64.to_le_bytes());
                            relations_data.extend_from_slice(&a_val.to_le_bytes::<32>());
                            relations_data.extend_from_slice(&b_val.to_le_bytes::<32>());
                            
                            let factors_len = factors.len() as u16;
                            relations_data.extend_from_slice(&factors_len.to_le_bytes());
                            for &f in &factors {
                                relations_data.extend_from_slice(&f.to_le_bytes());
                            }
                            relations_count += 1;
                        } else {
                            // Partial relation
                            let max_p = Int::from(self.fb[fb_len - 1]);
                            if temp > Int::from(1) && temp < max_p * max_p {
                                for k in 0..s {
                                    factors.push(q_indices[k] as u32);
                                }
                                let flags = if val_sign == 1 { 3u8 } else { 1u8 };
                                relations_data.push(flags);
                                relations_data.extend_from_slice(&x_i64.to_le_bytes());
                                relations_data.extend_from_slice(&a_val.to_le_bytes::<32>());
                                relations_data.extend_from_slice(&b_val.to_le_bytes::<32>());
                                relations_data.extend_from_slice(&temp.to_le_bytes::<32>());
                                
                                let factors_len = factors.len() as u16;
                                relations_data.extend_from_slice(&factors_len.to_le_bytes());
                                for &f in &factors {
                                    relations_data.extend_from_slice(&f.to_le_bytes());
                                }
                                relations_count += 1;
                            }
                        }
                    }
                }
            }
        }
        
        let mut output = Vec::with_capacity(12 + relations_data.len());
        output.extend_from_slice(&polys_searched.to_le_bytes());
        output.extend_from_slice(&relations_count.to_le_bytes());
        output.extend_from_slice(&relations_data);
        output
    }
}
