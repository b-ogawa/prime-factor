import { EventEmitter } from '../utils/index.js';
import { SIQSCoordinator } from './siqs_coordinator.js';
import { WorkerPool } from './worker_pool.js';
import { store, ActionTypes } from '../state/index.js';
import { ActionType } from '../wasm/wasm_engine.js';
import {
    EngineStateMachine,
    STATE_IDLE,
    STATE_INITIALIZING,
    STATE_RUNNING,
    STATE_STOPPING,
    STATE_COMPLETED,
    STATE_ABORTED
} from '../state/index.js';
import {
    Messages,
    MSG_TYPE_STOP_ACK,
    MSG_TYPE_PHASE_UPDATE,
    MSG_TYPE_LOG,
    MSG_TYPE_PRIME_FOUND,
    MSG_TYPE_FACTOR_FOUND,
    MSG_TYPE_EXHAUSTED,
    MSG_TYPE_RELATION_FOUND
} from '../utils/index.js';

import { WasmSessionManager } from './wasm_session_manager.js';
import { MetricsObserver } from './metrics_observer.js';
import { ENGINE_CONSTANTS } from '../config/index.js';

/**
 * @module js/orchestration/engine
 * @description The central orchestrator that manages the state machine, WebWorkers, SIQS Coordinator, and WASM interactions.
 */

/**
 * Orchestrates the overall factorization process.
 */
export class FactorizationEngine extends EventEmitter {
    constructor() {
        super();

        this.wasmSessionManager = new WasmSessionManager();
        this.metricsObserver = new MetricsObserver(this.wasmSessionManager, this);

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
        this.siqsCoordinator.on('siqsTaskGenerated', (msg, workerIds) => {
            if (workerIds) {
                this.workerPool.broadcastToSubset(workerIds, msg);
            } else {
                this.workerPool.broadcast(msg);
            }
        });

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

        let sLimit = ENGINE_CONSTANTS.DEFAULT_TRIAL_LIMIT;
        this.workerPool.init(sLimit);
    }

    // Starts the factorization process for a given input.
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

        try {
            this.wasmSessionManager.createSession(targetBig.toString());
        } catch (err) {
            return this.emit('log', `[WASM Init Error] ${err}`, "error");
        }

        globalThis.abortArray = this.workerPool.abortArray;

        this.stateMachine.transition(STATE_INITIALIZING);
        this.emit('log', `[SYSTEM START] Factorization target: ${targetBig.toString()}`, "sys");

        let sLimit = Math.min(
            ENGINE_CONSTANTS.MAX_FACTORING_LIMIT, 
            Math.max(
                this.currentParams.trialLimit, 
                this.currentParams.b1 * ENGINE_CONSTANTS.ECM_B1_MULTIPLIER, 
                this.currentParams.p1Limit * ENGINE_CONSTANTS.P1_LIMIT_MULTIPLIER, 
                ENGINE_CONSTANTS.DEFAULT_TRIAL_LIMIT
            )
        );
        this.emit('log', "[SYSTEM WAITING] Waiting for core initialization...", "sys");
        this.workerPool.reInit(sLimit);
    }

    handlePoolReady() {
        if (this.stateMachine.is(STATE_INITIALIZING)) {
            this.stateMachine.transition(STATE_RUNNING);
            this.metricsObserver.start();
            this.processSessionAction();
        }
    }

    stop() {
        if (this.stateMachine.is(STATE_RUNNING) || this.stateMachine.is(STATE_INITIALIZING)) {
            this.stateMachine.transition(STATE_STOPPING);
            this.siqsCoordinator.stop();
            this.workerPool.stopAcksNeeded = this.maxWorkers;
            this.workerPool.stopAll();
            this.metricsObserver.stop();
            this.emit('log', "[USER ABORT] Sent halt signal to all worker threads. Waiting for cores to halt...", "warning");

            if (this.stopTimeout) clearTimeout(this.stopTimeout);
            this.stopTimeout = setTimeout(() => {
                this.emit('log', "[SYSTEM WARNING] Workers failed to acknowledge stop signal within timeout. Hard-terminating...", "warning");
                let sLimit = Math.min(
                    ENGINE_CONSTANTS.MAX_FACTORING_LIMIT, 
                    Math.max(
                        this.currentParams.trialLimit || ENGINE_CONSTANTS.DEFAULT_TRIAL_LIMIT, 
                        (this.currentParams.b1 || 0) * ENGINE_CONSTANTS.ECM_B1_MULTIPLIER, 
                        ENGINE_CONSTANTS.DEFAULT_TRIAL_LIMIT
                    )
                );
                this.workerPool.terminateAndRecreate(sLimit);
                this.finalizeStop();
            }, ENGINE_CONSTANTS.WORKER_STOP_TIMEOUT_MS);
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
        this.wasmSessionManager.freeSession();
        
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
        this.wasmSessionManager.reportPrime(data.target);
        this.stopWorkers();
        setTimeout(() => this.processSessionAction(), 10);
    }

    handleFactorFound(data) {
        if (!this.stateMachine.is(STATE_RUNNING)) return;
        this.emit('log', `[FACTOR DISCOVERED] Found by Core ${data.workerId} via ${data.method}: ${data.factor.toString()}`, 'success');
        this.wasmSessionManager.reportFactor(data.target, data.factor);
        this.stopWorkers();
        setTimeout(() => this.processSessionAction(), 10);
    }

    handleExhausted(data) {
        if (!this.stateMachine.is(STATE_RUNNING)) return;
        this.workerPool.activeWorkersCount--;
        if (this.workerPool.activeWorkersCount === 0) {
            this.emit('log', `[BOUND EXHAUSTED] ECM cores failed to factor: ${data.target.toString()}`, 'error');
            this.wasmSessionManager.reportExhausted(data.target, data.b1Tested || 0);
            this.stopWorkers();
            setTimeout(() => this.processSessionAction(), 10);
        }
    }

    handleRelationFound(data) {
        if (!this.stateMachine.is(STATE_RUNNING)) return;
        this.siqsCoordinator.handleRelation(data);
    }

    stopWorkers() {
        this.siqsCoordinator.stop();
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

        let action = this.wasmSessionManager.getNextAction();
        
        this.metricsObserver.updateStoreMetrics();

        switch (action) {
            case ActionType.Idle:
                break;
            case ActionType.Complete:
                this.finalizeSuccess();
                break;
            case ActionType.LocalFactor:
                let target = this.wasmSessionManager.getCurrentTarget();
                this.emit('log', `[LOCAL RESOLVER] Factoring ${target} locally inside WASM...`, 'sys');
                this.wasmSessionManager.factorLocally(target);
                setTimeout(() => this.processSessionAction(), 0);
                break;
            case ActionType.StartSiqs:
                let siqsTarget = this.wasmSessionManager.getCurrentTarget();
                const config = store.getState().userConfig;
                if (config.detailedMode && config.concurrentPortfolio) {
                    let totalCores = this.maxWorkers;
                    let sCores = Math.max(1, Math.min(config.siqsCores, totalCores - 1));
                    let eCores = totalCores - sCores;
                    
                    let siqsWorkerIds = Array.from({length: sCores}, (_, i) => i);
                    let ecmWorkerIds = Array.from({length: eCores}, (_, i) => sCores + i);
                    
                    this.emit('log', `[PORTFOLIO CONCURRENT] Spawning Portfolio Search. SIQS on Cores [${siqsWorkerIds.join(', ')}] | ECM on Cores [${ecmWorkerIds.join(', ')}]`, 'sys');
                    
                    // Start SIQS on the subset of workers
                    this.siqsCoordinator.runPipeline(siqsTarget, siqsWorkerIds, this.currentSessionId, this.wasmSessionManager.session, this.workerPool);
                    
                    // Start ECM on the rest
                    let testedB1 = this.wasmSessionManager.getEcmB1Tested(siqsTarget);
                    let ecmParams = { ...this.currentParams };
                    if (testedB1 > 0) {
                        let nextB1 = Math.max(testedB1 * 2, ecmParams.b1 || 5000);
                        ecmParams.b1 = nextB1;
                    }
                    
                    this.workerPool.broadcastToSubset(ecmWorkerIds, 
                        Messages.createFactorize(siqsTarget, this.currentSessionId, ecmParams)
                    );
                } else {
                    let allWorkerIds = Array.from({length: this.maxWorkers}, (_, i) => i);
                    this.siqsCoordinator.runPipeline(siqsTarget, allWorkerIds, this.currentSessionId, this.wasmSessionManager.session, this.workerPool);
                }
                break;
            case ActionType.StartEcm:
                let ecmTarget = this.wasmSessionManager.getCurrentTarget();
                let testedB1 = this.wasmSessionManager.getEcmB1Tested(ecmTarget);
                let ecmParams = { ...this.currentParams };
                if (testedB1 > 0) {
                    let nextB1 = Math.max(testedB1 * 2, ecmParams.b1 || 5000);
                    this.emit('log', `[METADATA RESUME] Node has previously tested B1 = ${testedB1}. Scaling next B1 to ${nextB1}`, 'info');
                    ecmParams.b1 = nextB1;
                }
                this.emit('log', `[BROADCASTING TASK] Dispatching ${ecmTarget} to BPSW/ECM Suite (B1=${ecmParams.b1 || this.currentParams.b1})...`, 'sys');
                
                this.workerPool.activeWorkersCount = this.maxWorkers;
                this.workerPool.broadcast(
                    Messages.createFactorize(ecmTarget, this.currentSessionId, ecmParams)
                );
                break;
            case ActionType.Wait:
                break;
        }
    }

    finalizeSuccess() {
        this.metricsObserver.stop();
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
}