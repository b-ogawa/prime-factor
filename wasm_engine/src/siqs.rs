use wasm_bindgen::prelude::*;
use crate::{Int, DoubleInt, Xoroshiro128PlusPlus, int_from_le_slice};
use crate::ecm::ext_gcd_inverse_internal;

#[wasm_bindgen]
pub struct SiqsWorker {
    n: Int,
    fb: Vec<u32>,
    fb_log: Vec<u8>,
    fb_r: Vec<Int>,
    sieve_limit: usize,
    m: usize,
    q_inv_table: Vec<Vec<u32>>, // precomputed inverses for Carrier-Wagstaff
    prng: Xoroshiro128PlusPlus,
    worker_id: usize,
    s_val: usize,
    kn: Int, // The target kN
}

#[wasm_bindgen]
impl SiqsWorker {
    #[wasm_bindgen(constructor)]
    pub fn new(kn_bytes: &[u8], fb_primes: &[u32], fb_logs: &[u8], fb_r_bytes: &[u8], sieve_limit: usize, worker_id: usize) -> Self {
        let kn = int_from_le_slice(kn_bytes);
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

        // Build q_inv_table
        // q_inv_table[i][j] = (fb_primes[i])^{-1} mod fb_primes[j]
        let mut q_inv_table = vec![vec![0u32; fb_len]; fb_len];
        for i in 0..fb_len {
            let q_i = Int::from(fb_primes[i]);
            for j in 0..fb_len {
                if i == j {
                    q_inv_table[i][j] = 0;
                    continue;
                }
                let p_j = Int::from(fb_primes[j]);
                let q_mod = q_i % p_j;
                if let Some(inv) = ext_gcd_inverse_internal(q_mod, p_j) {
                    let limbs: &[u64] = inv.as_limbs();
                    q_inv_table[i][j] = limbs[0] as u32;
                }
            }
        }

        let mut prng = Xoroshiro128PlusPlus::new();
        // Seed offset based on worker_id
        for _ in 0..worker_id {
            prng.next();
        }

        let digits = kn.to_string().len(); // approximation for bits is better but this matches JS
        let mut s_val = 1;
        if digits >= 24 { s_val = 2; }
        if digits >= 32 { s_val = 3; }
        if digits >= 40 { s_val = 4; }
        if digits >= 48 { s_val = 5; }
        if digits >= 56 { s_val = 6; }
        if digits >= 64 { s_val = 7; }

        SiqsWorker {
            n: kn,
            fb: fb_primes.to_vec(),
            fb_log: fb_logs.to_vec(),
            fb_r,
            sieve_limit,
            m: sieve_limit / 2,
            q_inv_table,
            prng,
            worker_id,
            s_val,
            kn,
        }
    }
}

// Sieve core logic
#[wasm_bindgen]
impl SiqsWorker {
    pub fn step(&mut self, batch_size: usize) -> JsValue {
        use js_sys::{Array, Object, Reflect};
        let mut relations = Array::new();
        let mut polys_searched = 0;

        let fb_len = self.fb.len();
        let s = self.s_val;
        let mut q_indices = vec![0usize; s];

        for _batch in 0..batch_size {
            // Pick s primes randomly to form A. We avoid duplicates.
            let mut used = vec![false; fb_len];
            let start_idx = core::cmp::max(10, fb_len / 10);
            for i in 0..s {
                loop {
                    let r = (self.prng.next() as usize % (fb_len - start_idx)) + start_idx;
                    if !used[r] {
                        used[r] = true;
                        q_indices[i] = r;
                        break;
                    }
                }
            }

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

                // a_inv = Product of q_inv_table
                let mut a_inv = 1u64;
                for i in 0..s {
                    a_inv = (a_inv * (self.q_inv_table[q_indices[i]][j] as u64)) % (p as u64);
                }
                a_inv_p[j] = a_inv as u32;

                let b_mod = b_val % p_int;
                let b_mod_u64 = b_mod.as_limbs()[0];
                let r_j = self.fb_r[j].as_limbs()[0];

                let x1_num = (r_j + p as u64 - b_mod_u64) % (p as u64);
                let x2_num = ((p as u64) * 2 - r_j - b_mod_u64) % (p as u64);

                x1_p[j] = ((a_inv * x1_num) % (p as u64)) as u32;
                x2_p[j] = ((a_inv * x2_num) % (p as u64)) as u32;

                x1_p[j] = (x1_p[j] + (self.m as u32)) % p;
                x2_p[j] = (x2_p[j] + (self.m as u32)) % p;

                for k in 1..s {
                    let db = (Int::from(2) * b_i_prime[k]) % p_int;
                    let db_u64 = db.as_limbs()[0];
                    delta_x[k][j] = ((a_inv * db_u64) % (p as u64)) as u32;
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
                        b_val = if b_val >= sub_val { b_val - sub_val } else { b_val + a_val - sub_val };
                        for j in 0..fb_len {
                            if a_inv_p[j] == 0 { continue; }
                            let dx = delta_x[k][j];
                            let p = self.fb[j];
                            x1_p[j] = (x1_p[j] + dx) % p;
                            x2_p[j] = (x2_p[j] + dx) % p;
                        }
                    } else {
                        let add_val = (Int::from(2) * b_i_prime[k]) % a_val;
                        b_val = (b_val + add_val) % a_val;
                        for j in 0..fb_len {
                            if a_inv_p[j] == 0 { continue; }
                            let dx = delta_x[k][j];
                            let p = self.fb[j];
                            x1_p[j] = if x1_p[j] >= dx { x1_p[j] - dx } else { x1_p[j] + p - dx };
                            x2_p[j] = if x2_p[j] >= dx { x2_p[j] - dx } else { x2_p[j] + p - dx };
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

                let mut sieve = vec![0u8; self.sieve_limit];
                for j in 0..fb_len {
                    if a_inv_p[j] == 0 { continue; }
                    let p = self.fb[j] as usize;
                    let log_p = self.fb_log[j];
                    let mut idx1 = x1_p[j] as usize;
                    while idx1 < self.sieve_limit {
                        sieve[idx1] += log_p;
                        idx1 += p;
                    }
                    if p > 2 {
                        let mut idx2 = x2_p[j] as usize;
                        while idx2 < self.sieve_limit {
                            sieve[idx2] += log_p;
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
                let threshold_u8 = core::cmp::min(255, threshold) as u8;

                for i in 0..self.sieve_limit {
                    if sieve[i] >= threshold_u8 {
                        let x = if i >= self.m {
                            Int::from(i - self.m)
                        } else {
                            Int::from(self.m - i)
                        };
                        let x_is_neg = i < self.m;

                        let ax = a_val * x;
                        let ax2 = ax * x;
                        let bx2 = Int::from(2) * b_val * x;

                        // val = ax2 +- bx2 +- C
                        let mut val = ax2;
                        if x_is_neg {
                            val = if val >= bx2 { val - bx2 } else { bx2 - val }; // Might need signed math here.
                        } else {
                            val = val + bx2;
                        }

                        // We will do a simpler approach: Just do signed evaluation
                        // A*x^2 + 2Bx + C
                        // x can be negative
                        let mut val_sign = 1i32;
                        let mut temp = Int::from(0);

                        let x_isize = (i as isize) - (self.m as isize);

                        // DoubleInt for safety
                        let ax2_double = DoubleInt::from(a_val) * DoubleInt::from(x) * DoubleInt::from(x);
                        let bx2_double = DoubleInt::from(Int::from(2)) * DoubleInt::from(b_val) * DoubleInt::from(x);
                        let c_double = DoubleInt::from(c_val);

                        let mut sum = ax2_double;
                        if x_is_neg {
                            if sum >= bx2_double { sum = sum - bx2_double; }
                            else { sum = bx2_double - sum; val_sign = -1; }
                        } else {
                            sum = sum + bx2_double;
                        }

                        if c_is_neg {
                            if val_sign == 1 {
                                if sum >= c_double { sum = sum - c_double; }
                                else { sum = c_double - sum; val_sign = -1; }
                            } else {
                                sum = sum + c_double; // both negative
                            }
                        } else {
                            if val_sign == 1 {
                                sum = sum + c_double;
                            } else {
                                if sum >= c_double { sum = sum - c_double; val_sign = -1; }
                                else { sum = c_double - sum; val_sign = 1; }
                            }
                        }

                        temp = Int::from_limbs(sum.as_limbs()[..4].try_into().unwrap());

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
                            // Form relation
                            let rel_obj = Object::new();
                            Reflect::set(&rel_obj, &JsValue::from_str("x"), &JsValue::from_str(&x_isize.to_string())).unwrap();
                            Reflect::set(&rel_obj, &JsValue::from_str("A"), &JsValue::from_str(&a_val.to_string())).unwrap();
                            Reflect::set(&rel_obj, &JsValue::from_str("B"), &JsValue::from_str(&b_val.to_string())).unwrap();
                            Reflect::set(&rel_obj, &JsValue::from_str("sign"), &JsValue::from_f64(val_sign as f64)).unwrap();

                            let js_factors = Array::new();
                            for f in factors {
                                js_factors.push(&JsValue::from_f64(f as f64));
                            }
                            Reflect::set(&rel_obj, &JsValue::from_str("factors"), &js_factors).unwrap();

                            relations.push(&rel_obj);
                        } else {
                            // Partial relation
                            let max_p = Int::from(self.fb[fb_len - 1]);
                            if temp > Int::from(1) && temp < max_p * max_p {
                                for k in 0..s {
                                    factors.push(q_indices[k] as u32);
                                }
                                let rel_obj = Object::new();
                                Reflect::set(&rel_obj, &JsValue::from_str("x"), &JsValue::from_str(&x_isize.to_string())).unwrap();
                                Reflect::set(&rel_obj, &JsValue::from_str("A"), &JsValue::from_str(&a_val.to_string())).unwrap();
                                Reflect::set(&rel_obj, &JsValue::from_str("B"), &JsValue::from_str(&b_val.to_string())).unwrap();
                                Reflect::set(&rel_obj, &JsValue::from_str("sign"), &JsValue::from_f64(val_sign as f64)).unwrap();
                                Reflect::set(&rel_obj, &JsValue::from_str("largePrime"), &JsValue::from_str(&temp.to_string())).unwrap();

                                let js_factors = Array::new();
                                for f in factors {
                                    js_factors.push(&JsValue::from_f64(f as f64));
                                }
                                Reflect::set(&rel_obj, &JsValue::from_str("factors"), &js_factors).unwrap();

                                relations.push(&rel_obj);
                            }
                        }
                    }
                }
            }
        }

        let res = Object::new();
        Reflect::set(&res, &JsValue::from_str("polysSearched"), &JsValue::from_f64(polys_searched as f64)).unwrap();
        Reflect::set(&res, &JsValue::from_str("relations"), &relations).unwrap();
        JsValue::from(res)
    }
}
