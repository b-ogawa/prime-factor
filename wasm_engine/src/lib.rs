use getrandom::getrandom;
use ruint::{aliases::U256, aliases::U512};
use wasm_bindgen::prelude::*;
use rustc_hash::FxHashMap;
use crate::ecm::ext_gcd_inverse_internal;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);
    fn check_abort() -> u32;
}

pub mod ecm;

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
            n_inv = n_inv
                .wrapping_mul(Int::from(2))
                .wrapping_sub(n.wrapping_mul(n_inv).wrapping_mul(n_inv));
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
            let (new_res, _sub_carry) = res_int.overflowing_sub(self.n);
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
            self.n - (b - a)
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
    if n == Int::from(0) {
        return true;
    }
    let mod16 = (n.as_limbs()[0] & 15) as u8;
    if mod16 != 0 && mod16 != 1 && mod16 != 4 && mod16 != 9 {
        return false;
    }

    let mut x = n;
    let mut y = (x >> 1) + Int::from(1);
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
            if r == 3 || r == 5 {
                t = -t;
            }
        }
        core::mem::swap(&mut a, &mut n);
        if a.as_limbs()[0] % 4 == 3 && n.as_limbs()[0] % 4 == 3 {
            t = -t;
        }
        a = a % n;
    }
    if n == Int::from(1) {
        t
    } else {
        0
    }
}

fn strong_lucas_test(n: Int) -> bool {
    // Port of strongLucasTest from math.js
    let mut d = DoubleInt::from(n) + DoubleInt::from(1);
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
    // DoubleInt を用いた安全な Q の計算
    let num_double = if sign == 1 {
        DoubleInt::from(n) + DoubleInt::from(1) - DoubleInt::from(d_val)
    } else {
        DoubleInt::from(1) + DoubleInt::from(d_val)
    };

    let mut q_double = num_double;
    while q_double.as_limbs()[0] % 4 != 0 {
        q_double += DoubleInt::from(n);
    }
    q_double >>= 2;
    // nで割った余りを取る（安全のため）
    let q_val = Int::from_limbs((q_double % DoubleInt::from(n)).as_limbs()[..4].try_into().unwrap());

    let q_val = q_val % n;

    let mut u = Int::from(1);
    let mut v = p_val;
    let mut qk = q_val;

    let d_bits = 512 - d.leading_zeros(); // bit length

    for i in (0..d_bits - 1).rev() {
        // U_2k = (U * V) % n
        let u_double = DoubleInt::from(u).wrapping_mul(DoubleInt::from(v)) % DoubleInt::from(n);
        let u_2k = Int::from_limbs(u_double.as_limbs()[..4].try_into().unwrap());

        // V_2k = (V * V - 2 * Qk) % n
        let v2 = DoubleInt::from(v).wrapping_mul(DoubleInt::from(v)) % DoubleInt::from(n);
        let qk2 = DoubleInt::from(qk).wrapping_mul(DoubleInt::from(2)) % DoubleInt::from(n);
        let v_2k_mod = if v2 >= qk2 {
            v2 - qk2
        } else {
            v2 + DoubleInt::from(n) - qk2
        };
        let v_2k = Int::from_limbs(v_2k_mod.as_limbs()[..4].try_into().unwrap());

        let qk_sq = DoubleInt::from(qk).wrapping_mul(DoubleInt::from(qk)) % DoubleInt::from(n);
        qk = Int::from_limbs(qk_sq.as_limbs()[..4].try_into().unwrap());

        u = u_2k;
        v = v_2k;

        let word_idx = i / 64;
        let bit_idx = i % 64;
        let bit = (d.as_limbs()[word_idx] >> bit_idx) & 1;

        if bit == 1 {
            // U_next = (P * U + V) / 2 % n
            let mut u_next =
                DoubleInt::from(p_val).wrapping_mul(DoubleInt::from(u)) % DoubleInt::from(n);
            u_next = (u_next + DoubleInt::from(v)) % DoubleInt::from(n);
            let mut u_next_int = Int::from_limbs(u_next.as_limbs()[..4].try_into().unwrap());
            if u_next_int.as_limbs()[0] & 1 == 1 {
                u_next = (DoubleInt::from(u_next_int) + DoubleInt::from(n)) >> 1;
                u_next_int = Int::from_limbs(u_next.as_limbs()[..4].try_into().unwrap());
            } else {
                u_next_int >>= 1;
            }

            // V_next = (D * U + P * V) / 2 % n
            let mut v_next_part1 =
                DoubleInt::from(d_val).wrapping_mul(DoubleInt::from(u)) % DoubleInt::from(n);
            if sign == -1 {
                v_next_part1 = if v_next_part1 == DoubleInt::from(0) {
                    DoubleInt::from(0)
                } else {
                    DoubleInt::from(n) - v_next_part1
                };
            }
            let v_next_part2 =
                DoubleInt::from(p_val).wrapping_mul(DoubleInt::from(v)) % DoubleInt::from(n);
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

            let qk_q =
                DoubleInt::from(qk).wrapping_mul(DoubleInt::from(q_val)) % DoubleInt::from(n);
            qk = Int::from_limbs(qk_q.as_limbs()[..4].try_into().unwrap());
        }
    }

    if u == Int::from(0) || v == Int::from(0) {
        return true;
    }

    for _ in 1..s {
        let v2 = DoubleInt::from(v).wrapping_mul(DoubleInt::from(v)) % DoubleInt::from(n);
        let qk2 = DoubleInt::from(qk).wrapping_mul(DoubleInt::from(2)) % DoubleInt::from(n);
        let v_next_mod = if v2 >= qk2 {
            v2 - qk2
        } else {
            v2 + DoubleInt::from(n) - qk2
        };
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
        let new_exp = exp >> 1;
        exp = new_exp;
    }

    let mut x = res;
    let one = mont.transform(Int::from(1));
    let minus_one = mont.transform(n - Int::from(1));

    if x == one || x == minus_one {
        return true;
    }

    for _ in 1..s {
        x = mont.mul(x, x);
        if x == minus_one {
            return true;
        }
        if x == one {
            return false;
        }
    }
    false
}

pub(crate) fn int_from_le_slice(bytes: &[u8]) -> Int {
    let mut padded = [0u8; 32];
    let len = core::cmp::min(bytes.len(), 32);
    padded[..len].copy_from_slice(&bytes[..len]);
    Int::try_from_le_slice(&padded).unwrap_or(Int::from(0))
}

pub(crate) fn is_prime_bpsw(n: Int) -> bool {
    if n < Int::from(2) {
        return false;
    }
    if n == Int::from(2) || n == Int::from(3) || n == Int::from(5) || n == Int::from(7) {
        return true;
    }
    if n.as_limbs()[0] % 2 == 0 || n.as_limbs()[0] % 3 == 0 || n.as_limbs()[0] % 5 == 0 {
        return false;
    }

    let mont = MontgomerySpace::new(n);

    let bases = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37];
    for &b in &bases {
        let b_int = Int::from(b);
        if n == b_int {
            return true;
        }
        if n < b_int {
            return false;
        }
        if !miller_rabin_base_mont(n, b_int, &mont) {
            return false;
        }
    }

    if n.as_limbs()[1] > 0 || n.as_limbs()[2] > 0 || n.as_limbs()[3] > 0 {
        if !miller_rabin_base_mont(n, Int::from(2), &mont) {
            return false;
        }
        if is_square(n) {
            return false;
        }
        return strong_lucas_test(n);
    }

    true
}

#[wasm_bindgen]
pub fn is_prime_bpsw_bytes(n_bytes: &[u8]) -> bool {
    let n = int_from_le_slice(n_bytes);
    is_prime_bpsw(n)
}

#[wasm_bindgen]
pub fn sieve_primes_wasm(mut max: usize) -> Vec<u32> {
    if max > 100_000_000 {
        max = 100_000_000;
    }
    if max < 2 {
        return Vec::new();
    }
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
    is_prime
        .into_iter()
        .enumerate()
        .filter(|&(_, p)| p)
        .map(|(i, _)| i as u32)
        .collect()
}

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

    pub fn add_relation(
        &mut self,
        sign: i32,
        x_bytes: &[u8],
        b_bytes: &[u8],
        a_bytes: &[u8],
        factors: &[u32],
    ) {
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
                if (f_idx as usize) < self.fb.len() {
                    let col_idx = (f_idx + 1) as usize;
                    let w_idx = col_idx / 32;
                    let b_idx = col_idx % 32;
                    m[i][w_idx] ^= 1u32 << b_idx;
                }
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
                    if (f_idx as usize) < self.fb.len() {
                        exponent_sum[(f_idx + 1) as usize] += 1;
                    }
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
                            let res_prod =
                                DoubleInt::from(res).wrapping_mul(DoubleInt::from(base_pow));
                            res = Int::from_limbs(
                                (res_prod % DoubleInt::from(self.kn)).as_limbs()[..4]
                                    .try_into()
                                    .unwrap(),
                            );
                        }
                        let base_prod =
                            DoubleInt::from(base_pow).wrapping_mul(DoubleInt::from(base_pow));
                        base_pow = Int::from_limbs(
                            (base_prod % DoubleInt::from(self.kn)).as_limbs()[..4]
                                .try_into()
                                .unwrap(),
                        );
                        exp >>= 1;
                    }

                    let y_prod = DoubleInt::from(y_val).wrapping_mul(DoubleInt::from(res));
                    y_val = Int::from_limbs(
                        (y_prod % DoubleInt::from(self.kn)).as_limbs()[..4]
                            .try_into()
                            .unwrap(),
                    );
                }
            }
            if !success {
                continue;
            }

            let diff = if x_val >= y_val {
                x_val - y_val
            } else {
                self.kn - (y_val - x_val)
            };
            // Compute GCD against original N to avoid returning trivial k
            let mut g = gcd(diff, self.n);
            if g > Int::from(1) && g < self.n {
                return Some(g.to_le_bytes::<32>().to_vec());
            }

            let sum_double =
                (DoubleInt::from(x_val) + DoubleInt::from(y_val)) % DoubleInt::from(self.kn);
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

#[wasm_bindgen]
pub fn run_micro_benchmark() -> u32 {
    let n = Int::from(340282366920938463463374607431768211407u128);
    let mont = MontgomerySpace::new(n);
    let mut x = mont.transform(Int::from(12345));
    let mut y = mont.transform(Int::from(67890));
    for _ in 0..500000 {
        x = mont.mul(x, y);
        y = mont.mul(y, x);
    }
    x.as_limbs()[0] as u32
}

// ----------------------------------------------------
// FactorizationSession and Ring Buffer / Slab Allocation
// ----------------------------------------------------

use std::str::FromStr;

#[wasm_bindgen]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ActionType {
    Idle = 0,
    Complete = 1,
    LocalFactor = 2,
    StartSiqs = 3,
    StartEcm = 4,
    Wait = 5,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NodeStatus {
    Unsolved,
    Processing,
    Solved,
}

pub struct TreeNode {
    pub value: Int,
    pub status: NodeStatus,
    pub multiplicity: u32,
    pub children: Vec<usize>,
    pub tried_ecm: bool,
}

pub struct FbPrime {
    pub p: u32,
    pub log: u8,
    pub r: Int,
}

pub struct PendingPartialRelation {
    pub sign: i32,
    pub x: Int,
    pub b: Int,
    pub a: Int,
    pub factors: Vec<u32>,
}

pub struct SiqsState {
    pub target: Int,
    pub k: Int,
    pub kn: Int,
    pub fb: Vec<FbPrime>,
    pub m: usize,
    pub partial_relations: FxHashMap<u64, PendingPartialRelation>,
    pub relation_signatures: std::collections::HashSet<i64>,
}

// Math helpers for parameter calculation

fn legendre(a: Int, p: Int) -> i32 {
    if p == Int::from(2) {
        return 1;
    }
    let exp = (p - Int::from(1)) >> 1;
    let val = pow_mod(a, exp, p);
    if val.is_zero() {
        0
    } else if val == p - Int::from(1) {
        -1
    } else {
        1
    }
}

fn pow_mod(mut base: Int, mut exp: Int, mod_val: Int) -> Int {
    let mut res = Int::from(1);
    base = base % mod_val;
    while exp > Int::from(0) {
        if exp.as_limbs()[0] & 1 == 1 {
            let res_prod = DoubleInt::from(res).wrapping_mul(DoubleInt::from(base));
            res = Int::from_limbs((res_prod % DoubleInt::from(mod_val)).as_limbs()[..4].try_into().unwrap());
        }
        let base_prod = DoubleInt::from(base).wrapping_mul(DoubleInt::from(base));
        base = Int::from_limbs((base_prod % DoubleInt::from(mod_val)).as_limbs()[..4].try_into().unwrap());
        exp >>= 1;
    }
    res
}

fn tonelli_shanks(n: Int, p: Int) -> Option<Int> {
    let n_mod = n % p;
    if n_mod.is_zero() {
        return Some(Int::from(0));
    }
    if p == Int::from(2) {
        return Some(n_mod);
    }
    if legendre(n_mod, p) != 1 {
        return None;
    }
    if (p.as_limbs()[0] % 4) == 3 {
        let exp = (p + Int::from(1)) >> 2;
        return Some(pow_mod(n_mod, exp, p));
    }
    
    let mut s = 0u32;
    let mut q = p - Int::from(1);
    while (q.as_limbs()[0] & 1) == 0 {
        s += 1;
        q >>= 1;
    }
    
    let mut z = Int::from(2);
    while legendre(z, p) != -1 {
        z += Int::from(1);
    }
    
    let mut c = pow_mod(z, q, p);
    let mut r = pow_mod(n_mod, (q + Int::from(1)) >> 1, p);
    let mut t = pow_mod(n_mod, q, p);
    let mut m = s;
    
    while t != Int::from(1) {
        let mut temp_t = t;
        let mut i = 0u32;
        while temp_t != Int::from(1) && i < m {
            let temp_t_prod = DoubleInt::from(temp_t).wrapping_mul(DoubleInt::from(temp_t));
            temp_t = Int::from_limbs((temp_t_prod % DoubleInt::from(p)).as_limbs()[..4].try_into().unwrap());
            i += 1;
        }
        if i == m {
            return None;
        }
        let mut b = c;
        let b_exp = 1u64 << (m - i - 1);
        b = pow_mod(b, Int::from(b_exp), p);
        
        let r_prod = DoubleInt::from(r).wrapping_mul(DoubleInt::from(b));
        r = Int::from_limbs((r_prod % DoubleInt::from(p)).as_limbs()[..4].try_into().unwrap());
        
        let b_sq = DoubleInt::from(b).wrapping_mul(DoubleInt::from(b));
        c = Int::from_limbs((b_sq % DoubleInt::from(p)).as_limbs()[..4].try_into().unwrap());
        
        let t_prod = DoubleInt::from(t).wrapping_mul(DoubleInt::from(c));
        t = Int::from_limbs((t_prod % DoubleInt::from(p)).as_limbs()[..4].try_into().unwrap());
        
        m = i;
    }
    Some(r)
}

fn choose_multiplier(n: Int) -> Int {
    let multipliers = [1u64, 2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73];
    let mut best_score = -1.0;
    let primes = [2u64, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53];
    let mut selected_k = 1u64;
    
    for &k in &multipliers {
        let k_int = Int::from(k);
        let kn = n * k_int;
        let mut score = 0.0;
        for &p in &primes {
            let p_int = Int::from(p);
            let rem = kn % p_int;
            if rem.is_zero() {
                score += 1.0 / (p as f64);
            } else {
                let jac = jacobi(kn, p_int);
                if jac == 1 {
                    score += 2.0 / (p as f64);
                }
            }
        }
        let mod8 = (kn.as_limbs()[0] & 7) as u32;
        if mod8 == 1 {
            score += 2.0;
        } else if mod8 == 5 {
            score += 1.0;
        }
        if score > best_score {
            best_score = score;
            selected_k = k;
        }
    }
    Int::from(selected_k)
}

fn generate_factor_base(n: Int, target_size: usize) -> Vec<FbPrime> {
    let mut fb = Vec::with_capacity(target_size);
    fb.push(FbPrime { p: 2, log: 8, r: Int::from(1) });
    
    let mut candidate = 3u32;
    while fb.len() < target_size {
        let cand_int = Int::from(candidate);
        if is_prime_bpsw(cand_int) {
            let jac = jacobi(n, cand_int);
            if jac == 1 {
                if let Some(r) = tonelli_shanks(n, cand_int) {
                    let log_p = ((candidate as f64).log2() * 8.0).round() as u8;
                    fb.push(FbPrime {
                        p: candidate,
                        log: log_p,
                        r,
                    });
                }
            }
        }
        candidate += 2;
    }
    fb
}

fn get_siqs_params(digits: usize) -> usize {
    let ln_n = (digits as f64) * 10.0f64.ln();
    let sqrt_ln_n = (ln_n * ln_n.ln()).sqrt();
    let fb_size = (0.32 * sqrt_ln_n + 0.2).exp().round() as usize;
    fb_size.max(50).min(20000)
}

const SLOT_SIZE: usize = 128 * 1024;
const NUM_SLOTS: usize = 8;

#[wasm_bindgen]
pub struct FactorizationSession {
    nodes: Vec<TreeNode>,
    metrics: Vec<u32>,
    current_target_idx: Option<usize>,
    
    slots: Vec<Vec<u8>>,
    slot_in_use: Vec<bool>,
    
    current_siqs_state: Option<SiqsState>,
    current_reducer: Option<SiqsReducer>,
}

#[wasm_bindgen]
impl FactorizationSession {
    #[wasm_bindgen(constructor)]
    pub fn new(n_str: &str) -> Self {
        let n = Int::from_str(n_str).unwrap_or(Int::from(0));
        let is_pr = is_prime_bpsw(n);
        let status = if is_pr || n <= Int::from(1) {
            NodeStatus::Solved
        } else {
            NodeStatus::Unsolved
        };
        
        let root = TreeNode {
            value: n,
            status,
            multiplicity: 1,
            children: Vec::new(),
            tried_ecm: false,
        };

        let mut metrics = vec![0u32; 8];
        if status == NodeStatus::Solved && n > Int::from(1) {
            metrics[0] = 1;
        }

        let slots = vec![vec![0u8; SLOT_SIZE]; NUM_SLOTS];
        let slot_in_use = vec![false; NUM_SLOTS];

        Self {
            nodes: vec![root],
            metrics,
            current_target_idx: None,
            slots,
            slot_in_use,
            current_siqs_state: None,
            current_reducer: None,
        }
    }

    pub fn get_metrics_ptr(&self) -> *const u32 {
        self.metrics.as_ptr()
    }

    pub fn get_available_buffer(&mut self) -> i32 {
        for i in 0..NUM_SLOTS {
            if !self.slot_in_use[i] {
                self.slot_in_use[i] = true;
                return i as i32;
            }
        }
        -1
    }

    pub fn release_buffer(&mut self, slot_id: u32) {
        if (slot_id as usize) < NUM_SLOTS {
            self.slot_in_use[slot_id as usize] = false;
        }
    }

    pub fn get_buffer_ptr(&self, slot_id: u32) -> *const u8 {
        if (slot_id as usize) < NUM_SLOTS {
            self.slots[slot_id as usize].as_ptr()
        } else {
            std::ptr::null()
        }
    }

    pub fn get_next_action(&mut self) -> ActionType {
        self.merge_duplicates();

        let mut best_idx = None;
        let mut max_val = Int::from(0);

        for i in 0..self.nodes.len() {
            if self.nodes[i].status == NodeStatus::Unsolved {
                if self.nodes[i].value > max_val {
                    max_val = self.nodes[i].value;
                    best_idx = Some(i);
                }
            }
        }

        if let Some(idx) = best_idx {
            self.current_target_idx = Some(idx);
            self.nodes[idx].status = NodeStatus::Processing;

            let val = self.nodes[idx].value;
            let digits = val.to_string().len();

            if val.as_limbs()[1] == 0 && val.as_limbs()[2] == 0 && val.as_limbs()[3] == 0 {
                ActionType::LocalFactor
            } else if digits < 25 {
                if self.nodes[idx].tried_ecm {
                    self.prepare_siqs();
                    ActionType::StartSiqs
                } else {
                    ActionType::StartEcm
                }
            } else {
                self.prepare_siqs();
                ActionType::StartSiqs
            }
        } else {
            let has_processing = self.nodes.iter().any(|n| n.status == NodeStatus::Processing);
            if has_processing {
                ActionType::Wait
            } else {
                ActionType::Complete
            }
        }
    }

    fn prepare_siqs(&mut self) -> bool {
        let idx = match self.current_target_idx {
            Some(i) => i,
            None => return false,
        };
        let target = self.nodes[idx].value;
        
        let k = choose_multiplier(target);
        let kn = target * k;
        let digits = kn.to_string().len();
        let fb_size = get_siqs_params(digits);
        let fb = generate_factor_base(kn, fb_size);
        
        let fb_primes: Vec<u32> = fb.iter().map(|p| p.p).collect();
        let reducer = SiqsReducer {
            n: target,
            kn,
            fb: fb_primes,
            relations: Vec::new(),
        };
        
        self.current_reducer = Some(reducer);
        
        self.current_siqs_state = Some(SiqsState {
            target,
            k,
            kn,
            fb,
            m: 32768,
            partial_relations: FxHashMap::default(),
            relation_signatures: std::collections::HashSet::new(),
        });
        
        true
    }

    pub fn get_siqs_kn(&self) -> String {
        if let Some(state) = &self.current_siqs_state {
            state.kn.to_string()
        } else {
            String::new()
        }
    }
    
    pub fn get_siqs_fb_primes(&self) -> Vec<u32> {
        if let Some(state) = &self.current_siqs_state {
            state.fb.iter().map(|p| p.p).collect()
        } else {
            Vec::new()
        }
    }

    pub fn get_siqs_fb_logs(&self) -> Vec<u8> {
        if let Some(state) = &self.current_siqs_state {
            state.fb.iter().map(|p| p.log).collect()
        } else {
            Vec::new()
        }
    }

    pub fn get_siqs_fb_r(&self) -> Vec<u8> {
        if let Some(state) = &self.current_siqs_state {
            let mut res = Vec::with_capacity(state.fb.len() * 32);
            for p in &state.fb {
                res.extend_from_slice(&p.r.to_le_bytes::<32>());
            }
            res
        } else {
            Vec::new()
        }
    }

    pub fn get_siqs_m(&self) -> usize {
        if let Some(state) = &self.current_siqs_state {
            state.m
        } else {
            0
        }
    }

    pub fn get_current_target(&self) -> String {
        if let Some(idx) = self.current_target_idx {
            self.nodes[idx].value.to_string()
        } else {
            String::new()
        }
    }

    pub fn report_factor(&mut self, target_str: &str, factor_str: &str) -> ActionType {
        let target = Int::from_str(target_str).unwrap_or(Int::from(0));
        let factor = Int::from_str(factor_str).unwrap_or(Int::from(0));
        if target == Int::from(0) || factor <= Int::from(1) || factor >= target {
            return self.get_next_action();
        }

        let mut found_idx = None;
        for i in 0..self.nodes.len() {
            if self.nodes[i].value == target && self.nodes[i].status == NodeStatus::Processing {
                found_idx = Some(i);
                break;
            }
        }

        if let Some(idx) = found_idx {
            let f1 = factor;
            let f2 = target / factor;
            let m = self.nodes[idx].multiplicity;

            let m1 = if f1 == f2 { m * 2 } else { m };
            let m2 = if f1 == f2 { 0 } else { m };

            self.nodes[idx].status = NodeStatus::Solved;

            let f1_is_prime = is_prime_bpsw(f1);
            let f1_status = if f1_is_prime { NodeStatus::Solved } else { NodeStatus::Unsolved };
            let child1_idx = self.nodes.len();
            self.nodes.push(TreeNode {
                value: f1,
                status: f1_status,
                multiplicity: m1,
                children: Vec::new(),
                tried_ecm: false,
            });
            self.nodes[idx].children.push(child1_idx);

            if m2 > 0 {
                let f2_is_prime = is_prime_bpsw(f2);
                let f2_status = if f2_is_prime { NodeStatus::Solved } else { NodeStatus::Unsolved };
                let child2_idx = self.nodes.len();
                self.nodes.push(TreeNode {
                    value: f2,
                    status: f2_status,
                    multiplicity: m2,
                    children: Vec::new(),
                    tried_ecm: false,
                });
                self.nodes[idx].children.push(child2_idx);
            }

            self.update_metrics();
        }

        self.get_next_action()
    }

    pub fn report_prime(&mut self, target_str: &str) -> ActionType {
        let target = Int::from_str(target_str).unwrap_or(Int::from(0));
        for i in 0..self.nodes.len() {
            if self.nodes[i].value == target && self.nodes[i].status == NodeStatus::Processing {
                self.nodes[i].status = NodeStatus::Solved;
                self.nodes[i].children.clear();
            }
        }
        self.update_metrics();
        self.get_next_action()
    }

    pub fn report_exhausted(&mut self, target_str: &str) -> ActionType {
        let target = Int::from_str(target_str).unwrap_or(Int::from(0));
        for i in 0..self.nodes.len() {
            if self.nodes[i].value == target && self.nodes[i].status == NodeStatus::Processing {
                self.nodes[i].status = NodeStatus::Unsolved;
                self.nodes[i].tried_ecm = true;
            }
        }
        self.get_next_action()
    }

    pub fn factor_locally(&mut self, target_str: &str) -> bool {
        let target = Int::from_str(target_str).unwrap_or(Int::from(0));
        if target <= Int::from(1) {
            return false;
        }

        let mut factors = Vec::new();
        let mut temp = target;

        while temp.as_limbs()[0] % 2 == 0 && temp > Int::from(1) {
            factors.push(Int::from(2));
            temp >>= 1;
        }

        let mut d = Int::from(3);
        while d * d <= temp && d < Int::from(1000) {
            while (temp % d).is_zero() {
                factors.push(d);
                temp = temp / d;
            }
            d += Int::from(2);
        }

        if temp > Int::from(1) {
            let mut queue = vec![temp];
            while let Some(n) = queue.pop() {
                if is_prime_bpsw(n) {
                    factors.push(n);
                } else {
                    if let Some(f_bytes) = ecm::pollard_brent_bytes(&n.to_le_bytes::<32>(), 500000, 0) {
                        let f = int_from_le_slice(&f_bytes);
                        queue.push(f);
                        queue.push(n / f);
                    } else {
                        factors.push(n);
                    }
                }
            }
        }

        let mut found_idx = None;
        for i in 0..self.nodes.len() {
            if self.nodes[i].value == target && self.nodes[i].status == NodeStatus::Processing {
                found_idx = Some(i);
                break;
            }
        }

        if let Some(idx) = found_idx {
            self.nodes[idx].status = NodeStatus::Solved;
            let target_mult = self.nodes[idx].multiplicity;
            
            let mut factor_counts: std::collections::HashMap<Int, u32> = std::collections::HashMap::new();
            for f in factors {
                *factor_counts.entry(f).or_insert(0) += 1;
            }

            for (f, count) in factor_counts {
                let f_is_prime = is_prime_bpsw(f);
                let f_status = if f_is_prime { NodeStatus::Solved } else { NodeStatus::Unsolved };
                let child_idx = self.nodes.len();
                self.nodes.push(TreeNode {
                    value: f,
                    status: f_status,
                    multiplicity: count * target_mult,
                    children: Vec::new(),
                    tried_ecm: false,
                });
                self.nodes[idx].children.push(child_idx);
            }
            self.update_metrics();
            true
        } else {
            false
        }
    }

    pub fn submit_worker_result(&mut self, slot_id: u32, length: usize) -> ActionType {
        let data = match self.slots.get(slot_id as usize) {
            Some(buf) => &buf[..length],
            None => return self.get_next_action(),
        };

        if data.len() < 12 {
            self.release_buffer(slot_id);
            return self.get_next_action();
        }

        let polys_searched = u64::from_le_bytes(data[0..8].try_into().unwrap());
        let relations_count = u32::from_le_bytes(data[8..12].try_into().unwrap());

        self.metrics[2] += polys_searched as u32;

        let state = match &mut self.current_siqs_state {
            Some(s) => s,
            None => {
                self.release_buffer(slot_id);
                return self.get_next_action();
            }
        };

        let reducer = match &mut self.current_reducer {
            Some(r) => r,
            None => {
                self.release_buffer(slot_id);
                return self.get_next_action();
            }
        };

        let mut offset = 12;
        let kn = state.kn;

        for _ in 0..relations_count {
            if offset >= data.len() {
                break;
            }
            let flags = data[offset];
            offset += 1;

            let is_partial = (flags & 1) == 1;
            let sign = if (flags & 2) == 2 { 1i32 } else { -1i32 };

            if offset + 8 > data.len() { break; }
            let x_i64 = i64::from_le_bytes(data[offset..offset+8].try_into().unwrap());
            offset += 8;

            if offset + 32 > data.len() { break; }
            let a_val = int_from_le_slice(&data[offset..offset+32]);
            offset += 32;

            if offset + 32 > data.len() { break; }
            let b_val = int_from_le_slice(&data[offset..offset+32]);
            offset += 32;

            let mut lp_u64 = 0u64;
            if is_partial {
                if offset + 8 > data.len() { break; }
                lp_u64 = u64::from_le_bytes(data[offset..offset+8].try_into().unwrap());
                offset += 8;
            }

            if offset + 2 > data.len() { break; }
            let factors_len = u16::from_le_bytes(data[offset..offset+2].try_into().unwrap()) as usize;
            offset += 2;

            if offset + factors_len * 4 > data.len() { break; }
            let mut factors = Vec::with_capacity(factors_len);
            for _ in 0..factors_len {
                let f_idx = u32::from_le_bytes(data[offset..offset+4].try_into().unwrap());
                factors.push(f_idx);
                offset += 4;
            }

            if is_partial {
                if let Some(r1) = state.partial_relations.remove(&lp_u64) {
                    let term1 = (DoubleInt::from(r1.a) * DoubleInt::from(r1.x) + DoubleInt::from(r1.b)) % DoubleInt::from(kn);
                    let term1_int = Int::from_limbs(term1.as_limbs()[..4].try_into().unwrap());

                    let x2_u256 = if x_i64 < 0 {
                        let abs_x = (-x_i64) as u64;
                        let abs_x_int = Int::from(abs_x);
                        if kn > abs_x_int {
                            kn - abs_x_int
                        } else {
                            kn - (abs_x_int % kn)
                        }
                    } else {
                        Int::from(x_i64 as u64) % kn
                    };
                    let term2 = (DoubleInt::from(a_val) * DoubleInt::from(x2_u256) + DoubleInt::from(b_val)) % DoubleInt::from(kn);
                    let term2_int = Int::from_limbs(term2.as_limbs()[..4].try_into().unwrap());

                    let x_prod = (DoubleInt::from(term1_int) * DoubleInt::from(term2_int)) % DoubleInt::from(kn);
                    let x_prod_int = Int::from_limbs(x_prod.as_limbs()[..4].try_into().unwrap());

                    let lp_int = Int::from(lp_u64);
                    if let Some(lp_inv) = ext_gcd_inverse_internal(lp_int, kn) {
                        let x_combined = (DoubleInt::from(x_prod_int) * DoubleInt::from(lp_inv)) % DoubleInt::from(kn);
                        let x_combined_int = Int::from_limbs(x_combined.as_limbs()[..4].try_into().unwrap());

                        let combined_factors = [r1.factors, factors].concat();
                        let new_sign = r1.sign * sign;

                        reducer.add_relation(
                            new_sign,
                            &x_combined_int.to_le_bytes::<32>(),
                            &[0u8; 32],
                            &[1u8, 0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
                            &combined_factors,
                        );

                        self.metrics[1] += 1;
                    } else {
                        let g = gcd(lp_int, state.target);
                        if g > Int::from(1) && g < state.target {
                            let target_str = state.target.to_string();
                            let factor_str = g.to_string();
                            self.current_siqs_state = None;
                            self.current_reducer = None;
                            self.release_buffer(slot_id);
                            return self.report_factor(&target_str, &factor_str);
                        }
                    }
                } else {
                    let x_u256 = if x_i64 < 0 {
                        let abs_x = (-x_i64) as u64;
                        let abs_x_int = Int::from(abs_x);
                        if kn > abs_x_int {
                            kn - abs_x_int
                        } else {
                            kn - (abs_x_int % kn)
                        }
                    } else {
                        Int::from(x_i64 as u64) % kn
                    };
                    state.partial_relations.insert(lp_u64, PendingPartialRelation {
                        sign,
                        x: x_u256,
                        b: b_val,
                        a: a_val,
                        factors,
                    });
                }
            } else {
                let sig = x_i64;
                if state.relation_signatures.insert(sig) {
                    let x_u256 = if x_i64 < 0 {
                        let abs_x = (-x_i64) as u64;
                        let abs_x_int = Int::from(abs_x);
                        if kn > abs_x_int {
                            kn - abs_x_int
                        } else {
                            kn - (abs_x_int % kn)
                        }
                    } else {
                        Int::from(x_i64 as u64) % kn
                    };
                    reducer.add_relation(
                        sign,
                        &x_u256.to_le_bytes::<32>(),
                        &b_val.to_le_bytes::<32>(),
                        &a_val.to_le_bytes::<32>(),
                        &factors,
                    );
                    self.metrics[1] += 1;
                }
            }
        }

        self.release_buffer(slot_id);
        self.get_next_action()
    }

    pub fn siqs_reduce_matrix(&mut self) -> Option<String> {
        let reducer = self.current_reducer.as_ref()?;
        let res = reducer.reduce_matrix()?;
        let factor = int_from_le_slice(&res);
        Some(factor.to_string())
    }

    fn merge_duplicates(&mut self) {
        let mut solved_trees: std::collections::HashMap<Int, Vec<TreeNode>> = std::collections::HashMap::new();

        for i in 0..self.nodes.len() {
            if self.nodes[i].status == NodeStatus::Solved && !self.nodes[i].value.is_zero() {
                if self.is_subtree_solved(i) {
                    if !solved_trees.contains_key(&self.nodes[i].value) {
                        let mut subtree = Vec::new();
                        self.collect_subtree(i, &mut subtree);
                        solved_trees.insert(self.nodes[i].value, subtree);
                    }
                }
            }
        }

        let mut i = 0;
        while i < self.nodes.len() {
            if self.nodes[i].status != NodeStatus::Solved {
                let val = self.nodes[i].value;
                if let Some(subtree) = solved_trees.get(&val) {
                    self.apply_subtree(i, subtree);
                }
            }
            i += 1;
        }
    }

    fn is_subtree_solved(&self, idx: usize) -> bool {
        if self.nodes[idx].status != NodeStatus::Solved {
            return false;
        }
        for &child in &self.nodes[idx].children {
            if !self.is_subtree_solved(child) {
                return false;
            }
        }
        true
    }

    fn collect_subtree(&self, idx: usize, out: &mut Vec<TreeNode>) {
        let node = &self.nodes[idx];
        let copy_node = TreeNode {
            value: node.value,
            status: node.status,
            multiplicity: node.multiplicity,
            children: Vec::new(),
            tried_ecm: node.tried_ecm,
        };
        let start_pos = out.len();
        out.push(copy_node);

        for &child in &node.children {
            let child_pos = out.len();
            self.collect_subtree(child, out);
            out[start_pos].children.push(child_pos);
        }
    }

    fn apply_subtree(&mut self, target_idx: usize, subtree: &[TreeNode]) {
        let base_len = self.nodes.len();
        let target_mult = self.nodes[target_idx].multiplicity;

        self.nodes[target_idx].status = NodeStatus::Solved;
        self.nodes[target_idx].children.clear();

        for &child_idx in &subtree[0].children {
            let new_child_idx = base_len + (child_idx - 1);
            self.nodes[target_idx].children.push(new_child_idx);
        }

        for j in 1..subtree.len() {
            let node = &subtree[j];
            let mut new_node = TreeNode {
                value: node.value,
                status: node.status,
                multiplicity: node.multiplicity * target_mult,
                children: Vec::new(),
                tried_ecm: node.tried_ecm,
            };
            for &child_idx in &node.children {
                new_node.children.push(base_len + (child_idx - 1));
            }
            self.nodes.push(new_node);
        }
    }

    fn update_metrics(&mut self) {
        let mut factor_count = 0;
        for i in 0..self.nodes.len() {
            let node = &self.nodes[i];
            if node.status == NodeStatus::Solved && node.children.is_empty() && node.value > Int::from(1) {
                factor_count += node.multiplicity;
            }
        }
        self.metrics[0] = factor_count;
    }

    pub fn get_factors_json(&self) -> String {
        let map = {
            let mut map: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
            for i in 0..self.nodes.len() {
                let node = &self.nodes[i];
                if node.status == NodeStatus::Solved && node.children.is_empty() && node.value > Int::from(1) {
                    let key = node.value.to_string();
                    *map.entry(key).or_insert(0) += node.multiplicity;
                }
            }
            map
        };

        let mut parts = Vec::new();
        for (k, v) in map {
            parts.push(format!("\"{}\":{}", k, v));
        }
        format!("{{{}}}", parts.join(","))
    }

    pub fn get_unresolved_json(&self) -> String {
        let mut list = Vec::new();
        for i in 0..self.nodes.len() {
            let node = &self.nodes[i];
            if node.status != NodeStatus::Solved {
                list.push(format!("\"{}\"", node.value.to_string()));
            }
        }
        format!("[{}]", list.join(","))
    }
}
