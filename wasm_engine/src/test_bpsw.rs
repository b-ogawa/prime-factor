#[cfg(test)]
mod tests {
    use crate::math::primes::is_prime_bpsw;
    use crate::math::Int;

    #[test]
    fn test_r23() {
        // 11111111111111111111111
        // 16進数: 0x2539077bd79f0114f27
        let n = Int::from_str_radix("2539077bd79f0114f27", 16).unwrap();
        assert!(is_prime_bpsw(n));
    }
}
