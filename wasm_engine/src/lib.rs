pub mod algorithms;
pub mod config;
pub mod error;
pub mod math;
pub mod state;

use rustc_hash::FxHashMap;
use std::str::FromStr;
use wasm_bindgen::prelude::*;

use crate::math::{
    ext_gcd_inverse, gcd, int_from_le_slice, is_prime_bpsw, jacobi, tonelli_shanks, DoubleInt, Int,
};
use crate::state::{FbPrime, NodeStatus, PendingPartialRelation, SiqsState, TreeNode};

/// 因数分解セッションが現在メインスレッドおよびワーカーに要求しているアクションの種類。
#[wasm_bindgen]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ActionType {
    /// 探索対象がなくアイドル状態
    Idle = 0,
    /// すべての合成数が素因数分解された完了状態
    Complete = 1,
    /// 試し割り等のローカル演算を実行中
    LocalFactor = 2,
    /// 二次ふるい法(SIQS)のワーカー実行要求状態
    StartSiqs = 3,
    /// 楕円曲線法(ECM)のワーカー実行要求状態
    StartEcm = 4,
    /// 他のワーカーの終了待ちまたは同期待ち状態
    Wait = 5,
}

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);
    pub fn check_abort() -> u32;
}

/// JavaScript側から呼び出され、CPUの演算能力を評価するためのマイクロベンチマーク。
///
/// # Preconditions
/// 特になし。
///
/// # Postconditions
/// Montgomery空間での積算ループを50万回実行した結果の下位32ビットを返す。
#[wasm_bindgen]
pub fn run_micro_benchmark() -> u32 {
    let n = Int::from(340282366920938463463374607431768211407u128);
    let mont = crate::math::MontgomerySpace::new(n);
    let mut x = mont.transform(Int::from(12345));
    let mut y = mont.transform(Int::from(67890));
    for _ in 0..500000 {
        x = mont.mul(x, y);
        y = mont.mul(y, x);
    }
    x.as_limbs()[0] as u32
}

/// Knuth-Schroeppelの基準に従い、二次ふるい法(SIQS)で最も有利な乗数 k (multiplier) を選択する。
///
/// # Preconditions
/// - `n` は素因数分解の対象となる合成数。
///
/// # Postconditions
/// - リターンされた `k` は、`kN` が小さな素数を法とする平方剰余になりやすい乗数。
fn choose_multiplier(n: Int) -> Int {
    let multipliers = crate::config::MULTIPLIERS;
    let mut best_score = -1.0;
    let primes = crate::config::CHOOSE_MULTIPLIER_PRIMES;
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

/// ターゲット数 `n` に対する二次ふるいのファクターベース（小さな平方剰余素数）を生成する。
///
/// # Preconditions
/// - `n` は平方剰余判定の基準値。
/// - `target_size` は生成するファクターベースの素数の個数。
///
/// # Postconditions
/// - `jacobi(n, p) == 1` を満たし、Tonelli-Shanks法で `n` の平方根 `r (mod p)` が計算可能な素数 `p` が `target_size` 個格納されたベクタを返す。
fn generate_factor_base(n: Int, target_size: usize) -> Vec<FbPrime> {
    let mut fb = Vec::with_capacity(target_size);
    fb.push(FbPrime {
        p: 2,
        log: 8,
        r: Int::from(1),
    });

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

/// 合成数の十進数桁数に基づき、SIQSでの最適なファクターベースのサイズを算出する。
///
/// # Preconditions
/// 特になし。
///
/// # Postconditions
/// - 最小 50、最大 20000 の範囲でファクターベース数を返す。
fn get_siqs_params(digits: usize) -> usize {
    let params = crate::config::SiqsParams::default();
    let ln_n = (digits as f64) * 10.0f64.ln();
    let sqrt_ln_n = (ln_n * ln_n.ln()).sqrt();
    let fb_size = (params.fb_size_coeff_a * sqrt_ln_n + params.fb_size_coeff_b)
        .exp()
        .round() as usize;
    fb_size.max(params.fb_size_min).min(params.fb_size_max)
}

// --- SIQS MATRIX REDUCER (WASM) ---

/// SIQSで得られた1つの関係式（Relation）を表す構造体。
/// 各フィールドはバイト配列表記や素因数のインデックスリストとして保持される。
pub struct SiqsRelation {
    /// 符号（正なら2、負なら0などのフラグ化される）
    pub sign: i32,
    /// 多項式変数 x のリトルエンディアンバイト表現
    pub x: Vec<u8>,
    /// 二次多項式の値 b (mod a)
    pub b: Vec<u8>,
    /// 多項式係数 a
    pub a: Vec<u8>,
    /// 関係を構成するファクターベースの素因数インデックスリスト
    pub factors: Vec<u32>,
}

/// JS側から送られてくる個々のリレーションを蓄積し、行列のガウス消去法および平方剰余の平方根計算を行うための構造体。
#[wasm_bindgen]
pub struct SiqsReducer {
    n: Int,
    kn: Int,
    fb: Vec<u32>,
    relations: Vec<SiqsRelation>,
}

#[wasm_bindgen]
impl SiqsReducer {
    /// 新規のリデューサーを初期化する。
    ///
    /// # Preconditions
    /// - `n_bytes` と `kn_bytes` はリトルエンディアン形式の有効な整数バイト列であること。
    /// - `fb_primes` はファクターベースとなる素数のリストであること。
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

    /// 個別のふるいプロセスで発見された関係式（Relation）を追加する。
    ///
    /// # Preconditions
    /// - 各 `_bytes` 配列はリトルエンディアン形式の整数であること。
    /// - `factors` に含まれるインデックスは、コンストラクタで渡した `fb_primes` の有効範囲内であること。
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

const SLOT_SIZE: usize = 128 * 1024;
const NUM_SLOTS: usize = 8;

/// 因数分解セッションの状態および全体のタスクフローをオーケストレーションする構造体。
///
/// # Invariants
/// - `nodes` には分解中の因数分解木の全ノードが含まれ、インデックス 0 がルートノード（元の分解対象数）となります。
/// - `slots` は各ワーカープロセスが計算データを安全に書き込むための共有メモリブロック。
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
    /// 新規の因数分解セッションを生成する。
    ///
    /// # Preconditions
    /// - `n_str` は十進数の整数文字列であること。
    ///
    /// # Postconditions
    /// - バラメータ `n_str` に応じた探索木ノードおよび8個の共有バッファスロット（各128KB）が初期化される。
    #[wasm_bindgen(constructor)]
    pub fn new(n_str: &str) -> Result<FactorizationSession, JsValue> {
        let n = Int::from_str(n_str).map_err(|e| {
            crate::error::FactorizationError::InvalidInput(format!("Failed to parse number: {}", e))
        })?;

        if n <= Int::from(1) {
            return Err(crate::error::FactorizationError::InvalidInput(format!(
                "Input N must be > 1, got {}",
                n_str
            ))
            .into());
        }

        let is_pr = is_prime_bpsw(n);
        let status = if is_pr {
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
            ecm_b1_tested: 0,
        };

        let mut metrics = vec![0u32; 8];
        if status == NodeStatus::Solved {
            metrics[0] = 1;
        }

        let slots = vec![vec![0u8; SLOT_SIZE]; NUM_SLOTS];
        let slot_in_use = vec![false; NUM_SLOTS];

        Ok(Self {
            nodes: vec![root],
            metrics,
            current_target_idx: None,
            slots,
            slot_in_use,
            current_siqs_state: None,
            current_reducer: None,
        })
    }

    /// メトリクス情報領域の先頭メモリアドレスを取得する。
    ///
    /// # Preconditions
    /// 特になし。
    ///
    /// # Postconditions
    /// - `[solved_factors_count, relations_count, polys_searched]` 等の統計情報をマッピング可能なポインタを返す。
    pub fn get_metrics_ptr(&self) -> *const u32 {
        self.metrics.as_ptr()
    }

    /// 計算結果書き込み用の未使用バッファスロット（インデックス）を取得する。
    ///
    /// # Preconditions
    /// 特になし。
    ///
    /// # Postconditions
    /// - 利用可能なスロットがあれば `0..=7` のインデックスを返し、対象スロットを `in_use` にマークする。
    /// - 空きスロットがない場合は `-1` を返す。
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

    /// Determines the next action JS should take.
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
            let has_processing = self
                .nodes
                .iter()
                .any(|n| n.status == NodeStatus::Processing);
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

    /// Reports that a factor has been found.
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
            let parent_b1_tested = self.nodes[idx].ecm_b1_tested;

            let m1 = if f1 == f2 { m * 2 } else { m };
            let m2 = if f1 == f2 { 0 } else { m };

            self.nodes[idx].status = NodeStatus::Solved;

            let f1_is_prime = is_prime_bpsw(f1);
            let f1_status = if f1_is_prime {
                NodeStatus::Solved
            } else {
                NodeStatus::Unsolved
            };
            let child1_idx = self.nodes.len();
            self.nodes.push(TreeNode {
                value: f1,
                status: f1_status,
                multiplicity: m1,
                children: Vec::new(),
                tried_ecm: false,
                ecm_b1_tested: parent_b1_tested,
            });
            self.nodes[idx].children.push(child1_idx);

            if m2 > 0 {
                let f2_is_prime = is_prime_bpsw(f2);
                let f2_status = if f2_is_prime {
                    NodeStatus::Solved
                } else {
                    NodeStatus::Unsolved
                };
                let child2_idx = self.nodes.len();
                self.nodes.push(TreeNode {
                    value: f2,
                    status: f2_status,
                    multiplicity: m2,
                    children: Vec::new(),
                    tried_ecm: false,
                    ecm_b1_tested: parent_b1_tested,
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

    pub fn report_exhausted(&mut self, target_str: &str, b1_tested: u32) -> ActionType {
        let target = Int::from_str(target_str).unwrap_or(Int::from(0));
        for i in 0..self.nodes.len() {
            if self.nodes[i].value == target && self.nodes[i].status == NodeStatus::Processing {
                self.nodes[i].status = NodeStatus::Unsolved;
                self.nodes[i].tried_ecm = true;
                if b1_tested > self.nodes[i].ecm_b1_tested {
                    self.nodes[i].ecm_b1_tested = b1_tested;
                }
            }
        }
        self.get_next_action()
    }

    pub fn get_ecm_b1_tested(&self, target_str: &str) -> u32 {
        let target = Int::from_str(target_str).unwrap_or(Int::from(0));
        for node in &self.nodes {
            if node.value == target {
                return node.ecm_b1_tested;
            }
        }
        0
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
                    if let Some(f_bytes) =
                        crate::algorithms::pollard_brent_bytes(&n.to_le_bytes::<32>(), 500000, 0)
                    {
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
            let parent_b1_tested = self.nodes[idx].ecm_b1_tested;

            let mut factor_counts: std::collections::HashMap<Int, u32> =
                std::collections::HashMap::new();
            for f in factors {
                *factor_counts.entry(f).or_insert(0) += 1;
            }

            for (f, count) in factor_counts {
                let f_is_prime = is_prime_bpsw(f);
                let f_status = if f_is_prime {
                    NodeStatus::Solved
                } else {
                    NodeStatus::Unsolved
                };
                let child_idx = self.nodes.len();
                self.nodes.push(TreeNode {
                    value: f,
                    status: f_status,
                    multiplicity: count * target_mult,
                    children: Vec::new(),
                    tried_ecm: false,
                    ecm_b1_tested: parent_b1_tested,
                });
                self.nodes[idx].children.push(child_idx);
            }
            self.update_metrics();
            true
        } else {
            false
        }
    }

    /// Submits a buffer processed by a worker containing relations.
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

            if offset + 8 > data.len() {
                break;
            }
            let x_i64 = i64::from_le_bytes(data[offset..offset + 8].try_into().unwrap());
            offset += 8;

            if offset + 32 > data.len() {
                break;
            }
            let a_val = int_from_le_slice(&data[offset..offset + 32]);
            offset += 32;

            if offset + 32 > data.len() {
                break;
            }
            let b_val = int_from_le_slice(&data[offset..offset + 32]);
            offset += 32;

            let mut lp_u64 = 0u64;
            if is_partial {
                if offset + 8 > data.len() {
                    break;
                }
                lp_u64 = u64::from_le_bytes(data[offset..offset + 8].try_into().unwrap());
                offset += 8;
            }

            if offset + 2 > data.len() {
                break;
            }
            let factors_len =
                u16::from_le_bytes(data[offset..offset + 2].try_into().unwrap()) as usize;
            offset += 2;

            if offset + factors_len * 4 > data.len() {
                break;
            }
            let mut factors = Vec::with_capacity(factors_len);
            for _ in 0..factors_len {
                let f_idx = u32::from_le_bytes(data[offset..offset + 4].try_into().unwrap());
                factors.push(f_idx);
                offset += 4;
            }

            if is_partial {
                if let Some(r1) = state.partial_relations.remove(&lp_u64) {
                    let term1 = (DoubleInt::from(r1.a) * DoubleInt::from(r1.x)
                        + DoubleInt::from(r1.b))
                        % DoubleInt::from(kn);
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
                    let term2 = (DoubleInt::from(a_val) * DoubleInt::from(x2_u256)
                        + DoubleInt::from(b_val))
                        % DoubleInt::from(kn);
                    let term2_int = Int::from_limbs(term2.as_limbs()[..4].try_into().unwrap());

                    let x_prod = (DoubleInt::from(term1_int) * DoubleInt::from(term2_int))
                        % DoubleInt::from(kn);
                    let x_prod_int = Int::from_limbs(x_prod.as_limbs()[..4].try_into().unwrap());

                    let lp_int = Int::from(lp_u64);
                    if let Some(lp_inv) = ext_gcd_inverse(lp_int, kn) {
                        let x_combined = (DoubleInt::from(x_prod_int) * DoubleInt::from(lp_inv))
                            % DoubleInt::from(kn);
                        let x_combined_int =
                            Int::from_limbs(x_combined.as_limbs()[..4].try_into().unwrap());

                        let combined_factors = [r1.factors, factors].concat();
                        let new_sign = r1.sign * sign;

                        reducer.add_relation(
                            new_sign,
                            &x_combined_int.to_le_bytes::<32>(),
                            &[0u8; 32],
                            &[
                                1u8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                                0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                            ],
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
                    state.partial_relations.insert(
                        lp_u64,
                        PendingPartialRelation {
                            sign,
                            x: x_u256,
                            b: b_val,
                            a: a_val,
                            factors,
                        },
                    );
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
        let mut solved_trees: std::collections::HashMap<Int, Vec<TreeNode>> =
            std::collections::HashMap::new();

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
            ecm_b1_tested: node.ecm_b1_tested,
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
                ecm_b1_tested: node.ecm_b1_tested,
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
            if node.status == NodeStatus::Solved
                && node.children.is_empty()
                && node.value > Int::from(1)
            {
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
                if node.status == NodeStatus::Solved
                    && node.children.is_empty()
                    && node.value > Int::from(1)
                {
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

// ==========================================
//集約されたJS連携用 API（FFI / 契約の真のソース）
// ==========================================

/// JSのバイト配列を受け取り、内部で `is_prime_bpsw` を呼び出して素数か判定する。
/// JS側（WasmAdapter）との通信インターフェース。
///
/// # Preconditions
/// - `n_bytes` はリトルエンディアン形式の有効な整数バイト列。
#[wasm_bindgen]
pub fn is_prime_bpsw_bytes(n_bytes: &[u8]) -> bool {
    let n = int_from_le_slice(n_bytes);
    is_prime_bpsw(n)
}

/// エラトステネスのふるいを用いて、指定された上限値 `max` までのすべての素数を列挙する。
///
/// # Preconditions
/// - `max` は 100,000,000 以下であること（メモリ保護のため自動的に上限が切り詰められます）。
///
/// # Postconditions
/// - 発見された素数を昇順に並べた `Vec<u32>` を返します。
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

    let limit = (max as f64).sqrt() as usize;
    for p in 2..=limit {
        if is_prime[p] {
            let mut i = p * p;
            while i <= max {
                is_prime[i] = false;
                i += p;
            }
        }
    }

    let mut primes = Vec::new();
    for i in 2..=max {
        if is_prime[i] {
            primes.push(i as u32);
        }
    }
    primes
}

/// JSのバイト配列を受け取り、Pollard's P-1 法を用いて合成数の因数を探索するラッパー。
#[wasm_bindgen]
pub fn pollard_p1_bytes(
    n_bytes: &[u8],
    b1: usize,
    b2_multiplier: usize,
    primes: &[u32],
    seed_offset: usize,
) -> Option<Vec<u8>> {
    crate::algorithms::pollard_p1_bytes(n_bytes, b1, b2_multiplier, primes, seed_offset)
}

/// JSのバイト配列を受け取り、Pollard's Rho（Brent版）法を用いて因数を探索するラッパー。
#[wasm_bindgen]
pub fn pollard_brent_bytes(n_bytes: &[u8], max_iters: usize, seed_offset: usize) -> Option<Vec<u8>> {
    crate::algorithms::pollard_brent_bytes(n_bytes, max_iters, seed_offset)
}

/// 楕円曲線法（ECM）の計算プロセスを段階的に実行するためのランナーラッパー。
///
/// # Preconditions
/// - `n_bytes` は奇数の合成数（リトルエンディアンバイト配列）。
/// - `b1` は第1段階限界値 B1。
///
/// # Postconditions
/// - 実行状態を保持する native EcmRunner インスタンスが初期化されます。
#[wasm_bindgen]
pub struct EcmRunner(crate::algorithms::EcmRunner);

#[wasm_bindgen]
impl EcmRunner {
    #[wasm_bindgen(constructor)]
    pub fn new(n_bytes: &[u8], b1: usize, b2_multiplier: usize) -> Self {
        Self(crate::algorithms::EcmRunner::new(n_bytes, b1, b2_multiplier))
    }

    /// 指定された回数（カーブ数）だけ、Suyamaの媒介変数を用いた楕円曲線法（Montgomery ladder 形式）を実行する。
    ///
    /// # Preconditions
    /// - インスタンスが有効に初期化されていること。
    ///
    /// # Postconditions
    /// - 因数が発見された場合、直ちに `Some(Vec<u8>)` （リトルエンディアン32バイト）を返します。
    /// - カーブを実行し終えても因数が見つからない、またはアボート要求が検知された場合は `None` を返します。
    pub fn run_curves(&mut self, curves_to_run: usize) -> Option<Vec<u8>> {
        self.0.run_curves(curves_to_run)
    }
}

/// SIQSによるふるい落とし（Sieving）計算をスレッド個別に実行するためのワーカーラッパー。
///
/// # Preconditions
/// - `kn_bytes` はターゲット kN のリトルエンディアンバイト配列。
/// - `fb_primes` はファクターベース素数配列。
/// - `fb_logs` は各素数の対数スケール値配列。
/// - `fb_r_bytes` は各平方剰余平方根 `r (mod p)` を32バイト毎に連結したバイト配列。
/// - `sieve_limit` はふるい領域の長さ（100以上を推奨）。
#[wasm_bindgen]
pub struct SiqsWorker(crate::algorithms::SiqsWorker);

#[wasm_bindgen]
impl SiqsWorker {
    #[wasm_bindgen(constructor)]
    pub fn new(
        kn_bytes: &[u8],
        fb_primes: &[u32],
        fb_logs: &[u8],
        fb_r_bytes: &[u8],
        sieve_limit: usize,
        worker_id: usize,
        core_count: usize,
    ) -> Result<SiqsWorker, JsValue> {
        let worker = crate::algorithms::SiqsWorker::new(
            kn_bytes,
            fb_primes,
            fb_logs,
            fb_r_bytes,
            sieve_limit,
            worker_id,
            core_count,
        )
        .map_err(|e| JsValue::from_str(e))?;
        Ok(Self(worker))
    }

    /// 指定された多項式のバッチ数だけふるい落とし（Sieving）処理を実行し、結果をシリアライズバッファに書き込む。
    ///
    /// # Preconditions
    /// - `batch_size > 0` であること。
    ///
    /// # Postconditions
    /// - 処理中に `check_abort` が 1 を返した場合、処理を打ち切って直ちに `0` を返します。
    /// - 発見されたリレーションデータのバイトサイズを返します。
    pub fn step(&mut self, batch_size: usize) -> usize {
        self.0.step(batch_size)
    }

    /// 結果が書き込まれたシリアライズバッファの先頭メモリアドレスを取得する。
    pub fn result_ptr(&self) -> *const u8 {
        self.0.result_ptr()
    }
}
