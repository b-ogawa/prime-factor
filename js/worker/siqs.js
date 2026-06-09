async function runParallelSIQS(target_N, kN, params, ctx) {
    let fbSize = params.fbSize;
    let M = params.M;
    let maxWorkers = params.maxWorkers || 8;
    let kN_Big = BigInt(kN);
    ctx.sendPhase("SIQS Core", "Generating FB...", true);
    let FB = generateFactorBase(kN_Big, fbSize);
    ctx.sendPhase("SIQS Core", "FB Size: " + FB.length, true);

    let sieve_size = 2 * M;
    let sieve = new Uint32Array(sieve_size);
    let polys_searched = 0;

    let digits = kN_Big.toString().length;
    let s = 1;
    if (digits >= 24) s = 2;
    if (digits >= 32) s = 3;
    if (digits >= 40) s = 4;
    if (digits >= 48) s = 5;
    if (digits >= 56) s = 6;
    if (digits >= 64) s = 7;

    let targetA = sqrtBigInt((2n * kN_Big) / BigInt(M));
    let q_indices = new Array(s).fill(0);
    let startIndex = Math.max(10, Math.floor(FB.length * 0.15)) + ctx.workerId;
    for(let i=0; i<s; i++) q_indices[i] = startIndex + i;

    let A_inv_p = new Int32Array(FB.length);
    let delta_x = new Array(s).fill(0).map(() => new Int32Array(FB.length));
    let x1_p = new Int32Array(FB.length);
    let x2_p = new Int32Array(FB.length);

    while (!ctx.shouldStop) {
        let A = 1n;
        for (let i = 0; i < s; i++) A *= BigInt(FB[q_indices[i]].p);

        let B_i_prime = new Array(s).fill(0n);
        let skipA = false;
        for (let i = 0; i < s; i++) {
            let q_i = BigInt(FB[q_indices[i]].p);
            let b_i = FB[q_indices[i]].r;
            let Q_i = A / q_i;

            let inv_res = extGCDInverse(Q_i % q_i, q_i);
            if (!inv_res.success) { skipA = true; break; }
            let gamma = (b_i * inv_res.value) % q_i;
            B_i_prime[i] = gamma * Q_i;
        }
        if (skipA) { q_indices[0]++; continue; }

        let B = 0n;
        for (let i = 0; i < s; i++) B = (B + B_i_prime[i]) % A;

        for (let j = 0; j < FB.length; j++) {
            let p_num = FB[j].p;
            let p = BigInt(p_num);
            let isFactorOfA = false;
            for (let i = 0; i < s; i++) {
                if (q_indices[i] === j) { isFactorOfA = true; break; }
            }
            if (isFactorOfA) { A_inv_p[j] = 0; continue; }

            let a_mod = A % p;
            let inv_res = extGCDInverse(a_mod, p);
            if (!inv_res.success) { A_inv_p[j] = 0; continue; }
            let a_inv = inv_res.value;
            A_inv_p[j] = Number(a_inv);

            let B_mod = B % p;
            let x1 = (a_inv * (FB[j].r - B_mod + p)) % p;
            let x2 = (a_inv * (-FB[j].r - B_mod + 2n * p)) % p;

            let start1 = Number((x1 + BigInt(M)) % p);
            let start2 = Number((x2 + BigInt(M)) % p);
            x1_p[j] = start1; x2_p[j] = start2;

            for (let k = 1; k < s; k++) {
                let d_B = (2n * B_i_prime[k]) % p;
                delta_x[k][j] = Number((a_inv * d_B) % p);
            }
        }

        let nu = new Int8Array(s).fill(1);
        let polysInA = 1 << (s - 1);

        for (let polyIdx = 0; polyIdx < polysInA; polyIdx++) {
            if (ctx.shouldStop) break;
            polys_searched++;
            if (polys_searched % 1000 === 0) { ctx.sendPhase("SIQS Sieving", "Polys: " + polys_searched); await ctx.yieldIfNeeded(); }

            if (polyIdx > 0) {
                let k = 1;
                let temp = polyIdx;
                while ((temp & 1) === 0) { k++; temp >>= 1; }
                nu[k] = -nu[k];
                if (nu[k] === -1) {
                    B = (B - 2n * B_i_prime[k]) % A; if (B < 0n) B += A;
                    for (let j = 0; j < FB.length; j++) {
                        if (A_inv_p[j] === 0) continue;
                        let dx = delta_x[k][j];
                        x1_p[j] += dx; if (x1_p[j] >= FB[j].p) x1_p[j] -= FB[j].p;
                        x2_p[j] += dx; if (x2_p[j] >= FB[j].p) x2_p[j] -= FB[j].p;
                    }
                } else {
                    B = (B + 2n * B_i_prime[k]) % A;
                    for (let j = 0; j < FB.length; j++) {
                        if (A_inv_p[j] === 0) continue;
                        let dx = delta_x[k][j];
                        x1_p[j] -= dx; if (x1_p[j] < 0) x1_p[j] += FB[j].p;
                        x2_p[j] -= dx; if (x2_p[j] < 0) x2_p[j] += FB[j].p;
                    }
                }
            }

            let C = (B * B - kN_Big) / A;
            sieve.fill(0);

            for (let j = 0; j < FB.length; j++) {
                if (A_inv_p[j] === 0) continue;
                let p = FB[j].p, log_p = FB[j].log;
                for (let idx = x1_p[j]; idx < sieve_size; idx += p) sieve[idx] += log_p;
                if (p > 2) {
                    for (let idx = x2_p[j]; idx < sieve_size; idx += p) sieve[idx] += log_p;
                }
            }
            let log2_A = A.toString(2).length - 1;
            let buffer = Math.round(Math.log2(FB[FB.length - 1].p) * 1.0 * 8);
            let threshold = Math.round((log2_A + 2 * Math.log2(M)) * 8) - buffer;
            let smooth_candidates = new Int32Array(256);
            let candidate_count = 0;

            for (let i = 0; i < sieve_size; i++) {
                if (sieve[i] >= threshold) {
                    smooth_candidates[candidate_count++] = i;
                    if (candidate_count === 256) break;
                }
            }

            for (let c_idx = 0; c_idx < candidate_count; c_idx++) {
                let i = smooth_candidates[c_idx];
                let x = BigInt(i - M);
                let val = A * x * x + 2n * B * x + C;
                let temp = val < 0n ? -val : val;
                let sign = val < 0n ? -1 : 1;
                let factors = [];

                for (let j = 0; j < FB.length; j++) {
                    let p = BigInt(FB[j].p);
                    while (temp % p === 0n) {
                        factors.push(j);
                        temp /= p;
                    }
                }
                if (temp === 1n) {
                    for (let k = 0; k < s; k++) factors.push(q_indices[k]);

                    let valid = true;
                    // factors are now indices, max valid index is FB.length - 1
                    for (let fIdx of factors) {
                        if (fIdx >= FB.length) { valid = false; break; }
                    }
                    if (valid) {
                        postMessage({
                            type: "RELATION_FOUND",
                            target: target_N,
                            rel: { x: x.toString(), B: B.toString(), A: A.toString(), sign: sign, factors: factors },
                            polyCount: polys_searched
                        });
                    }
                }
            }
        }

        let j = s - 1;
        while (j >= 0 && q_indices[j] >= FB.length - s + j) {
            j--;
        }
        if (j < 0) {
            ctx.shouldStop = true;
            break;
        } else {
            if (j === 0) {
                q_indices[0] += maxWorkers;
                if (q_indices[0] + s - 1 >= FB.length) {
                    ctx.shouldStop = true;
                    break;
                }
            } else {
                q_indices[j]++;
            }
            for (let k = j + 1; k < s; k++) {
                q_indices[k] = q_indices[k - 1] + 1;
            }
        }
    }
}
