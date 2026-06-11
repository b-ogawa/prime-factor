import { WasmAdapter } from '../interop/index.js';

/**
 * @module js/orchestration/wasm_session_manager
 * @description Manages the lifecycle of the WebAssembly factorization session and encapsulates its native calls.
 */
export class WasmSessionManager {
    constructor() {
        /** @type {Object|null} The current active WASM session */
        this.session = null;
    }

    // Creates a new WASM factorization session
    createSession(targetStr) {
        this.freeSession();
        this.session = WasmAdapter.createSession(targetStr);
        return this.session;
    }

    // Frees the active WASM session resources
    freeSession() {
        if (this.session) {
            this.session.free();
            this.session = null;
        }
    }

    /**
     * Obtains the next orchestrated action type from the WASM engine.
     * @returns {number|null} Action type enum value or null if no session.
     */
    getNextAction() {
        if (!this.session) return null;
        return this.session.instance.get_next_action();
    }

    /**
     * Gets the currently active factorization target node value.
     * @returns {string} Target number string.
     */
    getCurrentTarget() {
        if (!this.session) return "";
        return this.session.instance.get_current_target();
    }

    /**
     * Runs local trial division / prime checks inside WASM.
     * @param {string} target - The target node string.
     * @returns {boolean} Whether the target was successfully factored locally.
     */
    factorLocally(target) {
        if (!this.session) return false;
        return this.session.instance.factor_locally(target);
    }

    /**
     * Reports a proven prime factor to the WASM tree.
     * @param {string} target - The target node string.
     */
    reportPrime(target) {
        if (!this.session) return;
        this.session.instance.report_prime(target);
    }

    /**
     * Reports a discovered factor of a node to the WASM tree.
     * @param {string} target - The target node string.
     * @param {string} factor - The discovered factor string.
     */
    reportFactor(target, factor) {
        if (!this.session) return;
        this.session.instance.report_factor(target, factor);
    }

    /**
     * Reports that a target's search space was exhausted up to b1.
     * @param {string} target - The target node string.
     * @param {number} b1Tested - The maximum B1 value tested.
     */
    reportExhausted(target, b1Tested) {
        if (!this.session) return;
        this.session.instance.report_exhausted(target, b1Tested);
    }

    /**
     * Gets the maximum B1 value that has already been tested for a target node.
     * @param {string} target - The target node string.
     * @returns {number} Tested B1 bound.
     */
    getEcmB1Tested(target) {
        if (!this.session) return 0;
        return this.session.instance.get_ecm_b1_tested(target);
    }

    /**
     * Returns a pointer to the WASM metrics array in shared memory.
     * @returns {number|null} Native pointer or null.
     */
    getMetricsPtr() {
        if (!this.session) return null;
        return this.session.instance.get_metrics_ptr();
    }

    /**
     * Retrieves the JSON string containing factors resolved in the tree.
     * @returns {string} JSON string map.
     */
    getFactorsJson() {
        if (!this.session) return "{}";
        return this.session.instance.get_factors_json();
    }

    /**
     * Retrieves the JSON string containing unresolved nodes in the tree.
     * @returns {string} JSON array string.
     */
    getUnresolvedJson() {
        if (!this.session) return "[]";
        return this.session.instance.get_unresolved_json();
    }
}
