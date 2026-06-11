/**
 * @fileoverview WebWorker内の実行状態とアボート制御、およびWASMとの相互作用を管理するコンテキスト。
 * @description このモジュールはスレッド固有の実行状態を管理し、SharedArrayBufferおよびWASM側コールバックと連携して計算を中断する役割を持ちます。
 */

import { Messages, MSG_TYPE_STOP_ACK, MSG_TYPE_PHASE_UPDATE, SPSCRingBuffer } from '../utils/index.js';

/**
 * Worker実行中の状態および通信フラグを保持するコンテキストクラス。
 */
export class WorkerContext {
    constructor() {
        /** @type {number} Workerの個別識別子 */
        this.workerId = 0;
        /** @type {number[]} SIQS探索用。ふるい落とされた素数のリスト */
        this.sievedPrimes = [];
        /** @type {boolean} 計算中止要求（アボート）を受けたかどうかのフラグ */
        this.shouldStop = false;
        /** @type {string|null} 現在処理中のタスクID */
        this.currentTaskId = null;
        /** @type {string|null} 現在処理中の探索セッションID */
        this.currentSessionId = null;
        /** @type {number} 最後にフェーズ更新をメインスレッドに通知したミリ秒タイムスタンプ */
        this.lastPhaseUpdate = 0;
        /** @type {string} 現在の探索フェーズ（"ECM" / "SIQS" 等） */
        this.currentPhase = "";
        /** @type {boolean} 中止応答（STOP_ACK）をメインスレッドに送信済みかどうか */
        this.stopAckSent = false;
        /** @type {Promise<void>|null} WASM読み込みおよび初期化の完了を表すPromise */
        this.wasmReadyPromise = null;
        /** @type {SPSCRingBuffer|null} メインスレッドとアボートフラグを同期するための共有メモリバッファ */
        this.ringBuffer = null;
        /** @type {object|null} WebAssemblyモジュールのエクスポートインスタンス */
        this.wasmInstance = null;
    }

    // Sends the current search phase and details to the main thread
    sendPhase(phase, detail, force) {
        let now = Date.now();
        if (force || phase !== this.currentPhase || now - this.lastPhaseUpdate > 100) {
            this.currentPhase = phase;
            this.lastPhaseUpdate = now;
            postMessage({ 
                type: MSG_TYPE_PHASE_UPDATE, 
                workerId: this.workerId, 
                sessionId: this.currentSessionId,
                phase: phase, 
                detail: detail 
            });
        }
    }

    // Initializes the SPSCRingBuffer
    initRingBuffer(sab) {
        if (sab) {
            this.ringBuffer = new SPSCRingBuffer(sab);
        }
    }

    // Checks if abort signal is raised
    checkAbort() {
        if (globalThis.check_abort() === 1) {
            this.shouldStop = true;
        }
        if (this.shouldStop) {
            if (!this.stopAckSent) {
                this.stopAckSent = true;
                postMessage({ type: MSG_TYPE_STOP_ACK, workerId: this.workerId });
            }
            return true;
        }
        return false;
    }
}

export const ctx = new WorkerContext();

// WASM global abort checker callback
globalThis.check_abort = function() {
    if (ctx.ringBuffer && ctx.ringBuffer.isAborted()) {
        return 1;
    }
    return 0;
};
