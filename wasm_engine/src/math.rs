mod primes;

/// BPSW (Baily-Pomerance-Selfridge-Wagstaff) 法による強力な確率的素数判定。
pub(crate) use primes::is_prime_bpsw;

/// Tonelli-Shanks法を用いて、平方剰余の平方根 `r^2 = n (mod p)` を計算する。
pub(crate) use primes::tonelli_shanks;

/// ヤコビ記号 (n/p) を計算する。
pub(crate) use primes::jacobi;

use getrandom::getrandom;
use ruint::{aliases::U256, aliases::U512};

/// 256ビット巨大整数型。主に素因数分解ターゲットや因数表現で使用。
pub(crate) type Int = U256;

/// 512ビット巨大整数型。Montgomery乗算の中間演算等で使用。
pub(crate) type DoubleInt = U512;

/// 乱数生成器（Xoroshiro128++）。
/// Pollard's rho 法や ECM（楕円曲線法）のランダムシード生成に使用。
///
/// # Invariants
/// - シード初期化時にシステムの暗号学的に安全な乱数（`getrandom`）を使用します。
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

#[inline(always)]
pub(crate) fn truncate_to_int(d: DoubleInt) -> Int {
    let limbs = d.as_limbs();
    Int::from_limbs([limbs[0], limbs[1], limbs[2], limbs[3]])
}


/// U256向けのMontgomery乗算空間。
/// 通常の剰余演算 `a * b % n` を高速に行うための構造体。
///
/// # Invariants
/// - モジュラス `n` は 1 より大きく、かつ奇数（`n % 2 == 1`）である必要があります。
///   偶数や 1 以下の値の場合、乗算結果が正しく得られなくなります。
pub(crate) struct MontgomerySpace {
    n: Int,
    n_inv: Int,
    r2: Int, // R^2 mod N
}

impl MontgomerySpace {
    /// 新規のMontgomery乗算空間を構築する。
    /// 
    /// # Preconditions
    /// - `n` は奇数の整数かつ > 1 であること。
    pub(crate) fn new(n: Int) -> Self {
        let mut n_inv = n;
        for _ in 0..7 {
            n_inv = n_inv
                .wrapping_mul(Int::from(2))
                .wrapping_sub(n.wrapping_mul(n_inv).wrapping_mul(n_inv));
        }
        n_inv = (!n_inv).wrapping_add(Int::from(1));

        let r: DoubleInt = DoubleInt::from(1) << 256;
        let r_mod: DoubleInt = r % DoubleInt::from(n);
        let r2: DoubleInt = r_mod.wrapping_mul(r_mod) % DoubleInt::from(n);
        let r2 = truncate_to_int(r2);

        Self { n, n_inv, r2 }
    }

    /// 通常の整数 `x` を Montgomery 表現に変換する。
    pub(crate) fn transform(&self, x: Int) -> Int {
        self.mul(x, self.r2)
    }

    /// Montgomery reduction (REDC) アルゴリズムを実行し、通常の整数表現へ縮約する。
    pub(crate) fn reduce(&self, t: DoubleInt) -> Int {
        let t_low = truncate_to_int(t);
        let m = t_low.wrapping_mul(self.n_inv);
        let mn = DoubleInt::from(m).wrapping_mul(DoubleInt::from(self.n));

        let (sum, carry) = t.overflowing_add(mn);
        let res: DoubleInt = sum >> 256;
        let mut res_int = truncate_to_int(res);

        if carry {
            let (new_res, _sub_carry) = res_int.overflowing_sub(self.n);
            res_int = new_res;
        } else if res_int >= self.n {
            res_int = res_int - self.n;
        }
        res_int
    }

    /// Montgomery空間上で乗算を実行する。
    pub(crate) fn mul(&self, a: Int, b: Int) -> Int {
        let t = DoubleInt::from(a).wrapping_mul(DoubleInt::from(b));
        self.reduce(t)
    }

    /// Montgomery空間上での加算（法 N）を実行する。
    pub(crate) fn add(&self, a: Int, b: Int) -> Int {
        let (res, carry) = a.overflowing_add(b);
        if carry || res >= self.n {
            res.wrapping_sub(self.n)
        } else {
            res
        }
    }

    /// Montgomery空間上での減算（法 N）を実行する。
    pub(crate) fn sub(&self, a: Int, b: Int) -> Int {
        if a >= b {
            a - b
        } else {
            self.n - (b - a)
        }
    }

    /// Montgomery空間上でのべき乗算 (base^exp) を実行する (exp が u64)。
    pub(crate) fn pow(&self, mut base: Int, mut exp: u64) -> Int {
        let mut res = self.transform(Int::from(1));
        while exp > 0 {
            if exp & 1 == 1 {
                res = self.mul(res, base);
            }
            base = self.mul(base, base);
            exp >>= 1;
        }
        res
    }

    /// Montgomery空間上でのべき乗算 (base^exp) を実行する (exp が Int)。
    pub(crate) fn pow_int(&self, mut base: Int, mut exp: Int) -> Int {
        let mut res = self.transform(Int::from(1));
        while exp > Int::from(0) {
            if exp.as_limbs()[0] & 1 == 1 {
                res = self.mul(res, base);
            }
            base = self.mul(base, base);
            exp >>= 1;
        }
        res
    }
}

/// 最大公約数（GCD）を計算する。
/// 
/// # Preconditions
/// - 特になし（0 が入力された場合も安全に動作します）。
/// 
/// # Postconditions
/// - `a` と `b` の最大公約数を返します。
pub(crate) fn gcd(mut a: Int, mut b: Int) -> Int {
    while b > Int::from(0) {
        let temp = b;
        b = a % b;
        a = temp;
    }
    a
}

/// べき剰余 (base^exp) % mod_val を計算する。
/// 
/// # Preconditions
/// - `mod_val` は 0 であってはならない。
/// 
/// # Postconditions
/// - `(base^exp) % mod_val` の剰余結果を返します。
pub(crate) fn pow_mod(mut base: Int, mut exp: Int, mod_val: Int) -> Int {
    let mut res = Int::from(1);
    base = base % mod_val;
    while exp > Int::from(0) {
        if exp.as_limbs()[0] & 1 == 1 {
            let res_prod = DoubleInt::from(res).wrapping_mul(DoubleInt::from(base));
            res = truncate_to_int(res_prod % DoubleInt::from(mod_val));
        }
        let base_prod = DoubleInt::from(base).wrapping_mul(DoubleInt::from(base));
        base = truncate_to_int(base_prod % DoubleInt::from(mod_val));
        exp >>= 1;
    }
    res
}

/// リトルエンディアンのバイトスライス（最大32バイト）を読み込んで Int (U256) に変換する。
/// 
/// # Preconditions
/// - 特になし（スライス長が32バイト未満の場合はゼロパディングして読み込みます）。
/// 
/// # Postconditions
/// - 変換された 256 ビット巨大整数値を返します。
pub(crate) fn int_from_le_slice(bytes: &[u8]) -> Int {
    let mut padded = [0u8; 32];
    let len = core::cmp::min(bytes.len(), 32);
    padded[..len].copy_from_slice(&bytes[..len]);
    
    // Invariant: padded is exactly 32 bytes, matching U256 representation.
    debug_assert_eq!(padded.len(), 32, "Padded array must be exactly 32 bytes");
    
    Int::try_from_le_slice(&padded).unwrap_or(Int::from(0))
}

/// 拡張ユークリッド互除法を用いて、指定した数のモジュラ逆数 `a^-1 (mod m)` を計算する。
///
/// # Preconditions
/// - `a` と `m` は U256 (Int)。
/// - `m` は 0 であってはならない。
/// - `a` と `m` が互いに素（`gcd(a, m) == 1`）であること。
///
/// # Postconditions
/// - 逆数が存在する場合は `Some(inv)` を返し、存在しない場合は `None` を返します。
pub(crate) fn ext_gcd_inverse(a: Int, m: Int) -> Option<Int> {
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
