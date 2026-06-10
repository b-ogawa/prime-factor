// --- WASM Adapter ---
// Shared globally since both main thread (engine.js/siqs_coordinator.js) and worker (main.js)
// use these serialization routines to communicate with WASM.

const WasmAdapter = {
    isPrime(bigIntNum) {
        let bytes = bigIntToBytesLE(bigIntNum);
        return wasm_bindgen.is_prime_bpsw_bytes(bytes);
    },
    pollardP1(bigIntNum, limit, sievedPrimes) {
        let bytes = bigIntToBytesLE(bigIntNum);
        let primesArr = new Uint32Array(sievedPrimes);
        let factorBytes = wasm_bindgen.pollard_p1_bytes(bytes, limit, primesArr);
        return factorBytes ? bytesToBigIntLE(factorBytes) : null;
    },
    pollardRho(bigIntNum, limit) {
        let bytes = bigIntToBytesLE(bigIntNum);
        let factorBytes = wasm_bindgen.pollard_brent_bytes(bytes, limit);
        return factorBytes ? bytesToBigIntLE(factorBytes) : null;
    },
    createEcmRunner(bigIntNum, b1) {
        let bytes = bigIntToBytesLE(bigIntNum);
        return new wasm_bindgen.EcmRunner(bytes, b1);
    },
    ecmRunCurves(runner, curves_to_run) {
        let factorBytes = runner.run_curves(curves_to_run);
        return factorBytes ? bytesToBigIntLE(factorBytes) : null;
    },
    createSiqsReducer(nBig, knBig, fbArr) {
        let n_bytes = bigIntToBytesLE(nBig);
        let kn_bytes = bigIntToBytesLE(knBig);
        return new wasm_bindgen.SiqsReducer(n_bytes, kn_bytes, fbArr);
    },
    addSiqsRelation(reducer, sign, xBig, bBig, aBig, factors) {
        let xBytes = bigIntToBytesLE(xBig);
        let bBytes = bigIntToBytesLE(bBig);
        let aBytes = aBig ? bigIntToBytesLE(aBig) : new Uint8Array(0);
        let factorsArr = new Uint32Array(factors);
        reducer.add_relation(sign, xBytes, bBytes, aBytes, factorsArr);
    },
    siqsReduceMatrix(reducer) {
        let factorBytes = reducer.reduce_matrix();
        return factorBytes ? bytesToBigIntLE(factorBytes) : null;
    }
};
