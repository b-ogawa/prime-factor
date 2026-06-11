/**
 * @module js/config/constants
 * @description Centralized configuration parameters and constants for the factorization engine and UI.
 */

export const ENGINE_CONSTANTS = {
    // Timer polling interval in milliseconds for metrics updates
    TIMER_INTERVAL_MS: 100,
    
    // Default limit value for trial division / sieve limit
    DEFAULT_TRIAL_LIMIT: 10000,
    
    // Absolute maximum limit for factoring bounds
    MAX_FACTORING_LIMIT: 100000000,
    
    // Worker stop timeout in milliseconds before hard termination
    WORKER_STOP_TIMEOUT_MS: 3000,
    
    // ECM B1 default multiplier for co-factor bounds
    ECM_B1_MULTIPLIER: 50,
    
    // Pollard's P-1 limit multiplier
    P1_LIMIT_MULTIPLIER: 10,
    
    // Default slot size for WASM shared buffer (128 KB)
    WASM_SLOT_SIZE: 128 * 1024,
};
