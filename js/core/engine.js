class FactorizationEngine extends EventEmitter {
    constructor() {
        super();

        this.siqsCoordinator = new SIQSCoordinator();
        this.siqsCoordinator.on('log', (msg, lvl) => this.emit('log', msg, lvl));
        this.siqsCoordinator.on('siqsActivated', (fbSize) => this.emit('siqsActivated', fbSize));
        this.siqsCoordinator.on('siqsProgress', (r, t, p, s) => this.emit('updateSIQSProgress', r, t, p, s));
        this.siqsCoordinator.on('siqsStopWorkers', () => this.stopWorkers());
        this.siqsCoordinator.on('siqsSuccess', (f1, f2) => this.handleCoordinatorResult(f1, f2));
        this.siqsCoordinator.on('siqsFallback', () => this.handleCoordinatorFallback());
        this.siqsCoordinator.on('siqsTaskGenerated', (msg) => this.workerPool.broadcast(msg));

        this.maxWorkers = Math.max(1, (navigator.hardwareConcurrency || 4));
        this.emit('setCoreCount', this.maxWorkers);

        this.taskQueue = new TaskQueue();
        this.taskQueue.on('log', (msg, lvl) => this.emit('log', msg, lvl));
        this.taskQueue.on('factorsUpdated', (f, u) => this.emit('renderFactors', f, u));

        this.workerPool = new WorkerPool(this.maxWorkers);
        this.workerPool.on('poolReady', () => this.handlePoolReady());
        this.workerPool.on('workerMessage', (data) => this.handleWorkerMessage(data));

        this.stateMachine = new EngineStateMachine();
        this.stateMachine.on('engineStateChanged', (state) => this.emit('engineStateChanged', state));

        this.currentParams = {};
        this.startTime = null;
        this.timerInterval = null;
    }

    initWorkers() {
        this.emit('initCoreUI', this.maxWorkers);
        let sLimit = 10000;
        this.workerPool.init(sLimit);
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

        this.taskQueue.init(targetBig);
        this.stateMachine.transition(STATE_INITIALIZING);
        this.emit('log', `[SYSTEM START] Factorization target: ${targetBig.toString()}`, "sys");

        // Always re-initialize to ensure fresh state/primes and explicitly wait for MSG_TYPE_INIT_COMPLETE
        let sLimit = Math.max(this.currentParams.trialLimit, this.currentParams.b1 * 50, 10000);
        this.emit('log', "[SYSTEM WAITING] Waiting for core initialization...", "sys");
        this.workerPool.reInit(sLimit);
    }

    handlePoolReady() {
        if (this.stateMachine.is(STATE_INITIALIZING)) {
            this.stateMachine.transition(STATE_RUNNING);
            this.startTimer();
            this.processQueue();
        }
    }

    stop() {
        if (this.stateMachine.is(STATE_RUNNING) || this.stateMachine.is(STATE_INITIALIZING)) {
            this.stateMachine.transition(STATE_STOPPING);
            this.siqsCoordinator.stop(); // Safe WASM cleanup before delegating further abort processing
            this.workerPool.stopAcksNeeded = this.maxWorkers;
            this.workerPool.stopAll();
            this.stopTimer();
            this.emit('log', "[USER ABORT] Sent halt signal to all worker threads. Waiting for cores to halt...", "warning");
        }
    }

    finalizeStop() {
        this.taskQueue.rollbackActiveTarget();
        this.stateMachine.transition(STATE_ABORTED);
        this.emit('log', "[USER ABORT] All cores have successfully halted.", "warning");
    }

    clear() {
        if (this.stateMachine.is(STATE_RUNNING) || this.stateMachine.is(STATE_INITIALIZING) || this.stateMachine.is(STATE_STOPPING)) {
            return this.emit('log', "[System Lock] Cannot clear memory while engine is active.", "warning");
        }
        this.taskQueue.reset();
        this.emit('coreUIResetRequest');
        this.emit('clearLogs');
        this.emit('resetTimer');
        this.emit('siqsDeactivated');
        this.stateMachine.transition(STATE_IDLE);
    }

    handleWorkerMessage(data) {
        if (data.type === MSG_TYPE_STOP_ACK) {
            if (this.stateMachine.is(STATE_STOPPING)) {
                this.workerPool.stopAcksNeeded--;
                if (this.workerPool.stopAcksNeeded <= 0) {
                    this.finalizeStop();
                }
            }
            return;
        }

        if (!this.stateMachine.is(STATE_RUNNING)) return;

        if (data.type === MSG_TYPE_PHASE_UPDATE) {
            this.emit('updateCoreStatus', data.workerId, data.phase, data.detail);
        }
        else if (data.type === MSG_TYPE_LOG) {
            if (data.level === 'sys' || data.level === 'error') {
                this.emit('log', `[Core ${data.workerId}] ${data.msg}`, data.level);
            }
        }
        else if (data.type === MSG_TYPE_PRIME_FOUND) {
            if (this.taskQueue.getActive() === data.target) {
                this.emit('log', `[PRIME CONFIRMED] ${data.target.toString()}`, 'success');
                this.taskQueue.addPrime(data.target);
                this.taskQueue.clearActive();
                this.stopWorkersAndResume();
            }
        }
        else if (data.type === MSG_TYPE_FACTOR_FOUND) {
            if (this.taskQueue.getActive() === data.target) {
                let f1 = BigInt(data.factor);
                let f2 = this.taskQueue.getActive() / f1;
                this.emit('log', `[FACTOR DISCOVERED] Found by Core ${data.workerId} via ${data.method}: ${f1.toString()}`, 'success');
                this.taskQueue.addFactors(f1, f2);
                this.taskQueue.clearActive();
                this.stopWorkersAndResume();
            }
        }
        else if (data.type === MSG_TYPE_EXHAUSTED) {
            if (this.taskQueue.getActive() === data.target) {
                this.workerPool.activeWorkersCount--;
                if (this.workerPool.activeWorkersCount === 0) {
                    this.emit('log', `[BOUND EXHAUSTED] All cores failed to factor: ${data.target.toString()}`, 'error');
                    this.taskQueue.addUnresolved(data.target);
                    this.taskQueue.clearActive();
                    this.stopWorkersAndResume();
                }
            }
        }
        else if (data.type === MSG_TYPE_RELATION_FOUND) {
            this.siqsCoordinator.handleRelation(data);
        }
    }

    stopWorkers() {
        this.emit('resetCoreUI', this.maxWorkers);
        this.workerPool.stopAll();
    }

    stopWorkersAndResume() {
        this.stopWorkers();
        setTimeout(() => this.processQueue(), 10);
    }

    handleCoordinatorResult(f1, f2) {
        this.taskQueue.addFactors(f1, f2);
        this.taskQueue.clearActive();
        setTimeout(() => this.processQueue(), 10);
    }

    handleCoordinatorFallback() {
        this.emit('hideSIQSPanel');
        this.emit('log', `[FALLBACK] Dispatching ${this.taskQueue.getActive().toString()} to ECM Suite...`, 'sys');

        this.workerPool.activeWorkersCount = this.maxWorkers;
        this.workerPool.broadcast(
            Messages.createFactorize(this.taskQueue.getActive(), this.currentParams)
        );
    }

    processQueue() {
        if (!this.stateMachine.is(STATE_RUNNING)) return;

        if (this.taskQueue.getActive() === null) {
            let nextTarget = this.taskQueue.next();
            if (nextTarget === null) {
                this.stateMachine.transition(STATE_COMPLETED);
                this.stopTimer();
                this.emit('coreUIResetRequest');
                this.emit('log', "[PROCESS COMPLETE] Factorization tree successfully resolved.", "success");
                this.emit('siqsDeactivated');
                return;
            }

            this.emit('targetStarted', nextTarget.toString());

            let targetDigits = nextTarget.toString().length;
            let mode = this.currentParams.mode;

            // Route
            if (mode === 'siqs' || (mode === 'auto' && targetDigits >= 24 && targetDigits <= 65)) {
                this.siqsCoordinator.runPipeline(nextTarget, this.maxWorkers);
            } else {
                // Fallback Suite
                this.emit('hideSIQSPanel');
                this.emit('log', `[BROADCASTING TASK] Dispatching ${nextTarget.toString()} to BPSW/ECM Suite...`, 'sys');
                this.emit('updateStatus', "RUNNING", true, nextTarget.toString());
                this.workerPool.activeWorkersCount = this.maxWorkers;

                this.workerPool.broadcast(
                    Messages.createFactorize(nextTarget, this.currentParams)
                );
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