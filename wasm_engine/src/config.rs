/// 楕円曲線法 (ECM) および Pollard's P-1, Pollard's Rho (Brent) の調整可能なパラメータ。
pub struct EcmParams {
    pub p1_b2_multiplier: usize,
    pub ecm_b2_multiplier: usize,
    pub brent_m: usize,
    pub d_val: usize,
    pub gcd_check_interval: usize,
    pub p1_max_gap: usize,
}

impl Default for EcmParams {
    fn default() -> Self {
        Self {
            p1_b2_multiplier: 10,
            ecm_b2_multiplier: 50,
            brent_m: 100,
            d_val: 210,
            gcd_check_interval: 256,
            p1_max_gap: 200,
        }
    }
}

/// 自己初期化型二次ふるい法 (SIQS) の調整可能なパラメータ。
pub struct SiqsParams {
    pub fb_size_coeff_a: f64,
    pub fb_size_coeff_b: f64,
    pub fb_size_min: usize,
    pub fb_size_max: usize,
}

impl Default for SiqsParams {
    fn default() -> Self {
        Self {
            fb_size_coeff_a: 0.32,
            fb_size_coeff_b: 0.2,
            fb_size_min: 50,
            fb_size_max: 20000,
        }
    }
}

/// 合成数 kN の十進数桁数に基づいて、SIQS の多項式 A を構成する素因数の数 s を返す。
pub(crate) fn get_s_val_for_digits(digits: usize) -> usize {
    if digits >= 64 {
        7
    } else if digits >= 56 {
        6
    } else if digits >= 48 {
        5
    } else if digits >= 40 {
        4
    } else if digits >= 32 {
        3
    } else if digits >= 24 {
        2
    } else {
        1
    }
}

/// Knuth-Schroeppel 乗数探索用の乗数定数リスト。
pub(crate) const MULTIPLIERS: [u64; 22] = [
    1, 2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73,
];

/// 乗数選択で使用する平方剰余判定用素数リスト。
pub(crate) const CHOOSE_MULTIPLIER_PRIMES: [u64; 16] = [
    2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53,
];
