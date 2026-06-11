mod ecm_params;
mod siqs_params;
mod primes;

/// 楕円曲線法 (ECM) および Pollard's P-1, Pollard's Rho (Brent) の調整可能なパラメータ。
///
/// # Invariants
/// - `p1_b2_multiplier` は Pollard's P-1 法における B2 限界値の B1 に対する倍率。
/// - `ecm_b2_multiplier` は ECM における B2 限界値の B1 に対する倍率。
/// - `brent_m` は Pollard's Brent 法における、GCD確認を行うブロックサイズ。
/// - `d_val` は ECM Phase 2 における baby-step / giant-step のパラメータ d。
/// - `gcd_check_interval` は ECM のメインループおよび P-1 法で GCD の計算を行う周期。
/// - `p1_max_gap` は Pollard's P-1 法 Phase 2 における最大許容ギャップサイズ。
pub use ecm_params::EcmParams;

/// 自己初期化型二次ふるい法 (SIQS) の調整可能なパラメータ。
///
/// # Invariants
/// - `fb_size_coeff_a` はファクターベースサイズ決定用の対数係数 A。
/// - `fb_size_coeff_b` はファクターベースサイズ決定用の対数定数 B。
/// - `fb_size_min` はファクターベースサイズの最小値制限。
/// - `fb_size_max` はファクターベースサイズの最大値制限。
pub use siqs_params::SiqsParams;

/// 合成数 kN の十進数桁数に基づいて、SIQS の多項式 A を構成する素因数の数 s を返す。
///
/// # Preconditions
/// - `digits` は合成数の十進数桁数。
///
/// # Postconditions
/// - 桁数に応じて 1〜7 の範囲で構成数 s を返します。
pub(crate) use siqs_params::get_s_val_for_digits;

/// Knuth-Schroeppel 乗数探索用の乗数定数リスト。
pub(crate) use primes::MULTIPLIERS;

/// 乗数選択で使用する平方剰余判定用素数リスト。
pub(crate) use primes::CHOOSE_MULTIPLIER_PRIMES;
