mod ecm;
mod siqs;

/// Pollard's P-1 法を用いて合成数の因数を探索する。
/// 
/// # Preconditions
/// - `n_bytes` はターゲットとなる合成数を示す32バイト以下のリトルエンディアンバイト配列。
/// - `primes` は十分な個数の試し割り素数リスト。
/// 
/// # Postconditions
/// - 因数が見つかった場合、その因数（リトルエンディアンバイト配列、32バイト）を `Some(Vec<u8>)` で返します。
/// - 因数が見つからない、またはアボートが検知された場合は `None` を返します。
pub use ecm::pollard_p1_bytes;

/// Pollard's Rho（Brent版）法を用いて因数を探索する。
/// 
/// # Preconditions
/// - `n_bytes` はターゲット値（奇数の合成数）を示すリトルエンディアンバイト配列。
/// - `max_iters` は探索のイテレーション上限。
/// 
/// # Postconditions
/// - 因数が見つかった場合、その因数（リトルエンディアン32バイト配列）を `Some(Vec<u8>)` で返します。
/// - アボート、探索完了、あるいは最大回数に達しても見つからない場合は `None` を返します。
pub use ecm::pollard_brent_bytes;

/// 楕円曲線法（ECM）の計算プロセスを段階的に実行するためのランナー。
pub use ecm::EcmRunner;

/// SIQSによるふるい落とし（Sieving）計算をスレッド個別に実行するためのワーカー。
pub use siqs::SiqsWorker;

/// 拡張ユークリッド互除法を用いて、指定した数のモジュラ逆数 `a^-1 (mod m)` を計算する内部関数。
///
/// # Preconditions
/// - `a` と `m` は U256 (Int)。
/// - `m` は 0 であってはならない。
/// - `a` と `m` が互いに素（`gcd(a, m) == 1`）であること。
///
/// # Postconditions
/// - 逆数が存在する場合は `Some(inv)` を返し、存在しない場合は `None` を返します。
pub(crate) use ecm::ext_gcd_inverse_internal;
