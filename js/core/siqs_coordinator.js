import { EventEmitter } from './event_emitter.js';
import { generateFactorBase, extGCDInverse, gcd, jacobi } from './math.js';
import { WasmAdapter } from './wasm_adapter.js';
import { MSG_CMD_SIQS_FACTORIZE } from './messages.js';
import { store } from './store.js';
import { bigIntToBytesLE, bytesToBigIntLE } from './math_utils.js';

export class SIQSCoordinator extends EventEmitter {
    constructor() {
        super();
        this.active = false;
        this.activeTarget = null;
        this.currentSessionId = null;
        this.FB = [];
        this.relationsCount = 0;
        this.relationSignatures = new Set();
        this.startTime = null;
        this.targetCount = 0;
        this.k = 1n;
        this.isReducing = false;
        this.tDevice = null;
        this.lastProgressEmitTime = 0;
        this.progressThrottleMs = 100;
    }

    // Continuous parameter calculation via L-notation and profiling
    getSIQSParams(digits) {
        if (!this.tDevice) {
            const profile = store.getState().hardwareProfile;
            this.tDevice = profile.tDevice || 1.0;
            this.emit('log', `[PROFILE] Loading device benchmark profile. T_device = ${this.tDevice.toFixed(2)}`, "sys");
        }

        let lnN = digits * Math.log(10);
        let sqrtLnN = Math.sqrt(lnN * Math.log(lnN));

        let fbSize = Math.round(Math.exp(0.32 * sqrtLnN + 0.2));
        
        // Hardcode M to a cache-friendly constant (sieve length M*2 = 65536)
        let M = 32768;

        // Safeguards
        fbSize = Math.max(50, Math.min(20000, fbSize));

        return { fbSize, M };
    }

    // Knuth-Schroeppel Multiplier Selection
    chooseMultiplier(N) {
        let multipliers = [1n, 2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n, 41n, 43n, 47n, 53n, 59n, 61n, 67n, 71n, 73n];
        let bestK = 1n;
        let bestScore = -1;
        let primes = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n, 41n, 43n, 47n, 53n];
        for (let k of multipliers) {
            let kN = N * k;
            let score = 0;
            for (let p of primes) {
                if (kN % p === 0n) {
                    score += 1.0 / Number(p);
                } else if (kN % p !== 0n && (kN % p + p) % p !== 0n) {
                    // Jacobi function is globally exported
                    let jVal = jacobi(kN, p);
                    if (jVal === 1n) {
                        score += 2.0 / Number(p);
                    }
                }
            }
            let mod8 = Number(kN % 8n);
            if (mod8 === 1) score += 2.0;
            if (mod8 === 5) score += 1.0;
            if (score > bestScore) {
                bestScore = score; bestK = k;
            }
        }
        return bestK;
    }

    runPipeline(N, maxWorkers, sessionId) {
        this.active = true;
        this.activeTarget = N;
        this.currentSessionId = sessionId;
        this.relationsCount = 0;
        this.relationSignatures = new Set();
        this.startTime = Date.now();
        this.isReducing = false;
        this.partialRelations = new Map();
        this.lastProgressEmitTime = 0;

        let k = this.chooseMultiplier(N);
        let kN = N * k;
        this.k = k;

        let digits = kN.toString().length;
        let params = this.getSIQSParams(digits);

        this.emit('log', `[SIQS INITIATED] Target N routed to True SIQS. Multiplier k=${k}`, "sys");
        this.emit('log', `[SIQS CONFIG] Factor Base: ${params.fbSize} | Sieve Limit M: ${params.M}`, "sys");

        this.emit('siqsActivated', params.fbSize + 15);

        // Generate Factor Base using kN
        let FB = generateFactorBase(kN, params.fbSize);
        this.FB = FB;
        this.targetCount = FB.length + 15;

        let fb_arr = new Uint32Array(FB.map(f => f.p));
        this.wasmReducer = WasmAdapter.createSiqsReducer(N, kN, fb_arr);

        // Dispatch tasks
        this.emit('siqsTaskGenerated', {
            cmd: MSG_CMD_SIQS_FACTORIZE,
            target: N.toString(),
            kN: kN.toString(),
            sessionId: sessionId,
            params: {
                fbSize: params.fbSize,
                M: params.M,
                sieveLimit: Math.max(params.M * 2, 10000),
                maxWorkers: maxWorkers
            }
        });
    }

    handleRelation(data) {
        if (!this.active || this.currentSessionId !== data.sessionId) return;

        if (!this.partialRelations) this.partialRelations = new Map();

        let chunks = data.chunks;
        if (!chunks) return;

        for (let chunk of chunks) {
            let view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
            let relationsCount = view.getUint32(8, true);
            let offset = 12;

            for (let rIdx = 0; rIdx < relationsCount; rIdx++) {
                if (!this.active) return;
                let flags = view.getUint8(offset);
                offset += 1;
                
                let is_partial = (flags & 1) === 1;
                let sign = (flags & 2) === 2 ? 1 : -1;
                
                let x_i64 = view.getBigInt64(offset, true);
                offset += 8;

                let aBytes = new Uint8Array(chunk.buffer, chunk.byteOffset + offset, 32);
                offset += 32;

                let bBytes = new Uint8Array(chunk.buffer, chunk.byteOffset + offset, 32);
                offset += 32;

                let lpBytes = null;
                if (is_partial) {
                    lpBytes = new Uint8Array(chunk.buffer, chunk.byteOffset + offset, 32);
                    offset += 32;
                }

                let factorsCountVal = view.getUint16(offset, true);
                offset += 2;

                let factors = new Uint32Array(chunk.buffer, chunk.byteOffset + offset, factorsCountVal);
                offset += factorsCountVal * 4;

                this.processSingleRelation(is_partial, sign, x_i64, aBytes, bBytes, lpBytes, factors, data.polyCount);
            }
        }
    }

    processSingleRelation(is_partial, sign, x_i64, aBytes, bBytes, lpBytes, factors, polyCount) {
        if (is_partial) {
            let lp = bytesToBigIntLE(lpBytes);
            let A = bytesToBigIntLE(aBytes);
            let key = `${A.toString()}_${lp.toString()}`;

            if (this.partialRelations.has(key)) {
                let r1 = this.partialRelations.get(key);
                this.partialRelations.delete(key);

                let kNBig = BigInt(this.activeTarget) * this.k;
                let u1 = (A * bytesToBigIntLE(r1.xBytes) + bytesToBigIntLE(r1.bBytes)) % kNBig;
                let u2 = (A * (BigInt(x_i64) % kNBig + kNBig) % kNBig + bytesToBigIntLE(bBytes)) % kNBig;

                let invLRes = extGCDInverse(lp, kNBig);
                if (invLRes.success) {
                    let u_new = (u1 * u2) % kNBig;
                    u_new = (u_new * invLRes.value) % kNBig;

                    let combinedFactors = new Uint32Array(r1.factors.length + factors.length);
                    combinedFactors.set(r1.factors);
                    combinedFactors.set(factors, r1.factors.length);

                    let new_sign = r1.sign * sign;
                    let uBytes = bigIntToBytesLE(u_new);
                    let zeroBytes = new Uint8Array(32);
                    let oneBytes = new Uint8Array(32); oneBytes[0] = 1;

                    WasmAdapter.addSiqsRelationRaw(
                        this.wasmReducer,
                        new_sign,
                        uBytes,
                        zeroBytes,
                        oneBytes,
                        combinedFactors
                    );

                    this.incrementRelationsCount(polyCount);
                } else {
                    let g = gcd(lp, BigInt(this.activeTarget));
                    if (g > 1n && g < BigInt(this.activeTarget)) {
                        let f1 = g;
                        let f2 = BigInt(this.activeTarget) / g;
                        this.emit('log', `[SIQS SUCCESS!] Found factors via Large Prime collision gcd: ${f1.toString()} & ${f2.toString()}`, "success");
                        this.active = false;
                        this.emit('siqsSuccess', f1, f2);
                    }
                }
            } else {
                let xBytes = new Uint8Array(8);
                new DataView(xBytes.buffer).setBigInt64(0, x_i64, true);

                this.partialRelations.set(key, {
                    sign: sign,
                    xBytes: xBytes,
                    bBytes: bBytes.slice(),
                    factors: factors.slice()
                });
            }
        } else {
            let sig = `${x_i64}`;
            if (!this.relationSignatures.has(sig)) {
                this.relationSignatures.add(sig);

                let kNBig = BigInt(this.activeTarget) * this.k;
                let xBig = (BigInt(x_i64) % kNBig + kNBig) % kNBig;
                let xBytes = bigIntToBytesLE(xBig);

                WasmAdapter.addSiqsRelationRaw(
                    this.wasmReducer,
                    sign,
                    xBytes,
                    bBytes,
                    aBytes,
                    factors
                );

                this.incrementRelationsCount(polyCount);
            }
        }
    }

    incrementRelationsCount(polyCount) {
        this.relationsCount++;
        let speed = Math.round((this.relationsCount / Math.max(1, Date.now() - this.startTime)) * 1000);
        
        let now = Date.now();
        let isTargetReached = this.relationsCount >= this.targetCount;
        if (isTargetReached || now - this.lastProgressEmitTime >= this.progressThrottleMs) {
            this.lastProgressEmitTime = now;
            this.emit('siqsProgress', this.relationsCount, this.targetCount, polyCount, speed);
        }

        if (isTargetReached && !this.isReducing) {
            this.isReducing = true;
            this.emit('log', `[SIQS] Relationship collection complete. Relations: ${this.relationsCount}`, "sys");
            this.emit('siqsStopWorkers');

            setTimeout(() => this.reduceMatrix(), 10);
        }
    }

    stop() {
        this.active = false;
        if (this.wasmReducer) {
            this.wasmReducer.free();
            this.wasmReducer = null;
        }
    }

    reduceMatrix() {
        if (!this.active || !this.activeTarget) return;

        this.emit('log', "[SIQS] Running WASM Bit-packed Gaussian Elimination & Evaluation...", "sys");

        try {
            let factor = WasmAdapter.siqsReduceMatrix(this.wasmReducer);

            if (factor && factor > 1n) {
                let f1 = gcd(factor, this.activeTarget);
                if (f1 > 1n && f1 < this.activeTarget) {
                    let f2 = this.activeTarget / f1;
                    this.emit('log', `[SIQS SUCCESS!] Found factors: ${f1.toString()} & ${f2.toString()}`, "success");

                    this.active = false;
                    this.emit('siqsSuccess', f1, f2);
                    return;
                }
            }
            this.emit('log', "[SIQS FAILURE] Dependencies exhausted without non-trivial factors. Falling back to ECM.", "error");
            this.active = false;
            this.emit('siqsFallback');
        } finally {
            if (this.wasmReducer) {
                this.wasmReducer.free();
                this.wasmReducer = null;
            }
        }
    }
}
