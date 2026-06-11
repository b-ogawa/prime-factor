import { EventEmitter, Messages, MSG_TYPE_INIT_COMPLETE, MSG_TYPE_WASM_READY, SPSCRingBuffer } from '../utils/index.js';

export class WorkerPool extends EventEmitter {
    constructor(maxWorkers) {
        super();
        this.maxWorkers = maxWorkers;
        this.workers = [];
        this.initCompleteCount = 0;
        this.activeWorkersCount = 0;
        this.currentSieveLimit = 10000;
        this.workerSabs = [];
        this.ringBuffers = [];

        // Allocate SharedArrayBuffers and RingBuffers for each worker
        for (let i = 0; i < this.maxWorkers; i++) {
            const sab = new SharedArrayBuffer(1048576 + 16);
            this.workerSabs.push(sab);
            this.ringBuffers.push(new SPSCRingBuffer(sab));
        }
    }

    resetAbort() {
        this.ringBuffers.forEach(rb => rb.reset());
    }

    init(sieveLimit) {
        this.currentSieveLimit = sieveLimit;
        this.initCompleteCount = 0;
        this.workers = [];
        this.resetAbort();
        for (let i = 0; i < this.maxWorkers; i++) {
            let w = new Worker('js/worker/main.js', { type: 'module' });
            w.onmessage = (e) => this.handleMessage(e);
            w.postMessage(Messages.createInit(i, sieveLimit, this.workerSabs[i]));
            this.workers.push(w);
        }
    }

    reInit(sieveLimit) {
        this.currentSieveLimit = sieveLimit;
        this.initCompleteCount = 0;
        this.resetAbort();
        this.workers.forEach((w, i) => {
            w.postMessage(Messages.createInit(i, sieveLimit, this.workerSabs[i]));
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

    broadcastToSubset(workerIds, message) {
        workerIds.forEach(id => {
            if (id >= 0 && id < this.workers.length) {
                this.workers[id].postMessage(message);
            }
        });
    }

    stopSubset(workerIds) {
        workerIds.forEach(id => {
            if (id >= 0 && id < this.ringBuffers.length) {
                this.ringBuffers[id].setAbort();
            }
            if (id >= 0 && id < this.workers.length) {
                this.workers[id].postMessage(Messages.createStop());
            }
        });
    }

    stopAll() {
        this.ringBuffers.forEach(rb => rb.setAbort());
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
