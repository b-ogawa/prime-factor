use crate::math::Int;
use rustc_hash::FxHashMap;

/// 因数分解木の個々のノードの状態を表す。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NodeStatus {
    Unsolved,
    Processing,
    Solved,
}

/// 因数分解対象の数および探索木の関係性を保持するノード。
pub struct TreeNode {
    pub value: Int,
    pub status: NodeStatus,
    pub multiplicity: u32,
    pub children: Vec<usize>,
    pub tried_ecm: bool,
    pub ecm_b1_tested: u32,
}

/// SIQSで使用するファクターベースの構成単位（素数）。
pub struct FbPrime {
    pub p: u32,
    pub log: u8,
    pub r: Int,
}

/// 部分リレーション（Large Prime Relation）の一致待ち中間データを表す。
pub struct PendingPartialRelation {
    pub sign: i32,
    pub x: Int,
    pub b: Int,
    pub a: Int,
    pub factors: Vec<u32>,
}

/// 二次ふるい（SIQS）の実行状態を保持する。
pub struct SiqsState {
    pub target: Int,
    pub k: Int,
    pub kn: Int,
    pub fb: Vec<FbPrime>,
    pub m: usize,
    pub partial_relations: FxHashMap<u64, PendingPartialRelation>,
    pub relation_signatures: std::collections::HashSet<i64>,
}
