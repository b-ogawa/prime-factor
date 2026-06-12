/* tslint:disable */
/* eslint-disable */

/**
 * 因数分解セッションが現在メインスレッドおよびワーカーに要求しているアクションの種類。
 */
export enum ActionType {
    /**
     * 探索対象がなくアイドル状態
     */
    Idle = 0,
    /**
     * すべての合成数が素因数分解された完了状態
     */
    Complete = 1,
    /**
     * 試し割り等のローカル演算を実行中
     */
    LocalFactor = 2,
    /**
     * 二次ふるい法(SIQS)のワーカー実行要求状態
     */
    StartSiqs = 3,
    /**
     * 楕円曲線法(ECM)のワーカー実行要求状態
     */
    StartEcm = 4,
    /**
     * 他のワーカーの終了待ちまたは同期待ち状態
     */
    Wait = 5,
}

/**
 * 楕円曲線法（ECM）の計算プロセスを段階的に実行するためのランナーラッパー。
 *
 * # Preconditions
 * - `n_bytes` は奇数の合成数（リトルエンディアンバイト配列）。
 * - `b1` は第1段階限界値 B1。
 *
 * # Postconditions
 * - 実行状態を保持する native EcmRunner インスタンスが初期化されます。
 */
export class EcmRunner {
    free(): void;
    [Symbol.dispose](): void;
    constructor(n_bytes: Uint8Array, b1: number);
    /**
     * 指定された回数（カーブ数）だけ、Suyamaの媒介変数を用いた楕円曲線法（Montgomery ladder 形式）を実行する。
     *
     * # Preconditions
     * - インスタンスが有効に初期化されていること。
     *
     * # Postconditions
     * - 因数が発見された場合、直ちに `Some(Vec<u8>)` （リトルエンディアン32バイト）を返します。
     * - カーブを実行し終えても因数が見つからない、またはアボート要求が検知された場合は `None` を返します。
     */
    run_curves(curves_to_run: number): Uint8Array | undefined;
}

/**
 * 因数分解セッションの状態および全体のタスクフローをオーケストレーションする構造体。
 *
 * # Invariants
 * - `nodes` には分解中の因数分解木の全ノードが含まれ、インデックス 0 がルートノード（元の分解対象数）となります。
 * - `slots` は各ワーカープロセスが計算データを安全に書き込むための共有メモリブロック。
 */
export class FactorizationSession {
    free(): void;
    [Symbol.dispose](): void;
    factor_locally(target_str: string): boolean;
    /**
     * 計算結果書き込み用の未使用バッファスロット（インデックス）を取得する。
     *
     * # Preconditions
     * 特になし。
     *
     * # Postconditions
     * - 利用可能なスロットがあれば `0..=7` のインデックスを返し、対象スロットを `in_use` にマークする。
     * - 空きスロットがない場合は `-1` を返す。
     */
    get_available_buffer(): number;
    get_buffer_ptr(slot_id: number): number;
    get_current_target(): string;
    get_ecm_b1_tested(target_str: string): number;
    get_factors_json(): string;
    /**
     * メトリクス情報領域の先頭メモリアドレスを取得する。
     *
     * # Preconditions
     * 特になし。
     *
     * # Postconditions
     * - `[solved_factors_count, relations_count, polys_searched]` 等の統計情報をマッピング可能なポインタを返す。
     */
    get_metrics_ptr(): number;
    /**
     * Determines the next action JS should take.
     */
    get_next_action(): ActionType;
    get_siqs_fb_logs(): Uint8Array;
    get_siqs_fb_primes(): Uint32Array;
    get_siqs_fb_r(): Uint8Array;
    get_siqs_kn(): string;
    get_siqs_m(): number;
    get_unresolved_json(): string;
    /**
     * 新規の因数分解セッションを生成する。
     *
     * # Preconditions
     * - `n_str` は十進数の整数文字列であること。
     *
     * # Postconditions
     * - バラメータ `n_str` に応じた探索木ノードおよび8個の共有バッファスロット（各128KB）が初期化される。
     */
    constructor(n_str: string);
    release_buffer(slot_id: number): void;
    report_exhausted(target_str: string, b1_tested: number): ActionType;
    /**
     * Reports that a factor has been found.
     */
    report_factor(target_str: string, factor_str: string): ActionType;
    report_prime(target_str: string): ActionType;
    siqs_reduce_matrix(): string | undefined;
    /**
     * Submits a buffer processed by a worker containing relations.
     */
    submit_worker_result(slot_id: number, length: number): ActionType;
}

/**
 * JS側から送られてくる個々のリレーションを蓄積し、行列のガウス消去法および平方剰余の平方根計算を行うための構造体。
 */
export class SiqsReducer {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * 個別のふるいプロセスで発見された関係式（Relation）を追加する。
     *
     * # Preconditions
     * - 各 `_bytes` 配列はリトルエンディアン形式の整数であること。
     * - `factors` に含まれるインデックスは、コンストラクタで渡した `fb_primes` の有効範囲内であること。
     */
    add_relation(sign: number, x_bytes: Uint8Array, b_bytes: Uint8Array, a_bytes: Uint8Array, factors: Uint32Array): void;
    /**
     * 新規のリデューサーを初期化する。
     *
     * # Preconditions
     * - `n_bytes` と `kn_bytes` はリトルエンディアン形式の有効な整数バイト列であること。
     * - `fb_primes` はファクターベースとなる素数のリストであること。
     */
    constructor(n_bytes: Uint8Array, kn_bytes: Uint8Array, fb_primes: Uint32Array);
    reduce_matrix(): Uint8Array | undefined;
}

/**
 * SIQSによるふるい落とし（Sieving）計算をスレッド個別に実行するためのワーカーラッパー。
 *
 * # Preconditions
 * - `kn_bytes` はターゲット kN のリトルエンディアンバイト配列。
 * - `fb_primes` はファクターベース素数配列。
 * - `fb_logs` は各素数の対数スケール値配列。
 * - `fb_r_bytes` は各平方剰余平方根 `r (mod p)` を32バイト毎に連結したバイト配列。
 * - `sieve_limit` はふるい領域の長さ（100以上を推奨）。
 */
export class SiqsWorker {
    free(): void;
    [Symbol.dispose](): void;
    constructor(kn_bytes: Uint8Array, fb_primes: Uint32Array, fb_logs: Uint8Array, fb_r_bytes: Uint8Array, sieve_limit: number, worker_id: number, core_count: number);
    /**
     * 結果が書き込まれたシリアライズバッファの先頭メモリアドレスを取得する。
     */
    result_ptr(): number;
    /**
     * 指定された多項式のバッチ数だけふるい落とし（Sieving）処理を実行し、結果をシリアライズバッファに書き込む。
     *
     * # Preconditions
     * - `batch_size > 0` であること。
     *
     * # Postconditions
     * - 処理中に `check_abort` が 1 を返した場合、処理を打ち切って直ちに `0` を返します。
     * - 発見されたリレーションデータのバイトサイズを返します。
     */
    step(batch_size: number): number;
}

/**
 * JSのバイト配列を受け取り、内部で `is_prime_bpsw` を呼び出して素数か判定する。
 * JS側（WasmAdapter）との通信インターフェース。
 *
 * # Preconditions
 * - `n_bytes` はリトルエンディアン形式の有効な整数バイト列。
 */
export function is_prime_bpsw_bytes(n_bytes: Uint8Array): boolean;

/**
 * JSのバイト配列を受け取り、Pollard's Rho（Brent版）法を用いて因数を探索するラッパー。
 */
export function pollard_brent_bytes(n_bytes: Uint8Array, max_iters: number, seed_offset: number): Uint8Array | undefined;

/**
 * JSのバイト配列を受け取り、Pollard's P-1 法を用いて合成数の因数を探索するラッパー。
 */
export function pollard_p1_bytes(n_bytes: Uint8Array, b1: number, primes: Uint32Array, seed_offset: number): Uint8Array | undefined;

/**
 * JavaScript側から呼び出され、CPUの演算能力を評価するためのマイクロベンチマーク。
 *
 * # Preconditions
 * 特になし。
 *
 * # Postconditions
 * Montgomery空間での積算ループを50万回実行した結果の下位32ビットを返す。
 */
export function run_micro_benchmark(): number;

/**
 * エラトステネスのふるいを用いて、指定された上限値 `max` までのすべての素数を列挙する。
 *
 * # Preconditions
 * - `max` は 100,000,000 以下であること（メモリ保護のため自動的に上限が切り詰められます）。
 *
 * # Postconditions
 * - 発見された素数を昇順に並べた `Vec<u32>` を返します。
 */
export function sieve_primes_wasm(max: number): Uint32Array;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_ecmrunner_free: (a: number, b: number) => void;
    readonly __wbg_factorizationsession_free: (a: number, b: number) => void;
    readonly __wbg_siqsreducer_free: (a: number, b: number) => void;
    readonly __wbg_siqsworker_free: (a: number, b: number) => void;
    readonly ecmrunner_new: (a: number, b: number, c: number) => number;
    readonly ecmrunner_run_curves: (a: number, b: number) => [number, number];
    readonly factorizationsession_factor_locally: (a: number, b: number, c: number) => number;
    readonly factorizationsession_get_available_buffer: (a: number) => number;
    readonly factorizationsession_get_buffer_ptr: (a: number, b: number) => number;
    readonly factorizationsession_get_current_target: (a: number) => [number, number];
    readonly factorizationsession_get_ecm_b1_tested: (a: number, b: number, c: number) => number;
    readonly factorizationsession_get_factors_json: (a: number) => [number, number];
    readonly factorizationsession_get_metrics_ptr: (a: number) => number;
    readonly factorizationsession_get_next_action: (a: number) => number;
    readonly factorizationsession_get_siqs_fb_logs: (a: number) => [number, number];
    readonly factorizationsession_get_siqs_fb_primes: (a: number) => [number, number];
    readonly factorizationsession_get_siqs_fb_r: (a: number) => [number, number];
    readonly factorizationsession_get_siqs_kn: (a: number) => [number, number];
    readonly factorizationsession_get_siqs_m: (a: number) => number;
    readonly factorizationsession_get_unresolved_json: (a: number) => [number, number];
    readonly factorizationsession_new: (a: number, b: number) => [number, number, number];
    readonly factorizationsession_release_buffer: (a: number, b: number) => void;
    readonly factorizationsession_report_exhausted: (a: number, b: number, c: number, d: number) => number;
    readonly factorizationsession_report_factor: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly factorizationsession_report_prime: (a: number, b: number, c: number) => number;
    readonly factorizationsession_siqs_reduce_matrix: (a: number) => [number, number];
    readonly factorizationsession_submit_worker_result: (a: number, b: number, c: number) => number;
    readonly is_prime_bpsw_bytes: (a: number, b: number) => number;
    readonly pollard_brent_bytes: (a: number, b: number, c: number, d: number) => [number, number];
    readonly pollard_p1_bytes: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly run_micro_benchmark: () => number;
    readonly sieve_primes_wasm: (a: number) => [number, number];
    readonly siqsreducer_add_relation: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => void;
    readonly siqsreducer_new: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly siqsreducer_reduce_matrix: (a: number) => [number, number];
    readonly siqsworker_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => [number, number, number];
    readonly siqsworker_result_ptr: (a: number) => number;
    readonly siqsworker_step: (a: number, b: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
