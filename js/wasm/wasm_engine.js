/* @ts-self-types="./wasm_engine.d.ts" */

/**
 * 因数分解セッションが現在メインスレッドおよびワーカーに要求しているアクションの種類。
 * @enum {0 | 1 | 2 | 3 | 4 | 5}
 */
export const ActionType = Object.freeze({
    /**
     * 探索対象がなくアイドル状態
     */
    Idle: 0, "0": "Idle",
    /**
     * すべての合成数が素因数分解された完了状態
     */
    Complete: 1, "1": "Complete",
    /**
     * 試し割り等のローカル演算を実行中
     */
    LocalFactor: 2, "2": "LocalFactor",
    /**
     * 二次ふるい法(SIQS)のワーカー実行要求状態
     */
    StartSiqs: 3, "3": "StartSiqs",
    /**
     * 楕円曲線法(ECM)のワーカー実行要求状態
     */
    StartEcm: 4, "4": "StartEcm",
    /**
     * 他のワーカーの終了待ちまたは同期待ち状態
     */
    Wait: 5, "5": "Wait",
});

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
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        EcmRunnerFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_ecmrunner_free(ptr, 0);
    }
    /**
     * @param {Uint8Array} n_bytes
     * @param {number} b1
     */
    constructor(n_bytes, b1) {
        const ptr0 = passArray8ToWasm0(n_bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.ecmrunner_new(ptr0, len0, b1);
        this.__wbg_ptr = ret;
        EcmRunnerFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * 指定された回数（カーブ数）だけ、Suyamaの媒介変数を用いた楕円曲線法（Montgomery ladder 形式）を実行する。
     *
     * # Preconditions
     * - インスタンスが有効に初期化されていること。
     *
     * # Postconditions
     * - 因数が発見された場合、直ちに `Some(Vec<u8>)` （リトルエンディアン32バイト）を返します。
     * - カーブを実行し終えても因数が見つからない、またはアボート要求が検知された場合は `None` を返します。
     * @param {number} curves_to_run
     * @returns {Uint8Array | undefined}
     */
    run_curves(curves_to_run) {
        const ret = wasm.ecmrunner_run_curves(this.__wbg_ptr, curves_to_run);
        let v1;
        if (ret[0] !== 0) {
            v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
}
if (Symbol.dispose) EcmRunner.prototype[Symbol.dispose] = EcmRunner.prototype.free;

/**
 * 因数分解セッションの状態および全体のタスクフローをオーケストレーションする構造体。
 *
 * # Invariants
 * - `nodes` には分解中の因数分解木の全ノードが含まれ、インデックス 0 がルートノード（元の分解対象数）となります。
 * - `slots` は各ワーカープロセスが計算データを安全に書き込むための共有メモリブロック。
 */
export class FactorizationSession {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        FactorizationSessionFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_factorizationsession_free(ptr, 0);
    }
    /**
     * @param {string} target_str
     * @returns {boolean}
     */
    factor_locally(target_str) {
        const ptr0 = passStringToWasm0(target_str, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.factorizationsession_factor_locally(this.__wbg_ptr, ptr0, len0);
        return ret !== 0;
    }
    /**
     * 計算結果書き込み用の未使用バッファスロット（インデックス）を取得する。
     *
     * # Preconditions
     * 特になし。
     *
     * # Postconditions
     * - 利用可能なスロットがあれば `0..=7` のインデックスを返し、対象スロットを `in_use` にマークする。
     * - 空きスロットがない場合は `-1` を返す。
     * @returns {number}
     */
    get_available_buffer() {
        const ret = wasm.factorizationsession_get_available_buffer(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} slot_id
     * @returns {number}
     */
    get_buffer_ptr(slot_id) {
        const ret = wasm.factorizationsession_get_buffer_ptr(this.__wbg_ptr, slot_id);
        return ret >>> 0;
    }
    /**
     * @returns {string}
     */
    get_current_target() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.factorizationsession_get_current_target(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @param {string} target_str
     * @returns {number}
     */
    get_ecm_b1_tested(target_str) {
        const ptr0 = passStringToWasm0(target_str, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.factorizationsession_get_ecm_b1_tested(this.__wbg_ptr, ptr0, len0);
        return ret >>> 0;
    }
    /**
     * @returns {string}
     */
    get_factors_json() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.factorizationsession_get_factors_json(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * メトリクス情報領域の先頭メモリアドレスを取得する。
     *
     * # Preconditions
     * 特になし。
     *
     * # Postconditions
     * - `[solved_factors_count, relations_count, polys_searched]` 等の統計情報をマッピング可能なポインタを返す。
     * @returns {number}
     */
    get_metrics_ptr() {
        const ret = wasm.factorizationsession_get_metrics_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Determines the next action JS should take.
     * @returns {ActionType}
     */
    get_next_action() {
        const ret = wasm.factorizationsession_get_next_action(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {Uint8Array}
     */
    get_siqs_fb_logs() {
        const ret = wasm.factorizationsession_get_siqs_fb_logs(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * @returns {Uint32Array}
     */
    get_siqs_fb_primes() {
        const ret = wasm.factorizationsession_get_siqs_fb_primes(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {Uint8Array}
     */
    get_siqs_fb_r() {
        const ret = wasm.factorizationsession_get_siqs_fb_r(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * @returns {string}
     */
    get_siqs_kn() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.factorizationsession_get_siqs_kn(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {number}
     */
    get_siqs_m() {
        const ret = wasm.factorizationsession_get_siqs_m(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {string}
     */
    get_unresolved_json() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.factorizationsession_get_unresolved_json(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * 新規の因数分解セッションを生成する。
     *
     * # Preconditions
     * - `n_str` は十進数の整数文字列であること。
     *
     * # Postconditions
     * - バラメータ `n_str` に応じた探索木ノードおよび8個の共有バッファスロット（各128KB）が初期化される。
     * @param {string} n_str
     */
    constructor(n_str) {
        const ptr0 = passStringToWasm0(n_str, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.factorizationsession_new(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        FactorizationSessionFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {number} slot_id
     */
    release_buffer(slot_id) {
        wasm.factorizationsession_release_buffer(this.__wbg_ptr, slot_id);
    }
    /**
     * @param {string} target_str
     * @param {number} b1_tested
     * @returns {ActionType}
     */
    report_exhausted(target_str, b1_tested) {
        const ptr0 = passStringToWasm0(target_str, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.factorizationsession_report_exhausted(this.__wbg_ptr, ptr0, len0, b1_tested);
        return ret;
    }
    /**
     * Reports that a factor has been found.
     * @param {string} target_str
     * @param {string} factor_str
     * @returns {ActionType}
     */
    report_factor(target_str, factor_str) {
        const ptr0 = passStringToWasm0(target_str, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(factor_str, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.factorizationsession_report_factor(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        return ret;
    }
    /**
     * @param {string} target_str
     * @returns {ActionType}
     */
    report_prime(target_str) {
        const ptr0 = passStringToWasm0(target_str, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.factorizationsession_report_prime(this.__wbg_ptr, ptr0, len0);
        return ret;
    }
    /**
     * @returns {string | undefined}
     */
    siqs_reduce_matrix() {
        const ret = wasm.factorizationsession_siqs_reduce_matrix(this.__wbg_ptr);
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * Submits a buffer processed by a worker containing relations.
     * @param {number} slot_id
     * @param {number} length
     * @returns {ActionType}
     */
    submit_worker_result(slot_id, length) {
        const ret = wasm.factorizationsession_submit_worker_result(this.__wbg_ptr, slot_id, length);
        return ret;
    }
}
if (Symbol.dispose) FactorizationSession.prototype[Symbol.dispose] = FactorizationSession.prototype.free;

/**
 * JS側から送られてくる個々のリレーションを蓄積し、行列のガウス消去法および平方剰余の平方根計算を行うための構造体。
 */
export class SiqsReducer {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SiqsReducerFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_siqsreducer_free(ptr, 0);
    }
    /**
     * 個別のふるいプロセスで発見された関係式（Relation）を追加する。
     *
     * # Preconditions
     * - 各 `_bytes` 配列はリトルエンディアン形式の整数であること。
     * - `factors` に含まれるインデックスは、コンストラクタで渡した `fb_primes` の有効範囲内であること。
     * @param {number} sign
     * @param {Uint8Array} x_bytes
     * @param {Uint8Array} b_bytes
     * @param {Uint8Array} a_bytes
     * @param {Uint32Array} factors
     */
    add_relation(sign, x_bytes, b_bytes, a_bytes, factors) {
        const ptr0 = passArray8ToWasm0(x_bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(b_bytes, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(a_bytes, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArray32ToWasm0(factors, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        wasm.siqsreducer_add_relation(this.__wbg_ptr, sign, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
    }
    /**
     * 新規のリデューサーを初期化する。
     *
     * # Preconditions
     * - `n_bytes` と `kn_bytes` はリトルエンディアン形式の有効な整数バイト列であること。
     * - `fb_primes` はファクターベースとなる素数のリストであること。
     * @param {Uint8Array} n_bytes
     * @param {Uint8Array} kn_bytes
     * @param {Uint32Array} fb_primes
     */
    constructor(n_bytes, kn_bytes, fb_primes) {
        const ptr0 = passArray8ToWasm0(n_bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(kn_bytes, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray32ToWasm0(fb_primes, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.siqsreducer_new(ptr0, len0, ptr1, len1, ptr2, len2);
        this.__wbg_ptr = ret;
        SiqsReducerFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {Uint8Array | undefined}
     */
    reduce_matrix() {
        const ret = wasm.siqsreducer_reduce_matrix(this.__wbg_ptr);
        let v1;
        if (ret[0] !== 0) {
            v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
}
if (Symbol.dispose) SiqsReducer.prototype[Symbol.dispose] = SiqsReducer.prototype.free;

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
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SiqsWorkerFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_siqsworker_free(ptr, 0);
    }
    /**
     * @param {Uint8Array} kn_bytes
     * @param {Uint32Array} fb_primes
     * @param {Uint8Array} fb_logs
     * @param {Uint8Array} fb_r_bytes
     * @param {number} sieve_limit
     * @param {number} worker_id
     * @param {number} core_count
     */
    constructor(kn_bytes, fb_primes, fb_logs, fb_r_bytes, sieve_limit, worker_id, core_count) {
        const ptr0 = passArray8ToWasm0(kn_bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray32ToWasm0(fb_primes, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(fb_logs, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArray8ToWasm0(fb_r_bytes, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ret = wasm.siqsworker_new(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, sieve_limit, worker_id, core_count);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        SiqsWorkerFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * 結果が書き込まれたシリアライズバッファの先頭メモリアドレスを取得する。
     * @returns {number}
     */
    result_ptr() {
        const ret = wasm.siqsworker_result_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * 指定された多項式のバッチ数だけふるい落とし（Sieving）処理を実行し、結果をシリアライズバッファに書き込む。
     *
     * # Preconditions
     * - `batch_size > 0` であること。
     *
     * # Postconditions
     * - 処理中に `check_abort` が 1 を返した場合、処理を打ち切って直ちに `0` を返します。
     * - 発見されたリレーションデータのバイトサイズを返します。
     * @param {number} batch_size
     * @returns {number}
     */
    step(batch_size) {
        const ret = wasm.siqsworker_step(this.__wbg_ptr, batch_size);
        return ret >>> 0;
    }
}
if (Symbol.dispose) SiqsWorker.prototype[Symbol.dispose] = SiqsWorker.prototype.free;

/**
 * JSのバイト配列を受け取り、内部で `is_prime_bpsw` を呼び出して素数か判定する。
 * JS側（WasmAdapter）との通信インターフェース。
 *
 * # Preconditions
 * - `n_bytes` はリトルエンディアン形式の有効な整数バイト列。
 * @param {Uint8Array} n_bytes
 * @returns {boolean}
 */
export function is_prime_bpsw_bytes(n_bytes) {
    const ptr0 = passArray8ToWasm0(n_bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.is_prime_bpsw_bytes(ptr0, len0);
    return ret !== 0;
}

/**
 * Pollard's Rho（Brent版）法を用いて因数を探索する。
 *
 * # Preconditions
 * - `n_bytes` はターゲット値（奇数の合成数）を示すリトルエンディアンバイト配列。
 * - `max_iters` は探索のイテレーション上限。
 *
 * # Postconditions
 * - 因数が見つかった場合、その因数（リトルエンディアン32バイト配列）を `Some(Vec<u8>)` で返します。
 * - アボート、探索完了、あるいは最大回数に達しても見つからない場合は `None` を返します。
 * @param {Uint8Array} n_bytes
 * @param {number} max_iters
 * @param {number} worker_id
 * @returns {Uint8Array | undefined}
 */
export function pollard_brent_bytes(n_bytes, max_iters, worker_id) {
    const ptr0 = passArray8ToWasm0(n_bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.pollard_brent_bytes(ptr0, len0, max_iters, worker_id);
    let v2;
    if (ret[0] !== 0) {
        v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v2;
}

/**
 * Pollard's P-1 法を用いて合成数の因数を探索する。
 *
 * # Preconditions
 * - `n_bytes` はターゲットとなる合成数を示す32バイト以下のリトルエンディアンバイト配列。
 * - `primes` は十分な個数の試し割り素数リスト。
 *
 * # Postconditions
 * - 因数が見つかった場合、その因数（リトルエンディアンバイト配列、32バイト）を `Some(Vec<u8>)` で返します。
 * - 因数が見つからない、またはアボートが検知された場合は `None` を返します。
 * @param {Uint8Array} n_bytes
 * @param {number} b1
 * @param {Uint32Array} primes
 * @param {number} worker_id
 * @returns {Uint8Array | undefined}
 */
export function pollard_p1_bytes(n_bytes, b1, primes, worker_id) {
    const ptr0 = passArray8ToWasm0(n_bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray32ToWasm0(primes, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.pollard_p1_bytes(ptr0, len0, b1, ptr1, len1, worker_id);
    let v3;
    if (ret[0] !== 0) {
        v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v3;
}

/**
 * JavaScript側から呼び出され、CPUの演算能力を評価するためのマイクロベンチマーク。
 *
 * # Preconditions
 * 特になし。
 *
 * # Postconditions
 * Montgomery空間での積算ループを50万回実行した結果の下位32ビットを返す。
 * @returns {number}
 */
export function run_micro_benchmark() {
    const ret = wasm.run_micro_benchmark();
    return ret >>> 0;
}

/**
 * エラトステネスのふるいを用いて、指定された上限値 `max` までのすべての素数を列挙する。
 *
 * # Preconditions
 * - `max` は 100,000,000 以下であること（メモリ保護のため自動的に上限が切り詰められます）。
 *
 * # Postconditions
 * - 発見された素数を昇順に並べた `Vec<u32>` を返します。
 * @param {number} max
 * @returns {Uint32Array}
 */
export function sieve_primes_wasm(max) {
    const ret = wasm.sieve_primes_wasm(max);
    var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v1;
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_is_function_754e9f305ff6029e: function(arg0) {
            const ret = typeof(arg0) === 'function';
            return ret;
        },
        __wbg___wbindgen_is_object_56732c2bc353f41d: function(arg0) {
            const val = arg0;
            const ret = typeof(val) === 'object' && val !== null;
            return ret;
        },
        __wbg___wbindgen_is_string_c236cabd84a4d769: function(arg0) {
            const ret = typeof(arg0) === 'string';
            return ret;
        },
        __wbg___wbindgen_is_undefined_67b456be8673d3d7: function(arg0) {
            const ret = arg0 === undefined;
            return ret;
        },
        __wbg___wbindgen_throw_1506f2235d1bdba0: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_call_9c758de292015997: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.call(arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_check_abort_b8a7c1f6d5fccf2a: function() {
            const ret = check_abort();
            return ret;
        },
        __wbg_crypto_38df2bab126b63dc: function(arg0) {
            const ret = arg0.crypto;
            return ret;
        },
        __wbg_getRandomValues_c44a50d8cfdaebeb: function() { return handleError(function (arg0, arg1) {
            arg0.getRandomValues(arg1);
        }, arguments); },
        __wbg_length_4a591ecaa01354d9: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_msCrypto_bd5a034af96bcba6: function(arg0) {
            const ret = arg0.msCrypto;
            return ret;
        },
        __wbg_new_with_length_36a4998e27b014c5: function(arg0) {
            const ret = new Uint8Array(arg0 >>> 0);
            return ret;
        },
        __wbg_node_84ea875411254db1: function(arg0) {
            const ret = arg0.node;
            return ret;
        },
        __wbg_process_44c7a14e11e9f69e: function(arg0) {
            const ret = arg0.process;
            return ret;
        },
        __wbg_prototypesetcall_3249fc62a0fafa30: function(arg0, arg1, arg2) {
            Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
        },
        __wbg_randomFillSync_6c25eac9869eb53c: function() { return handleError(function (arg0, arg1) {
            arg0.randomFillSync(arg1);
        }, arguments); },
        __wbg_require_b4edbdcf3e2a1ef0: function() { return handleError(function () {
            const ret = module.require;
            return ret;
        }, arguments); },
        __wbg_static_accessor_GLOBAL_9d53f2689e622ca1: function() {
            const ret = typeof global === 'undefined' ? null : global;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_GLOBAL_THIS_a1a35cec07001a8a: function() {
            const ret = typeof globalThis === 'undefined' ? null : globalThis;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_SELF_4c59f6c7ea29a144: function() {
            const ret = typeof self === 'undefined' ? null : self;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_WINDOW_e70ae9f2eb052253: function() {
            const ret = typeof window === 'undefined' ? null : window;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_subarray_4aa221f6a4f5ab22: function(arg0, arg1, arg2) {
            const ret = arg0.subarray(arg1 >>> 0, arg2 >>> 0);
            return ret;
        },
        __wbg_versions_276b2795b1c6a219: function(arg0) {
            const ret = arg0.versions;
            return ret;
        },
        __wbindgen_cast_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Ref(Slice(U8)) -> NamedExternref("Uint8Array")`.
            const ret = getArrayU8FromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_cast_0000000000000002: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./wasm_engine_bg.js": import0,
    };
}

const EcmRunnerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_ecmrunner_free(ptr, 1));
const FactorizationSessionFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_factorizationsession_free(ptr, 1));
const SiqsReducerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_siqsreducer_free(ptr, 1));
const SiqsWorkerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_siqsworker_free(ptr, 1));

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

function getArrayU32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint32ArrayMemory0 = null;
function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passArray32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getUint32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedUint32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('wasm_engine_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
