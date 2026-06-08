class FactorizationEngine {
    constructor(ui) {
        this.ui = ui;
        this.siqsCoordinator = new SIQSCoordinator(this);

        this.workers = [];
        this.maxWorkers = Math.max(1, (navigator.hardwareConcurrency || 4));
        this.ui.setCoreCount(this.maxWorkers);

        this.isRunning = false;
        this.queue = [];
        this.activeTarget = null;
        this.activeWorkersCount = 0;
        this.currentParams = {};

        this.factors = [];
        this.unresolved = [];
        this.startTime = null;
        this.timerInterval = null;
    }

    initWorkers() {
        this.ui.initCoreUI(this.maxWorkers);

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
        try { targetBig = BigInt(inputParams.inputStr); }
        catch (e) { return this.ui.log("[Input Error] Invalid character detection.", "error"); }
        if (targetBig <= 1n) return this.ui.log("[Input Error] N must be an integer > 1.", "error");

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
        this.ui.renderFactors(this.factors, this.unresolved);

        this.queue = [targetBig];
        this.activeTarget = null;
        this.isRunning = true;

        this.ui.setButtonsRunning();
        this.ui.updateStatus("RUNNING", true);
        this.ui.log(`[SYSTEM START] Factorization target: ${this.ui.formatBigInt(targetBig)}`, "sys");

        this.startTimer();
        this.processQueue();
    }

    stop() {
        if (this.isRunning) {
            this.isRunning = false;
            this.siqsCoordinator.active = false;
            this.workers.forEach(w => w.postMessage({ cmd: 'STOP' }));
            this.stopTimer();
            this.ui.updateStatus("ABORTED", false);
            this.ui.resetCoreUI(this.maxWorkers);
            this.ui.log("[USER ABORT] Sent halt signal to all worker threads.", "error");
            this.ui.setButtonsIdle();
            this.ui.hideSIQSPanel();

            if (this.activeTarget !== null) {
                this.unresolved.push(this.activeTarget);
                this.ui.renderFactors(this.factors, this.unresolved);
            }
        }
    }

    clear() {
        if (this.isRunning) return this.ui.log("[System Lock] Cannot clear memory while engine is active.", "warning");
        this.factors = [];
        this.unresolved = [];
        this.queue = [];
        this.activeTarget = null;
        this.ui.renderFactors(this.factors, this.unresolved);
        this.ui.resetCoreUI(this.maxWorkers);
        this.ui.clearLogs();
        this.ui.resetTimer();
        this.ui.updateStatus("IDLE", false);
        this.ui.hideSIQSPanel();
    }

    handleWorkerMessage(e) {
        if (!this.isRunning) return;
        const data = e.data;

        if (data.type === 'PHASE_UPDATE') {
            this.ui.updateCoreStatus(data.workerId, data.phase, data.detail);
        }
        else if (data.type === 'LOG') {
            if (data.level === 'sys' || data.level === 'error') {
                this.ui.log(`[Core ${data.workerId}] ${data.msg}`, data.level);
            }
        }
        else if (data.type === 'PRIME_FOUND') {
            if (this.activeTarget === data.target) {
                this.ui.log(`[PRIME CONFIRMED] ${this.ui.formatBigInt(data.target)}`, 'success');
                this.factors.push(data.target);
                this.ui.renderFactors(this.factors, this.unresolved);
                this.activeTarget = null;
                this.stopWorkersAndResume();
            }
        }
        else if (data.type === 'FACTOR_FOUND') {
            if (this.activeTarget === data.target) {
                let f1 = BigInt(data.factor);
                let f2 = this.activeTarget / f1;
                this.ui.log(`[FACTOR DISCOVERED] Found by Core ${data.workerId} via ${data.method}: ${this.ui.formatBigInt(f1)}`, 'success');
                this.queue.push(f1);
                this.queue.push(f2);
                this.activeTarget = null;
                this.stopWorkersAndResume();
            }
        }
        else if (data.type === 'EXHAUSTED') {
            if (this.activeTarget === data.target) {
                this.activeWorkersCount--;
                if (this.activeWorkersCount === 0) {
                    this.ui.log(`[BOUND EXHAUSTED] All cores failed to factor: ${this.ui.formatBigInt(data.target)}`, 'error');
                    this.unresolved.push(data.target);
                    this.ui.renderFactors(this.factors, this.unresolved);
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
        this.ui.resetCoreUI(this.maxWorkers);
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
                this.ui.updateStatus("COMPLETED", false);
                this.ui.resetCoreUI(this.maxWorkers);
                this.ui.log("[PROCESS COMPLETE] Factorization tree successfully resolved.", "success");
                this.ui.setButtonsIdle();
                this.ui.hideSIQSPanel();
                return;
            }

            this.queue.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
            this.activeTarget = this.queue.shift();

            while (this.activeTarget % 2n === 0n) {
                this.factors.push(2n);
                this.activeTarget /= 2n;
                this.ui.log(`[FACTOR DISCOVERED] 2`, 'success');
                this.ui.renderFactors(this.factors, this.unresolved);
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
                this.ui.hideSIQSPanel();
                this.ui.log(`[BROADCASTING TASK] Dispatching ${this.ui.formatBigInt(this.activeTarget)} to BPSW/ECM Suite...`, 'sys');
                this.ui.updateStatus("RUNNING", true, this.activeTarget.toString());
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
        this.ui.resetTimer();
        this.timerInterval = setInterval(() => {
            let diff = Date.now() - this.startTime;
            this.ui.updateTimer(diff);
        }, 100);
    }

    stopTimer() {
        clearInterval(this.timerInterval);
    }
}