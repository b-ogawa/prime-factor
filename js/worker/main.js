import { 
    Messages, 
    MSG_CMD_INIT, 
    MSG_CMD_STOP, 
    MSG_CMD_SIQS_FACTORIZE, 
    MSG_CMD_FACTORIZE, 
    MSG_TYPE_WASM_READY, 
    MSG_TYPE_INIT_COMPLETE 
} from '../core/messages.js';
import { bigIntToBytesLE } from '../core/math_utils.js';
import { WasmAdapter } from '../core/wasm_adapter.js';
import { ctx } from './context.js';
import { runParallelSIQS } from './siqs.js';
import init, { is_prime_bpsw_bytes, sieve_primes_wasm, EcmRunner, SiqsWorker } from '../wasm/wasm_engine.js';

// Polyfill Symbol.dispose if not present
if (typeof Symbol !== 'undefined' && !Symbol.dispose) {
    Object.defineProperty(Symbol, 'dispose', {
        value: Symbol('Symbol.dispose'),
        configurable: false,
        enumerable: false,
        writable: false
    });
}

// Augment WASM class prototypes to support JS `using` syntax directly
[EcmRunner, SiqsWorker].forEach(cls => {
    if (cls && cls.prototype && !cls.prototype[Symbol.dispose]) {
        cls.prototype[Symbol.dispose] = function() {
            this.free();
        };
    }
});


const PHASE_ECM_WASM = "ECM Phase (WASM)";

// Load WASM
let wasmReadyPromise = init().then((wasm) => {
    ctx.wasmInstance = wasm;
    postMessage({ type: MSG_TYPE_WASM_READY, workerId: ctx.workerId });
}).catch(console.error);

ctx.wasmReadyPromise = wasmReadyPromise;

// Command Dispatcher Routing Map
const commandHandlers = {
    [MSG_CMD_INIT]: (data) => handleInitCommand(data),
    [MSG_CMD_STOP]: (data) => handleStopCommand(data),
    [MSG_CMD_SIQS_FACTORIZE]: (data) => handleSiqsFactorizeCommand(data),
    [MSG_CMD_FACTORIZE]: (data) => handleFactorizeCommand(data),
};

self.onmessage = async (e) => {
    const data = e.data;
    const handler = commandHandlers[data.cmd];
    if (handler) {
        await handler(data);
    }
};

async function handleInitCommand(data) {
    ctx.workerId = data.workerId;
    let sieveLimit = data.params.sieveLimit;
    let sab = data.params.sab;
    
    try {
        await wasmReadyPromise;
        ctx.initRingBuffer(sab);
        ctx.sievedPrimes = sieve_primes_wasm(sieveLimit);
        postMessage(Messages.createLog(ctx.workerId, ctx.currentSessionId, "Core online & Primes sieved.", "sys"));
        postMessage({ type: MSG_TYPE_INIT_COMPLETE, workerId: ctx.workerId });
    } catch (err) {
        console.error("WASM Init failed", err);
        postMessage(Messages.createLog(ctx.workerId, ctx.currentSessionId, "WASM Initialization Failed: " + err, "error"));
    }
}

async function handleStopCommand(data) {
    ctx.shouldStop = true;
    ctx.stopAckSent = false;
    ctx.currentTaskId = null;
    ctx.currentSessionId = null;
    
    postMessage({ type: "STOP_ACK", workerId: ctx.workerId });
    ctx.stopAckSent = true;
}

async function handleSiqsFactorizeCommand(data) {
    ctx.shouldStop = false;
    ctx.stopAckSent = false;
    ctx.currentTaskId = BigInt(data.target);
    ctx.currentSessionId = data.sessionId;
    
    // Primality check before attempting SIQS
    let n_bytes = bigIntToBytesLE(BigInt(data.target));
    if (is_prime_bpsw_bytes(n_bytes)) {
        if (ctx.workerId === 0) {
            postMessage(Messages.createPrimeFound(ctx.workerId, data.sessionId, data.target));
        }
        return;
    }

    await runParallelSIQS(data.target, data.kN, data.params, ctx, BigInt(data.target), data.sessionId);
}

async function handleFactorizeCommand(data) {
    ctx.shouldStop = false;
    ctx.stopAckSent = false;
    ctx.currentTaskId = BigInt(data.target);
    ctx.currentSessionId = data.sessionId;
    
    let M = BigInt(data.target);
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
            if (ctx.checkAbort()) return;
            let result = await strategy();
            if (result === true) return; // True means factor found and handled
        }

        if (!ctx.shouldStop && ctx.currentTaskId === M) {
            postMessage(Messages.createExhausted(ctx.workerId, ctx.currentSessionId, data.target));
        }
    }
    catch (err) {
        postMessage(Messages.createLog(ctx.workerId, ctx.currentSessionId, "Exception: " + err.message, "error"));
    }
}

// --- Strategies ---

async function runBpswStrategy(M, ctx) {
    ctx.sendPhase("BPSW Test", "Primality check", true);
    if (WasmAdapter.isPrime(M)) {
        if (ctx.workerId === 0) postMessage(Messages.createPrimeFound(ctx.workerId, ctx.currentSessionId, M.toString()));
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
            postMessage(Messages.createPrimeFound(ctx.workerId, ctx.currentSessionId, M.toString()));
            return true;
        }
        if (pBig > BigInt(params.trialLimit)) break;
        if (currentVal % pBig === 0n) {
            postMessage(Messages.createFactorFound(ctx.workerId, ctx.currentSessionId, M.toString(), p.toString(), "Trial Division"));
            return true;
        }
        if (ctx.checkAbort()) return true;
    }
    return false;
}

async function runPollardP1Strategy(M, params, ctx) {
    if (params.p1Limit <= 0) return false;
    ctx.sendPhase("Pollard P-1 (WASM)", "Limit=" + params.p1Limit, true);
    
    let factor = WasmAdapter.pollardP1(M, params.p1Limit, ctx.sievedPrimes, ctx.workerId);
    if (factor) {
        postMessage(Messages.createFactorFound(ctx.workerId, ctx.currentSessionId, M.toString(), factor.toString(), "P-1 (WASM)"));
        return true;
    }
    return false;
}

async function runPollardRhoStrategy(M, params, ctx) {
    if (params.rhoLimit <= 0) return false;
    ctx.sendPhase("Pollard Rho (WASM)", "Limit=" + params.rhoLimit, true);
    
    let factor = WasmAdapter.pollardRho(M, params.rhoLimit, ctx.workerId);
    if (factor) {
        postMessage(Messages.createFactorFound(ctx.workerId, ctx.currentSessionId, M.toString(), factor.toString(), "Rho (WASM)"));
        return true;
    }
    return false;
}

async function runEcmStrategy(M, params, ctx) {
    if (params.maxCurves <= 0) return false;
    ctx.sendPhase(PHASE_ECM_WASM, "B1=" + params.b1 + ", Curves=" + params.maxCurves, true);

    using ecmRunner = WasmAdapter.createEcmRunner(M, params.b1);
    let chunk_size = 10;
    let curves_run = 0;

    while (curves_run < params.maxCurves) {
        if (ctx.checkAbort() || ctx.currentTaskId !== M) return true;

        let curves_to_run = Math.min(chunk_size, params.maxCurves - curves_run);
        ctx.sendPhase(PHASE_ECM_WASM, "Curves " + curves_run + " / " + params.maxCurves, true);

        let factor = WasmAdapter.ecmRunCurves(ecmRunner, curves_to_run);
        if (factor) {
            postMessage(Messages.createFactorFound(ctx.workerId, ctx.currentSessionId, M.toString(), factor.toString(), "ECM (WASM)"));
            return true;
        }

        curves_run += curves_to_run;
        if (ctx.checkAbort()) return true;
    }
    return false;
}
