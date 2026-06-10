import { EventEmitter } from './event_emitter.js';
import { Messages, MSG_TYPE_INIT_COMPLETE, MSG_TYPE_WASM_READY } from './messages.js';

export class WorkerPool extends EventEmitter {
    constructor(maxWorkers) {
        super();
        this.maxWorkers = maxWorkers;
        this.workers = [];
        this.initCompleteCount = 0;
        this.activeWorkersCount = 0;
        this.currentSieveLimit = 10000;
        this.abortBuffer = new SharedArrayBuffer(4);
        this.abortArray = new Int32Array(this.abortBuffer);
    }

    resetAbort() {
        Atomics.store(this.abortArray, 0, 0);
    }

    init(sieveLimit) {
        this.currentSieveLimit = sieveLimit;
        this.initCompleteCount = 0;
        this.workers = [];
        this.resetAbort();
        for (let i = 0; i < this.maxWorkers; i++) {
            let w = new Worker('js/worker/main.js', { type: 'module' });
            w.onmessage = (e) => this.handleMessage(e);
            w.postMessage(Messages.createInit(i, sieveLimit, this.abortBuffer));
            this.workers.push(w);
        }
    }

    reInit(sieveLimit) {
        this.currentSieveLimit = sieveLimit;
        this.initCompleteCount = 0;
        this.resetAbort();
        this.workers.forEach((w, i) => {
            w.postMessage(Messages.createInit(i, sieveLimit, this.abortBuffer));
        });
    }

    terminateAll() {
        this.workers.forEach(w => w.terminate());
        this.workers = [];
        this.initCompleteCount = 0;
        this.activeWorkersCount = 0;
    }

    terminateAndRecreate(sieveLimit) {
        this.terminateAll();
        this.init(sieveLimit || this.currentSieveLimit);
    }

    broadcast(message) {
        this.workers.forEach(w => w.postMessage(message));
    }

    stopAll() {
        Atomics.store(this.abortArray, 0, 1);
        this.broadcast(Messages.createStop());
    }

    handleMessage(e) {
        const data = e.data;
        if (data.type === MSG_TYPE_INIT_COMPLETE) {
            this.initCompleteCount++;
            if (this.initCompleteCount === this.maxWorkers) {
                this.emit('poolReady');
            }
            return;
        }

        if (data.type === MSG_TYPE_WASM_READY) return;

        this.emit('workerMessage', data);
    }
}
