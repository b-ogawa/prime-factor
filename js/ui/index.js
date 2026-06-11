/**
 * @module js/ui/index
 * @description UIコンポーネント制御のメニュー表（契約の真のソース）。
 */

/**
 * @class UIController
 * @description DOM操作、イベントハンドリング、UI状態の更新を統括するコントローラークラス。
 * 
 * @method requestRender
 * @description Schedules a UI render operation in the next requestAnimationFrame.
 * @postcondition Triggers the render function with the current store state.
 * 
 * @method log
 * @description Appends a log line to the interactive UI console.
 * @param {string} message - Log payload message.
 * @param {string} [type="default"] - Log style level ("default"|"success"|"error"|"warning"|"info"|"sys").
 * 
 * @method clearLogs
 * @description Flushes the interactive UI console history.
 * @postcondition The console log innerHTML is reset.
 */
export { UIController } from './ui.js';

