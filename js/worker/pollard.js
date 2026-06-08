// Pollard Rho (Brent)
async function pollardBrent(n, maxIters, mont, ctx) {
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
        await ctx.yieldIfNeeded();
        if (ctx.shouldStop) return null;
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
async function pollardP1(n, B_limit, mont, ctx) {
    if (B_limit < 3) B_limit = 3;
    const cryptoObj = typeof window !== 'undefined' ? window.crypto : self.crypto;
    const arr = new Uint32Array(1);
    cryptoObj.getRandomValues(arr);
    let rIdx = arr[0] % Math.max(1, Math.min(100, ctx.sievedPrimes.length));
    let basePrime = ctx.sievedPrimes[rIdx] || 2n;
    let a = mont.transform(basePrime);
    let B_limit_big = BigInt(B_limit);
    let B2_limit_big = BigInt(B_limit * 10);
    let p1_primes = [];
    let p2_primes = [];
    for (let p of ctx.sievedPrimes) {
        if (p <= B_limit_big) p1_primes.push(p);
        else if (p <= B2_limit_big) p2_primes.push(p);
        else break;
    }
    ctx.sendPhase("Pollard P-1", "Phase 1: B1=" + B_limit, true);
    for (let i = 0; i < p1_primes.length; i++) {
        let p = p1_primes[i];
        let q = p;
        while (q * p <= B_limit_big) q *= p;
        a = mont.pow(a, q);
        if (i % 2500 === 0) {
            await ctx.yieldIfNeeded();
            if (ctx.shouldStop) return null;
        }
    }
    let res = mont.reduce(a);
    let g1 = gcd(res - 1n + n, n);
    if (g1 > 1n && g1 < n) return g1;
    if (g1 === n || p2_primes.length === 0) return null;

    // Phase 2
    ctx.sendPhase("Pollard P-1", "Phase 2: B2=" + Number(B2_limit_big), true);
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
            await ctx.yieldIfNeeded();
            if (ctx.shouldStop) return null;
        }
    }
    let g2 = gcd(mont.reduce(acc), n);
    return (g2 > 1n && g2 < n) ? g2 : null;
}