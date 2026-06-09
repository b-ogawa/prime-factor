importScripts('../core/math.js', '../core/math_utils.js', 'context.js', 'siqs.js');

// Load WASM
let wasmModule;
let wasmReadyPromise;
importScripts('../wasm/wasm_engine.js');
if (typeof wasm_bindgen === 'function') {
    wasmReadyPromise = wasm_bindgen({ module_or_path: '../wasm/wasm_engine_bg.wasm' }).then((module) => {
        wasmModule = module;
        postMessage({ type: "WASM_READY", workerId: ctx.workerId });
    }).catch(console.error);
} else {
    // If we're here, it might be that the module format is different.
    console.error("wasm_bindgen is not a function in the worker!");
}

// Main Worker Routine
self.onmessage = async (e) => {
    const data = e.data;
    if (data.cmd === "INIT") {
        ctx.workerId = data.workerId;

        let sieveLimit = data.params.sieveLimit;
        // The worker is likely receiving INIT before WASM is fully loaded.
        // We will wait if it's not ready yet.
        const initSieve = async () => {
            if (wasmReadyPromise) await wasmReadyPromise;
            // Now use the bound exports from the module
            ctx.sievedPrimes = wasm_bindgen.sieve_primes_wasm(sieveLimit);
            postMessage({ type: "LOG", msg: "Core online & Primes sieved.", level: "sys", workerId: ctx.workerId });
        };
        initSieve();

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
                    let pBig = BigInt(p);
                    if (pBig > BigInt(params.trialLimit)) break;
                    if (currentVal % pBig === 0n) {
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

            // --- WASM INTEGRATION: Stateful / Non-blocking ---
            let ecmRunner = wasm_bindgen.EcmRunner.new(n_bytes, params.b1);
            let chunk_size = 10; // Run 10 curves at a time to prevent blocking the event loop
            let curves_run = 0;

            while (curves_run < params.maxCurves) {
                if (ctx.shouldStop) {
                    ecmRunner.free();
                    return;
                }

                let curves_to_run = Math.min(chunk_size, params.maxCurves - curves_run);
                ctx.sendPhase("ECM Phase (WASM)", "Curves " + curves_run + " / " + params.maxCurves, true);

                let ecmFactorBytes = ecmRunner.run_curves(curves_to_run);
                if (ecmFactorBytes) {
                    let ecmFactorBigInt = bytesToBigIntLE(ecmFactorBytes);
                    postMessage({ type: "FACTOR_FOUND", factor: ecmFactorBigInt.toString(), target: M, workerId: ctx.workerId, method: "ECM (WASM)" });
                    ecmRunner.free();
                    return;
                }

                curves_run += curves_to_run;
                await ctx.yieldIfNeeded();
            }
            ecmRunner.free();
            if (!ctx.shouldStop) {
                postMessage({ type: "EXHAUSTED", target: M, workerId: ctx.workerId });
            }
        }
        catch (err) {
            postMessage({ type: "LOG", msg: "Exception: " + err.message, level: "error", workerId: ctx.workerId });
        }
    }
};
