use wasm_bindgen::prelude::*;
use num_bigint::BigUint;
use num_traits::{Zero, One};
use getrandom::getrandom;

// Replace console_log with a macro or wasm_bindgen function if needed
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);
}

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

// Montgomery Space (simplified for BigUint)
struct MontgomerySpace {
    n: BigUint,
    mask: BigUint,
    r: BigUint,
    n_inv: BigUint,
    one: BigUint,
    k: u64,
}

impl MontgomerySpace {
    fn new(n: BigUint) -> Self {
        let k = n.bits();
        let mask = (BigUint::one() << k) - 1u32;
        let r = BigUint::one() << k;

        let mut inv = &n & BigUint::from(3u32);
        let mut bit_count = 2;
        while bit_count < k {
            bit_count *= 2;
            let m = (BigUint::one() << bit_count) - 1u32;
            inv = (&inv * (BigUint::from(2u32) - (&n & &m) * &inv)) & &m;
        }
        inv = inv & &mask;
        let n_inv = (&r - inv) & &mask;

        let one = (&r) % &n;

        Self { n, mask, r, n_inv, one, k }
    }

    fn transform(&self, x: &BigUint) -> BigUint {
        (x * &self.r) % &self.n
    }

    fn reduce(&self, t: &BigUint) -> BigUint {
        let m = ((t & &self.mask) * &self.n_inv) & &self.mask;
        let mut res = (t + m * &self.n) >> self.k;
        if res >= self.n {
            res -= &self.n;
        }
        res
    }

    fn mul(&self, a: &BigUint, b: &BigUint) -> BigUint {
        self.reduce(&(a * b))
    }

    fn add(&self, a: &BigUint, b: &BigUint) -> BigUint {
        let res = a + b;
        if res >= self.n { res - &self.n } else { res }
    }
}

// Math utils
fn gcd(a: BigUint, b: BigUint) -> BigUint {
    let mut a = a;
    let mut b = b;
    while b > BigUint::zero() {
        let temp = b.clone();
        b = a % &b;
        a = temp;
    }
    a
}

#[wasm_bindgen]
pub fn pollard_brent_bytes(n_bytes: &[u8], max_iters: usize) -> Option<Vec<u8>> {
    let n = BigUint::from_bytes_le(n_bytes);
    let mont = MontgomerySpace::new(n.clone());
    let mut prng = Xoroshiro128PlusPlus::new();

    // Convert 64-bit randoms to BigUint
    let c_val = BigUint::from(prng.next()) % &n;
    let y_val = BigUint::from(prng.next()) % &n;

    let mut y = mont.transform(&y_val);
    let c = mont.transform(&c_val);
    let mut q = mont.one.clone();
    let m = 100usize;
    let mut g = BigUint::one();
    let mut r = 1usize;
    let mut ys = y.clone();
    let mut x = y.clone();
    let mut iters = 0;

    while g == BigUint::one() {
        x = y.clone();
        for _ in 0..r {
            let y_sq = mont.mul(&y, &y);
            y = mont.add(&y_sq, &c);
        }
        let mut k = 0;
        while k < r && g == BigUint::one() {
            ys = y.clone();
            let limit = std::cmp::min(m, r - k);
            for _ in 0..limit {
                let y_sq = mont.mul(&y, &y);
                y = mont.add(&y_sq, &c);
                let diff = if y > x { &y - &x } else { &x - &y };
                q = mont.mul(&q, &diff);
            }
            g = gcd(mont.reduce(&q), n.clone());
            k += limit;
            iters += limit;
            if iters >= max_iters { return None; }
        }
        r *= 2;
    }

    if g == n {
        let mut backtrack_limit = 0;
        loop {
            let ys_sq = mont.mul(&ys, &ys);
            ys = mont.add(&ys_sq, &c);
            let diff = if ys > x { &ys - &x } else { &x - &ys };
            g = gcd(mont.reduce(&diff), n.clone());
            backtrack_limit += 1;
            if backtrack_limit > m { return None; }
            if g != BigUint::one() { break; }
        }
    }

    if g == n { None } else { Some(g.to_bytes_le()) }
}
