/**
 * @module js/interop/index
 * @description WASM連携用の抽象化層メニュー表（契約の真のソース）。
 */

/**
 * @namespace WasmAdapter
 * @description WASMとJS間のポインタ操作や配列変換を行う低レベルAPIのラッパー群。
 * 
 * @property {Object|null} wasm - WebAssembly instance injected at runtime.
 * 
 * @method getMemoryBuffer
 * @description Retrieves the raw linear memory ArrayBuffer of WebAssembly.
 * @precondition `wasm` instance must be set.
 * @postcondition Returns a reference to the active buffer. (Note: May detach upon memory expansion, re-query as needed).
 * @returns {ArrayBuffer} WebAssembly memory buffer.
 * 
 * @method getMetricsArray
 * @description Obtains a u32 array view mapped to a specific pointer in WASM memory.
 * @precondition Pointer `ptr` must point to valid WASM linear memory boundaries and `length` must be safe.
 * @param {number} ptr - WASM memory pointer.
 * @param {number} length - Number of u32 elements.
 * @returns {Uint32Array} TypedArray view mapped to WASM memory.
 * 
 * @method getSlotBuffer
 * @description Obtains a u8 array view (slot buffer) mapped to a specific pointer in WASM memory.
 * @precondition `ptr` and `size` must match valid slot boundaries.
 * @param {number} ptr - WASM memory pointer.
 * @param {number} size - Number of bytes to read.
 * @returns {Uint8Array} TypedArray view mapped to WASM memory.
 * 
 * @method isPrime
 * @description Runs a BPSW primality test via WASM.
 * @precondition `bigIntNum` must be a positive integer.
 * @param {bigint} bigIntNum - Number to test.
 * @returns {boolean} True if prime, false if composite.
 * 
 * @method pollardP1
 * @description Runs Pollard's P-1 factorization method in WASM.
 * @precondition `bigIntNum` must be BigInt, `limit` must be a positive integer.
 * @param {bigint} bigIntNum - Number to factorize.
 * @param {number} limit - Search bound.
 * @param {number[]} sievedPrimes - Array of trial primes.
 * @param {number} workerId - Worker index.
 * @returns {bigint|null} Discovered factor or null.
 * 
 * @method pollardRho
 * @description Runs Pollard's Rho (Brent version) method in WASM.
 * @precondition `bigIntNum` must be BigInt, `limit` must be a positive integer.
 * @param {bigint} bigIntNum - Number to factorize.
 * @param {number} limit - Search loop limit.
 * @param {number} workerId - Worker index.
 * @returns {bigint|null} Discovered factor or null.
 * 
 * @method createEcmRunner
 * @description Spawns a new Elliptic Curve Method (ECM) runner instance in WASM.
 * @precondition `bigIntNum` must be BigInt, `b1` must be a positive integer.
 * @postcondition The caller must explicitly call `free()` or use `using` to release WASM resources.
 * @param {bigint} bigIntNum - Target number to search factors for.
 * @param {number} b1 - First stage limit bound.
 * @returns {EcmRunner} Native WASM EcmRunner instance.
 * 
 * @method ecmRunCurves
 * @description Runs ECM curves on an active runner.
 * @precondition `runner` must be a valid, un-freed EcmRunner instance.
 * @param {EcmRunner} runner - ECM runner instance.
 * @param {number} curves_to_run - Number of curves to execute.
 * @returns {bigint|null} Discovered factor or null.
 * 
 * @method runMicroBenchmark
 * @description Executes the WASM micro-benchmark.
 * @returns {number} Score representing multiplication performance (higher is faster).
 * 
 * @method createSession
 * @description Spawns a new FactorizationSession in WASM wrapped in a SafeWasmWrapper.
 * @precondition `nStr` must be a valid integer string representation.
 * @postcondition Returns a wrapper that manages WASM memory release.
 * @param {string} nStr - Factorization target.
 * @returns {SafeWasmWrapper} Safe wrapper instance.
 */
export { WasmAdapter } from './wasm_adapter.js';

/**
 * @class SafeWasmWrapper
 * @description WebAssemblyのヒープ領域で確保されたインスタンスの自動解放を管理するラッパー。
 * 
 * @method free
 * @description Explicitly frees the WASM memory resource. Prevents double free.
 * @postcondition Native object `free()` is called and `isFreed` is set to true.
 */
export { SafeWasmWrapper } from './wasm_adapter.js';

