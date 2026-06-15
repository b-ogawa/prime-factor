import { 
    Messages, 
    MSG_CMD_INIT, 
    MSG_CMD_STOP, 
    MSG_CMD_SIQS_FACTORIZE, 
    MSG_CMD_FACTORIZE, 
    MSG_TYPE_WASM_READY, 
    MSG_TYPE_INIT_COMPLETE 
} from '../utils/messages.js';
import { bigIntToBytesLE } from '../utils/index.js';
import { WasmAdapter } from '../interop/index.js';
import { ctx } from './context.js';
import { runParallelSIQS } from './siqs.js';
import init, { is_prime_bpsw_bytes, sieve_primes_wasm, EcmRunner, SiqsWorker } from '../wasm/wasm_engine.js';

// Polyfill Symbol.dispose if not present
if (typeof Symbol !== 'undefined' && !Symbol.dispose) {
    Object.defineProperty(Symbol, 'dispose', {
        value: Symbol('Symbol.dispose'),
        configurable: false,
        enumerable: false,
        writable: false
    });
}

// Augment WASM class prototypes to support JS `using` syntax directly
[EcmRunner, SiqsWorker].forEach(cls => {
    if (cls && cls.prototype && !cls.prototype[Symbol.dispose]) {
        cls.prototype[Symbol.dispose] = function() {
            this.free();
        };
    }
});


/**
 * @fileoverview WebWorkerのメインエントリポイント。
 * @description メインスレッドからの制御コマンドを受信し、BPSW、試し割り、Pollard's Rho/P-1、ECM、SIQS などの素因数分解アルゴリズムを順次実行し、結果をポストします。
 */

const PHASE_ECM_WASM = "ECM Phase (WASM)";

// Load WASM
let wasmReadyPromise = init().then((wasm) => {
    ctx.wasmInstance = wasm;
    postMessage({ type: MSG_TYPE_WASM_READY, workerId: ctx.workerId });
}).catch(console.error);

ctx.wasmReadyPromise = wasmReadyPromise;

/**
 * コマンド文字列に対応するハンドラー関数のマッピング。
 * @type {Object<string, function(object): Promise<void>>}
 */
const commandHandlers = {
    [MSG_CMD_INIT]: (data) => handleInitCommand(data),
    [MSG_CMD_STOP]: (data) => handleStopCommand(data),
    [MSG_CMD_SIQS_FACTORIZE]: (data) => handleSiqsFactorizeCommand(data),
    [MSG_CMD_FACTORIZE]: (data) => handleFactorizeCommand(data),
};

/**
 * メインスレッドからのポストメッセージを受信するイベントハンドラー。
 * 
 * @precondition 送信される `e.data` は `{ cmd: string }` を含み、各 `MSG_CMD_*` に準拠した構造であること。
 * @postcondition 対応するコマンドハンドラーが非同期実行される。
 * @param {MessageEvent} e メッセージイベントオブジェクト。
 */
self.onmessage = async (e) => {
    const data = e.data;
    const handler = commandHandlers[data.cmd];
    if (handler) {
        await handler(data);
    }
};

/**
 * 初期化コマンドを処理する。WASMのロード完了を待ち、アボート管理用のSharedArrayBufferを接続し、素数テーブルを初期化する。
 * 
 * @precondition data は `{ workerId: number, params: { sieveLimit: number, sab: SharedArrayBuffer } }` を含むこと。
 * @postcondition `ctx.sievedPrimes` が初期化され、メインスレッドに `MSG_TYPE_INIT_COMPLETE` メッセージが送信される。
 * @param {object} data コマンドパラメータデータ。
 */
async function handleInitCommand(data) {
    ctx.workerId = data.workerId;
    let sieveLimit = data.params.sieveLimit;
    let sab = data.params.sab;
    
    try {
        await wasmReadyPromise;
        ctx.initRingBuffer(sab);
        ctx.sievedPrimes = sieve_primes_wasm(sieveLimit);
        postMessage(Messages.createLog(ctx.workerId, ctx.currentSessionId, "Core online & Primes sieved.", "sys"));
        postMessage({ type: MSG_TYPE_INIT_COMPLETE, workerId: ctx.workerId });
    } catch (err) {
        console.error("WASM Init failed", err);
        postMessage(Messages.createLog(ctx.workerId, ctx.currentSessionId, "WASM Initialization Failed: " + err, "error"));
    }
}

/**
 * 停止コマンドを処理し、計算中止フラグを立て、各種セッション状態をクリアする。
 * 
 * @precondition なし。
 * @postcondition `ctx.shouldStop` が true になり、メインスレッドへ `STOP_ACK` が応答される。
 * @param {object} data コマンドパラメータデータ。
 */
async function handleStopCommand(data) {
    ctx.shouldStop = true;
    ctx.stopAckSent = false;
    ctx.currentTaskId = null;
    ctx.currentSessionId = null;
    
    postMessage({ type: "STOP_ACK", workerId: ctx.workerId });
    ctx.stopAckSent = true;
}

/**
 * SIQS（自己初期化二次ふるい法）による因数分解コマンドを処理する。
 * 実行前にターゲット値の素数判定を行い、素数であればそのまま通知、合成数であればSIQS実行パイプラインに入る。
 * 
 * @precondition data は `{ target: string, kN: string, sessionId: string, params: object }` を含むこと。
 * @postcondition 素数であれば `MSG_TYPE_PRIME_FOUND`、合成数であれば `runParallelSIQS` 内で因数発見時に `MSG_TYPE_FACTOR_FOUND` が送信される。
 * @param {object} data コマンドパラメータデータ。
 */
async function handleSiqsFactorizeCommand(data) {
    ctx.shouldStop = false;
    ctx.stopAckSent = false;
    ctx.currentTaskId = BigInt(data.target);
    ctx.currentSessionId = data.sessionId;
    
    // Primality check before attempting SIQS
    let n_bytes = bigIntToBytesLE(BigInt(data.target));
    if (is_prime_bpsw_bytes(n_bytes)) {
        if (ctx.workerId === 0) {
            postMessage(Messages.createPrimeFound(ctx.workerId, data.sessionId, data.target));
        }
        return;
    }

    await runParallelSIQS(data.target, data.kN, data.params, ctx, BigInt(data.target), data.sessionId);
}

/**
 * 逐次因子探索（BPSW, 試し割り, Pollard's P-1 / Rho, ECM）コマンドを処理する。
 * 探索パイプラインを順次実行し、いずれかのアルゴリズムで因数が発見されるか、全探索の上限に達するまで稼働する。
 * 
 * @precondition data は `{ target: string, sessionId: string, params: object }` を含むこと。
 * @postcondition 因数発見時は `MSG_TYPE_FACTOR_FOUND`、全探索で未発見時は `MSG_TYPE_EXHAUSTED` メッセージが送信される。
 * @param {object} data コマンドパラメータデータ。
 */
async function handleFactorizeCommand(data) {
    ctx.shouldStop = false;
    ctx.stopAckSent = false;
    ctx.currentTaskId = BigInt(data.target);
    ctx.currentSessionId = data.sessionId;
    
    let M = BigInt(data.target);
    let params = data.params;
    try {
        const pipeline = [
            async () => runBpswStrategy(M, ctx),
            async () => runTrialDivisionStrategy(M, params, ctx),
            async () => runPollardP1Strategy(M, params, ctx),
            async () => runPollardRhoStrategy(M, params, ctx),
            async () => runEcmStrategy(M, params, ctx)
        ];

        for (let strategy of pipeline) {
            if (ctx.checkAbort()) return;
            let result = await strategy();
            if (result === true) return; // True means factor found and handled
        }

        if (!ctx.shouldStop && ctx.currentTaskId === M) {
            postMessage(Messages.createExhausted(ctx.workerId, ctx.currentSessionId, data.target, params.b1 || 0));
        }
    }
    catch (err) {
        postMessage(Messages.createLog(ctx.workerId, ctx.currentSessionId, "Exception: " + err.message, "error"));
    }
}

// --- Strategies ---

/**
 * BPSW（Baillie-PSW）素数判定戦略を実行する。
 * 
 * @precondition M は正の奇数（BigInt）であること。
 * @postcondition M が素数の場合、worker 0から PRIME_FOUND が送信され、結果として true を返す。
 * @param {bigint} M 判定対象の数値。
 * @param {WorkerContext} ctx ワーカーコンテキスト。
 * @returns {Promise<boolean>} 素数であれば true、合成数なら false。
 */
async function runBpswStrategy(M, ctx) {
    ctx.sendPhase("BPSW Test", "Primality check", true);
    if (WasmAdapter.isPrime(M)) {
        if (ctx.workerId === 0) postMessage(Messages.createPrimeFound(ctx.workerId, ctx.currentSessionId, M.toString()));
        return true;
    }
    return false;
}

/**
 * 試し割り法（Trial Division）戦略を実行する。
 * 
 * @precondition M は BigInt、params.trialLimit は整数であること。
 * @postcondition 因数が見つかった場合、FACTOR_FOUND または PRIME_FOUND を送信し true を返す。
 * @param {bigint} M 探索対象の数値。
 * @param {object} params 設定パラメータ。
 * @param {WorkerContext} ctx ワーカーコンテキスト。
 * @returns {Promise<boolean>} 因数が見つかれば true、見つからなければ false。
 */
async function runTrialDivisionStrategy(M, params, ctx) {
    if (ctx.workerId !== 0 || params.trialLimit <= 0) return false;
    ctx.sendPhase("Trial Div", "up to " + params.trialLimit, true);
    let currentVal = M;
    for (let p of ctx.sievedPrimes) {
        let pBig = BigInt(p);
        if (pBig * pBig > currentVal) {
            postMessage(Messages.createPrimeFound(ctx.workerId, ctx.currentSessionId, M.toString()));
            return true;
        }
        if (pBig > BigInt(params.trialLimit)) break;
        if (currentVal % pBig === 0n) {
            postMessage(Messages.createFactorFound(ctx.workerId, ctx.currentSessionId, M.toString(), p.toString(), "Trial Division"));
            return true;
        }
        if (ctx.checkAbort()) return true;
    }
    return false;
}

/**
 * Pollard's P-1 法戦略を実行する。
 * 
 * @precondition M は BigInt、params.p1Limit は正の整数であること。
 * @postcondition 因数が発見された場合、FACTOR_FOUND を送信し true を返す。
 * @param {bigint} M 探索対象の数値。
 * @param {object} params 設定パラメータ。
 * @param {WorkerContext} ctx ワーカーコンテキスト。
 * @returns {Promise<boolean>} 因数が見つかれば true、見つからなければ false。
 */
async function runPollardP1Strategy(M, params, ctx) {
    if (params.p1Limit <= 0 || params.p1Iters === 0) return false;
    
    let iters = params.p1Iters || 1;
    let isInfinite = iters === Infinity;
    
    for (let iter = 0; isInfinite || iter < iters; iter++) {
        if (ctx.checkAbort()) return true;
        let iterLabel = isInfinite ? `Iter ${iter+1}` : `Iter ${iter+1}/${iters}`;
        ctx.sendPhase(`Pollard P-1 (${iterLabel})`, `Limit=${params.p1Limit}`, true);
        
        let b2Multiplier = params.p1B2Multiplier || 10;
        let factor = WasmAdapter.pollardP1(M, params.p1Limit, b2Multiplier, ctx.sievedPrimes, ctx.workerId + iter);
        if (factor) {
            postMessage(Messages.createFactorFound(ctx.workerId, ctx.currentSessionId, M.toString(), factor.toString(), "P-1"));
            return true;
        }
        await new Promise(r => setTimeout(r, 0));
    }
    return false;
}

/**
 * Pollard's Rho 法戦略を実行する。
 * 
 * @precondition M は BigInt、params.rhoLimit は正の整数であること。
 * @postcondition 因数が発見された場合、FACTOR_FOUND を送信し true を返す。
 * @param {bigint} M 探索対象の数値.
 * @param {object} params 設定パラメータ。
 * @param {WorkerContext} ctx ワーカーコンテキスト。
 * @returns {Promise<boolean>} 因数が見つかれば true、見つからなければ false。
 */
async function runPollardRhoStrategy(M, params, ctx) {
    if (params.rhoLimit <= 0 || params.brentIters === 0) return false;
    
    let iters = params.brentIters || 1;
    let isInfinite = iters === Infinity;
    
    for (let iter = 0; isInfinite || iter < iters; iter++) {
        if (ctx.checkAbort()) return true;
        let iterLabel = isInfinite ? `Iter ${iter+1}` : `Iter ${iter+1}/${iters}`;
        ctx.sendPhase(`Brent (${iterLabel})`, `Limit=${params.rhoLimit}`, true);
        
        let factor = WasmAdapter.pollardRho(M, params.rhoLimit, ctx.workerId + iter);
        if (factor) {
            postMessage(Messages.createFactorFound(ctx.workerId, ctx.currentSessionId, M.toString(), factor.toString(), "Brent"));
            return true;
        }
        await new Promise(r => setTimeout(r, 0));
    }
    return false;
}

/**
 * 楕円曲線法（ECM）戦略を実行する。
 * WASM側のEcmRunnerを生成し、指定カーブ数分ループを回しながら判定を行う。
 * 
 * @precondition M は BigInt、params.b1, params.maxCurves は正の整数であること。
 * @postcondition 因数が発見された場合、FACTOR_FOUND を送信し true を返す。
 * @param {bigint} M 探索対象の数値。
 * @param {object} params 設定パラメータ。
 * @param {WorkerContext} ctx ワーカーコンテキスト。
 * @returns {Promise<boolean>} 因数が見つかれば true、見つからなければ false。
 */
async function runEcmStrategy(M, params, ctx) {
    if (params.maxCurves <= 0 || params.ecmIters === 0) return false;
    ctx.sendPhase(PHASE_ECM_WASM, "B1=" + params.b1, true);

    let isInfinite = params.ecmIters === Infinity;
    let chunk_size = 10;
    let curves_run = 0;

    while (isInfinite || curves_run < params.maxCurves) {
        if (ctx.checkAbort() || ctx.currentTaskId !== M) return true;

        let b2Multiplier = params.ecmB2Multiplier || 50;
        using ecmRunner = WasmAdapter.createEcmRunner(M, params.b1, b2Multiplier);
        let curves_to_run = isInfinite ? chunk_size : Math.min(chunk_size, params.maxCurves - curves_run);
        
        let progressStr = isInfinite ? `Curves ${curves_run}` : `Curves ${curves_run} / ${params.maxCurves}`;
        ctx.sendPhase(PHASE_ECM_WASM, progressStr, true);

        let factor = WasmAdapter.ecmRunCurves(ecmRunner, curves_to_run);
        if (factor) {
            postMessage(Messages.createFactorFound(ctx.workerId, ctx.currentSessionId, M.toString(), factor.toString(), "ECM"));
            return true;
        }

        curves_run += curves_to_run;
        if (ctx.checkAbort()) return true;
        await new Promise(r => setTimeout(r, 0));
    }
    return false;
}
