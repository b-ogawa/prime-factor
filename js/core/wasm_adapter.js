import { is_prime_bpsw_bytes, pollard_p1_bytes, pollard_brent_bytes, EcmRunner, SiqsReducer, run_micro_benchmark } from '../wasm/wasm_engine.js';
import { bigIntToBytesLE, bytesToBigIntLE } from './math_utils.js';
 
export const WasmAdapter = {
    isPrime(bigIntNum) {
        let bytes = bigIntToBytesLE(bigIntNum);
        return is_prime_bpsw_bytes(bytes);
    },
    pollardP1(bigIntNum, limit, sievedPrimes) {
        let bytes = bigIntToBytesLE(bigIntNum);
        let primesArr = new Uint32Array(sievedPrimes);
        let factorBytes = pollard_p1_bytes(bytes, limit, primesArr);
        return factorBytes ? bytesToBigIntLE(factorBytes) : null;
    },
    pollardRho(bigIntNum, limit) {
        let bytes = bigIntToBytesLE(bigIntNum);
        let factorBytes = pollard_brent_bytes(bytes, limit);
        return factorBytes ? bytesToBigIntLE(factorBytes) : null;
    },
    createEcmRunner(bigIntNum, b1) {
        let bytes = bigIntToBytesLE(bigIntNum);
        return new EcmRunner(bytes, b1);
    },
    ecmRunCurves(runner, curves_to_run) {
        let factorBytes = runner.run_curves(curves_to_run);
        return factorBytes ? bytesToBigIntLE(factorBytes) : null;
    },
    createSiqsReducer(nBig, knBig, fbArr) {
        let n_bytes = bigIntToBytesLE(nBig);
        let kn_bytes = bigIntToBytesLE(knBig);
        let wasmInstance = new SiqsReducer(n_bytes, kn_bytes, fbArr);
        return new SafeWasmWrapper(wasmInstance);
    },
    addSiqsRelation(reducerWrapper, sign, xBig, bBig, aBig, factors) {
        if (!reducerWrapper || reducerWrapper.isFreed) return;
        let xBytes = bigIntToBytesLE(xBig);
        let bBytes = bigIntToBytesLE(bBig);
        let aBytes = aBig ? bigIntToBytesLE(aBig) : new Uint8Array(0);
        let factorsArr = new Uint32Array(factors);
        reducerWrapper.instance.add_relation(sign, xBytes, bBytes, aBytes, factorsArr);
    },
    siqsReduceMatrix(reducerWrapper) {
        if (!reducerWrapper || reducerWrapper.isFreed) return null;
        let factorBytes = reducerWrapper.instance.reduce_matrix();
        return factorBytes ? bytesToBigIntLE(factorBytes) : null;
    },
    withReducer(nBig, knBig, fbArr, callback) {
        using reducer = this.createSiqsReducer(nBig, knBig, fbArr);
        return callback(reducer);
    },
    runMicroBenchmark() {
        return run_micro_benchmark();
    }
};

// Polyfill Symbol.dispose if not present
if (typeof Symbol !== 'undefined' && !Symbol.dispose) {
    Object.defineProperty(Symbol, 'dispose', {
        value: Symbol('Symbol.dispose'),
        configurable: false,
        enumerable: false,
        writable: false
    });
}

export class SafeWasmWrapper {
    constructor(instance) {
        this.instance = instance;
        this.isFreed = false;
    }

    free() {
        if (!this.isFreed && this.instance) {
            try {
                this.instance.free();
            } catch (e) {
                console.warn("Error freeing WASM instance:", e);
            }
            this.isFreed = true;
            this.instance = null;
        }
    }

    [Symbol.dispose]() {
        this.free();
    }
}

// Augment WASM class prototypes to support JS `using` syntax directly
[EcmRunner, SiqsReducer].forEach(cls => {
    if (cls && cls.prototype && !cls.prototype[Symbol.dispose]) {
        cls.prototype[Symbol.dispose] = function() {
            this.free();
        };
    }
});

