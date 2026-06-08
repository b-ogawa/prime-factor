// Main Thread (UI & Coordinator)

        // UI Elements
        const consoleLogEl = document.getElementById('consoleLog');
        const factorsContainer = document.getElementById('factorsContainer');
        const equationDisplay = document.getElementById('equationDisplay');
        const statTimer = document.getElementById('statTimer');
        const statTarget = document.getElementById('statTarget');
        const statFactorCount = document.getElementById('statFactorCount');
        const engineStatusText = document.getElementById('engineStatusText');
        const coreIndicator = document.getElementById('coreIndicator');
        const btnStart = document.getElementById('btnStart');
        const btnStop = document.getElementById('btnStop');
        const engineModeEl = document.getElementById('engineMode');

        // SIQS UI Elements
        const siqsProgressPanel = document.getElementById('siqsProgressPanel');
        const siqsRelRatio = document.getElementById('siqsRelRatio');
        const siqsProgressBar = document.getElementById('siqsProgressBar');
        const siqsPolyCount = document.getElementById('siqsPolyCount');
        const siqsRelSpeed = document.getElementById('siqsRelSpeed');

        // Engine State
        let state = {
            factors: [],
            unresolved: [],
            startTime: null,
            timerInterval: null
        };

        let workers = [];
        let maxWorkers = Math.max(1, (navigator.hardwareConcurrency || 4));
        document.getElementById('coreCount').innerText = `${maxWorkers} THREADS`;

        let isRunning = false;
        let queue = [];
        let activeTarget = null;
        let activeWorkersCount = 0;
        let currentParams = {};

        // SIQS Coordinator State
        let siqsState = {
            active: false,
            FB: [],
            relations: [],
            polyCounter: 0,
            startTime: null,
            targetCount: 0
        };

        function formatBigInt(n, maxLen = 30) {
            let str = n.toString();
            if (str.length <= maxLen) return str;
            return str.substring(0, 15) + "..." + str.substring(str.length - 15) + " (" + str.length + " digits)";
        }

        function log(message, type = "default") {
            const timeStr = new Date().toLocaleTimeString();
            let colorClass = "text-slate-600";
            if (type === "success") colorClass = "text-emerald-600 font-bold";
            else if (type === "error") colorClass = "text-rose-600 font-bold";
            else if (type === "warning") colorClass = "text-amber-600";
            else if (type === "info") colorClass = "text-blue-600";
            else if (type === "sys") colorClass = "text-slate-800 font-semibold";

            const logLine = document.createElement('div');
            logLine.className = `py-0.5 border-b border-slate-100/60 font-mono text-[11px] ${colorClass}`;
            logLine.innerHTML = `<span class="text-slate-400 select-none mr-2">[${timeStr}]</span>${message}`;
            consoleLogEl.appendChild(logLine);
            consoleLogEl.scrollTop = consoleLogEl.scrollHeight;
        }

        function updateStatus(status, active = true) {
            engineStatusText.innerText = status;
            if (active) {
                engineStatusText.className = "font-mono text-sm font-bold text-emerald-500 animate-pulse";
                coreIndicator.className = "w-1.5 h-1.5 rounded-full bg-emerald-500 pulse-dot";
            } else {
                engineStatusText.className = "font-mono text-sm font-bold text-slate-500";
                coreIndicator.className = "w-1.5 h-1.5 rounded-full bg-slate-400";
                statTarget.innerText = "-";
            }
        }

        // Core UI Status
        function initCoreUI() {
            const container = document.getElementById('coreActivityContainer');
            if (!container) return;
            container.innerHTML = '';
            for (let i = 0; i < maxWorkers; i++) {
                let el = document.createElement('div');
                el.id = `core-stat-${i}`;
                el.className = "font-mono text-xs text-slate-300 bg-slate-800/50 rounded px-2 py-1.5 flex items-center shadow-inner border border-slate-700/50";
                el.innerHTML = `<span class="text-slate-500 w-14 inline-block font-bold">CORE ${i}</span> <div class="flex-1 truncate"><span class="font-bold text-slate-500">IDLE</span></div>`;
                container.appendChild(el);
            }
        }

        function updateCoreStatus(id, phase, detail) {
            let el = document.getElementById(`core-stat-${id}`);
            if (el) {
                let phaseStr = phase === 'IDLE' ? '<span class="text-slate-500">IDLE</span>' : `<span class="text-emerald-400">${phase}</span>`;
                let detailStr = detail ? `<span class="text-slate-400 text-[10px] ml-2">${detail}</span>` : '';
                el.innerHTML = `<span class="text-slate-500 w-14 inline-block font-bold">CORE ${id}</span> <div class="flex-1 truncate"><span class="font-bold">${phaseStr}</span>${detailStr}</div>`;
            }
        }

        function resetCoreUI() {
            for (let i = 0; i < maxWorkers; i++) updateCoreStatus(i, 'IDLE', '');
        }

        function renderFactors() {
            factorsContainer.innerHTML = '';

            let allParsed = [
                ...state.factors.map(f => ({ val: f, prime: true })),
                ...state.unresolved.map(f => ({ val: f, prime: false }))
            ];

            if (allParsed.length === 0) {
                factorsContainer.innerHTML = `<div class="text-center py-8 text-slate-400 text-xs font-mono">No factors yet.</div>`;
                equationDisplay.innerText = "No active data.";
                statFactorCount.innerText = "0";
                return;
            }

            allParsed.sort((a, b) => (a.val < b.val ? -1 : a.val > b.val ? 1 : 0));
            let groups = [];
            for (let item of allParsed) {
                let existing = groups.find(g => g.val === item.val);
                if (existing) existing.count++;
                else groups.push({ val: item.val, prime: item.prime, count: 1 });
            }

            statFactorCount.innerText = allParsed.length.toString();

            groups.forEach(g => {
                const el = document.createElement('div');
                el.className = "bg-slate-50 border border-slate-200 rounded p-2 flex justify-between items-center text-xs";
                const typeBadge = g.prime
                    ? `<span class="text-[9px] font-mono font-bold text-emerald-600 uppercase">Prime</span>`
                    : `<span class="text-[9px] font-mono font-bold text-rose-500 uppercase">Composite</span>`;

                el.innerHTML = `
                    <div class="flex flex-col max-w-[80%] font-mono">
                        <div class="flex items-center gap-2 mb-0.5">${typeBadge} <span class="text-slate-400 text-[10px]">${g.val.toString().length} digits</span></div>
                        <span class="text-slate-800 break-all text-xs font-semibold">${g.val.toString()}${g.count > 1 ? ` <span class="text-emerald-600">^ ${g.count}</span>` : ''}</span>
                    </div>
                `;
                factorsContainer.appendChild(el);
            });

            let equationTerms = groups.map(g => {
                let term = g.val.toString();
                if (g.count > 1) term += `^${g.count}`;
                return g.prime ? term : `[${term}]`;
            });
            equationDisplay.innerText = equationTerms.join(" × ");
        }

        // Main Thread Math Helpers
        function gcd(a, b) {
            a = a < 0n ? -a : a; b = b < 0n ? -b : b;
            while (b > 0n) { let temp = b; b = a % b; a = temp; }
            return a;
        }

        function extGCDInverse(a, m) {
            a = (a % m + m) % m;
            let x0 = 1n, y0 = 0n, x1 = 0n, y1 = 1n;
            let b = m;
            while (b !== 0n) {
                let q = a / b; let r = a % b;
                a = b; b = r;
                let x2 = x0 - q * x1, y2 = y0 - q * y1;
                x0 = x1; x1 = x2; y0 = y1; y1 = y2;
            }
            if (a === 1n) return { success: true, value: (x0 % m + m) % m };
            else return { success: false, factor: a };
        }

        function powMod(base, exp, mod) {
            let res = 1n;
            base = base % mod;
            while (exp > 0n) {
                if (exp & 1n) res = (res * base) % mod;
                base = (base * base) % mod;
                exp >>= 1n;
            }
            return res;
        }

        function isPrime(n) {
            if (n < 2) return false;
            if (n === 2 || n === 3) return true;
            if (n % 2 === 0 || n % 3 === 0) return false;
            for (let i = 5; i * i <= n; i += 6) {
                if (n % i === 0 || n % (i + 2) === 0) return false;
            }
            return true;
        }

        // SIQS Parameters Table
        function getSIQSParams(digits) {
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

        function generateFBOnMain(N, size) {
            let fb = [{ p: 2, r: 1n }];
            let candidate = 3;
            let N_bi = BigInt(N);
            while (fb.length < size) {
                if (isPrime(candidate)) {
                    let p_bi = BigInt(candidate);
                    if (jacobi(N_bi, p_bi) === 1n) {
                        let r = tonelliShanks(N_bi, p_bi);
                        if (r !== null) {
                            fb.push({ p: candidate, r: r });
                        }
                    }
                }
                candidate += 2;
            }
            return fb;
        }

        function jacobi(a, n) {
            a = (a % n + n) % n;
            let t = 1n;
            while (a !== 0n) {
                while (a % 2n === 0n) {
                    a /= 2n;
                    let r = n % 8n;
                    if (r === 3n || r === 5n) t = -t;
                }
                let temp = a; a = n; n = temp;
                if (a % 4n === 3n && n % 4n === 3n) t = -t;
                a %= n;
            }
            return n === 1n ? t : 0n;
        }

        function legendre(a, p) {
            if (p === 2n) return 1;
            let val = powMod(a, (p - 1n) >> 1n, p);
            if (val === 0n) return 0;
            if (val === p - 1n) return -1;
            return 1;
        }

        function tonelliShanks(n, p) {
            let n_mod = n % p;
            if (n_mod === 0n) return 0n;
            if (p === 2n) return n_mod;
            if (legendre(n_mod, p) !== 1) return null;
            if (p % 4n === 3n) return powMod(n_mod, (p + 1n) >> 2n, p);
            let s = 0n, q = p - 1n;
            while (q % 2n === 0n) { s++; q /= 2n; }
            let z = 2n;
            while (legendre(z, p) !== -1) z++;
            let c = powMod(z, q, p);
            let r = powMod(n_mod, (q + 1n) >> 1n, p);
            let t = powMod(n_mod, q, p);
            let m = s;
            while (t !== 1n) {
                let tempT = t, i = 0n;
                while (tempT !== 1n && i < m) { tempT = (tempT * tempT) % p; i++; }
                if (i === m) return null;
                let b = powMod(c, 1n << (m - i - 1n), p);
                r = (r * b) % p;
                c = (b * b) % p;
                t = (t * c) % p;
                m = i;
            }
            return r;
        }

        // Bit-packed Gaussian Elimination
        function solveMatrixBitpacked(relations, FB) {
            let numCols = FB.length + 1; // Col 0: Sign, Col 1..: FB Primes
            let numRows = relations.length;
            let words = Math.ceil(numCols / 32);

            // Col Mapping
            let colMap = {};
            colMap[-1] = 0; // Sign
            for (let j = 0; j < FB.length; j++) {
                colMap[FB[j].p] = j + 1;
            }

            let M = [];
            let ID = [];

            let idWords = Math.ceil(numRows / 32);

            for (let i = 0; i < numRows; i++) {
                let r = new Uint32Array(words);
                let id = new Uint32Array(idWords);
                id[Math.floor(i / 32)] |= (1 << (i % 32)); // Identity element

                let rel = relations[i];
                if (rel.sign === -1) r[0] |= 1; // Sign index

                for (let fStr of rel.factors) {
                    let colIdx = colMap[fStr];
                    if (colIdx !== undefined) {
                        let wIdx = Math.floor(colIdx / 32);
                        let bIdx = colIdx % 32;
                        r[wIdx] ^= (1 << bIdx); // mod 2 addition
                    }
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
        function evaluateDependencies(deps, relations, FB, N) {
            let N_big = BigInt(N);
            for (let d = 0; d < deps.length; d++) {
                let dep = deps[d];
                let X = 1n;
                let exponentSum = {};

                // Exponent trackers
                exponentSum[-1] = 0;
                for (let p of FB) exponentSum[String(p.p)] = 0;

                for (let idx of dep) {
                    let rel = relations[idx];
                    let relX = BigInt(rel.x);
                    let relB = BigInt(rel.B);

                    let relA = 1n;
                    if (rel.A !== undefined && rel.A !== null) {
                        relA = BigInt(rel.A);
                    }
                    let term = (relA * relX + relB) % N_big;
                    if (term < 0n) term += N_big;
                    X = (X * term) % N_big;

                    if (rel.sign === -1 || rel.sign === "-1") exponentSum[-1]++;
                    for (let fStr of rel.factors) {
                        let f = String(fStr);
                        exponentSum[f] = (exponentSum[f] || 0) + 1;
                    }
                }

                // Verify and compute square root Y
                let Y = 1n;
                let success = true;
                for (let f in exponentSum) {
                    let count = Number(exponentSum[f]);
                    if (count % 2 !== 0) {
                        success = false; break; // odd exponent detected
                    }
                    if (count > 0) {
                        let half = BigInt(Math.floor(count / 2));
                        let prime = BigInt(f);
                        if (prime === -1n) continue; // sign square root
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

        // Worker Coordinator
        function initWorkers() {
            let sLimit = Math.max(parseInt(document.getElementById('paramTrialLimit').value), parseInt(document.getElementById('paramB1').value) * 50, 10000);

            initCoreUI();

            for (let i = 0; i < maxWorkers; i++) {
                let w = new Worker('js/worker.js');
                w.onmessage = handleWorkerMessage;
                w.postMessage({
                    cmd: 'INIT', workerId: i,
                    params: { sieveLimit: sLimit }
                });
                workers.push(w);
            }
        }

        function handleWorkerMessage(e) {
            if (!isRunning) return;
            const data = e.data;

            if (data.type === 'PHASE_UPDATE') {
                updateCoreStatus(data.workerId, data.phase, data.detail);
            }
            else if (data.type === 'LOG') {
                if (data.level === 'sys' || data.level === 'error') {
                    log(`[Core ${data.workerId}] ${data.msg}`, data.level);
                }
            }
            else if (data.type === 'PRIME_FOUND') {
                if (activeTarget === data.target) {
                    log(`[PRIME CONFIRMED] ${formatBigInt(data.target)}`, 'success');
                    state.factors.push(data.target);
                    renderFactors();
                    activeTarget = null;
                    stopAllWorkersAndResume();
                }
            }
            else if (data.type === 'FACTOR_FOUND') {
                if (activeTarget === data.target) {
                    let f1 = BigInt(data.factor);
                    let f2 = activeTarget / f1;
                    log(`[FACTOR DISCOVERED] Found by Core ${data.workerId} via ${data.method}: ${formatBigInt(f1)}`, 'success');
                    queue.push(f1);
                    queue.push(f2);
                    activeTarget = null;
                    stopAllWorkersAndResume();
                }
            }
            else if (data.type === 'EXHAUSTED') {
                if (activeTarget === data.target) {
                    activeWorkersCount--;
                    if (activeWorkersCount === 0) {
                        log(`[BOUND EXHAUSTED] All cores failed to factor: ${formatBigInt(data.target)}`, 'error');
                        state.unresolved.push(data.target);
                        renderFactors();
                        activeTarget = null;
                        stopAllWorkersAndResume();
                    }
                }
            }
            else if (data.type === 'RELATION_FOUND') {
                // SIQS Relation Handler
                if (siqsState.active && activeTarget === data.target) {
                    let sig = data.rel.x + "|" + data.rel.A + "|" + data.rel.B;
                    if (!siqsState.relationSignatures.has(sig)) {
                        siqsState.relationSignatures.add(sig);
                        siqsState.relations.push(data.rel);

                        let speed = Math.round((siqsState.relations.length / Math.max(1, Date.now() - siqsState.startTime)) * 1000);
                        siqsRelRatio.innerText = `${siqsState.relations.length} / ${siqsState.targetCount}`;
                        siqsProgressBar.style.width = `${Math.min(100, (siqsState.relations.length / siqsState.targetCount) * 100)}%`;
                        siqsPolyCount.innerText = data.polyCount;
                        siqsRelSpeed.innerText = speed;

                        if (siqsState.relations.length >= siqsState.targetCount) {
                            // Relations collected
                            log(`[SIQS] Relationship collection complete. Relations: ${siqsState.relations.length}`, "sys");
                            workers.forEach(w => w.postMessage({ cmd: 'STOP' }));

                            setTimeout(reduceSIQSMatrix, 10);
                        }
                    }
                }
            }
        }

        // Coordinator
        function stopAllWorkersAndResume() {
            resetCoreUI();
            workers.forEach(w => w.postMessage({ cmd: 'STOP' }));
            setTimeout(processQueue, 10);
        }

        function processQueue() {
            if (!isRunning) return;

            if (activeTarget === null) {
                if (queue.length === 0) {
                    isRunning = false;
                    stopTimer();
                    updateStatus("COMPLETED", false);
                    resetCoreUI();
                    log("[PROCESS COMPLETE] Factorization tree successfully resolved.", "success");
                    setButtonsIdle();
                    siqsProgressPanel.classList.add('hidden');
                    return;
                }

                queue.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
                activeTarget = queue.shift();

                while (activeTarget % 2n === 0n) {
                    state.factors.push(2n);
                    activeTarget /= 2n;
                    log(`[FACTOR DISCOVERED] 2`, 'success');
                    renderFactors();
                }
                if (activeTarget === 1n) {
                    activeTarget = null;
                    processQueue();
                    return;
                }

                let targetDigits = activeTarget.toString().length;
                let mode = engineModeEl.value;

                // Route
                if (mode === 'siqs' || (mode === 'auto' && targetDigits >= 24 && targetDigits <= 65)) {
                    runSIQSPipeline(activeTarget);
                } else {
                    // Fallback Suite
                    siqsProgressPanel.classList.add('hidden');
                    log(`[BROADCASTING TASK] Dispatching ${formatBigInt(activeTarget)} to BPSW/ECM Suite...`, 'sys');
                    statTarget.innerText = activeTarget.toString();
                    activeWorkersCount = maxWorkers;

                    workers.forEach(w => w.postMessage({
                        cmd: 'FACTORIZE',
                        target: activeTarget,
                        params: currentParams
                    }));
                }
            }
        }

        // Knuth-Schroeppel Multiplier Selection
        function chooseMultiplier(N) {
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

        // SIQS Pipeline
        function runSIQSPipeline(N) {
            siqsState.active = true;
            siqsState.relations = [];
            siqsState.relationSignatures = new Set();
            siqsState.startTime = Date.now();

            let k = chooseMultiplier(N);
            let kN = N * k;
            siqsState.k = k;

            let digits = kN.toString().length;
            let params = getSIQSParams(digits);

            log(`[SIQS INITIATED] Target N routed to True SIQS. Multiplier k=${k}`, "sys");
            log(`[SIQS CONFIG] Factor Base: ${params.fbSize} | Sieve Limit M: ${params.M}`, "sys");

            statTarget.innerText = N.toString();
            siqsProgressPanel.classList.remove('hidden');
            siqsRelRatio.innerText = `0 / ${params.fbSize + 15}`;
            siqsProgressBar.style.width = "0%";

            // Generate Factor Base using kN
            let FB = generateFBOnMain(kN, params.fbSize);
            siqsState.FB = FB;
            siqsState.targetCount = FB.length + 15;

            // Dispatch tasks
            workers.forEach(w => {
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

        function reduceSIQSMatrix() {
            log("[SIQS] Running Bit-packed Gaussian Elimination on binary matrix...", "sys");
            updateStatus("SIQS: Reducing Matrix");

            let deps = solveMatrixBitpacked(siqsState.relations, siqsState.FB);
            log(`[SIQS] Found ${deps.length} linear dependencies. Testing modular square roots...`, "sys");

            let factor = evaluateDependencies(deps, siqsState.relations, siqsState.FB, activeTarget);

            if (factor && factor > 1n) {
                let f1 = gcd(factor, activeTarget);
                if (f1 > 1n && f1 < activeTarget) {
                    let f2 = activeTarget / f1;
                    log(`[SIQS SUCCESS!] Found factors: ${formatBigInt(f1)} & ${formatBigInt(f2)}`, "success");

                    queue.push(f1);
                    queue.push(f2);

                    siqsState.active = false;
                    activeTarget = null;
                    setTimeout(processQueue, 10);
                    return;
                }
            }
            log("[SIQS FAILURE] Dependencies exhausted without non-trivial factors. Falling back to ECM.", "error");
            // Fallback to ECM
            siqsState.active = false;
            siqsProgressPanel.classList.add('hidden');
            log(`[FALLBACK] Dispatching ${formatBigInt(activeTarget)} to ECM Suite...`, 'sys');

            activeWorkersCount = maxWorkers;
            workers.forEach(w => w.postMessage({
                cmd: 'FACTORIZE',
                target: activeTarget,
                params: currentParams
            }));
        }

        // Controls
        function startTimer() {
            state.startTime = Date.now();
            statTimer.innerText = "00:00.0";
            state.timerInterval = setInterval(() => {
                let diff = Date.now() - state.startTime;
                let min = Math.floor(diff / 60000).toString().padStart(2, '0');
                let sec = Math.floor((diff % 60000) / 1000).toString().padStart(2, '0');
                let ms = Math.floor((diff % 1000) / 100).toString();
                statTimer.innerText = `${min}:${sec}.${ms}`;
            }, 100);
        }

        function stopTimer() { clearInterval(state.timerInterval); }

        function setButtonsRunning() {
            btnStart.disabled = true;
            btnStart.className = "flex-1 py-2.5 bg-slate-100 text-slate-400 border border-slate-200 rounded-lg font-medium text-xs cursor-not-allowed font-mono";
            btnStop.disabled = false;
            btnStop.className = "py-2.5 px-4 bg-rose-600 hover:bg-rose-700 text-white font-medium text-xs rounded-lg transition-all font-mono shadow-sm";
        }

        function setButtonsIdle() {
            btnStart.disabled = false;
            btnStart.className = "flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-white font-medium text-xs rounded-lg transition-all font-mono shadow-sm";
            btnStop.disabled = true;
            btnStop.className = "py-2.5 px-4 bg-slate-100 text-slate-400 border border-slate-200 rounded-lg font-medium text-xs cursor-not-allowed font-mono";
        }

        btnStart.addEventListener('click', () => {
            let inputStr = document.getElementById('numberInput').value.trim().replace(/\s/g, '');
            if (!inputStr) return log("[Input Error] No numerical data present.", "error");

            let targetBig;
            try { targetBig = BigInt(inputStr); }
            catch (e) { return log("[Input Error] Invalid character detection.", "error"); }
            if (targetBig <= 1n) return log("[Input Error] N must be an integer > 1.", "error");

            currentParams = {
                trialLimit: parseInt(document.getElementById('paramTrialLimit').value) || 0,
                b1: parseInt(document.getElementById('paramB1').value) || 0,
                p1Limit: parseInt(document.getElementById('paramP1Limit').value) || 0,
                rhoLimit: parseInt(document.getElementById('paramRhoLimit').value) || 0,
                maxCurves: parseInt(document.getElementById('paramMaxCurves').value) || 0
            };

            state.factors = [];
            state.unresolved = [];
            renderFactors();

            queue = [targetBig];
            activeTarget = null;
            isRunning = true;

            setButtonsRunning();
            updateStatus("RUNNING", true);
            log(`[SYSTEM START] Factorization target: ${formatBigInt(targetBig)}`, "sys");

            startTimer();
            processQueue();
        });

        btnStop.addEventListener('click', () => {
            if (isRunning) {
                isRunning = false;
                siqsState.active = false;
                workers.forEach(w => w.postMessage({ cmd: 'STOP' }));
                stopTimer();
                updateStatus("ABORTED", false);
                resetCoreUI();
                log("[USER ABORT] Sent halt signal to all worker threads.", "error");
                setButtonsIdle();
                siqsProgressPanel.classList.add('hidden');

                if (activeTarget !== null) {
                    state.unresolved.push(activeTarget);
                    renderFactors();
                }
            }
        });

        document.getElementById('btnClear').addEventListener('click', () => {
            if (isRunning) return log("[System Lock] Cannot clear memory while engine is active.", "warning");
            state.factors = []; state.unresolved = []; queue = []; activeTarget = null;
            renderFactors();
            resetCoreUI();
            consoleLogEl.innerHTML = `<div class="text-slate-400 font-mono text-[11px]">&gt; Memory buffers flushed.</div>`;
            statTimer.innerText = "00:00.0"; statTarget.innerText = "-";
            siqsProgressPanel.classList.add('hidden');
        });

        document.getElementById('numberInput').addEventListener('input', function () {
            let val = this.value.replace(/\D/g, '');
            document.getElementById('digitCounter').innerText = `${val.length} digits`;
        });

        window.onload = () => {
            initWorkers();
        };