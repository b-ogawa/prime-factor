importScripts('../core/math.js', 'math_utils.js', 'context.js', 'siqs.js');

// Load WASM
let wasmModule;
importScripts('../wasm/wasm_engine.js');
wasm_bindgen({ module_or_path: '../wasm/wasm_engine_bg.wasm' }).then((module) => {
    wasmModule = module;
    // Notify main thread that worker is ready
    postMessage({ type: "WASM_READY", workerId: ctx.workerId });
}).catch(console.error);

// Main Worker Routine
self.onmessage = async (e) => {
    const data = e.data;
    if (data.cmd === "INIT") {
        ctx.workerId = data.workerId;
        ctx.sievedPrimes = wasm_bindgen.sieve_primes_wasm(data.params.sieveLimit);
        postMessage({ type: "LOG", msg: "Core online & Primes sieved.", level: "sys", workerId: ctx.workerId });
    }
    else if (data.cmd === "STOP") {
        ctx.shouldStop = true;
    }
    else if (data.cmd === "SIQS_FACTORIZE") {
        ctx.shouldStop = false;
        await runParallelSIQS(data.target, data.kN, data.params, ctx);
    }
    else if (data.cmd === "FACTORIZE") {
        ctx.shouldStop = false;
        let M = data.target;
        let params = data.params;
        try {
            ctx.sendPhase("BPSW Test", "Primality check", true);
            let n_bytes = bigIntToBytesLE(M);
            if (wasm_bindgen.is_prime_bpsw_bytes(n_bytes)) {
                if (ctx.workerId === 0) postMessage({ type: "PRIME_FOUND", target: M, workerId: ctx.workerId });
                return;
            }
            if (ctx.workerId === 0 && params.trialLimit > 0) {
                ctx.sendPhase("Trial Div", "up to " + params.trialLimit, true);
                let currentVal = M;
                for (let p of ctx.sievedPrimes) {
                    if (p > params.trialLimit) break;
                    if (currentVal % p === 0n) {
                        postMessage({ type: "FACTOR_FOUND", factor: p, target: M, workerId: ctx.workerId, method: "Trial Division" });
                        return;
                    }
                    await ctx.yieldIfNeeded();
                    if (ctx.shouldStop) return;
                }
            }
            await ctx.yieldIfNeeded(); if (ctx.shouldStop) return;
            if (params.p1Limit > 0) {
                ctx.sendPhase("Pollard P-1 (WASM)", "Limit=" + params.p1Limit, true);
                let primesArr = new Uint32Array(ctx.sievedPrimes);
                let p1FactorBytes = wasm_bindgen.pollard_p1_bytes(n_bytes, params.p1Limit, primesArr);
                if (p1FactorBytes) {
                    let p1FactorBigInt = bytesToBigIntLE(p1FactorBytes);
                    postMessage({ type: "FACTOR_FOUND", factor: p1FactorBigInt.toString(), target: M, workerId: ctx.workerId, method: "P-1 (WASM)" });
                    return;
                }
            }
            await ctx.yieldIfNeeded(); if (ctx.shouldStop) return;
            if (params.rhoLimit > 0) {
                ctx.sendPhase("Pollard Rho (WASM)", "Limit=" + params.rhoLimit, true);

                // --- WASM INTEGRATION ---
                let rhoFactorBytes = wasm_bindgen.pollard_brent_bytes(n_bytes, params.rhoLimit);

                if (rhoFactorBytes) {
                    let rhoFactorBigInt = bytesToBigIntLE(rhoFactorBytes);
                    postMessage({ type: "FACTOR_FOUND", factor: rhoFactorBigInt.toString(), target: M, workerId: ctx.workerId, method: "Rho (WASM)" });
                    return;
                }
            }
            await ctx.yieldIfNeeded(); if (ctx.shouldStop) return;
            ctx.sendPhase("ECM Phase (WASM)", "B1=" + params.b1 + ", Curves=" + params.maxCurves, true);
            let ecmFactorBytes = wasm_bindgen.run_ecm_bytes(n_bytes, params.b1, params.maxCurves);

            if (ecmFactorBytes) {
                let ecmFactorBigInt = bytesToBigIntLE(ecmFactorBytes);
                postMessage({ type: "FACTOR_FOUND", factor: ecmFactorBigInt.toString(), target: M, workerId: ctx.workerId, method: "ECM (WASM)" });
                return;
            }
            if (!ctx.shouldStop) {
                postMessage({ type: "EXHAUSTED", target: M, workerId: ctx.workerId });
            }
        }
        catch (err) {
            postMessage({ type: "LOG", msg: "Exception: " + err.message, level: "error", workerId: ctx.workerId });
        }
    }
};
