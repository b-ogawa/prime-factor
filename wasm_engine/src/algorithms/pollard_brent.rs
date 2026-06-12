use crate::math::{gcd, int_from_le_slice, DoubleInt, Int, MontgomerySpace, Xoroshiro128PlusPlus};
use crate::check_abort;

/// Pollard's Rho（Brent版）法を用いて因数を探索する。
/// 
/// # Preconditions
/// - `n_bytes` はターゲット値（奇数の合成数）を示すリトルエンディアンバイト配列。
/// - `max_iters` は探索のイテレーション上限。
/// 
/// # Postconditions
/// - 因数が見つかった場合、その因数（リトルエンディアン32バイト配列）を `Some(Vec<u8>)` で返します。
/// - アボート、探索完了、あるいは最大回数に達しても見つからない場合は `None` を返します。
pub fn pollard_brent_bytes(n_bytes: &[u8], max_iters: usize, seed_offset: usize) -> Option<Vec<u8>> {
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

    let c_limbs = [prng.next(), prng.next(), prng.next(), prng.next()];
    let c_val = Int::from_limbs(c_limbs) % n;
    let y_limbs = [prng.next(), prng.next(), prng.next(), prng.next()];
    let y_val = Int::from_limbs(y_limbs) % n;

    let mut y = mont.transform(y_val);
    let c = mont.transform(c_val);
    let mut q = mont.transform(Int::from(1)); // 1 in Mont space
    let m = params.brent_m;
    let mut g = Int::from(1);
    let mut r = 1usize;
    let mut ys = y;
    let mut x = y;
    let mut iters = 0;

    while g == Int::from(1) {
        if check_abort() == 1 {
            return None;
        }
        x = y;
        let mut k = 0;
        while k < r && g == Int::from(1) {
            ys = y;
            let limit = core::cmp::min(m, r - k);
            for _ in 0..limit {
                let y_sq = mont.mul(y, y);
                y = mont.add(y_sq, c);
                let diff = if y > x { y - x } else { x - y };
                q = mont.mul(q, diff);
            }
            g = gcd(mont.reduce(DoubleInt::from(q)), n);
            k += limit;
            iters += limit;
            if iters >= max_iters {
                return None;
            }
        }
        r *= 2;
    }

    if g == n {
        let mut backtrack_limit = 0;
        loop {
            let ys_sq = mont.mul(ys, ys);
            ys = mont.add(ys_sq, c);
            let diff = if ys > x { ys - x } else { x - ys };
            g = gcd(mont.reduce(DoubleInt::from(diff)), n);
            backtrack_limit += 1;
            if backtrack_limit > m {
                return None;
            }
            if g != Int::from(1) {
                break;
            }
        }
    }

    if g == n {
        None
    } else {
        Some(g.to_le_bytes::<32>().to_vec())
    }
}
