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

        // Use BigInt representation to form a stable string-free signature where possible, or an optimized hash
        let sig = `${data.rel.x}-${data.rel.A}-${data.rel.B}`;
        if (!this.relationSignatures.has(sig)) {
            this.relationSignatures.add(sig);
            this.relations.push(data.rel);

            let speed = Math.round((this.relations.length / Math.max(1, Date.now() - this.startTime)) * 1000);
            this.engine.emit('updateSIQSProgress', this.relations.length, this.targetCount, data.polyCount, speed);

            if (this.relations.length >= this.targetCount) {
                // Relations collected
                this.engine.emit('log', `[SIQS] Relationship collection complete. Relations: ${this.relations.length}`, "sys");
                this.engine.stopWorkers();

                setTimeout(() => this.reduceMatrix(), 10);
            }
        }
    }

    reduceMatrix() {
        if (!this.active || !this.engine.activeTarget) return;

        this.engine.emit('log', "[SIQS] Running Bit-packed Gaussian Elimination on binary matrix...", "sys");
        this.engine.emit('updateStatus', "SIQS: Reducing Matrix");

        let deps = this.solveMatrixBitpacked();
        this.engine.emit('log', `[SIQS] Found ${deps.length} linear dependencies. Testing modular square roots...`, "sys");

        let factor = this.evaluateDependencies(deps);

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

    // Bit-packed Gaussian Elimination
    solveMatrixBitpacked() {
        let numCols = this.FB.length + 1; // Col 0: Sign, Col 1..: FB Primes
        let numRows = this.relations.length;
        let words = Math.ceil(numCols / 32);

        // No Col Mapping needed since factors are now FB indices directly!
        // Index -1 represents the sign.

        let M = [];
        let ID = [];

        let idWords = Math.ceil(numRows / 32);

        for (let i = 0; i < numRows; i++) {
            let r = new Uint32Array(words);
            let id = new Uint32Array(idWords);
            id[Math.floor(i / 32)] |= (1 << (i % 32)); // Identity element

            let rel = this.relations[i];
            if (rel.sign === -1) r[0] |= 1; // Sign index

            for (let fIdx of rel.factors) {
                let colIdx = fIdx + 1; // +1 because col 0 is the sign
                let wIdx = Math.floor(colIdx / 32);
                let bIdx = colIdx % 32;
                r[wIdx] ^= (1 << bIdx); // mod 2 addition
            }
            M.push(r);
            ID.push(id);
        }

        let numPivots = 0;
        for (let c = 0; c < numCols; c++) {
            let wIdx = Math.floor(c / 32);
            let bIdx = c % 32;

            let r = -1;
            for (let i = numPivots; i < numRows; i++) {
                if ((M[i][wIdx] & (1 << bIdx)) !== 0) {
                    r = i; break;
                }
            }
            if (r !== -1) {
                // Row Swap
                let tempM = M[numPivots]; M[numPivots] = M[r]; M[r] = tempM;
                let tempID = ID[numPivots]; ID[numPivots] = ID[r]; ID[r] = tempID;

                // Elimination
                for (let i = 0; i < numRows; i++) {
                    if (i !== numPivots) {
                        if ((M[i][wIdx] & (1 << bIdx)) !== 0) {
                            for (let w = 0; w < words; w++) M[i][w] ^= M[numPivots][w];
                            for (let w = 0; w < idWords; w++) ID[i][w] ^= ID[numPivots][w];
                        }
                    }
                }
                numPivots++;
            }
        }

        // Collect Dependencies
        let dependencies = [];
        for (let i = numPivots; i < numRows; i++) {
            let dep = [];
            for (let j = 0; j < numRows; j++) {
                if ((ID[i][Math.floor(j / 32)] & (1 << (j % 32))) !== 0) {
                    dep.push(j);
                }
            }
            if (dep.length > 0) dependencies.push(dep);
        }
        return dependencies;
    }

    // Solve dependencies
    evaluateDependencies(deps) {
        if (!this.engine.activeTarget) return null;
        let N_big = BigInt(this.engine.activeTarget);
        for (let d = 0; d < deps.length; d++) {
            let dep = deps[d];
            let X = 1n;

            // Exponent trackers
            let exponentSum = new Int32Array(this.FB.length + 1); // index 0 is sign, 1..FB.length are primes

            for (let idx of dep) {
                let rel = this.relations[idx];
                let relX = BigInt(rel.x);
                let relB = BigInt(rel.B);

                let relA = 1n;
                if (rel.A !== undefined && rel.A !== null && rel.A !== "") {
                    relA = BigInt(rel.A);
                }
                let term = (relA * relX + relB) % N_big;
                if (term < 0n) term += N_big;
                X = (X * term) % N_big;

                if (rel.sign === -1 || rel.sign === "-1") exponentSum[0]++;
                for (let fIdx of rel.factors) {
                    exponentSum[fIdx + 1]++;
                }
            }

            // Verify and compute square root Y
            let Y = 1n;
            let success = true;
            for (let i = 1; i <= this.FB.length; i++) {
                let count = exponentSum[i];
                if (count % 2 !== 0) {
                    success = false; break; // odd exponent detected
                }
                if (count > 0) {
                    let half = BigInt(Math.floor(count / 2));
                    let prime = BigInt(this.FB[i - 1].p);
                    Y = (Y * powMod(prime, half, N_big)) % N_big;
                }
            }
            if (!success) continue;

            // GCD check
            let diff = (X - Y) % N_big;
            if (diff < 0n) diff += N_big;
            let g = gcd(diff, N_big);
            if (g > 1n && g < N_big) return g;

            let sum = (X + Y) % N_big;
            if (sum < 0n) sum += N_big;
            g = gcd(sum, N_big);
            if (g > 1n && g < N_big) return g;
        }
        return null;
    }
}