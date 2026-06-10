class WorkerPool extends EventEmitter {
    constructor(maxWorkers) {
        super();
        this.maxWorkers = maxWorkers;
        this.workers = [];
        this.initCompleteCount = 0;
        this.activeWorkersCount = 0;
    }

    init(sieveLimit) {
        this.initCompleteCount = 0;
        this.workers = [];
        for (let i = 0; i < this.maxWorkers; i++) {
            let w = new Worker('js/worker/main.js');
            w.onmessage = (e) => this.handleMessage(e);
            w.postMessage(Messages.createInit(i, sieveLimit));
            this.workers.push(w);
        }
    }

    reInit(sieveLimit) {
        this.initCompleteCount = 0;
        this.workers.forEach((w, i) => {
            w.postMessage(Messages.createInit(i, sieveLimit));
        });
    }

    broadcast(message) {
        this.workers.forEach(w => w.postMessage(message));
    }

    stopAll() {
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
