use crate::math::{gcd, int_from_le_slice, DoubleInt, Int, MontgomerySpace, Xoroshiro128PlusPlus};
use crate::check_abort;

/// Pollard's P-1 法を用いて合成数の因数を探索する。
/// 
/// # Preconditions
/// - `n_bytes` はターゲットとなる合成数を示す32バイト以下のリトルエンディアンバイト配列。
/// - `primes` は十分な個数の試し割り素数リスト。
/// 
/// # Postconditions
/// - 因数が見つかった場合、その因数（リトルエンディアンバイト配列、32バイト）を `Some(Vec<u8>)` で返します。
/// - 因数が見つからない、またはアボートが検知された場合は `None` を返します。
pub fn pollard_p1_bytes(n_bytes: &[u8], b1: usize, primes: &[u32], seed_offset: usize) -> Option<Vec<u8>> {
    let params = crate::config::EcmParams::default();
    let n = int_from_le_slice(n_bytes);
    if n == Int::from(0) || n == Int::from(1) {
        return None;
    }
    if n.as_limbs()[0] & 1 == 0 {
        return Some(Int::from(2).to_le_bytes::<32>().to_vec()); // 偶数なら即座に2を返す
    }
    let mont = MontgomerySpace::new(n);
    let mut prng = Xoroshiro128PlusPlus::new();
    for _ in 0..seed_offset {
        prng.next();
    }

    let b1_big = Int::from(b1);
    let b2_big = Int::from(b1 * params.p1_b2_multiplier);

    let mut p1_primes = Vec::new();
    let mut p2_primes = Vec::new();

    for &p in primes {
        let p_int = Int::from(p);
        if p_int <= b1_big {
            p1_primes.push(p);
        } else if p_int <= b2_big {
            p2_primes.push(p);
        } else {
            break;
        }
    }

    let r_idx = (prng.next() as usize) % core::cmp::max(1, core::cmp::min(100, primes.len()));
    let base_prime = Int::from(*primes.get(r_idx).unwrap_or(&2));
    let mut a = mont.transform(base_prime);
    let a_start = a;

    // Phase 1
    for &p in &p1_primes {
        if check_abort() == 1 {
            return None;
        }
        let mut q = p as u64;
        let p_u64 = p as u64;
        while q.saturating_mul(p_u64) <= b1 as u64 {
            q *= p_u64;
        }

        a = mont.pow(a, q);
    }

    let res = mont.reduce(DoubleInt::from(a));
    let g1 = gcd(
        if res >= Int::from(1) {
            res - Int::from(1)
        } else {
            n - Int::from(1)
        },
        n,
    );

    if g1 > Int::from(1) && g1 < n {
        return Some(g1.to_le_bytes::<32>().to_vec());
    }
    if g1 == n {
        let mut a_bt = a_start;
        for &p in &p1_primes {
            let mut q = p as u64;
            let p_u64 = p as u64;
            while q.saturating_mul(p_u64) <= b1 as u64 {
                q *= p_u64;
            }
            a_bt = mont.pow(a_bt, q);
            let res_val = mont.reduce(DoubleInt::from(a_bt));
            let g_bt = gcd(if res_val >= Int::from(1) { res_val - Int::from(1) } else { n - Int::from(1) }, n);
            if g_bt > Int::from(1) && g_bt < n {
                return Some(g_bt.to_le_bytes::<32>().to_vec());
            }
            if g_bt == n {
                break;
            }
        }
        return None;
    }
    if p2_primes.is_empty() {
        return None;
    }

    // Phase 2
    let a_val = mont.reduce(DoubleInt::from(a));
    if a_val == Int::from(1) {
        return None;
    }

    let max_gap = params.p1_max_gap;
    let mut a_d = vec![mont.transform(Int::from(0)); max_gap / 2 + 1];
    let a_2 = mont.mul(a, a);
    a_d[1] = a_2;
    for i in 2..=(max_gap / 2) {
        a_d[i] = mont.mul(a_d[i - 1], a_2);
    }

    let mut current_q = p1_primes.last().cloned().unwrap_or(2) as u64;

    let mut a_q = mont.pow(a, current_q);

    let mut acc = mont.transform(Int::from(1));
    let mut iters_since_check = 0;

    for &next_q in &p2_primes {
        let diff = next_q as isize - current_q as isize;
        if diff as usize > max_gap {
            a_q = mont.pow(a, next_q as u64);
        } else if diff > 0 {
            if diff % 2 != 0 {
                let even_gap = (diff - 1) as usize;
                if even_gap > 0 {
                    a_q = mont.mul(a_q, a_d[even_gap / 2]);
                }
                a_q = mont.mul(a_q, a);
            } else {
                a_q = mont.mul(a_q, a_d[diff as usize / 2]);
            }
        }
        current_q = next_q as u64;

        let one_mont = mont.transform(Int::from(1));
        let term = mont.sub(a_q, one_mont);
        acc = mont.mul(acc, term);
        iters_since_check += 1;

        if iters_since_check > params.gcd_check_interval {
            let g2 = gcd(mont.reduce(DoubleInt::from(acc)), n);
            if g2 > Int::from(1) && g2 < n {
                return Some(g2.to_le_bytes::<32>().to_vec());
            }
            if g2 == n {
                break;
            }
            acc = mont.transform(Int::from(1));
            iters_since_check = 0;
        }
    }
    let g2 = gcd(mont.reduce(DoubleInt::from(acc)), n);
    if g2 > Int::from(1) && g2 < n {
        Some(g2.to_le_bytes::<32>().to_vec())
    } else {
        None
    }
}
