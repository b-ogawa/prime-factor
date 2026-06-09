class SIQSCoordinator {
    constructor(engine) {
        this.engine = engine; // Reference to FactorizationEngine
        this.active = false;
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
                } else if (jacobi(kN, p) === 1n) {
                    score += 2.0 / Number(p);
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

    runPipeline(N, maxWorkers) {
        this.active = true;
        this.relations = [];
        this.relationSignatures = new Set();
        this.startTime = Date.now();
        this.isReducing = false;

        let k = this.chooseMultiplier(N);
        let kN = N * k;
        this.k = k;

        let digits = kN.toString().length;
        let params = this.getSIQSParams(digits);

        this.engine.emit('log', `[SIQS INITIATED] Target N routed to True SIQS. Multiplier k=${k}`, "sys");
        this.engine.emit('log', `[SIQS CONFIG] Factor Base: ${params.fbSize} | Sieve Limit M: ${params.M}`, "sys");

        this.engine.emit('updateStatus', "RUNNING", true, N.toString());
        this.engine.emit('showSIQSPanel', params.fbSize + 15);

        // Generate Factor Base using kN
        let FB = generateFactorBase(kN, params.fbSize);
        this.FB = FB;
        this.targetCount = FB.length + 15;

        let n_bytes = bigIntToBytesLE(N);
        let kn_bytes = bigIntToBytesLE(kN);
        let fb_arr = new Uint32Array(FB.map(f => f.p));
        this.wasmReducer = new wasm_bindgen.SiqsReducer(n_bytes, kn_bytes, fb_arr);

        // Dispatch tasks
        this.engine.workers.forEach(w => {
            w.postMessage({
                cmd: 'SIQS_FACTORIZE',
                target: N,
                kN: kN.toString(),
                params: {
                    fbSize: params.fbSize,
                    M: params.M,
                    sieveLimit: Math.max(params.M * 2, 10000),
                    maxWorkers: maxWorkers
                }
            });
        });
    }

    handleRelation(data) {
        if (!this.active || this.engine.activeTarget !== data.target) return;
        
        if (!this.partialRelations) this.partialRelations = new Map();

        // Check if it's a partial relation
        if (data.rel.largePrime) {
            let lp = data.rel.largePrime;
            if (this.partialRelations.has(lp)) {
                let r1 = this.partialRelations.get(lp);
                let r2 = data.rel;
                
                // Combine r1 and r2 into a full relation
                let kNBig = BigInt(this.engine.activeTarget) * this.k;
                let L = BigInt(lp);
                
                // V1 = A1 * x1^2 + 2 * B1 * x1 + C1? No, we need A1*x1 + B1
                // Actually the relation is: (A*x + B)^2 = A * (A*x^2 + 2Bx + C) mod kN
                // For combining partial relations (u1^2 = v1 * L mod N) and (u2^2 = v2 * L mod N)
                // (u1 * u2 * L^-1)^2 = v1 * v2 mod N
                
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
                    this.partialRelations.delete(lp);
                    
                    // We recursively process this synthesized relation
                    this.handleRelation({ target: data.target, rel: combinedRel, polyCount: data.polyCount });
                }
            } else {
                this.partialRelations.set(lp, data.rel);
            }
            return;
        }

        // Use BigInt representation to form a stable string-free signature where possible, or an optimized hash
        let sig = `${data.rel.x}-${data.rel.A}-${data.rel.B}`;
        if (!this.relationSignatures.has(sig)) {
            this.relationSignatures.add(sig);
            this.relations.push(data.rel);

            // Add relation to WASM reducer
            let nBig = BigInt(this.engine.activeTarget);
            let kNBig = nBig * this.k;
            let xBig = BigInt(data.rel.x);
            // Normalize x mod kN to avoid negative number serialization issues
            xBig = (xBig % kNBig + kNBig) % kNBig;

            let xBytes = bigIntToBytesLE(xBig);
            let bBytes = bigIntToBytesLE(BigInt(data.rel.B));
            let aBytes = data.rel.A ? bigIntToBytesLE(BigInt(data.rel.A)) : new Uint8Array(0);
            let factorsArr = new Uint32Array(data.rel.factors);
            this.wasmReducer.add_relation(data.rel.sign, xBytes, bBytes, aBytes, factorsArr);

            let speed = Math.round((this.relations.length / Math.max(1, Date.now() - this.startTime)) * 1000);
            this.engine.emit('updateSIQSProgress', this.relations.length, this.targetCount, data.polyCount, speed);

            if (this.relations.length >= this.targetCount && !this.isReducing) {
                this.isReducing = true;
                // Relations collected
                this.engine.emit('log', `[SIQS] Relationship collection complete. Relations: ${this.relations.length}`, "sys");
                this.engine.stopWorkers();

                setTimeout(() => this.reduceMatrix(), 10);
            }
        }
    }

    reduceMatrix() {
        if (!this.active || !this.engine.activeTarget) return;

        this.engine.emit('log', "[SIQS] Running WASM Bit-packed Gaussian Elimination & Evaluation...", "sys");
        this.engine.emit('updateStatus', "SIQS: Reducing Matrix (WASM)");

        let factorBytes = this.wasmReducer.reduce_matrix();
        let factor = factorBytes ? bytesToBigIntLE(factorBytes) : null;

        // Free WASM memory
        this.wasmReducer.free();

        if (factor && factor > 1n) {
            let f1 = gcd(factor, this.engine.activeTarget);
            if (f1 > 1n && f1 < this.engine.activeTarget) {
                let f2 = this.engine.activeTarget / f1;
                this.engine.emit('log', `[SIQS SUCCESS!] Found factors: ${f1.toString()} & ${f2.toString()}`, "success");

                this.engine.queue.push(f1);
                this.engine.queue.push(f2);

                this.active = false;
                this.engine.activeTarget = null;
                setTimeout(() => this.engine.processQueue(), 10);
                return;
            }
        }
        this.engine.emit('log', "[SIQS FAILURE] Dependencies exhausted without non-trivial factors. Falling back to ECM.", "error");
        // Fallback to ECM
        this.active = false;
        this.engine.emit('hideSIQSPanel');
        this.engine.emit('log', `[FALLBACK] Dispatching ${this.engine.activeTarget.toString()} to ECM Suite...`, 'sys');

        this.engine.activeWorkersCount = this.engine.maxWorkers;
        this.engine.workers.forEach(w => w.postMessage({
            cmd: 'FACTORIZE',
            target: this.engine.activeTarget,
            params: this.engine.currentParams
        }));
    }


}
