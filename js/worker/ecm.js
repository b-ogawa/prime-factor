// Montgomery ECM
function xAdd_mont_inplace(R0, R1, Xdiff, Zdiff, mont, dest) {
    let t1 = mont.sub(R0[0], R0[1]), t2 = mont.add(R1[0], R1[1]);
    let t3 = mont.add(R0[0], R0[1]), t4 = mont.sub(R1[0], R1[1]);
    let t5 = mont.mul(t1, t2), t6 = mont.mul(t3, t4);
    let t7 = mont.add(t5, t6), t8 = mont.sub(t5, t6);
    dest[0] = mont.mul(Zdiff, mont.mul(t7, t7));
    dest[1] = mont.mul(Xdiff, mont.mul(t8, t8));
}

function xAdd_mont_inplace_Z1(R0, R1, Xdiff, mont, dest) {
    let t1 = mont.sub(R0[0], R0[1]), t2 = mont.add(R1[0], R1[1]);
    let t3 = mont.add(R0[0], R0[1]), t4 = mont.sub(R1[0], R1[1]);
    let t5 = mont.mul(t1, t2), t6 = mont.mul(t3, t4);
    let t7 = mont.add(t5, t6), t8 = mont.sub(t5, t6);
    dest[0] = mont.mul(t7, t7);
    dest[1] = mont.mul(Xdiff, mont.mul(t8, t8));
}

function xDbl_mont_inplace(R, a24, mont, dest) {
    let t1 = mont.add(R[0], R[1]), t2 = mont.sub(R[0], R[1]);
    let t3 = mont.mul(t1, t1), t4 = mont.mul(t2, t2);
    let t5 = mont.sub(t3, t4);
    dest[0] = mont.mul(t3, t4);
    let temp = mont.add(t4, mont.mul(a24, t5));
    dest[1] = mont.mul(t5, temp);

}

function montgomeryLadder_mont(k, X, Z, a24, mont) {
    let R0 = [mont.one, 0n], R1 = [X, Z];
    let kBin = k.toString(2);
    R0[0] = X; R0[1] = Z;
    xDbl_mont_inplace(R0, a24, mont, R1);
    let next_R0 = [0n, 0n], next_R1 = [0n, 0n];
    let isZ1 = (Z === mont.one);
    for (let i = 1; i < kBin.length; i++) {
        if (kBin[i] === "1") {
            if (isZ1) xAdd_mont_inplace_Z1(R0, R1, X, mont, next_R0);
            else xAdd_mont_inplace(R0, R1, X, Z, mont, next_R0);
            xDbl_mont_inplace(R1, a24, mont, next_R1);
        }
        else {
            if (isZ1) xAdd_mont_inplace_Z1(R0, R1, X, mont, next_R1);
            else xAdd_mont_inplace(R0, R1, X, Z, mont, next_R1);
            xDbl_mont_inplace(R0, a24, mont, next_R0);
        }
        R0[0] = next_R0[0]; R0[1] = next_R0[1];
        R1[0] = next_R1[0]; R1[1] = next_R1[1];
    }
    return R0;
}

// Suyama Curve
function getSuyamaCurve(sigma, n) {
    let s = BigInt(sigma);
    let u = (s * s - 5n + n) % n; let v = (4n * s) % n;
    let u3 = (u * u * u) % n; let v3 = (v * v * v) % n;
    let X0 = u3, Z0 = v3;
    let v_u = (v - u + n) % n; let v_u3 = (v_u * v_u * v_u) % n;
    let term1 = (v_u3 * ((3n * u + v) % n)) % n; let term2 = (8n * u3 * v) % n;
    let Anum = (term1 - term2 + n) % n; let Aden = (4n * u3 * v) % n;
    let a24_num = (Anum + 2n * Aden) % n; let a24_den = (4n * Aden) % n;

    // Batch inversion
    let invBatch = batchInversion([a24_den, Z0], n);
    if (!invBatch.success) return { success: false, factor: invBatch.factor };
    let a24 = (a24_num * invBatch.inverses[0]) % n;
    let X0_scaled = (X0 * invBatch.inverses[1]) % n;
    return { success: true, X0: X0_scaled, a24: a24 };
}

async function runECM(M, B1, maxCurves, mont, ctx) {
    let B2 = B1 * 50;
    let B1_big = BigInt(B1), B2_big = BigInt(B2);
    let phase1Powers = [];
    let phase2Primes = [];
    for (let p of ctx.sievedPrimes) {
        if (p <= B1_big) {
            let q = p; while (q * p <= B1_big) q *= p;
            phase1Powers.push(q);
        }
        else if (p <= B2_big) {
            phase2Primes.push(p);
        }
        else break;
    }
    let dest_R1 = [0n, 0n];

    // Pre-allocate arrays to reduce GC
    let baby_X = new Array(106);
    let baby_Z = new Array(106);
    for (let c = 1; c <= maxCurves; c++) {
        ctx.sendPhase("ECM Phase", "Curve " + c + " / " + maxCurves);
        await ctx.yieldIfNeeded();
        if (ctx.shouldStop) return null;
        let sigma = getSecureSigma();
        let curveData = getSuyamaCurve(sigma, M);
        if (!curveData.success) return { success: true, factor: curveData.factor };
        let X0_mont = mont.transform(curveData.X0);
        let a24 = mont.transform(curveData.a24);
        let P = [X0_mont, mont.one];
        for (let i = 0; i < phase1Powers.length; i++) {
            P = montgomeryLadder_mont(phase1Powers[i], P[0], P[1], a24, mont);
        }
        let Z_val = mont.reduce(P[1]);
        let g1 = gcd(Z_val, M);
        if (g1 > 1n && g1 < M) return { success: true, factor: g1 };
        if (g1 === M) continue;
        if (phase2Primes.length === 0) continue;
        let D_val = 210n;
        for (let d = 1n; d <= 105n; d += 2n) {
            let pt = montgomeryLadder_mont(d, P[0], P[1], a24, mont);
            let idx = Number(d);
            baby_X[idx] = pt[0]; baby_Z[idx] = pt[1];
        }
        let S = montgomeryLadder_mont(D_val, P[0], P[1], a24, mont);
        let first_q = BigInt(phase2Primes[0]);
        let m_current = (first_q + D_val / 2n) / D_val;
        let R0 = montgomeryLadder_mont(m_current, S[0], S[1], a24, mont);
        let R1 = montgomeryLadder_mont(m_current + 1n, S[0], S[1], a24, mont);
        let acc = mont.one;
        let itersSinceCheck = 0;
        for (let i = 0; i < phase2Primes.length; i++) {
            let q = BigInt(phase2Primes[i]);
            let m = (q + D_val / 2n) / D_val;
            let d = q - m * D_val;
            let abs_d = d < 0n ? -d : d;
            while (m_current < m) {
                xAdd_mont_inplace(R1, S, R0[0], R0[1], mont, dest_R1);
                R0[0] = R1[0]; R0[1] = R1[1];
                R1[0] = dest_R1[0]; R1[1] = dest_R1[1];
                m_current++;
            }
            let idx_lookup = Number(abs_d);
            if (baby_X[idx_lookup] !== undefined) {
                let diff = mont.sub(mont.mul(R0[0], baby_Z[idx_lookup]), mont.mul(baby_X[idx_lookup], R0[1]));
                acc = mont.mul(acc, diff);
            }
            itersSinceCheck++;
            if (itersSinceCheck > 256) {
                let acc_val = mont.reduce(acc);
                let g2 = gcd(acc_val, M);
                if (g2 > 1n && g2 < M) return { success: true, factor: g2 };
                if (g2 === M) break;
                acc = mont.one;
                itersSinceCheck = 0;
            }
        }
        let acc_val = mont.reduce(acc);
        let g2 = gcd(acc_val, M);
        if (g2 > 1n && g2 < M) return { success: true, factor: g2 };
    }
    return { success: false };
}