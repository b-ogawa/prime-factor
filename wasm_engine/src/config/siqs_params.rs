pub struct SiqsParams {
    pub fb_size_coeff_a: f64,
    pub fb_size_coeff_b: f64,
    pub fb_size_min: usize,
    pub fb_size_max: usize,
}

impl Default for SiqsParams {
    fn default() -> Self {
        Self {
            fb_size_coeff_a: 0.32,
            fb_size_coeff_b: 0.2,
            fb_size_min: 50,
            fb_size_max: 20000,
        }
    }
}

pub fn get_s_val_for_digits(digits: usize) -> usize {
    if digits >= 64 {
        7
    } else if digits >= 56 {
        6
    } else if digits >= 48 {
        5
    } else if digits >= 40 {
        4
    } else if digits >= 32 {
        3
    } else if digits >= 24 {
        2
    } else {
        1
    }
}
