/**
 * @module js/orchestration/index
 * @description 状態遷移やアルゴリズムの制御を統括するエンジンのメニュー表（契約の真のソース）。
 */

/**
 * @class FactorizationEngine
 * @description 全体の素因数分解フローを管理・オーケストレーションするメインエンジンクラス。
 * @extends EventEmitter
 * 
 * @method start
 * @description Starts the factorization process for a given input.
 * @precondition The engine must be in the IDLE state. `inputParams` must contain `inputStr` and other configs.
 * @postcondition Engine transitions to INITIALIZING. Store configuration is updated. A new factorization session is created.
 * @sideeffects Initializes the WASM session and WebWorkers. Dispatches actions to Store.
 * @param {Object} inputParams - Configuration parameters including `inputStr`, limits, and detailed mode options.
 * 
 * @method stop
 * @description Gracefully halts the active factorization processes.
 * @precondition The engine must be in the RUNNING or INITIALIZING state.
 * @postcondition Engine transitions to STOPPING. Workers and metrics observer are requested to stop.
 * @sideeffects Sets up a timeout to force-halt workers if they do not respond.
 * 
 * @method clear
 * @description Clears the current factorization session from memory and resets store state.
 * @precondition The engine must not be in the RUNNING, INITIALIZING, or STOPPING state.
 * @postcondition Resets the state machine to IDLE. Frees the WASM session. Dispatches state resets to Store.
 * @sideeffects Resets runtime configuration, triggers 'clearLogs' event.
 */
export { FactorizationEngine } from './engine.js';

/**
 * @class WasmSessionManager
 * @description WASMインスタンスの初期化と共有メモリ等の状態を管理するマネージャ。
 * 
 * @method createSession
 * @description Creates a new WASM factorization session for the target string.
 * @precondition targetStr is a valid integer string.
 * @postcondition The old session is freed and a new one is initialized.
 * @param {string} targetStr - The target number to factorize.
 * @returns {Object} The created session instance.
 * 
 * @method freeSession
 * @description Frees the active WASM session resources.
 * @postcondition The session object is freed and set to null.
 * 
 * @method getNextAction
 * @description Obtains the next orchestrated action type from the WASM engine.
 * @returns {number|null} Action type enum value or null if no session.
 * 
 * @method getCurrentTarget
 * @description Gets the currently active factorization target node value.
 * @returns {string} Target number string.
 * 
 * @method factorLocally
 * @description Runs local trial division / prime checks inside WASM.
 * @param {string} target - The target node string.
 * @returns {boolean} Whether the target was successfully factored locally.
 * 
 * @method reportPrime
 * @description Reports a proven prime factor to the WASM tree.
 * @param {string} target - The target node string.
 * 
 * @method reportFactor
 * @description Reports a discovered factor of a node to the WASM tree.
 * @param {string} target - The target node string.
 * @param {string} factor - The discovered factor string.
 * 
 * @method reportExhausted
 * @description Reports that a target's search space was exhausted up to b1.
 * @param {string} target - The target node string.
 * @param {number} b1Tested - The maximum B1 value tested.
 * 
 * @method getEcmB1Tested
 * @description Gets the maximum B1 value that has already been tested for a target node.
 * @param {string} target - The target node string.
 * @returns {number} Tested B1 bound.
 * 
 * @method getMetricsPtr
 * @description Returns a pointer to the WASM metrics array in shared memory.
 * @returns {number|null} Native pointer or null.
 * 
 * @method getFactorsJson
 * @description Retrieves the JSON string containing factors resolved in the tree.
 * @returns {string} JSON string map.
 * 
 * @method getUnresolvedJson
 * @description Retrieves the JSON string containing unresolved nodes in the tree.
 * @returns {string} JSON array string.
 */
export { WasmSessionManager } from './wasm_session_manager.js';

/**
 * @class SIQSCoordinator
 * @description 並列SIQSの初期化、タスク分配、リレーション集約を行うコーディネーター。
 * @extends EventEmitter
 * 
 * @method runPipeline
 * @description Initializes and starts the SIQS factorization pipeline for a specific target.
 * @precondition Target `N` must be established. A valid `session` and `workerPool` must be provided.
 * @postcondition Worker tasks for SIQS collection are generated and broadcasted. Event listeners are updated.
 * @sideeffects Retrieves parameters from WASM. Overrides parameters based on `store.getState().userConfig`.
 * @param {BigInt|string} N - The number to factor.
 * @param {number[]} workerIds - Array of active worker IDs.
 * @param {string} sessionId - The current factorization session ID.
 * @param {Object} session - The WASM FactorizationSession adapter instance.
 * @param {Object} workerPool - The WorkerPool instance for task distribution.
 * 
 * @method handleRelation
 * @description Processes incoming relations from workers via ring buffers.
 * @precondition The coordinator must be active and the session ID must match.
 * @postcondition Increments relations count and triggers matrix reduction if target count is reached.
 * @param {Object} data - Message containing workerId and sessionId.
 * 
 * @method stop
 * @description Safely stops the relation collection pipeline.
 * @postcondition The active flag is set to false.
 */
export { SIQSCoordinator } from './siqs_coordinator.js';

/**
 * @class MetricsObserver
 * @description メトリクス（進行状況、経過時間など）の計測と更新を行うオブザーバー。
 * 
 * @method start
 * @description Starts the execution timer and schedules periodical metrics sync.
 * @postcondition timerInterval is active, state dispatch loop is running.
 * 
 * @method stop
 * @description Stops the active timer interval.
 * @postcondition timerInterval is cleared.
 * 
 * @method updateStoreMetrics
 * @description Pulls factors, unresolved nodes and speed stats from WASM memory and dispatches them to the Store.
 * @sideeffects Dispatches stats update actions to store. Logs parsing errors if JSON decoding fails.
 */
export { MetricsObserver } from './metrics_observer.js';

/**
 * @class MicroBenchmark
 * @description 初回ロード時にデバイスの性能を測定し、アルゴリズムのパラメータ（タイムアウトなど）をスケーリングするためのクラス。
 * 
 * @method run
 * @static
 * @description Measures the device's performance through a micro-benchmark multiplication run.
 * @returns {number} The scaling factor (safeguarded between 0.1 and 5.0) relative to a standard baseline.
 */
export { MicroBenchmark } from './benchmark.js';

