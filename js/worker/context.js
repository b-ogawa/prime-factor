import { Messages, MSG_TYPE_STOP_ACK, MSG_TYPE_PHASE_UPDATE } from '../core/messages.js';
import { SPSCRingBuffer } from '../core/spsc_ring_buffer.js';

export class WorkerContext {
    constructor() {
        this.workerId = 0;
        this.sievedPrimes = [];
        this.shouldStop = false;
        this.currentTaskId = null;
        this.currentSessionId = null;
        this.lastPhaseUpdate = 0;
        this.currentPhase = "";
        this.stopAckSent = false;
        this.wasmReadyPromise = null;
        this.ringBuffer = null;
        this.wasmInstance = null;
    }

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

    initRingBuffer(sab) {
        if (sab) {
            this.ringBuffer = new SPSCRingBuffer(sab);
        }
    }

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

globalThis.check_abort = function() {
    if (ctx.ringBuffer && ctx.ringBuffer.isAborted()) {
        return 1;
    }
    return 0;
};
