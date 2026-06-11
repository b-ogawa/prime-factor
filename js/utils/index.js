/**
 * @module js/utils/index
 * @description 汎用ユーティリティ群のメニュー表（契約の真のソース）。
 */

import { bigIntToBytesLE as _bigIntToBytesLE, bytesToBigIntLE as _bytesToBigIntLE } from './math_utils.js';

/**
 * @class EventEmitter
 * @description シンプルなイベントエミッタークラス。コンポーネント間の疎結合なイベント通信を提供します。
 * 
 * @method on
 * @description Registers a listener callback for a specific event.
 * @precondition `event` must be a non-empty string. `listener` must be a function.
 * @postcondition The `listener` is added to the internal array for the specified `event`.
 * @param {string} event - The name of the event to listen for.
 * @param {Function} listener - The callback function to execute when the event is emitted.
 * 
 * @method emit
 * @description Emits an event, calling all registered listeners synchronously.
 * @precondition `event` should be a valid string.
 * @postcondition All functions registered for `event` are invoked with the provided `args`.
 * @sideeffects Executes arbitrary code depending on the registered listeners.
 * @param {string} event - The name of the event to emit.
 * @param {...any} args - Arguments to pass to the listeners.
 */
export { EventEmitter } from './event_emitter.js';

/**
 * BigIntをリトルエンディアンのUint8Arrayに変換します（WASM連携用）。
 * @precondition `bigInt` must be a valid BigInt. Negatives are normalized modulo N or two's complement.
 * @postcondition Returns a non-empty Uint8Array representing the value.
 * @param {bigint} bigInt - BigInt value to convert.
 * @returns {Uint8Array} Little-endian byte array.
 */
export function bigIntToBytesLE(bigInt) {
    return _bigIntToBytesLE(bigInt);
}

/**
 * リトルエンディアンのUint8ArrayをBigIntに変換します。
 * @precondition `bytes` must be a valid Uint8Array.
 * @param {Uint8Array} bytes - Little-endian byte array.
 * @returns {bigint} Converted BigInt.
 */
export function bytesToBigIntLE(bytes) {
    return _bytesToBigIntLE(bytes);
}

/**
 * @class SPSCRingBuffer
 * @description SharedArrayBufferを用いたシングルプロデューサー・シングルコンシューマーのロックフリーリングバッファ。
 * 
 * @method write
 * @description Writes data to the ring buffer. Blocks using Atomics.wait if full.
 * @precondition Caller thread must be a Worker thread to avoid deadlocks. `dataBytes.byteLength + 4` must be less than CAPACITY - 1.
 * @postcondition Shared memory tail is updated and Consumer is notified. Returns false if aborted.
 * @param {Uint8Array} dataBytes - Data to write.
 * @returns {boolean} True if write succeeds, false if aborted.
 * 
 * @method readFrame
 * @description Non-blocking read of one frame from the ring buffer.
 * @precondition Caller thread must be the Consumer (UI thread). `destWasmBuffer` must have sufficient capacity.
 * @postcondition Shared memory head is advanced and Producer is notified.
 * @param {Uint8Array} destWasmBuffer - Output buffer for the frame.
 * @returns {number} Read frame length in bytes, or 0 if not enough data.
 * 
 * @method isAborted
 * @description Atomically checks if the abort request flag is set.
 * @returns {boolean} True if aborted, false otherwise.
 * 
 * @method setAbort
 * @description Transmits the abort request signal.
 * @postcondition Shared abort flag is set and Producer is notified.
 * 
 * @method reset
 * @description Resets the buffer head, tail, and abort state.
 * @precondition No read or write operations should be in progress.
 * @postcondition Shared memory header registers are cleared to 0.
 */
export { SPSCRingBuffer } from './spsc_ring_buffer.js';

/**
 * ワーカーやモジュール間で使用するメッセージ・コマンド定義の一覧。
 */
export * from './messages.js';

