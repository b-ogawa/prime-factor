import { generateFactorBase } from '../core/math.js';
import { bigIntToBytesLE, bytesToBigIntLE } from '../core/math_utils.js';
import { MSG_TYPE_RELATION_FOUND } from '../core/messages.js';
import { SiqsWorker } from '../wasm/wasm_engine.js';

export async function runParallelSIQS(target_N, kN, params, ctx, expectedTaskId, sessionId) {
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
    using worker = new SiqsWorker(nBytes, fbPrimes, fbLogs, fbRBytes, sieveLimit, ctx.workerId, maxWorkers);

    let polys_searched = 0;
    let chunks = [];
    let lastSendTime = performance.now();
    let lastPhaseTime = performance.now();

    while (!ctx.checkAbort() && ctx.currentTaskId === expectedTaskId) {
        let byteLen = worker.step(10);
        
        let buffer = ctx.wasmInstance.memory.buffer;
        let ptr = worker.result_ptr();
        let resBytes = new Uint8Array(buffer, ptr, byteLen);

        let view = new DataView(resBytes.buffer, resBytes.byteOffset, 12);
        let polysSearchedThisStep = Number(view.getBigUint64(0, true));
        polys_searched += polysSearchedThisStep;

        let chunk = resBytes.slice();
        chunks.push(chunk);

        let now = performance.now();
        if (chunks.length >= 30 || (now - lastSendTime >= 50 && chunks.length > 0)) {
            let transferableBuffers = chunks.map(c => c.buffer);
            postMessage({
                type: MSG_TYPE_RELATION_FOUND,
                target: target_N,
                sessionId: sessionId,
                chunks: chunks,
                polyCount: polys_searched
            }, transferableBuffers);
            chunks = [];
            lastSendTime = now;
        }

        if (now - lastPhaseTime >= 200) {
            ctx.sendPhase("SIQS Sieving", "Polys: " + polys_searched);
            lastPhaseTime = now;
        }
    }

    if (chunks.length > 0 && ctx.currentTaskId === expectedTaskId) {
        let transferableBuffers = chunks.map(c => c.buffer);
        postMessage({
            type: MSG_TYPE_RELATION_FOUND,
            target: target_N,
            sessionId: sessionId,
            chunks: chunks,
            polyCount: polys_searched
        }, transferableBuffers);
    }
}
