/**
 * @fileoverview メインスレッドとWebWorker間で送受信されるメッセージの定数定義およびビルダー。
 * @description メッセージには「メインスレッドから指示するコマンド（MSG_CMD_*）」と「Workerから状態・結果を応答するイベント（MSG_TYPE_*）」の2種類があります。
 */

// --- Main -> Worker Commands ---
/** @type {string} Worker初期化コマンド。SharedArrayBufferやふるい範囲を設定 */
export const MSG_CMD_INIT = "INIT";
/** @type {string} 現在の計算を即時停止させるコマンド */
export const MSG_CMD_STOP = "STOP";
/** @type {string} SIQSによるふるい落とし計算の開始コマンド */
export const MSG_CMD_SIQS_FACTORIZE = "SIQS_FACTORIZE";
/** @type {string} 逐次因子探索（BPSW, TrialDiv, Rho/P-1, ECM）の開始コマンド */
export const MSG_CMD_FACTORIZE = "FACTORIZE";

// --- Worker -> Main Event Types ---
/** @type {string} WASMモジュールのロードと初期化の完了通知 */
export const MSG_TYPE_WASM_READY = "WASM_READY";
/** @type {string} コアおよび素数テーブルの初期化完了通知 */
export const MSG_TYPE_INIT_COMPLETE = "INIT_COMPLETE";
/** @type {string} ログ出力メッセージ */
export const MSG_TYPE_LOG = "LOG";
/** @type {string} 進捗・フェーズ更新通知 */
export const MSG_TYPE_PHASE_UPDATE = "PHASE_UPDATE";
/** @type {string} 素数が発見（確定）されたことの通知 */
export const MSG_TYPE_PRIME_FOUND = "PRIME_FOUND";
/** @type {string} 合成数の因数（factor）が発見されたことの通知 */
export const MSG_TYPE_FACTOR_FOUND = "FACTOR_FOUND";
/** @type {string} 指定された上限までで因数が見つからなかったこと（探索完了）の通知 */
export const MSG_TYPE_EXHAUSTED = "EXHAUSTED";
/** @type {string} SIQSで新しいリレーションが発見されたことのシグナル（詳細データはSAB経由） */
export const MSG_TYPE_RELATION_FOUND = "RELATION_FOUND";
/** @type {string} 中止処理（STOP）が完了したことの応答シグナル */
export const MSG_TYPE_STOP_ACK = "STOP_ACK";

/**
 * 送受信する各種メッセージのオブジェクト生成ユーティリティ。
 */
export const Messages = {
    /**
     * @param {number} workerId
     * @param {number} sieveLimit
     * @param {SharedArrayBuffer} sab
     * @returns {{cmd: string, workerId: number, params: {sieveLimit: number, sab: SharedArrayBuffer}}}
     */
    createInit(workerId, sieveLimit, sab) {
        return { cmd: MSG_CMD_INIT, workerId, params: { sieveLimit, sab } };
    },

    /**
     * @returns {{cmd: string}}
     */
    createStop() {
        return { cmd: MSG_CMD_STOP };
    },

    /**
     * @param {string} target ターゲット数（10進数文字列）
     * @param {string} kN k*N の値（10進数文字列）
     * @param {string} sessionId 因数分解セッションのUUID/ID
     * @param {object} params SIQS実行パラメータ群
     * @returns {{cmd: string, target: string, kN: string, sessionId: string, params: object}}
     */
    createSiqsFactorize(target, kN, sessionId, params) {
        return { cmd: MSG_CMD_SIQS_FACTORIZE, target, kN, sessionId, params };
    },

    /**
     * @param {string} target ターゲット数（10進数文字列）
     * @param {string} sessionId 因数分解セッションのUUID/ID
     * @param {object} params 探索パラメータ（maxCurves, b1, trialLimit, rhoLimit等）
     * @returns {{cmd: string, target: string, sessionId: string, params: object}}
     */
    createFactorize(target, sessionId, params) {
        return { cmd: MSG_CMD_FACTORIZE, target, sessionId, params };
    },

    /**
     * @param {number} workerId
     * @param {string|null} sessionId
     * @param {string} msg ログメッセージ内容
     * @param {string} level ログレベル（"sys" | "error" | "info" 等）
     * @returns {{type: string, workerId: number, sessionId: (string|null), msg: string, level: string}}
     */
    createLog(workerId, sessionId, msg, level) {
        return { type: MSG_TYPE_LOG, workerId, sessionId, msg, level };
    },

    /**
     * @param {number} workerId
     * @param {string} sessionId
     * @param {string} target ターゲット数（10進数文字列）
     * @returns {{type: string, workerId: number, sessionId: string, target: string}}
     */
    createPrimeFound(workerId, sessionId, target) {
        return { type: MSG_TYPE_PRIME_FOUND, workerId, sessionId, target };
    },

    /**
     * @param {number} workerId
     * @param {string} sessionId
     * @param {string} target ターゲット数（10進数文字列）
     * @param {string} factor 発見された因数（10進数文字列）
     * @param {string} method 発見に使用した手法名（"ECM (WASM)" 等）
     * @returns {{type: string, workerId: number, sessionId: string, target: string, factor: string, method: string}}
     */
    createFactorFound(workerId, sessionId, target, factor, method) {
        return { type: MSG_TYPE_FACTOR_FOUND, workerId, sessionId, target, factor, method };
    },

    /**
     * @param {number} workerId
     * @param {string} sessionId
     * @param {string} target ターゲット数（10進数文字列）
     * @param {number} b1Tested テスト済みの B1 限界値
     * @returns {{type: string, workerId: number, sessionId: string, target: string, b1Tested: number}}
     */
    createExhausted(workerId, sessionId, target, b1Tested) {
        return { type: MSG_TYPE_EXHAUSTED, workerId, sessionId, target, b1Tested };
    }
};
