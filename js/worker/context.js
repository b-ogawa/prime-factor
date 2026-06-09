// Worker Context
class WorkerContext {
    constructor() {
        this.workerId = 0;
        this.sievedPrimes = [];
        this.shouldStop = false;
        this.currentTaskId = null;
        this.lastYieldTime = Date.now();
        this.lastPhaseUpdate = 0;
        this.currentPhase = "";
    }

    sendPhase(phase, detail, force) {
        let now = Date.now();
        if (force || phase !== this.currentPhase || now - this.lastPhaseUpdate > 100) {
            this.currentPhase = phase;
            this.lastPhaseUpdate = now;
            postMessage({ type: "PHASE_UPDATE", workerId: this.workerId, phase: phase, detail: detail });
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
            return true; // Indicates we should stop
        }
        return false;
    }
}

const ctx = new WorkerContext();
