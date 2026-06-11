import { EventEmitter, MSG_CMD_SIQS_FACTORIZE } from '../utils/index.js';
import { WasmAdapter } from '../interop/index.js';
import { store } from '../state/index.js';

/**
 * @module js/orchestration/siqs_coordinator
 * @description Coordinates the Self-Initializing Quadratic Sieve (SIQS) pipeline, including relationship collection and matrix reduction.
 */
export class SIQSCoordinator extends EventEmitter {
    constructor() {
        super();
        this.active = false;
        this.activeTarget = null;
        this.currentSessionId = null;
        this.relationsCount = 0;
        this.startTime = null;
        this.targetCount = 0;
        this.isReducing = false;
        this.lastProgressEmitTime = 0;
        this.progressThrottleMs = 100;
        this.session = null;
    }

    // Initializes and starts the SIQS pipeline
    runPipeline(N, workerIds, sessionId, session, workerPool) {
        this.active = true;
        this.activeTarget = N;
        this.currentSessionId = sessionId;
        this.session = session;
        this.workerPool = workerPool;
        this.relationsCount = 0;
        this.startTime = Date.now();
        this.isReducing = false;
        this.lastProgressEmitTime = 0;

        // Support both array of worker IDs and single number of max workers
        this.siqsWorkerIds = Array.isArray(workerIds) ? workerIds : Array.from({length: workerIds}, (_, i) => i);
        const maxWorkers = this.siqsWorkerIds.length;

        const config = store.getState().userConfig;

        let kn = this.session.instance.get_siqs_kn();
        let fbPrimes = this.session.instance.get_siqs_fb_primes();
        let fbLogs = this.session.instance.get_siqs_fb_logs();
        let fbRBytes = this.session.instance.get_siqs_fb_r();
        let m = this.session.instance.get_siqs_m();

        // Apply detailed mode config overrides
        if (config.detailedMode) {
            if (config.parameterDerivation === 'manual' && config.manualM > 0) {
                m = config.manualM;
                this.emit('log', `[SIQS] Applying manual Sieve Limit M: ${m}`, "warning");
            }
        }

        let targetCount = fbPrimes.length + (config.detailedMode ? config.lanczosExtraRelations : 15);
        this.targetCount = targetCount;

        this.emit('log', `[SIQS INITIATED] Target N routed to True SIQS. kN=${kn}`, "sys");
        this.emit('log', `[SIQS CONFIG] Factor Base: ${fbPrimes.length} | Sieve Limit M: ${m}`, "sys");

        this.emit('siqsActivated', targetCount);

        let taskMsg = {
            cmd: MSG_CMD_SIQS_FACTORIZE,
            target: N.toString(),
            kN: kn,
            sessionId: sessionId,
            params: {
                fbPrimes: fbPrimes,
                fbLogs: fbLogs,
                fbRBytes: fbRBytes,
                M: m,
                sieveLimit: m * 2,
                sieveBlockSize: config.detailedMode ? config.sieveBlockSize : 32768,
                maxWorkers: maxWorkers
            }
        };

        this.emit('siqsTaskGenerated', taskMsg, this.siqsWorkerIds);
    }

    handleRelation(data) {
        if (!this.active || this.currentSessionId !== data.sessionId) return;
        const workerId = data.workerId;
        const rb = this.workerPool.ringBuffers[workerId];
        if (!rb) return;

        const SLOT_SIZE = 131072; // WASM slot size (128KB)

        // Drain all available frames from the ring buffer
        while (this.active) {
            let slotId = this.session.instance.get_available_buffer();
            if (slotId < 0) {
                break; // No available WASM buffer slots
            }

            let ptr = this.session.instance.get_buffer_ptr(slotId);
            let wasmMemory = WasmAdapter.getSlotBuffer(ptr, SLOT_SIZE);

            let len = rb.readFrame(wasmMemory);
            if (len === 0) {
                this.session.instance.release_buffer(slotId);
                break; // No complete frame in the ring buffer
            }

            let action = this.session.instance.submit_worker_result(slotId, len);

            let metricsPtr = this.session.instance.get_metrics_ptr();
            let metrics = WasmAdapter.getMetricsArray(metricsPtr, 8);
            let relationsCount = metrics[1];
            this.relationsCount = relationsCount;
            let polyCount = metrics[2];
            let speed = Math.round((relationsCount / Math.max(1, Date.now() - this.startTime)) * 1000);

            if (action === 1 || action === 2) {
                this.active = false;
                let factorsJson = this.session.instance.get_factors_json();
                this.emit('siqsSuccessFactors', factorsJson);
                return;
            }

            let now = Date.now();
            let isTargetReached = relationsCount >= this.targetCount;
            if (isTargetReached || now - this.lastProgressEmitTime >= this.progressThrottleMs) {
                this.lastProgressEmitTime = now;
                this.emit('siqsProgress', relationsCount, this.targetCount, polyCount, speed);
            }

            if (isTargetReached && !this.isReducing) {
                this.isReducing = true;
                this.emit('log', `[SIQS] Relationship collection complete. Relations: ${relationsCount}`, "sys");
                this.emit('siqsStopWorkers');

                setTimeout(() => this.reduceMatrix(), 10);
            }
        }
    }

    stop() {
        this.active = false;
    }

    reduceMatrix() {
        if (!this.active || !this.activeTarget) return;

        this.emit('log', "[SIQS] Running WASM Bit-packed Gaussian Elimination & Evaluation...", "sys");

        let factorStr = this.session.instance.siqs_reduce_matrix();
        if (factorStr) {
            let target = this.activeTarget.toString();
            this.session.instance.report_factor(target, factorStr);
            this.active = false;
            this.emit('siqsSuccessFactors', this.session.instance.get_factors_json());
        } else {
            this.emit('log', "[SIQS FAILURE] Dependencies exhausted without non-trivial factors. Falling back to ECM.", "error");
            this.active = false;
            let target = this.activeTarget.toString();
            this.session.instance.report_exhausted(target);
            this.emit('siqsFallback');
        }
    }
}
