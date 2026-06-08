importScripts('../core/math.js', 'context.js', 'pollard.js', 'ecm.js', 'siqs.js');

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
        ctx.sievedPrimes = sievePrimes(data.params.sieveLimit);
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
            let mont = new MontgomerySpace(M);
            if (isPrimeBPSW(M, mont)) {
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
                let p1Factor = await pollardP1(M, params.p1Limit, mont, ctx);
                if (p1Factor) {
                    postMessage({ type: "FACTOR_FOUND", factor: p1Factor, target: M, workerId: ctx.workerId, method: "P-1" });
                    return;
                }
            }
            await ctx.yieldIfNeeded(); if (ctx.shouldStop) return;
            if (params.rhoLimit > 0) {
                ctx.sendPhase("Pollard Rho (WASM)", "Limit=" + params.rhoLimit, true);

                // --- WASM INTEGRATION ---
                let rhoFactorStr = wasm_bindgen.pollard_brent(M.toString(), params.rhoLimit);

                if (rhoFactorStr) {
                    postMessage({ type: "FACTOR_FOUND", factor: rhoFactorStr, target: M, workerId: ctx.workerId, method: "Rho (WASM)" });
                    return;
                }
            }
            await ctx.yieldIfNeeded(); if (ctx.shouldStop) return;
            let ecmRes = await runECM(M, params.b1, params.maxCurves, mont, ctx);
            if (ecmRes && ecmRes.success) {
                postMessage({ type: "FACTOR_FOUND", factor: ecmRes.factor, target: M, workerId: ctx.workerId, method: "ECM" });
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
