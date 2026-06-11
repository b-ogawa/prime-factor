use crate::math::{DoubleInt, Int, MontgomerySpace, pow_mod};

/// Checks if a number is a perfect square.
/// 指定された数が完全平方数（`k^2 == n` となる整数 `k` が存在するか）を判定する。
pub(crate) fn is_square(n: Int) -> bool {
    if n == Int::from(0) {
        return true;
    }
    let mod16 = (n.as_limbs()[0] & 15) as u8;
    if mod16 != 0 && mod16 != 1 && mod16 != 4 && mod16 != 9 {
        return false;
    }

    let mut x = n;
    let mut y = (x >> 1) + Int::from(1);
    while y < x {
        x = y;
        y = (x + n / x) >> 1;
    }
    x * x == n
}

pub(crate) fn jacobi(mut a: Int, mut n: Int) -> i32 {
    let mut t = 1;
    while a != Int::from(0) {
        while a.as_limbs()[0] % 2 == 0 {
            a >>= 1;
            let r = n.as_limbs()[0] % 8;
            if r == 3 || r == 5 {
                t = -t;
            }
        }
        core::mem::swap(&mut a, &mut n);
        if a.as_limbs()[0] % 4 == 3 && n.as_limbs()[0] % 4 == 3 {
            t = -t;
        }
        a = a % n;
    }
    if n == Int::from(1) {
        t
    } else {
        0
    }
}

pub(crate) fn legendre(a: Int, p: Int) -> i32 {
    if p == Int::from(2) {
        return 1;
    }
    let exp = (p - Int::from(1)) >> 1;
    let val = pow_mod(a, exp, p);
    if val.is_zero() {
        0
    } else if val == p - Int::from(1) {
        -1
    } else {
        1
    }
}

pub(crate) fn tonelli_shanks(n: Int, p: Int) -> Option<Int> {
    let n_mod = n % p;
    if n_mod.is_zero() {
        return Some(Int::from(0));
    }
    if p == Int::from(2) {
        return Some(n_mod);
    }
    if legendre(n_mod, p) != 1 {
        return None;
    }
    if (p.as_limbs()[0] % 4) == 3 {
        let exp = (p + Int::from(1)) >> 2;
        return Some(pow_mod(n_mod, exp, p));
    }
    
    let mut s = 0u32;
    let mut q = p - Int::from(1);
    while (q.as_limbs()[0] & 1) == 0 {
        s += 1;
        q >>= 1;
    }
    
    let mut z = Int::from(2);
    while legendre(z, p) != -1 {
        z += Int::from(1);
    }
    
    let mut c = pow_mod(z, q, p);
    let mut r = pow_mod(n_mod, (q + Int::from(1)) >> 1, p);
    let mut t = pow_mod(n_mod, q, p);
    let mut m = s;
    
    while t != Int::from(1) {
        let mut temp_t = t;
        let mut i = 0u32;
        while temp_t != Int::from(1) && i < m {
            let temp_t_prod = DoubleInt::from(temp_t).wrapping_mul(DoubleInt::from(temp_t));
            temp_t = Int::from_limbs((temp_t_prod % DoubleInt::from(p)).as_limbs()[..4].try_into().unwrap());
            i += 1;
        }
        if i == m {
            return None;
        }
        let mut b = c;
        let b_exp = 1u64 << (m - i - 1);
        b = pow_mod(b, Int::from(b_exp), p);
        
        let r_prod = DoubleInt::from(r).wrapping_mul(DoubleInt::from(b));
        r = Int::from_limbs((r_prod % DoubleInt::from(p)).as_limbs()[..4].try_into().unwrap());
        
        let b_sq = DoubleInt::from(b).wrapping_mul(DoubleInt::from(b));
        c = Int::from_limbs((b_sq % DoubleInt::from(p)).as_limbs()[..4].try_into().unwrap());
        
        let t_prod = DoubleInt::from(t).wrapping_mul(DoubleInt::from(c));
        t = Int::from_limbs((t_prod % DoubleInt::from(p)).as_limbs()[..4].try_into().unwrap());
        
        m = i;
    }
    Some(r)
}

fn strong_lucas_test(n: Int) -> bool {
    let mut d = DoubleInt::from(n) + DoubleInt::from(1);
    let mut s = 0;
    while d.as_limbs()[0] & 1 == 0 {
        s += 1;
        d >>= 1;
    }

    let mut d_val = Int::from(5);
    let mut sign = 1i32;
    loop {
        let mut a = d_val;
        if sign == -1 {
            a = n - d_val;
        }
        let j = jacobi(a, n);
        if j == -1 {
            break;
        }
        if j == 0 {
            return false;
        }
        d_val = d_val + Int::from(2);
        sign = -sign;
    }

    let p_val = Int::from(1);
    let num_double = if sign == 1 {
        DoubleInt::from(n) + DoubleInt::from(1) - DoubleInt::from(d_val)
    } else {
        DoubleInt::from(1) + DoubleInt::from(d_val)
    };

    let mut q_double = num_double;
    while q_double.as_limbs()[0] % 4 != 0 {
        q_double += DoubleInt::from(n);
    }
    q_double >>= 2;
    let q_val = Int::from_limbs((q_double % DoubleInt::from(n)).as_limbs()[..4].try_into().unwrap());
    let q_val = q_val % n;

    let mut u = Int::from(1);
    let mut v = p_val;
    let mut qk = q_val;

    let d_bits = 512 - d.leading_zeros();

    for i in (0..d_bits - 1).rev() {
        let u_double = DoubleInt::from(u).wrapping_mul(DoubleInt::from(v)) % DoubleInt::from(n);
        let u_2k = Int::from_limbs(u_double.as_limbs()[..4].try_into().unwrap());

        let v2 = DoubleInt::from(v).wrapping_mul(DoubleInt::from(v)) % DoubleInt::from(n);
        let qk2 = DoubleInt::from(qk).wrapping_mul(DoubleInt::from(2)) % DoubleInt::from(n);
        let v_2k_mod = if v2 >= qk2 {
            v2 - qk2
        } else {
            v2 + DoubleInt::from(n) - qk2
        };
        let v_2k = Int::from_limbs(v_2k_mod.as_limbs()[..4].try_into().unwrap());

        let qk_sq = DoubleInt::from(qk).wrapping_mul(DoubleInt::from(qk)) % DoubleInt::from(n);
        qk = Int::from_limbs(qk_sq.as_limbs()[..4].try_into().unwrap());

        u = u_2k;
        v = v_2k;

        let word_idx = i / 64;
        let bit_idx = i % 64;
        let bit = (d.as_limbs()[word_idx] >> bit_idx) & 1;

        if bit == 1 {
            let mut u_next =
                DoubleInt::from(p_val).wrapping_mul(DoubleInt::from(u)) % DoubleInt::from(n);
            u_next = (u_next + DoubleInt::from(v)) % DoubleInt::from(n);
            let mut u_next_int = Int::from_limbs(u_next.as_limbs()[..4].try_into().unwrap());
            if u_next_int.as_limbs()[0] & 1 == 1 {
                u_next = (DoubleInt::from(u_next_int) + DoubleInt::from(n)) >> 1;
                u_next_int = Int::from_limbs(u_next.as_limbs()[..4].try_into().unwrap());
            } else {
                u_next_int >>= 1;
            }

            let mut v_next_part1 =
                DoubleInt::from(d_val).wrapping_mul(DoubleInt::from(u)) % DoubleInt::from(n);
            if sign == -1 {
                v_next_part1 = if v_next_part1 == DoubleInt::from(0) {
                    DoubleInt::from(0)
                } else {
                    DoubleInt::from(n) - v_next_part1
                };
            }
            let v_next_part2 =
                DoubleInt::from(p_val).wrapping_mul(DoubleInt::from(v)) % DoubleInt::from(n);
            let mut v_next = (v_next_part1 + v_next_part2) % DoubleInt::from(n);
            let mut v_next_int = Int::from_limbs(v_next.as_limbs()[..4].try_into().unwrap());
            if v_next_int.as_limbs()[0] & 1 == 1 {
                v_next = (DoubleInt::from(v_next_int) + DoubleInt::from(n)) >> 1;
                v_next_int = Int::from_limbs(v_next.as_limbs()[..4].try_into().unwrap());
            } else {
                v_next_int >>= 1;
            }

            u = u_next_int;
            v = v_next_int;

            let qk_q =
                DoubleInt::from(qk).wrapping_mul(DoubleInt::from(q_val)) % DoubleInt::from(n);
            qk = Int::from_limbs(qk_q.as_limbs()[..4].try_into().unwrap());
        }
    }

    if u == Int::from(0) || v == Int::from(0) {
        return true;
    }

    for _ in 1..s {
        let v2 = DoubleInt::from(v).wrapping_mul(DoubleInt::from(v)) % DoubleInt::from(n);
        let qk2 = DoubleInt::from(qk).wrapping_mul(DoubleInt::from(2)) % DoubleInt::from(n);
        let v_next_mod = if v2 >= qk2 {
            v2 - qk2
        } else {
            v2 + DoubleInt::from(n) - qk2
        };
        v = Int::from_limbs(v_next_mod.as_limbs()[..4].try_into().unwrap());

        let qk_sq = DoubleInt::from(qk).wrapping_mul(DoubleInt::from(qk)) % DoubleInt::from(n);
        qk = Int::from_limbs(qk_sq.as_limbs()[..4].try_into().unwrap());

        if v == Int::from(0) {
            return true;
        }
    }
    false
}

fn miller_rabin_base_mont(n: Int, base: Int, mont: &MontgomerySpace) -> bool {
    let mut d = n - Int::from(1);
    let mut s = 0;
    while d.as_limbs()[0] & 1 == 0 {
        d >>= 1;
        s += 1;
    }
    let a = mont.transform(base);

    let mut res = mont.transform(Int::from(1));
    let mut base_pow = a;
    let mut exp = d;
    while exp > Int::from(0) {
        if exp.as_limbs()[0] & 1 == 1 {
            res = mont.mul(res, base_pow);
        }
        base_pow = mont.mul(base_pow, base_pow);
        let new_exp = exp >> 1;
        exp = new_exp;
    }

    let mut x = res;
    let one = mont.transform(Int::from(1));
    let minus_one = mont.transform(n - Int::from(1));

    if x == one || x == minus_one {
        return true;
    }

    for _ in 1..s {
        x = mont.mul(x, x);
        if x == minus_one {
            return true;
        }
        if x == one {
            return false;
        }
    }
    false
}

pub(crate) fn is_prime_bpsw(n: Int) -> bool {
    if n < Int::from(2) {
        return false;
    }
    if n == Int::from(2) || n == Int::from(3) || n == Int::from(5) || n == Int::from(7) {
        return true;
    }
    if n.as_limbs()[0] % 2 == 0 || n.as_limbs()[0] % 3 == 0 || n.as_limbs()[0] % 5 == 0 {
        return false;
    }

    let mont = MontgomerySpace::new(n);

    let bases = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37];
    for &b in &bases {
        let b_int = Int::from(b);
        if n == b_int {
            return true;
        }
        if n < b_int {
            return false;
        }
        if !miller_rabin_base_mont(n, b_int, &mont) {
            return false;
        }
    }

    if n.as_limbs()[1] > 0 || n.as_limbs()[2] > 0 || n.as_limbs()[3] > 0 {
        if !miller_rabin_base_mont(n, Int::from(2), &mont) {
            return false;
        }
        if is_square(n) {
            return false;
        }
        return strong_lucas_test(n);
    }

    true
}
// Extracted WASM FFI wrappers migrated to lib.rs
