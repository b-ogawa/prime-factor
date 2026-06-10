// Common Math Utilities for both Main Thread and Web Workers

// CSPRNG
export function getSecureRandomBigInt(min, max) {
    const cryptoObj = typeof window !== 'undefined' ? window.crypto : self.crypto;
    const arr = new Uint32Array(4);
    cryptoObj.getRandomValues(arr);
    let val = 0n;
    for (let i = 0; i < 4; i++) {
        val = (val << 32n) | BigInt(arr[i]);
    }
    let range = max - min + 1n;
    return min + (val % range);
}

export function getSecureSigma() {
    const cryptoObj = typeof window !== 'undefined' ? window.crypto : self.crypto;
    const arr = new Uint32Array(2);
    cryptoObj.getRandomValues(arr);
    let s = (BigInt(arr[0]) << 32n) | BigInt(arr[1]);
    return s > 5n ? s : s + 6n;
}

// Math utilities
export function gcd(a, b) {
    a = a < 0n ? -a : a; b = b < 0n ? -b : b;
    while (b > 0n) { let temp = b; b = a % b; a = temp; }
    return a;
}

export function extGCDInverse(a, m) {
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
export function batchInversion(arr, M) {
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

export function powMod(base, exp, mod) {
    let res = 1n;
    base = base % mod;
    while (exp > 0n) {
        if (exp & 1n) res = (res * base) % mod;
        base = (base * base) % mod;
        exp >>= 1n;
    }
    return res;
}

export function isPrime(n) {
    if (n < 2) return false;
    if (n === 2 || n === 3) return true;
    if (n % 2 === 0 || n % 3 === 0) return false;
    for (let i = 5; i * i <= n; i += 6) {
        if (n % i === 0 || n % (i + 2) === 0) return false;
    }
    return true;
}

export function jacobi(a, n) {
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
export function legendre(a, p) {
    if (p === 2n) return 1;
    let val = powMod(a, (p - 1n) >> 1n, p);
    if (val === 0n) return 0;
    if (val === p - 1n) return -1;
    return 1;
}

export function tonelliShanks(n, p) {
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

export function sievePrimes(max) {
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
export class MontgomerySpace {
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

export function isSquare(n) {
    if (n < 0n) return false; if (n === 0n) return true;
    let mod16 = Number(n & 15n);
    if (mod16 !== 0 && mod16 !== 1 && mod16 !== 4 && mod16 !== 9) return false;
    let x = n, y = (x + 1n) / 2n;
    while (y < x) { x = y; y = (x + n / x) / 2n; }
    return x * x === n;
}

export function millerRabinBaseMont(n, base, mont) {
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

export function strongLucasTest(n, D, P, Q) {
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

export function isPrimeBPSW(n, mont) {
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

export function sqrtBigInt(n) {
    if (n < 0n) return 0n;
    if (n === 0n) return 0n;
    let x = n, y = (x + 1n) >> 1n;
    while (y < x) { x = y; y = (x + n / x) >> 1n; }
    return x;
}

export function generateFactorBase(N, targetSize) {
    let fb = [];
    fb.push({ p: 2, log: 8, r: 1n });
    let candidate = 3;
    let N_bi = BigInt(N);
    while (fb.length < targetSize) {
        if (isPrime(candidate)) {
            let p_bi = BigInt(candidate);
            if (jacobi(N_bi, p_bi) === 1n) {
                let r = tonelliShanks(N_bi, p_bi);
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
