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
    using worker = new SiqsWorker(nBytes, fbPrimes, fbLogs, fbRBytes, sieveLimit, ctx.workerId);

    let polys_searched = 0;

        while (!ctx.shouldStop && ctx.currentTaskId === expectedTaskId) {
            let yieldTime = performance.now() + 50;

            while (performance.now() < yieldTime && !ctx.shouldStop && ctx.currentTaskId === expectedTaskId) {
                let resBytes = worker.step(10);
                let view = new DataView(resBytes.buffer, resBytes.byteOffset, resBytes.byteLength);
                let polysSearched = Number(view.getBigUint64(0, true));
                let relationsCount = view.getUint32(8, true);
                polys_searched += polysSearched;

                let offset = 12;
                for (let rIdx = 0; rIdx < relationsCount; rIdx++) {
                    let flags = view.getUint8(offset);
                    offset += 1;
                    
                    let is_partial = (flags & 1) === 1;
                    let sign = (flags & 2) === 2 ? 1 : -1;
                    
                    let x_i64 = view.getBigInt64(offset, true);
                    offset += 8;

                    let aBytes = new Uint8Array(resBytes.buffer, resBytes.byteOffset + offset, 32);
                    let aVal = bytesToBigIntLE(aBytes);
                    offset += 32;

                    let bBytes = new Uint8Array(resBytes.buffer, resBytes.byteOffset + offset, 32);
                    let bVal = bytesToBigIntLE(bBytes);
                    offset += 32;

                    let largePrime = "1";
                    if (is_partial) {
                        let lpBytes = new Uint8Array(resBytes.buffer, resBytes.byteOffset + offset, 32);
                        largePrime = bytesToBigIntLE(lpBytes).toString();
                        offset += 32;
                    }

                    let factorsCountVal = view.getUint16(offset, true);
                    offset += 2;

                    let factors = [];
                    for (let fIdx = 0; fIdx < factorsCountVal; fIdx++) {
                        factors.push(view.getUint32(offset, true));
                        offset += 4;
                    }

                    let xBig = x_i64;
                    xBig = (xBig % kN_Big + kN_Big) % kN_Big;

                    let rel = {
                        x: xBig.toString(),
                        A: aVal.toString(),
                        B: bVal.toString(),
                        sign: sign,
                        largePrime: largePrime,
                        factors: factors
                    };

                    postMessage({
                        type: MSG_TYPE_RELATION_FOUND,
                        target: target_N,
                        sessionId: sessionId,
                        rel: rel,
                        polyCount: polys_searched
                    });
                }
            }

            ctx.sendPhase("SIQS Sieving", "Polys: " + polys_searched);
            if (await ctx.checkYieldAndStop(expectedTaskId)) {
                break;
            }
            await new Promise(r => setTimeout(r, 0)); // yield control to JS event loop
        }
    }
}
