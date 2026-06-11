mod tree;

/// 因数分解木の個々のノードの状態を表す。
/// 
/// # Invariants
/// - `Unsolved`: まだ素数であることが証明されておらず、因数分解が未完了の状態。
/// - `Processing`: 現在Workerによって計算（ECMやSIQS等）アサイン中である状態。
/// - `Solved`: 素数であることが確定した、または1以下の状態（これ以上の分解は不要）。
pub(crate) use tree::NodeStatus;

/// 因数分解対象の数および探索木の関係性を保持するノード。
/// 
/// # Invariants
/// - `value` はノードの数値（U256）。
/// - `status` はノードの解決ステータス。
/// - `multiplicity` はこのノード値の重複度（冪乗数）。
/// - `children` は子ノード（分解された因数）の `nodes` 配列内インデックス一覧。
/// - `tried_ecm` はこのノードに対してECMが一度実行されたかどうかのフラグ（無駄なECM再実行を防ぐ）。
/// - `ecm_b1_tested` はこのノードに対してこれまでにテスト済みの最大 ECM B1 限界値。
pub(crate) use tree::TreeNode;

/// SIQSで使用するファクターベースの構成単位（素数）。
/// 
/// # Invariants
/// - `p` は素数 p。
/// - `log` は対数スケール値 log2(p) * 8。
/// - `r` は二次剰余根 r^2 = N (mod p)。
pub(crate) use tree::FbPrime;

/// 部分リレーション（Large Prime Relation）の一致待ち中間データを表す。
/// 
/// # Invariants
/// - `sign` は多項式値の符号。
/// - `x` は多項式変数 x の値。
/// - `b`, `a` は多項式の係数。
/// - `factors` は関係を構成する素因数インデックスリスト。
pub(crate) use tree::PendingPartialRelation;

/// 二次ふるい（SIQS）の実行状態を保持する。
/// 
/// # Invariants
/// - `target` はターゲットとなる合成数。
/// - `k` は乗数。
/// - `kn` は k * target。
/// - `fb` はファクターベース素数のリスト。
/// - `m` はふるい領域の長さ。
/// - `partial_relations` は大素数をキーとする未解決の部分リレーションマップ。
/// - `relation_signatures` は二重登録防止用の関係シグネチャセット。
pub(crate) use tree::SiqsState;
