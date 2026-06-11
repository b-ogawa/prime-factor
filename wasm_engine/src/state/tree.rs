use crate::math::Int;
use rustc_hash::FxHashMap;

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
    pub ecm_b1_tested: u32,
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
