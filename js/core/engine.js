class FactorizationEngine extends EventEmitter {
    constructor() {
        super();

        this.siqsCoordinator = new SIQSCoordinator(this);

        this.workers = [];
        this.maxWorkers = Math.max(1, (navigator.hardwareConcurrency || 4));
        this.emit('setCoreCount', this.maxWorkers);

        this.isRunning = false;
        this.queue = [];
        this.activeTarget = null;
        this.activeWorkersCount = 0;
        this.currentParams = {};

        this.factors = [];
        this.unresolved = [];
        this.startTime = null;
        this.timerInterval = null;

        this.initCompleteCount = 0;
        this.startPending = false;
    }

    initWorkers() {
        this.emit('initCoreUI', this.maxWorkers);

        // Use a dummy params initially, update upon start
        let sLimit = 10000;

        for (let i = 0; i < this.maxWorkers; i++) {
            let w = new Worker('js/worker/main.js');
            w.onmessage = (e) => this.handleWorkerMessage(e);
            w.postMessage({
                cmd: 'INIT', workerId: i,
                params: { sieveLimit: sLimit }
            });
            this.workers.push(w);
        }
    }

    start(inputParams) {
        let targetBig;
        try {
            let str = inputParams.inputStr.trim().toLowerCase();
            if (/^\d+$/.test(str)) {
                targetBig = BigInt(str);
            } else if (/^\d+e\d+$/.test(str)) {
                let [base, exp] = str.split('e');
                targetBig = BigInt(base) * (10n ** BigInt(exp));
            } else if (/^\d+(?:\^|\*\*)\d+$/.test(str)) {
                let parts = str.split(/\^|\*\*/);
                targetBig = BigInt(parts[0]) ** BigInt(parts[1]);
            } else {
                targetBig = BigInt(str); // let it throw if invalid
            }
        }
        catch (e) { return this.emit('log', "[Input Error] Invalid character detection.", "error"); }
        if (targetBig <= 1n) return this.emit('log', "[Input Error] N must be an integer > 1.", "error");

        this.currentParams = inputParams;

        // Re-init worker primes if needed based on limits
        let sLimit = Math.max(this.currentParams.trialLimit, this.currentParams.b1 * 50, 10000);
        this.workers.forEach((w, i) => {
             w.postMessage({
                cmd: 'INIT', workerId: i,
                params: { sieveLimit: sLimit }
            });
        });

        this.factors = [];
        this.unresolved = [];
        this.emit('renderFactors', this.factors, this.unresolved);

        this.queue = [targetBig];
        this.activeTarget = null;
        this.isRunning = true;

        this.emit('setButtonsRunning');
        this.emit('updateStatus', "INITIALIZING", true);
        this.emit('log', `[SYSTEM START] Factorization target: ${targetBig.toString()}`, "sys");

        if (this.initCompleteCount < this.maxWorkers) {
            this.emit('log', "[SYSTEM WAITING] Waiting for core initialization...", "sys");
            this.startPending = true;
        } else {
            this.emit('updateStatus', "RUNNING", true);
            this.startTimer();
            this.processQueue();
        }
    }

    stop() {
        if (this.isRunning) {
            this.isRunning = false;
            this.siqsCoordinator.active = false;
            this.workers.forEach(w => w.postMessage({ cmd: 'STOP' }));
            this.stopTimer();
            this.emit('updateStatus', "ABORTED", false);
            this.emit('resetCoreUI', this.maxWorkers);
            this.emit('log', "[USER ABORT] Sent halt signal to all worker threads.", "error");
            this.emit('setButtonsIdle');
            this.emit('hideSIQSPanel');

            if (this.activeTarget !== null) {
                this.unresolved.push(this.activeTarget);
                this.emit('renderFactors', this.factors, this.unresolved);
            }
        }
    }

    clear() {
        if (this.isRunning) return this.emit('log', "[System Lock] Cannot clear memory while engine is active.", "warning");
        this.factors = [];
        this.unresolved = [];
        this.queue = [];
        this.activeTarget = null;
        this.emit('renderFactors', this.factors, this.unresolved);
        this.emit('resetCoreUI', this.maxWorkers);
        this.emit('clearLogs');
        this.emit('resetTimer');
        this.emit('updateStatus', "IDLE", false);
        this.emit('hideSIQSPanel');
    }

    handleWorkerMessage(e) {
        const data = e.data;
        if (data.type === "INIT_COMPLETE") {
            this.initCompleteCount++;
            if (this.initCompleteCount === this.maxWorkers && this.startPending) {
                this.startPending = false;
                this.emit('updateStatus', "RUNNING", true);
                this.startTimer();
                this.processQueue();
            }
            return;
        }

        if (data.type === "WASM_READY") return; // Keep for backward compatibility or ignore

        if (!this.isRunning) return;

        if (data.type === 'PHASE_UPDATE') {
            this.emit('updateCoreStatus', data.workerId, data.phase, data.detail);
        }
        else if (data.type === 'LOG') {
            if (data.level === 'sys' || data.level === 'error') {
                this.emit('log', `[Core ${data.workerId}] ${data.msg}`, data.level);
            }
        }
        else if (data.type === 'PRIME_FOUND') {
            if (this.activeTarget === data.target) {
                this.emit('log', `[PRIME CONFIRMED] ${data.target.toString()}`, 'success');
                this.factors.push(data.target);
                this.emit('renderFactors', this.factors, this.unresolved);
                this.activeTarget = null;
                this.stopWorkersAndResume();
            }
        }
        else if (data.type === 'FACTOR_FOUND') {
            if (this.activeTarget === data.target) {
                let f1 = BigInt(data.factor);
                let f2 = this.activeTarget / f1;
                this.emit('log', `[FACTOR DISCOVERED] Found by Core ${data.workerId} via ${data.method}: ${f1.toString()}`, 'success');
                if (f1 === this.activeTarget) {
                    this.factors.push(f1);
                    this.emit('renderFactors', this.factors, this.unresolved);
                } else {
                    this.queue.push(f1);
                    this.queue.push(f2);
                }
                this.activeTarget = null;
                this.stopWorkersAndResume();
            }
        }
        else if (data.type === 'EXHAUSTED') {
            if (this.activeTarget === data.target) {
                this.activeWorkersCount--;
                if (this.activeWorkersCount === 0) {
                    this.emit('log', `[BOUND EXHAUSTED] All cores failed to factor: ${data.target.toString()}`, 'error');
                    this.unresolved.push(data.target);
                    this.emit('renderFactors', this.factors, this.unresolved);
                    this.activeTarget = null;
                    this.stopWorkersAndResume();
                }
            }
        }
        else if (data.type === 'RELATION_FOUND') {
            this.siqsCoordinator.handleRelation(data);
        }
    }

    stopWorkers() {
        this.emit('resetCoreUI', this.maxWorkers);
        this.workers.forEach(w => w.postMessage({ cmd: 'STOP' }));
    }

    stopWorkersAndResume() {
        this.stopWorkers();
        setTimeout(() => this.processQueue(), 10);
    }

    processQueue() {
        if (!this.isRunning) return;

        if (this.activeTarget === null) {
            if (this.queue.length === 0) {
                this.isRunning = false;
                this.stopTimer();
                this.emit('updateStatus', "COMPLETED", false);
                this.emit('resetCoreUI', this.maxWorkers);
                this.emit('log', "[PROCESS COMPLETE] Factorization tree successfully resolved.", "success");
                this.emit('setButtonsIdle');
                this.emit('hideSIQSPanel');
                return;
            }

            this.queue.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
            this.activeTarget = this.queue.shift();

            while (this.activeTarget % 2n === 0n) {
                this.factors.push(2n);
                this.activeTarget /= 2n;
                this.emit('log', `[FACTOR DISCOVERED] 2`, 'success');
                this.emit('renderFactors', this.factors, this.unresolved);
            }
            if (this.activeTarget === 1n) {
                this.activeTarget = null;
                this.processQueue();
                return;
            }

            let targetDigits = this.activeTarget.toString().length;
            let mode = this.currentParams.mode;

            // Route
            if (mode === 'siqs' || (mode === 'auto' && targetDigits >= 24 && targetDigits <= 65)) {
                this.siqsCoordinator.runPipeline(this.activeTarget, this.maxWorkers);
            } else {
                // Fallback Suite
                this.emit('hideSIQSPanel');
                this.emit('log', `[BROADCASTING TASK] Dispatching ${this.activeTarget.toString()} to BPSW/ECM Suite...`, 'sys');
                this.emit('updateStatus', "RUNNING", true, this.activeTarget.toString());
                this.activeWorkersCount = this.maxWorkers;

                this.workers.forEach(w => w.postMessage({
                    cmd: 'FACTORIZE',
                    target: this.activeTarget,
                    params: this.currentParams
                }));
            }
        }
    }

    startTimer() {
        this.startTime = Date.now();
        this.emit('resetTimer');
        this.timerInterval = setInterval(() => {
            let diff = Date.now() - this.startTime;
            this.emit('updateTimer', diff);
        }, 100);
    }

    stopTimer() {
        clearInterval(this.timerInterval);
    }
}