import { Messages, MSG_TYPE_STOP_ACK, MSG_TYPE_PHASE_UPDATE } from '../core/messages.js';

export class WorkerContext {
    constructor() {
        this.workerId = 0;
        this.sievedPrimes = [];
        this.shouldStop = false;
        this.currentTaskId = null;
        this.currentSessionId = null;
        this.lastYieldTime = Date.now();
        this.lastPhaseUpdate = 0;
        this.currentPhase = "";
        this.stopAckSent = false;
        this.wasmReadyPromise = null;
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

    async yieldIfNeeded() {
        let now = Date.now();
        if (now - this.lastYieldTime > 300) {
            this.lastYieldTime = now;
            await new Promise(r => setTimeout(r, 0));
        }
    }

    async checkYieldAndStop(expectedTaskId) {
        await this.yieldIfNeeded();
        if (this.shouldStop || this.currentTaskId !== expectedTaskId) {
            if (this.shouldStop && !this.stopAckSent) {
                this.stopAckSent = true;
                postMessage({ type: MSG_TYPE_STOP_ACK, workerId: this.workerId });
            }
            return true; // Indicates we should stop
        }
        return false;
    }
}

export const ctx = new WorkerContext();
