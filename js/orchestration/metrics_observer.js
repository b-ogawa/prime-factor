import { store, ActionTypes } from '../state/index.js';
import { WasmAdapter } from '../interop/index.js';
import { ENGINE_CONSTANTS } from '../config/index.js';

/**
 * @module js/orchestration/metrics_observer
 * @description Monitors factorization execution time and periodically pulls tree metrics from WASM to sync with the Store.
 */
export class MetricsObserver {
    /**
     * Constructs a new MetricsObserver.
     * @param {import("./wasm_session_manager").WasmSessionManager} wasmSessionManager - The WebAssembly session wrapper.
     * @param {Object} logEmitter - The object used to emit log messages.
     */
    constructor(wasmSessionManager, logEmitter) {
        this.wasmSessionManager = wasmSessionManager;
        this.logEmitter = logEmitter;
        
        /** @type {number|null} Start timestamp */
        this.startTime = null;
        /** @type {any|null} Interval ID for polling timer */
        this.timerInterval = null;
    }

    // Starts the execution timer and schedules periodical sync
    start() {
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
        }, ENGINE_CONSTANTS.TIMER_INTERVAL_MS);
    }

    // Stops the active timer interval
    stop() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }

    /**
     * Pulls factors, unresolved nodes and speed stats from WASM memory and dispatches them to the Store.
     * Log warnings are raised in case of JSON decoding anomalies (empty catches resolved).
     */
    updateStoreMetrics() {
        if (!this.wasmSessionManager.session) return;
        
        const metricsPtr = this.wasmSessionManager.getMetricsPtr();
        if (!metricsPtr) return;
        
        // Extract array metrics
        const metrics = WasmAdapter.getMetricsArray(metricsPtr, 8);
        
        const activeTarget = this.wasmSessionManager.getCurrentTarget();
        
        const factorsJson = this.wasmSessionManager.getFactorsJson();
        const factors = [];
        try {
            const parsed = JSON.parse(factorsJson);
            for (const [f, mult] of Object.entries(parsed)) {
                for (let i = 0; i < mult; i++) {
                    factors.push(BigInt(f));
                }
            }
        } catch (e) {
            this.logEmitter.emit('log', `[METRICS OBSERVER ERROR] Failed to parse factors JSON: ${e.message}`, 'error');
        }

        const unresolvedJson = this.wasmSessionManager.getUnresolvedJson();
        let unresolved = [];
        try {
            unresolved = JSON.parse(unresolvedJson).map(BigInt);
        } catch (e) {
            this.logEmitter.emit('log', `[METRICS OBSERVER ERROR] Failed to parse unresolved JSON: ${e.message}`, 'error');
        }

        store.dispatch({
            type: ActionTypes.UPDATE_RUNTIME_STATE,
            payload: {
                activeTarget: activeTarget || "-",
                factors: factors,
                unresolved: unresolved
            }
        });
    }
}
