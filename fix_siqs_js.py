with open('js/worker/siqs.js', 'r') as f:
    content = f.read()

# We completely rewrite runParallelSIQS to use wasm

new_content = """async function runParallelSIQS(target_N, kN, params, ctx) {
    let fbSize = params.fbSize;
    let M = params.M;
    let maxWorkers = params.maxWorkers || 8;
    let kN_Big = BigInt(kN);
    ctx.sendPhase("SIQS Core", "Generating FB...", true);
    let FB = generateFactorBase(kN_Big, fbSize);
    ctx.sendPhase("SIQS Core", "FB Size: " + FB.length, true);

    await ctx.wasmReadyPromise;

    // Serialize FB for WASM
    let nBytes = bigIntToBytesLE(kN_Big);
    let fbPrimes = new Uint32Array(FB.map(f => f.p));
    let fbLogs = new Uint8Array(FB.map(f => f.log));

    // We need fb_r as bytes as well
    let fbRBytes = new Uint8Array(FB.length * 32);
    for(let i=0; i<FB.length; i++) {
        let rBytes = bigIntToBytesLE(FB[i].r);
        for(let j=0; j<rBytes.length; j++) {
            fbRBytes[i*32 + j] = rBytes[j];
        }
    }

    let sieveLimit = M * 2;
    let worker = new wasm_bindgen.SiqsWorker(nBytes, fbPrimes, fbLogs, fbRBytes, sieveLimit, ctx.workerId);

    let polys_searched = 0;

    while (!ctx.shouldStop) {
        let res = worker.step(100);
        polys_searched += res.polysSearched;

        for (let i = 0; i < res.relations.length; i++) {
            let rel = res.relations[i];
            postMessage({
                type: "RELATION_FOUND",
                target: target_N,
                rel: rel,
                polyCount: polys_searched
            });
        }

        ctx.sendPhase("SIQS Sieving", "Polys: " + polys_searched);
        await ctx.yieldIfNeeded();
    }

    worker.free();
}
"""

with open('js/worker/siqs.js', 'w') as f:
    f.write(new_content)
