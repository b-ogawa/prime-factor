import { EventEmitter } from './event_emitter.js';
import { SIQSCoordinator } from './siqs_coordinator.js';
import { WorkerPool } from './worker_pool.js';
import { store, ActionTypes } from './store.js';
import { WasmAdapter } from './wasm_adapter.js';
import { ActionType } from '../wasm/wasm_engine.js';
import {
    EngineStateMachine,
    STATE_IDLE,
    STATE_INITIALIZING,
    STATE_RUNNING,
    STATE_STOPPING,
    STATE_COMPLETED,
    STATE_ABORTED
} from './state_machine.js';
import {
    Messages,
    MSG_TYPE_STOP_ACK,
    MSG_TYPE_PHASE_UPDATE,
    MSG_TYPE_LOG,
    MSG_TYPE_PRIME_FOUND,
    MSG_TYPE_FACTOR_FOUND,
    MSG_TYPE_EXHAUSTED,
    MSG_TYPE_RELATION_FOUND
} from './messages.js';

export class FactorizationEngine extends EventEmitter {
    constructor() {
        super();

        this.session = null;

        this.siqsCoordinator = new SIQSCoordinator();
        this.siqsCoordinator.on('log', (msg, lvl) => this.emit('log', msg, lvl));
        this.siqsCoordinator.on('siqsActivated', (targetCount) => {
            store.dispatch({
                type: ActionTypes.UPDATE_RUNTIME_STATE,
                payload: { siqsActive: true, siqsTargetRelations: targetCount, siqsRelationsCount: 0, siqsPolyCount: 0, siqsRelSpeed: 0 }
            });
        });
        this.siqsCoordinator.on('siqsProgress', (r, t, p, s) => {
            store.dispatch({
                type: ActionTypes.UPDATE_RUNTIME_STATE,
                payload: { siqsRelationsCount: r, siqsTargetRelations: t, siqsPolyCount: p, siqsRelSpeed: s }
            });
        });
        this.siqsCoordinator.on('siqsStopWorkers', () => this.stopWorkers());
        this.siqsCoordinator.on('siqsSuccessFactors', () => {
            this.stopWorkers();
            setTimeout(() => this.processSessionAction(), 10);
        });
        this.siqsCoordinator.on('siqsFallback', () => {
            this.stopWorkers();
            store.dispatch({
                type: ActionTypes.UPDATE_RUNTIME_STATE,
                payload: { siqsActive: false }
            });
            setTimeout(() => this.processSessionAction(), 10);
        });
        this.siqsCoordinator.on('siqsTaskGenerated', (msg) => this.workerPool.broadcast(msg));

        const profile = store.getState().hardwareProfile;
        this.maxWorkers = profile.coreCount;

        this.workerPool = new WorkerPool(this.maxWorkers);
        this.workerPool.on('poolReady', () => this.handlePoolReady());
        this.workerPool.on('workerMessage', (data) => this.handleWorkerMessage(data));

        this.stateMachine = new EngineStateMachine();
        this.stateMachine.on('engineStateChanged', (state) => {
            store.dispatch({
                type: ActionTypes.UPDATE_RUNTIME_STATE,
                payload: { status: state }
            });
        });

        this.currentParams = {};
        this.startTime = null;
        this.timerInterval = null;
        this.currentSessionId = null;
        this.stopTimeout = null;

        this.messageHandlers = {
            [MSG_TYPE_STOP_ACK]: (data) => this.handleStopAck(data),
            [MSG_TYPE_PHASE_UPDATE]: (data) => this.handlePhaseUpdate(data),
            [MSG_TYPE_LOG]: (data) => this.handleCoreLog(data),
            [MSG_TYPE_PRIME_FOUND]: (data) => this.handlePrimeFound(data),
            [MSG_TYPE_FACTOR_FOUND]: (data) => this.handleFactorFound(data),
            [MSG_TYPE_EXHAUSTED]: (data) => this.handleExhausted(data),
            [MSG_TYPE_RELATION_FOUND]: (data) => this.handleRelationFound(data),
        };
    }

    initWorkers() {
        const coreStatus = {};
        for (let i = 0; i < this.maxWorkers; i++) {
            coreStatus[i] = { phase: 'IDLE', detail: '' };
        }
        store.dispatch({
            type: ActionTypes.UPDATE_RUNTIME_STATE,
            payload: { coreStatus }
        });

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
                targetBig = BigInt(str);
            }
        }
        catch (e) { return this.emit('log', "[Input Error] Invalid character detection.", "error"); }
        if (targetBig <= 1n) return this.emit('log', "[Input Error] N must be an integer > 1.", "error");

        this.currentParams = inputParams;
        store.dispatch({
            type: ActionTypes.UPDATE_CONFIG,
            payload: inputParams
        });
        store.dispatch({
            type: ActionTypes.UPDATE_RUNTIME_STATE,
            payload: {
                activeTarget: targetBig.toString(),
                factors: [],
                unresolved: []
            }
        });

        this.currentSessionId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);

        if (this.session) {
            this.session.free();
        }
        this.session = WasmAdapter.createSession(targetBig.toString());

        globalThis.abortArray = this.workerPool.abortArray;

        this.stateMachine.transition(STATE_INITIALIZING);
        this.emit('log', `[SYSTEM START] Factorization target: ${targetBig.toString()}`, "sys");

        let sLimit = Math.min(100000000, Math.max(this.currentParams.trialLimit, this.currentParams.b1 * 50, this.currentParams.p1Limit * 10, 10000));
        this.emit('log', "[SYSTEM WAITING] Waiting for core initialization...", "sys");
        this.workerPool.reInit(sLimit);
    }

    handlePoolReady() {
        if (this.stateMachine.is(STATE_INITIALIZING)) {
            this.stateMachine.transition(STATE_RUNNING);
            this.startTimer();
            this.processSessionAction();
        }
    }

    stop() {
        if (this.stateMachine.is(STATE_RUNNING) || this.stateMachine.is(STATE_INITIALIZING)) {
            this.stateMachine.transition(STATE_STOPPING);
            this.siqsCoordinator.stop();
            this.workerPool.stopAcksNeeded = this.maxWorkers;
            this.workerPool.stopAll();
            this.stopTimer();
            this.emit('log', "[USER ABORT] Sent halt signal to all worker threads. Waiting for cores to halt...", "warning");

            if (this.stopTimeout) clearTimeout(this.stopTimeout);
            this.stopTimeout = setTimeout(() => {
                this.emit('log', "[SYSTEM WARNING] Workers failed to acknowledge stop signal within timeout. Hard-terminating...", "warning");
                let sLimit = Math.min(100000000, Math.max(this.currentParams.trialLimit || 10000, (this.currentParams.b1 || 0) * 50, 10000));
                this.workerPool.terminateAndRecreate(sLimit);
                this.finalizeStop();
            }, 3000);
        }
    }

    finalizeStop() {
        if (this.stopTimeout) {
            clearTimeout(this.stopTimeout);
            this.stopTimeout = null;
        }
        this.stateMachine.transition(STATE_ABORTED);
        this.emit('log', "[USER ABORT] All cores have successfully halted.", "warning");
    }

    clear() {
        if (this.stateMachine.is(STATE_RUNNING) || this.stateMachine.is(STATE_INITIALIZING) || this.stateMachine.is(STATE_STOPPING)) {
            return this.emit('log', "[System Lock] Cannot clear memory while engine is active.", "warning");
        }
        if (this.session) {
            this.session.free();
            this.session = null;
        }
        this.emit('clearLogs');
        store.dispatch({
            type: ActionTypes.RESET_RUNTIME_STATE
        });
        
        store.dispatch({
            type: ActionTypes.UPDATE_PROFILE,
            payload: { coreCount: this.maxWorkers }
        });
        
        this.stateMachine.transition(STATE_IDLE);
    }

    handleWorkerMessage(data) {
        if (data.type !== MSG_TYPE_STOP_ACK && data.sessionId && data.sessionId !== this.currentSessionId) {
            return;
        }

        const handler = this.messageHandlers[data.type];
        if (handler) {
            handler(data);
        }
    }

    handleStopAck(data) {
        if (this.stateMachine.is(STATE_STOPPING)) {
            this.workerPool.stopAcksNeeded--;
            if (this.workerPool.stopAcksNeeded <= 0) {
                this.finalizeStop();
            }
        }
    }

    handlePhaseUpdate(data) {
        if (!this.stateMachine.is(STATE_RUNNING)) return;
        const currentCoreStatus = store.getState().runtimeState.coreStatus;
        store.dispatch({
            type: ActionTypes.UPDATE_RUNTIME_STATE,
            payload: {
                coreStatus: {
                    ...currentCoreStatus,
                    [data.workerId]: { phase: data.phase, detail: data.detail }
                }
            }
        });
    }

    handleCoreLog(data) {
        if (!this.stateMachine.is(STATE_RUNNING)) return;
        if (data.level === 'sys' || data.level === 'error') {
            this.emit('log', `[Core ${data.workerId}] ${data.msg}`, data.level);
        }
    }

    handlePrimeFound(data) {
        if (!this.stateMachine.is(STATE_RUNNING)) return;
        this.emit('log', `[PRIME CONFIRMED] ${data.target.toString()}`, 'success');
        this.session.instance.report_prime(data.target);
        this.stopWorkers();
        setTimeout(() => this.processSessionAction(), 10);
    }

    handleFactorFound(data) {
        if (!this.stateMachine.is(STATE_RUNNING)) return;
        this.emit('log', `[FACTOR DISCOVERED] Found by Core ${data.workerId} via ${data.method}: ${data.factor.toString()}`, 'success');
        this.session.instance.report_factor(data.target, data.factor);
        this.stopWorkers();
        setTimeout(() => this.processSessionAction(), 10);
    }

    handleExhausted(data) {
        if (!this.stateMachine.is(STATE_RUNNING)) return;
        this.workerPool.activeWorkersCount--;
        if (this.workerPool.activeWorkersCount === 0) {
            this.emit('log', `[BOUND EXHAUSTED] ECM cores failed to factor: ${data.target.toString()}`, 'error');
            this.session.instance.report_exhausted(data.target);
            this.stopWorkers();
            setTimeout(() => this.processSessionAction(), 10);
        }
    }

    handleRelationFound(data) {
        if (!this.stateMachine.is(STATE_RUNNING)) return;
        this.siqsCoordinator.handleRelation(data);
    }

    stopWorkers() {
        const resetCoreStatus = {};
        for (let i = 0; i < this.maxWorkers; i++) {
            resetCoreStatus[i] = { phase: 'IDLE', detail: '' };
        }
        store.dispatch({
            type: ActionTypes.UPDATE_RUNTIME_STATE,
            payload: { coreStatus: resetCoreStatus }
        });
        this.workerPool.stopAll();
    }

    async processSessionAction() {
        if (!this.stateMachine.is(STATE_RUNNING)) return;

        let action = this.session.instance.get_next_action();
        
        this.updateStoreMetrics();

        switch (action) {
            case ActionType.Idle:
                break;
            case ActionType.Complete:
                this.finalizeSuccess();
                break;
            case ActionType.LocalFactor:
                let target = this.session.instance.get_current_target();
                this.emit('log', `[LOCAL RESOLVER] Factoring ${target} locally inside WASM...`, 'sys');
                this.session.instance.factor_locally(target);
                setTimeout(() => this.processSessionAction(), 0);
                break;
            case ActionType.StartSiqs:
                let siqsTarget = this.session.instance.get_current_target();
                this.siqsCoordinator.runPipeline(siqsTarget, this.maxWorkers, this.currentSessionId, this.session, this.workerPool);
                break;
            case ActionType.StartEcm:
                let ecmTarget = this.session.instance.get_current_target();
                this.emit('log', `[BROADCASTING TASK] Dispatching ${ecmTarget} to BPSW/ECM Suite...`, 'sys');
                this.workerPool.activeWorkersCount = this.maxWorkers;
                this.workerPool.broadcast(
                    Messages.createFactorize(ecmTarget, this.currentSessionId, this.currentParams)
                );
                break;
            case ActionType.Wait:
                break;
        }
    }

    updateStoreMetrics() {
        if (!this.session) return;
        let metricsPtr = this.session.instance.get_metrics_ptr();
        if (!metricsPtr) return;
        let metrics = new Uint32Array(WasmAdapter.wasm.memory.buffer, metricsPtr, 8);
        
        let factorsCount = metrics[0];
        let relationsCount = metrics[1];
        let polyCount = metrics[2];
        
        let activeTarget = this.session.instance.get_current_target();
        
        let factorsJson = this.session.instance.get_factors_json();
        let factors = [];
        try {
            let parsed = JSON.parse(factorsJson);
            for (let [f, mult] of Object.entries(parsed)) {
                for (let i = 0; i < mult; i++) {
                    factors.push(BigInt(f));
                }
            }
        } catch (e) {}

        let unresolvedJson = this.session.instance.get_unresolved_json();
        let unresolved = [];
        try {
            unresolved = JSON.parse(unresolvedJson).map(BigInt);
        } catch (e) {}

        store.dispatch({
            type: ActionTypes.UPDATE_RUNTIME_STATE,
            payload: {
                activeTarget: activeTarget || "-",
                factors: factors,
                unresolved: unresolved
            }
        });
    }

    finalizeSuccess() {
        this.stopTimer();
        this.stopWorkers();

        const resetCoreStatus = {};
        for (let i = 0; i < this.maxWorkers; i++) {
            resetCoreStatus[i] = { phase: 'IDLE', detail: '' };
        }
        store.dispatch({
            type: ActionTypes.UPDATE_RUNTIME_STATE,
            payload: { coreStatus: resetCoreStatus, siqsActive: false }
        });

        this.stateMachine.transition(STATE_COMPLETED);
        this.emit('log', "[PROCESS COMPLETE] Factorization tree successfully resolved.", "success");
    }

    startTimer() {
        this.startTime = Date.now();
        store.dispatch({
            type: ActionTypes.UPDATE_RUNTIME_STATE,
            payload: { elapsedTime: 0 }
        });
        this.timerInterval = setInterval(() => {
            let diff = Date.now() - this.startTime;
            store.dispatch({
                type: ActionTypes.UPDATE_RUNTIME_STATE,
                payload: { elapsedTime: diff }
            });
            this.updateStoreMetrics();
        }, 100);
    }

    stopTimer() {
        clearInterval(this.timerInterval);
    }
}