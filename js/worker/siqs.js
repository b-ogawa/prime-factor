import { bigIntToBytesLE } from '../core/math_utils.js';
import { MSG_TYPE_RELATION_FOUND } from '../core/messages.js';
import { SiqsWorker } from '../wasm/wasm_engine.js';

export async function runParallelSIQS(target_N, kN, params, ctx, expectedTaskId, sessionId) {
    let M = params.M;
    let maxWorkers = params.maxWorkers || 8;
    let kN_Big = BigInt(kN);

    await ctx.wasmReadyPromise;

    let fbPrimes = params.fbPrimes;
    let fbLogs = params.fbLogs;
    let fbRBytes = params.fbRBytes;

    let sieveLimit = M * 2;
    let nBytes = bigIntToBytesLE(kN_Big);
    using worker = new SiqsWorker(nBytes, fbPrimes, fbLogs, fbRBytes, sieveLimit, ctx.workerId, maxWorkers);

    let polys_searched = 0;
    let lastSendTime = performance.now();
    let lastPhaseTime = performance.now();

    while (!ctx.checkAbort() && ctx.currentTaskId === expectedTaskId) {
        let byteLen = worker.step(10);
        if (byteLen === 0) {
            if (ctx.checkAbort()) break;
        }
        
        let buffer = ctx.wasmInstance.memory.buffer;
        let ptr = worker.result_ptr();
        let resBytes = new Uint8Array(buffer, ptr, byteLen);

        let view = new DataView(buffer, ptr, 12);
        let polysSearchedThisStep = Number(view.getBigUint64(0, true));
        polys_searched += polysSearchedThisStep;

        // Write directly to the SPSC Ring Buffer on SAB
        if (!ctx.ringBuffer.write(resBytes)) {
            break; // Aborted
        }

        let now = performance.now();
        let hasRelation = byteLen > 12;

        // Send a lightweight signal to the main thread when a relation is found,
        // or periodically (every 50ms) to update the polyCount progress.
        if (hasRelation || (now - lastSendTime >= 50)) {
            postMessage({
                type: MSG_TYPE_RELATION_FOUND,
                workerId: ctx.workerId,
                sessionId: sessionId
            });
            lastSendTime = now;
        }

        if (now - lastPhaseTime >= 200) {
            ctx.sendPhase("SIQS Sieving", "Polys: " + polys_searched);
            lastPhaseTime = now;
        }
    }

    // Ensure any remaining data in the buffer is drained
    if (ctx.currentTaskId === expectedTaskId) {
        postMessage({
            type: MSG_TYPE_RELATION_FOUND,
            workerId: ctx.workerId,
            sessionId: sessionId
        });
    }
}
