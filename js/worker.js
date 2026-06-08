let workerId = 0;
let sievedPrimes = [];
let shouldStop = false;
let lastYieldTime = Date.now();
let lastPhaseUpdate = 0;
let currentPhase = "";

function sendPhase(phase, detail, force) {
    let now = Date.now();
    if (force || phase !== currentPhase || now - lastPhaseUpdate > 100) {
        currentPhase = phase;
        lastPhaseUpdate = now;
        postMessage({ type: "PHASE_UPDATE", workerId: workerId, phase: phase, detail: detail });
    }
}

// CSPRNG
function getSecureRandomBigInt(min, max) {
    const arr = new Uint32Array(4);
    self.crypto.getRandomValues(arr);
    let val = 0n;
    for (let i = 0; i < 4; i++) {
        val = (val << 32n) | BigInt(arr[i]);
    }
    let range = max - min + 1n;
    return min + (val % range);
}

function getSecureSigma() {
    const arr = new Uint32Array(2);
    self.crypto.getRandomValues(arr);
    let s = (BigInt(arr[0]) << 32n) | BigInt(arr[1]);
    return s > 5n ? s : s + 6n;
}

// Math utilities
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

// Batch inversion
function batchInversion(arr, M) {
    let len = arr.length;
    if (len === 0) return { success: true, inverses: [] };
    let s = new Array(len);
    s[0] = arr[0];
    for (let i = 1; i < len; i++) {
        s[i] = (s[i - 1] * arr[i]) % M;
    }
    let invRes = extGCDInverse(s[len - 1], M);
    if (!invRes.success) return { success: false, factor: invRes.factor };
    let allInv = invRes.value;
    let inverses = new Array(len);
    for (let i = len - 1; i > 0; i--) {
        inverses[i] = (allInv * s[i - 1]) % M;
        allInv = (allInv * arr[i]) % M;
    }
    inverses[0] = allInv;
    return { success: true, inverses: inverses };
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

// Tonelli-Shanks
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

function sievePrimes(max) {
    if (max < 2) return [];
    let isPrimeArr = new Uint8Array(max + 1).fill(1);
    isPrimeArr[0] = isPrimeArr[1] = 0;
    for (let i = 2; i * i <= max; i++) {
        if (isPrimeArr[i]) {
            for (let j = i * i; j <= max; j += i) isPrimeArr[j] = 0;
        }
    }
    let list = [];
    for (let i = 2; i <= max; i++) {
        if (isPrimeArr[i]) list.push(BigInt(i));
    }
    return list;
}

// Montgomery Space
class MontgomerySpace {
    constructor(n) {
        this.n = n;
        this.k = BigInt(n.toString(2).length);
        this.mask = (1n << this.k) - 1n;
        this.R = 1n << this.k;
        let inv = n & 3n; let bitCount = 2n;
        while (bitCount < this.k) {
            bitCount *= 2n;
            let m = (1n << bitCount) - 1n;
            inv = (inv * (2n - (n & m) * inv)) & m;
        }
        inv = inv & this.mask;
        this.n_inv = (this.R - inv) & this.mask;
        this.one = this.transform(1n);
    }
    transform(x) { return (x * this.R) % this.n; }
    reduce(T) {
        let m = ((T & this.mask) * this.n_inv) & this.mask;
        let t = (T + m * this.n) >> this.k;
        return t >= this.n ? t - this.n : t;
    }
    mul(A, B) { return this.reduce(A * B); }
    add(A, B) { let r = A + B; return r >= this.n ? r - this.n : r; }
    sub(A, B) { let r = A - B; return r < 0n ? r + this.n : r; }

    // Sliding window (4-bit)
    pow(A, e) {
        if (e === 0n) return this.one;
        if (e === 1n) return A;
        let A2 = this.mul(A, A);
        let table = new Array(16);
        table[1] = A;
        for (let i = 3; i < 16; i += 2) {
            table[i] = this.mul(table[i - 2], A2);
        }
        let res = this.one;
        let h = 0n, temp = e;
        while (temp > 0n) { h++; temp >>= 1n; }

        let i = Number(h) - 1;
        while (i >= 0) {
            if ((e & (1n << BigInt(i))) === 0n) {
                res = this.mul(res, res);
                i--;
            } else {
                let l = 1, val = 1, last1 = 0;
                for (let j = 1; j < 4 && i - j >= 0; j++) {
                    if ((e & (1n << BigInt(i - j))) !== 0n) last1 = j;
                }
                l = last1 + 1;
                for (let j = 1; j < l; j++) {
                    val = (val << 1) | (((e & (1n << BigInt(i - j))) !== 0n) ? 1 : 0);
                }
                for (let j = 0; j < l; j++) res = this.mul(res, res);
                res = this.mul(res, table[val]);
                i -= l;
            }
        }
        return res;
    }
}

function isSquare(n) {
    if (n < 0n) return false; if (n === 0n) return true;
    let mod16 = Number(n & 15n);
    if (mod16 !== 0 && mod16 !== 1 && mod16 !== 4 && mod16 !== 9) return false;
    let x = n, y = (x + 1n) / 2n;
    while (y < x) { x = y; y = (x + n / x) / 2n; }
    return x * x === n;
}

function millerRabinBaseMont(n, base, mont) {
    let d = n - 1n, s = 0n;
    while (d % 2n === 0n) { d /= 2n; s++; }
    let a = mont.transform(base);
    let x = mont.pow(a, d);
    let one = mont.one, minusOne = mont.transform(n - 1n);
    if (x === one || x === minusOne) return true;
    for (let r = 1n; r < s; r++) {
        x = mont.mul(x, x);
        if (x === minusOne) return true;
        if (x === one) return false;
    }
    return false;
}

function strongLucasTest(n, D, P, Q) {
    let s = 0n, d = n + 1n;
    while (d % 2n === 0n) { s++; d /= 2n; }
    let kBin = d.toString(2);
    let U = 1n, V = P, Qk = Q;
    for (let i = 1; i < kBin.length; i++) {
        let U_2k = (U * V) % n;
        let V_2k = (V * V - 2n * Qk) % n;
        V_2k = (V_2k + n) % n; Qk = (Qk * Qk) % n;
        U = U_2k; V = V_2k;
        if (kBin[i] === "1") {
            let U_next = P * U + V; if (U_next % 2n !== 0n) U_next += n; U_next = (U_next >> 1n) % n;
            let V_next = D * U + P * V; if (V_next % 2n !== 0n) V_next += n; V_next = (V_next >> 1n) % n;
            U = U_next; V = V_next;
            Qk = (Qk * Q) % n; Qk = (Qk + n) % n;
        }
    }
    if (U === 0n || V === 0n) return true;
    for (let r = 1n; r < s; r++) {
        V = (V * V - 2n * Qk) % n; V = (V + n) % n; Qk = (Qk * Qk) % n;
        if (V === 0n) return true;
    }
    return false;
}

function isPrimeBPSW(n, mont) {
    if (n < 2n) return false;
    if (n === 2n || n === 3n || n === 5n || n === 7n) return true;
    if (n % 2n === 0n || n % 3n === 0n || n % 5n === 0n) return false;
    let limit64 = 18446744073709551616n;
    if (n < limit64) {
        const bases = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n];
        for (let b of bases) {
            if (n <= b) break;
            if (!millerRabinBaseMont(n, b, mont)) return false;
        }
        return true;
    }
    if (!millerRabinBaseMont(n, 2n, mont)) return false;
    if (isSquare(n)) return false;
    let D = 5n, sign = 1n;
    while (true) {
        let j = jacobi(D * sign, n);
        if (j === -1n) { D = D * sign; break; }
        if (j === 0n) return false;
        D += 2n; sign = -sign;
    }
    let P = 1n, Q = (1n - D) / 4n;
    Q = (Q % n + n) % n;
    return strongLucasTest(n, D, P, Q);

}

async function yieldIfNeeded() {
    let now = Date.now();
    if (now - lastYieldTime > 300) {
        lastYieldTime = now;
        await new Promise(r => setTimeout(r, 0));
    }
}

// Pollard Rho (Brent)
async function pollardBrent(n, maxIters, mont) {
    let c_val = getSecureRandomBigInt(1n, 10000000000n);
    let y_val = getSecureRandomBigInt(2n, 10000000000n);
    let y = mont.transform(y_val);
    let c = mont.transform(c_val);
    let q = mont.transform(1n);
    let m = 100n;
    let g = 1n, r = 1n;
    let ys = y, x = y;
    let iters = 0;
    while (g === 1n) {
        await yieldIfNeeded();
        if (shouldStop) return null;
        x = y;
        for (let i = 0n; i < r; i++) y = mont.add(mont.mul(y, y), c);
        let k = 0n;
        while (k < r && g === 1n) {
            ys = y;
            let limit = (m < r - k) ? m : r - k;
            for (let i = 0n; i < limit; i++) {
                y = mont.add(mont.mul(y, y), c);
                let diff = y > x ? y - x : x - y;
                q = mont.mul(q, diff);
            }
            g = gcd(mont.reduce(q), n);
            k += limit; iters += Number(limit);
            if (iters >= maxIters) return null;
        }
        r *= 2n;
    }
    if (g === n) {
        let backtrackLimit = 0;
        do {
            ys = mont.add(mont.mul(ys, ys), c);
            let diff = ys > x ? ys - x : x - ys;
            g = gcd(mont.reduce(diff), n);
            backtrackLimit++;
            if (backtrackLimit > Number(m)) return null;
        }
        while (g === 1n);
    }
    return g === n ? null : g;
}

// Pollard P-1
async function pollardP1(n, B_limit, mont) {
    if (B_limit < 3) B_limit = 3;
    const arr = new Uint32Array(1);
    self.crypto.getRandomValues(arr);
    let rIdx = arr[0] % Math.max(1, Math.min(100, sievedPrimes.length));
    let basePrime = sievedPrimes[rIdx] || 2n;
    let a = mont.transform(basePrime);
    let B_limit_big = BigInt(B_limit);
    let B2_limit_big = BigInt(B_limit * 10);
    let p1_primes = [];
    let p2_primes = [];
    for (let p of sievedPrimes) {
        if (p <= B_limit_big) p1_primes.push(p);
        else if (p <= B2_limit_big) p2_primes.push(p);
        else break;
    }
    sendPhase("Pollard P-1", "Phase 1: B1=" + B_limit, true);
    for (let i = 0; i < p1_primes.length; i++) {
        let p = p1_primes[i];
        let q = p;
        while (q * p <= B_limit_big) q *= p;
        a = mont.pow(a, q);
        if (i % 2500 === 0) {
            await yieldIfNeeded();
            if (shouldStop) return null;
        }
    }
    let res = mont.reduce(a);
    let g1 = gcd(res - 1n + n, n);
    if (g1 > 1n && g1 < n) return g1;
    if (g1 === n || p2_primes.length === 0) return null;

    // Phase 2
    sendPhase("Pollard P-1", "Phase 2: B2=" + Number(B2_limit_big), true);
    let a_val = mont.reduce(a);
    if (a_val === 1n) return null;
    let max_gap = 200;
    let a_d = new Array(max_gap / 2 + 1).fill(0n);
    let a_2 = mont.mul(a, a);
    a_d[1] = a_2;
    for (let i = 2; i <= max_gap / 2; i++) {
        a_d[i] = mont.mul(a_d[i - 1], a_2);
    }
    let current_q = p1_primes[p1_primes.length - 1];
    let a_q = mont.pow(a, current_q);
    let acc = mont.one;
    let itersSinceCheck = 0;
    for (let i = 0; i < p2_primes.length; i++) {
        let next_q = p2_primes[i];
        let diff = Number(next_q - current_q);
        if (diff > max_gap) {
            a_q = mont.pow(a, next_q);
        }
        else {
            a_q = mont.mul(a_q, a_d[diff / 2]);
        }
        current_q = next_q;
        let term = mont.sub(a_q, mont.one);
        acc = mont.mul(acc, term);
        itersSinceCheck++;
        if (itersSinceCheck > 256) {
            let g2 = gcd(mont.reduce(acc), n);
            if (g2 > 1n && g2 < n) return g2;
            if (g2 === n) break;
            acc = mont.one;
            itersSinceCheck = 0;
            await yieldIfNeeded();
            if (shouldStop) return null;
        }
    }
    let g2 = gcd(mont.reduce(acc), n);
    return (g2 > 1n && g2 < n) ? g2 : null;
}

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

async function runECM(M, B1, maxCurves, mont) {
    let B2 = B1 * 50;
    let B1_big = BigInt(B1), B2_big = BigInt(B2);
    let phase1Powers = [];
    let phase2Primes = [];
    for (let p of sievedPrimes) {
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
        sendPhase("ECM Phase", "Curve " + c + " / " + maxCurves);
        await yieldIfNeeded();
        if (shouldStop) return null;
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

// SIQS/MPQS Engine
function sqrtBigInt(n) {
    if (n < 0n) return 0n;
    if (n === 0n) return 0n;
    let x = n, y = (x + 1n) >> 1n;
    while (y < x) { x = y; y = (x + n / x) >> 1n; }
    return x;
}

function generateFactorBase(N, targetSize) {
    let fb = [];
    fb.push({ p: 2, log: 8, r: 1n });
    let candidate = 3;
    while (fb.length < targetSize) {
        if (isPrime(candidate)) {
            let p_bi = BigInt(candidate);
            if (jacobi(N, p_bi) === 1n) {
                let r = tonelliShanks(N, p_bi);
                if (r !== null) {
                    fb.push({
                        p: candidate,
                        log: Math.round(Math.log2(candidate) * 8),
                        r: r
                    });
                }
            }
        }
        candidate += 2;
    }
    return fb;
}

async function runParallelSIQS(workerId, target_N, kN, params) {
    let fbSize = params.fbSize;
    let M = params.M;
    let maxWorkers = params.maxWorkers || 8;
    let kN_Big = BigInt(kN);
    sendPhase("SIQS Core", "Generating FB...", true);
    let FB = generateFactorBase(kN_Big, fbSize);
    sendPhase("SIQS Core", "FB Size: " + FB.length, true);

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
    let startIndex = Math.max(10, Math.floor(FB.length * 0.15)) + workerId;
    for(let i=0; i<s; i++) q_indices[i] = startIndex + i;

    let A_inv_p = new Int32Array(FB.length);
    let delta_x = new Array(s).fill(0).map(() => new Int32Array(FB.length));
    let x1_p = new Int32Array(FB.length);
    let x2_p = new Int32Array(FB.length);

    while (!shouldStop) {
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
            if (shouldStop) break;
            polys_searched++;
            if (polys_searched % 1000 === 0) { sendPhase("SIQS Sieving", "Polys: " + polys_searched); await yieldIfNeeded(); }

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
                        factors.push(p.toString());
                        temp /= p;
                    }
                }
                if (temp === 1n) {
                    for (let k = 0; k < s; k++) factors.push(FB[q_indices[k]].p.toString());

                    let valid = true;
                    let maxPrime = BigInt(FB[FB.length - 1].p);
                    for (let f of factors) {
                        if (BigInt(f) > maxPrime) { valid = false; break; }
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
            shouldStop = true;
            break;
        } else {
            if (j === 0) {
                q_indices[0] += maxWorkers;
                if (q_indices[0] + s - 1 >= FB.length) {
                    shouldStop = true;
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

// Main Worker Routine
self.onmessage = async (e) => {
    const data = e.data;
    if (data.cmd === "INIT") {
        workerId = data.workerId;
        sievedPrimes = sievePrimes(data.params.sieveLimit);
        postMessage({ type: "LOG", msg: "Core online & Primes sieved.", level: "sys", workerId: workerId });
    }
    else if (data.cmd === "STOP") {
        shouldStop = true;
    }
    else if (data.cmd === "SIQS_FACTORIZE") {
        shouldStop = false;
        await runParallelSIQS(workerId, data.target, data.kN, data.params);
    }
    else if (data.cmd === "FACTORIZE") {
        shouldStop = false;
        let M = data.target;
        let params = data.params;
        try {
            sendPhase("BPSW Test", "Primality check", true);
            let mont = new MontgomerySpace(M);
            if (isPrimeBPSW(M, mont)) {
                if (workerId === 0) postMessage({ type: "PRIME_FOUND", target: M, workerId: workerId });
                return;
            }
            if (workerId === 0 && params.trialLimit > 0) {
                sendPhase("Trial Div", "up to " + params.trialLimit, true);
                let currentVal = M;
                for (let p of sievedPrimes) {
                    if (p > params.trialLimit) break;
                    if (currentVal % p === 0n) {
                        postMessage({ type: "FACTOR_FOUND", factor: p, target: M, workerId: workerId, method: "Trial Division" });
                        return;
                    }
                    await yieldIfNeeded();
                    if (shouldStop) return;
                }
            }
            await yieldIfNeeded(); if (shouldStop) return;
            if (params.p1Limit > 0) {
                let p1Factor = await pollardP1(M, params.p1Limit, mont);
                if (p1Factor) {
                    postMessage({ type: "FACTOR_FOUND", factor: p1Factor, target: M, workerId: workerId, method: "P-1" });
                    return;
                }
            }
            await yieldIfNeeded(); if (shouldStop) return;
            if (params.rhoLimit > 0) {
                sendPhase("Pollard Rho", "Limit=" + params.rhoLimit, true);
                let rhoFactor = await pollardBrent(M, params.rhoLimit, mont);
                if (rhoFactor) {
                    postMessage({ type: "FACTOR_FOUND", factor: rhoFactor, target: M, workerId: workerId, method: "Rho (Brent)" });
                    return;
                }
            }
            await yieldIfNeeded(); if (shouldStop) return;
            let ecmRes = await runECM(M, params.b1, params.maxCurves, mont);
            if (ecmRes && ecmRes.success) {
                postMessage({ type: "FACTOR_FOUND", factor: ecmRes.factor, target: M, workerId: workerId, method: "ECM" });
                return;
            }
            if (!shouldStop) {
                postMessage({ type: "EXHAUSTED", target: M, workerId: workerId });
            }
        }
        catch (err) {
            postMessage({ type: "LOG", msg: "Exception: " + err.message, level: "error", workerId: workerId });
        }
    }
};