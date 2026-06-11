/**
 * @module js/worker/index
 * @description WebWorkerコンテキストとSIQSロジックのメニュー表（契約の真のソース）。
 */

import { runParallelSIQS as _runParallelSIQS } from './siqs.js';

/**
 * @class WorkerContext
 * @description Worker実行中の状態および通信フラグを保持するコンテキストクラス。
 * 
 * @method sendPhase
 * @description Sends the current search phase and details to the main thread via postMessage.
 * @precondition `workerId` and `currentSessionId` must be correctly set in the context.
 * @postcondition Sends MSG_TYPE_PHASE_UPDATE to the main thread (throttled to 100ms unless `force` is true).
 * @param {string} phase - The search phase label.
 * @param {any} detail - Additional statistics or detail payload.
 * @param {boolean} [force=false] - Force emit ignoring throttle.
 * 
 * @method initRingBuffer
 * @description Allocates SPSCRingBuffer wrapper on top of a SharedArrayBuffer.
 * @precondition `sab` must be a SharedArrayBuffer or null.
 * @postcondition `this.ringBuffer` is populated if `sab` is valid.
 * @param {SharedArrayBuffer|null} sab - Shared memory buffer object.
 * 
 * @method checkAbort
 * @description Periodically checks if an abort request is flagged in the ring buffer or WASM.
 * @precondition Must be invoked periodically within active execution loops.
 * @postcondition Sends MSG_TYPE_STOP_ACK once to the main thread if abort is triggered.
 * @returns {boolean} True if execution should abort, false otherwise.
 */
export { WorkerContext } from './context.js';

/**
 * @type {WorkerContext}
 * @description グローバルなWorkerコンテキストのシングルトンインスタンス。
 */
export { ctx } from './context.js';

/**
 * 自己初期化二次ふるい法（SIQS）の並行ふるい落とし（Sieving）処理を実行する。
 * 
 * @precondition 
 *   - WASMインスタンスが読み込み済みであり、`ctx.ringBuffer`（SPSCRingBuffer）が初期化されていること。
 *   - `params` は `{ M: number, fbPrimes: Uint32Array, fbLogs: Uint8Array, fbRBytes: Uint8Array }` を含むこと。
 * @postcondition 
 *   - ふるい落としによって得られたリレーションデータ（バイト配列）が、WASMのメモリヒープから抽出され、直接 `ctx.ringBuffer` に書き込まれる。
 *   - 関係が発見されるか進捗更新タイミングで、メインスレッドに `MSG_TYPE_RELATION_FOUND` シグナルが送信される。
 * @param {string} target_N - 因数分解対象の数値（文字列）。
 * @param {string} kN - 乗数 k を掛けたターゲット値（文字列）。
 * @param {object} params - ふるい落としに必要なパラメータ群。
 * @param {WorkerContext} ctx - ワーカーコンテキスト。
 * @param {bigint} expectedTaskId - 中止判定用の期待タスクID。
 * @param {string} sessionId - 因数分解セッションID。
 */
export function runParallelSIQS(target_N, kN, params, ctx, expectedTaskId, sessionId) {
    return _runParallelSIQS(target_N, kN, params, ctx, expectedTaskId, sessionId);
}

