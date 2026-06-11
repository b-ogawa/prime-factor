/**
 * @module js/config/index
 * @description 設定・定数関連のメニュー表（契約の真のソース）。
 */

/**
 * @namespace ENGINE_CONSTANTS
 * @description エンジンやUIに関する各種定数。タイムアウト値や各アルゴリズムのパラメータしきい値などが含まれます。
 * 
 * @property {number} TIMER_INTERVAL_MS - Timer polling interval in milliseconds for metrics updates.
 * @property {number} DEFAULT_TRIAL_LIMIT - Default limit value for trial division / sieve limit.
 * @property {number} MAX_FACTORING_LIMIT - Absolute maximum limit for factoring bounds.
 * @property {number} WORKER_STOP_TIMEOUT_MS - Worker stop timeout in milliseconds before hard termination.
 * @property {number} ECM_B1_MULTIPLIER - ECM B1 default multiplier for co-factor bounds.
 * @property {number} P1_LIMIT_MULTIPLIER - Pollard's P-1 limit multiplier.
 * @property {number} WASM_SLOT_SIZE - Default slot size for WASM shared buffer (128 KB).
 */
export { ENGINE_CONSTANTS } from './constants.js';

