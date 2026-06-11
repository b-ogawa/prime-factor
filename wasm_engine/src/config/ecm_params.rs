pub struct EcmParams {
    pub p1_b2_multiplier: usize,
    pub ecm_b2_multiplier: usize,
    pub brent_m: usize,
    pub d_val: usize,
    pub gcd_check_interval: usize,
    pub p1_max_gap: usize,
}

impl Default for EcmParams {
    fn default() -> Self {
        Self {
            p1_b2_multiplier: 10,
            ecm_b2_multiplier: 50,
            brent_m: 100,
            d_val: 210,
            gcd_check_interval: 256,
            p1_max_gap: 200,
        }
    }
}
