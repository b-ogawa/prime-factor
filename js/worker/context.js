import { Messages, MSG_TYPE_STOP_ACK, MSG_TYPE_PHASE_UPDATE } from '../core/messages.js';

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
        this.abortArray = null;
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

    initAbortArray(buf) {
        if (buf) {
            this.abortArray = new Int32Array(buf);
        }
    }

    checkAbort() {
        if (this.abortArray && Atomics.load(this.abortArray, 0) !== 0) {
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
