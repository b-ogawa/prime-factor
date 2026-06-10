importScripts('../core/messages.js', '../core/math.js', '../core/math_utils.js', '../core/wasm_adapter.js', 'context.js', 'siqs.js');

const PHASE_ECM_WASM = "ECM Phase (WASM)";

// Load WASM
let wasmModule;
let wasmReadyPromise;
importScripts('../wasm/wasm_engine.js');
if (typeof wasm_bindgen === 'function') {
    wasmReadyPromise = wasm_bindgen({ module_or_path: '../wasm/wasm_engine_bg.wasm' }).then((module) => {
        wasmModule = module;
        postMessage({ type: MSG_TYPE_WASM_READY, workerId: ctx.workerId });
    }).catch(console.error);
} else {
    console.error("wasm_bindgen is not a function in the worker!");
}

// Main Worker Routine
self.onmessage = async (e) => {
    const data = e.data;
    if (data.cmd === MSG_CMD_INIT) {
        ctx.workerId = data.workerId;

        let sieveLimit = data.params.sieveLimit;
        // The worker is likely receiving INIT before WASM is fully loaded.
        // We will wait if it's not ready yet.
        const initSieve = async () => {
            try {
                if (wasmReadyPromise) await wasmReadyPromise;
                // Use the bound exports from the module
                ctx.sievedPrimes = wasm_bindgen.sieve_primes_wasm(sieveLimit);
                postMessage(Messages.createLog(ctx.workerId, "Core online & Primes sieved.", "sys"));
                postMessage({ type: MSG_TYPE_INIT_COMPLETE, workerId: ctx.workerId });
            } catch (err) {
                console.error("WASM Init failed", err);
                postMessage(Messages.createLog(ctx.workerId, "WASM Initialization Failed: " + err, "error"));
            }
        };
        initSieve();
    }
    else if (data.cmd === MSG_CMD_STOP) {
        ctx.shouldStop = true;
        ctx.stopAckSent = false;
        ctx.currentTaskId = null;
        
        postMessage({ type: MSG_TYPE_STOP_ACK, workerId: ctx.workerId });
        ctx.stopAckSent = true;
    }
    else if (data.cmd === MSG_CMD_SIQS_FACTORIZE) {
        ctx.shouldStop = false;
        ctx.stopAckSent = false;
        ctx.currentTaskId = data.target;
        
        // Primality check before attempting SIQS
        let n_bytes = bigIntToBytesLE(data.target);
        if (wasm_bindgen.is_prime_bpsw_bytes(n_bytes)) {
            if (ctx.workerId === 0) postMessage(Messages.createPrimeFound(ctx.workerId, data.target));
            return;
        }

        await runParallelSIQS(data.target, data.kN, data.params, ctx, data.target);
    }
    else if (data.cmd === MSG_CMD_FACTORIZE) {
        ctx.shouldStop = false;
        ctx.stopAckSent = false;
        ctx.currentTaskId = data.target;
        let M = data.target;
        let params = data.params;
        try {
            const pipeline = [
                async () => runBpswStrategy(M, ctx),
                async () => runTrialDivisionStrategy(M, params, ctx),
                async () => runPollardP1Strategy(M, params, ctx),
                async () => runPollardRhoStrategy(M, params, ctx),
                async () => runEcmStrategy(M, params, ctx)
            ];

            for (let strategy of pipeline) {
                if (await ctx.checkYieldAndStop(M)) return;
                let result = await strategy();
                if (result === true) return; // True means factor found and handled
            }

            if (!ctx.shouldStop && ctx.currentTaskId === M) {
                postMessage(Messages.createExhausted(ctx.workerId, M));
            }
        }
        catch (err) {
            postMessage(Messages.createLog(ctx.workerId, "Exception: " + err.message, "error"));
        }
    }
};

// --- Strategies ---

async function runBpswStrategy(M, ctx) {
    ctx.sendPhase("BPSW Test", "Primality check", true);
    if (WasmAdapter.isPrime(M)) {
        if (ctx.workerId === 0) postMessage(Messages.createPrimeFound(ctx.workerId, M));
        return true;
    }
    return false;
}

async function runTrialDivisionStrategy(M, params, ctx) {
    if (ctx.workerId !== 0 || params.trialLimit <= 0) return false;
    ctx.sendPhase("Trial Div", "up to " + params.trialLimit, true);
    let currentVal = M;
    for (let p of ctx.sievedPrimes) {
        let pBig = BigInt(p);
        if (pBig * pBig > currentVal) {
            postMessage(Messages.createPrimeFound(ctx.workerId, M));
            return true;
        }
        if (pBig > BigInt(params.trialLimit)) break;
        if (currentVal % pBig === 0n) {
            postMessage(Messages.createFactorFound(ctx.workerId, M, p.toString(), "Trial Division"));
            return true;
        }
        if (await ctx.checkYieldAndStop(M)) return true;
    }
    return false;
}

async function runPollardP1Strategy(M, params, ctx) {
    if (params.p1Limit <= 0) return false;
    ctx.sendPhase("Pollard P-1 (WASM)", "Limit=" + params.p1Limit, true);
    
    let factor = WasmAdapter.pollardP1(M, params.p1Limit, ctx.sievedPrimes);
    if (factor) {
        postMessage(Messages.createFactorFound(ctx.workerId, M, factor.toString(), "P-1 (WASM)"));
        return true;
    }
    return false;
}

async function runPollardRhoStrategy(M, params, ctx) {
    if (params.rhoLimit <= 0) return false;
    ctx.sendPhase("Pollard Rho (WASM)", "Limit=" + params.rhoLimit, true);
    
    let factor = WasmAdapter.pollardRho(M, params.rhoLimit);
    if (factor) {
        postMessage(Messages.createFactorFound(ctx.workerId, M, factor.toString(), "Rho (WASM)"));
        return true;
    }
    return false;
}

async function runEcmStrategy(M, params, ctx) {
    if (params.maxCurves <= 0) return false;
    ctx.sendPhase(PHASE_ECM_WASM, "B1=" + params.b1 + ", Curves=" + params.maxCurves, true);

    let ecmRunner = WasmAdapter.createEcmRunner(M, params.b1);
    let chunk_size = 10;
    let curves_run = 0;

    try {
        while (curves_run < params.maxCurves) {
            if (ctx.shouldStop || ctx.currentTaskId !== M) return true;

            let curves_to_run = Math.min(chunk_size, params.maxCurves - curves_run);
            ctx.sendPhase(PHASE_ECM_WASM, "Curves " + curves_run + " / " + params.maxCurves, true);

            let factor = WasmAdapter.ecmRunCurves(ecmRunner, curves_to_run);
            if (factor) {
                postMessage(Messages.createFactorFound(ctx.workerId, M, factor.toString(), "ECM (WASM)"));
                return true;
            }

            curves_run += curves_to_run;
            if (await ctx.checkYieldAndStop(M)) return true;
        }
    } finally {
        ecmRunner.free();
    }
    return false;
}
