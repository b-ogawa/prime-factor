import { is_prime_bpsw_bytes, pollard_p1_bytes, pollard_brent_bytes, EcmRunner, run_micro_benchmark, FactorizationSession, ActionType } from '../wasm/wasm_engine.js';
import { bigIntToBytesLE, bytesToBigIntLE } from './math_utils.js';
 
export const WasmAdapter = {
    wasm: null,
    isPrime(bigIntNum) {
        let bytes = bigIntToBytesLE(bigIntNum);
        return is_prime_bpsw_bytes(bytes);
    },
    pollardP1(bigIntNum, limit, sievedPrimes, workerId) {
        let bytes = bigIntToBytesLE(bigIntNum);
        let primesArr = new Uint32Array(sievedPrimes);
        let factorBytes = pollard_p1_bytes(bytes, limit, primesArr, workerId);
        return factorBytes ? bytesToBigIntLE(factorBytes) : null;
    },
    pollardRho(bigIntNum, limit, workerId) {
        let bytes = bigIntToBytesLE(bigIntNum);
        let factorBytes = pollard_brent_bytes(bytes, limit, workerId);
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

    runMicroBenchmark() {
        return run_micro_benchmark();
    },
    createSession(nStr) {
        let wasmInstance = new FactorizationSession(nStr);
        return new SafeWasmWrapper(wasmInstance);
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
[EcmRunner, FactorizationSession].forEach(cls => {
    if (cls && cls.prototype && !cls.prototype[Symbol.dispose]) {
        cls.prototype[Symbol.dispose] = function() {
            this.free();
        };
    }
});

