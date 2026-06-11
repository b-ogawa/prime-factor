/**
 * @module js/types/typedefs
 * @description Centralized JSDoc type definitions for the factorization process.
 * This file is not executed at runtime, but serves as a documentation reference.
 */

/**
 * @typedef {Object} FactorizationInputParams
 * @property {string} inputStr - The integer string to factor.
 * @property {number} trialLimit - Sieve limit or trial division bound.
 * @property {number} b1 - ECM B1 parameter.
 * @property {number} p1Limit - Pollard P-1 parameter limit.
 * @property {boolean} detailedMode - Whether detailed mode is enabled.
 * @property {boolean} concurrentPortfolio - Whether concurrent portfolio searching (SIQS+ECM) is enabled.
 * @property {number} siqsCores - Number of cores dedicated to SIQS in portfolio mode.
 */

/**
 * @typedef {Object} SingleCoreStatus
 * @property {string} phase - The current execution phase (e.g., 'IDLE', 'ECM', 'SIQS').
 * @property {string} detail - Additional progress details from the thread.
 */

/**
 * @typedef {Object.<number, SingleCoreStatus>} CoreStatusMap
 */

/**
 * @typedef {Object} WasmSessionMetrics
 * @property {number} factorsCount - Number of resolved factors.
 * @property {number} relationsCount - SIQS relations collected.
 * @property {number} polyCount - SIQS polynomials searched.
 */
