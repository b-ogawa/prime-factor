/**
 * @module js/state/index
 * @description アプリケーションの状態管理とステートマシンのメニュー表（契約の真のソース）。
 */

/**
 * @class Store
 * @description アプリケーションのグローバル状態（設定、ハードウェアプロファイル、実行時ステート）を管理するストア。
 * @extends EventEmitter
 * 
 * @method getState
 * @description Retrieves the current state tree.
 * @precondition None.
 * @postcondition Returns a reference to the internal state object.
 * @returns {Object} The complete application state.
 * 
 * @method dispatch
 * @description Dispatches an action to mutate the state and emits change events.
 * @precondition `action` must be an object with a `type` string.
 * @postcondition The state is immutably updated according to the action type. Relevant events are emitted.
 * @param {Object} action - The action object containing `type` and optional `payload`.
 */
export { Store } from './store.js';

/**
 * @type {Store}
 * @description 全体のステート（状態）を保持し、変更を監視・通知するシングルトンストアインスタンス。
 */
export { store } from './store.js';

/**
 * 状態を変更するためのアクション名の定義一覧。
 */
export { ActionTypes } from './store.js';

/**
 * @class EngineStateMachine
 * @description エンジンの状態（実行中、停止中など）の遷移を管理する有限ステートマシン。
 * @extends EventEmitter
 * 
 * @method transition
 * @description Transitions the engine to a new state if valid.
 * @precondition `newState` must be a valid state constant.
 * @postcondition Transitions state and emits 'engineStateChanged' event.
 * @param {string} newState - The destination state to transition to.
 * 
 * @method get
 * @description Gets the current state value.
 * @returns {string} The active state constant.
 * 
 * @method is
 * @description Checks if the machine is currently in the specified state.
 * @param {string} state - State constant to compare against.
 * @returns {boolean} True if active state matches, false otherwise.
 */
export { EngineStateMachine } from './state_machine.js';

/** ステート群定数 */
export { 
    STATE_IDLE, STATE_INITIALIZING, STATE_RUNNING, 
    STATE_STOPPING, STATE_COMPLETED, STATE_ABORTED 
} from './state_machine.js';

