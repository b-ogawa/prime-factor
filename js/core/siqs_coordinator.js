import { EventEmitter } from './event_emitter.js';
import { generateFactorBase, extGCDInverse, gcd } from './math.js';
import { WasmAdapter } from './wasm_adapter.js';
import { MSG_CMD_SIQS_FACTORIZE } from './messages.js';

export class SIQSCoordinator extends EventEmitter {
    constructor() {
        super();
        this.active = false;
        this.activeTarget = null;
        this.currentSessionId = null;
        this.FB = [];
        this.relations = [];
        this.relationSignatures = new Set();
        this.startTime = null;
        this.targetCount = 0;
        this.k = 1n;
        this.isReducing = false;
    }

    // SIQS Parameters Table
    getSIQSParams(digits) {
        if (digits < 25) {
            return { fbSize: 150, M: 6000 };
        } else if (digits < 30) {
            return { fbSize: 260, M: 12000 };
        } else if (digits < 35) {
            return { fbSize: 450, M: 25000 };
        } else if (digits < 40) {
            return { fbSize: 750, M: 50000 };
        } else if (digits < 45) {
            return { fbSize: 1200, M: 100000 };
        } else {
            return { fbSize: 1800, M: 200000 };
        }
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
        this.relations = [];
        this.relationSignatures = new Set();
        this.startTime = Date.now();
        this.isReducing = false;
        this.partialRelations = new Map();

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

        // Check if it's a partial relation
        if (data.rel.largePrime) {
            let lp = data.rel.largePrime;
            // Pair partial relations strictly with the same A to preserve mathematical correctness (A1*A2 = A^2)
            let key = `${data.rel.A}_${lp}`;
            if (this.partialRelations.has(key)) {
                let r1 = this.partialRelations.get(key);
                let r2 = data.rel;
                
                // Combine r1 and r2 into a full relation
                let kNBig = BigInt(this.activeTarget) * this.k;
                let L = BigInt(lp);
                
                let u1 = (BigInt(r1.A) * BigInt(r1.x) + BigInt(r1.B)) % kNBig;
                if (u1 < 0n) u1 += kNBig;
                let u2 = (BigInt(r2.A) * BigInt(r2.x) + BigInt(r2.B)) % kNBig;
                if (u2 < 0n) u2 += kNBig;
                
                let invLRes = extGCDInverse(L, kNBig);
                if (invLRes.success) {
                    let u_new = (u1 * u2) % kNBig;
                    u_new = (u_new * invLRes.value) % kNBig;
                    
                    let new_factors = [...r1.factors, ...r2.factors];
                    let new_sign = r1.sign * r2.sign;
                    
                    // Add this synthesized relation
                    let combinedRel = {
                        x: u_new.toString(),
                        A: "1", // Since u_new is already fully evaluated, we can just say x = u_new, A = 1, B = 0
                        B: "0",
                        sign: new_sign,
                        factors: new_factors
                    };
                    
                    // Remove the partial
                    this.partialRelations.delete(key);
                    
                    // We recursively process this synthesized relation
                    this.handleRelation({ target: data.target, sessionId: data.sessionId, rel: combinedRel, polyCount: data.polyCount });
                } else {
                    // This means gcd(L, kNBig) > 1, so we found a factor!
                    let g = gcd(L, BigInt(this.activeTarget));
                    if (g > 1n && g < BigInt(this.activeTarget)) {
                        let f1 = g;
                        let f2 = BigInt(this.activeTarget) / g;
                        this.emit('log', `[SIQS SUCCESS!] Found factors via Large Prime collision gcd: ${f1.toString()} & ${f2.toString()}`, "success");
                        this.active = false;
                        this.emit('siqsSuccess', f1, f2);
                        return;
                    }
                }
            } else {
                this.partialRelations.set(key, data.rel);
            }
            return;
        }

        // Use BigInt representation to form a stable signature
        let sig = `${data.rel.x}-${data.rel.A}-${data.rel.B}`;
        if (!this.relationSignatures.has(sig)) {
            this.relationSignatures.add(sig);
            this.relations.push(data.rel);

            // Add relation to WASM reducer
            let nBig = BigInt(this.activeTarget);
            let kNBig = nBig * this.k;
            let xBig = BigInt(data.rel.x);
            // Normalize x mod kN to avoid negative number serialization issues
            xBig = (xBig % kNBig + kNBig) % kNBig;

            WasmAdapter.addSiqsRelation(
                this.wasmReducer,
                data.rel.sign,
                xBig,
                BigInt(data.rel.B),
                data.rel.A ? BigInt(data.rel.A) : null,
                data.rel.factors
            );

            let speed = Math.round((this.relations.length / Math.max(1, Date.now() - this.startTime)) * 1000);
            this.emit('siqsProgress', this.relations.length, this.targetCount, data.polyCount, speed);

            if (this.relations.length >= this.targetCount && !this.isReducing) {
                this.isReducing = true;
                this.emit('log', `[SIQS] Relationship collection complete. Relations: ${this.relations.length}`, "sys");
                this.emit('siqsStopWorkers');

                setTimeout(() => this.reduceMatrix(), 10);
            }
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
