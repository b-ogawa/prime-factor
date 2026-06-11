/**
 * @fileoverview JSとWASM(Rust)間の低レベル連携を抽象化・カプセル化するアダプター。
 * @description WASMヒープメモリからの直接読み込み（ポインタ経由）や、BigInt型からリトルエンディアンバイト配列（WASMが期待する形式）への変換を安全に行うインターフェースを提供します。
 */

import { is_prime_bpsw_bytes, pollard_p1_bytes, pollard_brent_bytes, EcmRunner, run_micro_benchmark, FactorizationSession, ActionType } from '../wasm/wasm_engine.js';
import { bigIntToBytesLE, bytesToBigIntLE } from '../utils/index.js';
 
/**
 * WASM連携APIおよびメモリバッファの取得ユーティリティ。
 */
export const WasmAdapter = {
    /** @type {object|null} WebAssemblyインスタンス（メインスレッド側で初期化時に注入される） */
    wasm: null,

    /**
     * WebAssemblyの全線形メモリのArrayBufferを取得する。
     * 
     * @precondition wasm インスタンスがセットされていること。
     * @postcondition WASMメモリのサイズ拡張によって、参照しているArrayBufferがデタッチ（無効化）される可能性があるため、読み出しの度に毎回再取得すること。
     * @returns {ArrayBuffer} WebAssemblyメモリバッファ。
     */
    getMemoryBuffer() {
        return this.wasm.memory.buffer;
    },

    /**
     * WASMの指定ポインタから指定長さのu32配列ビューを取得する。
     * 
     * @precondition ポインタ ptr が指す先が有効な境界内であり、要素数 length がメモリを超えないこと。
     * @param {number} ptr WASMメモリポインタ。
     * @param {number} length 要素数 (u32 の個数)。
     * @returns {Uint32Array} メモリ領域にマップされたTypedArrayビュー。
     */
    getMetricsArray(ptr, length) {
        return new Uint32Array(this.wasm.memory.buffer, ptr, length);
    },

    /**
     * WASMの指定ポインタから指定サイズのバイトビュー（Uint8Array）を取得する。
     * 
     * @precondition ptr および size が正しいWASMのメモリ配置と整合していること。
     * @param {number} ptr WASMメモリポインタ。
     * @param {number} size 読み込むバイト数。
     * @returns {Uint8Array} メモリ領域にマップされたTypedArrayビュー。
     */
    getSlotBuffer(ptr, size) {
        return new Uint8Array(this.wasm.memory.buffer, ptr, size);
    },

    /**
     * BPSWテストにより素数かどうか判定する。
     * 
     * @precondition bigIntNum は正の整数であること。
     * @param {bigint} bigIntNum 判定対象の数値（BigInt）。
     * @returns {boolean} 素数であれば true、合成数なら false。
     */
    isPrime(bigIntNum) {
        let bytes = bigIntToBytesLE(bigIntNum);
        return is_prime_bpsw_bytes(bytes);
    },

    /**
     * Pollard's P-1 法を用いて因数を探索する。
     * 
     * @precondition bigIntNum は BigInt、limit は正の整数であること。
     * @param {bigint} bigIntNum 探索対象の数値。
     * @param {number} limit 探索限界値。
     * @param {number[]} sievedPrimes 試し割り用の素数テーブル。
     * @param {number} workerId ワーカーID。
     * @returns {bigint|null} 発見された因数（BigInt）、または見つからなければ null。
     */
    pollardP1(bigIntNum, limit, sievedPrimes, workerId) {
        let bytes = bigIntToBytesLE(bigIntNum);
        let primesArr = new Uint32Array(sievedPrimes);
        let factorBytes = pollard_p1_bytes(bytes, limit, primesArr, workerId);
        return factorBytes ? bytesToBigIntLE(factorBytes) : null;
    },

    /**
     * Pollard's Rho（Brent版）法を用いて因数を探索する。
     * 
     * @precondition bigIntNum は BigInt、limit は正の整数であること。
     * @param {bigint} bigIntNum 探索対象の数値。
     * @param {number} limit 探索ループ上限。
     * @param {number} workerId ワーカーID。
     * @returns {bigint|null} 発見された因数（BigInt）、または見つからなければ null。
     */
    pollardRho(bigIntNum, limit, workerId) {
        let bytes = bigIntToBytesLE(bigIntNum);
        let factorBytes = pollard_brent_bytes(bytes, limit, workerId);
        return factorBytes ? bytesToBigIntLE(factorBytes) : null;
    },

    /**
     * 楕円曲線法(ECM)ランナーインスタンスを新しく生成する。
     * 
     * @precondition bigIntNum は BigInt、b1 は正の整数であること。
     * @postcondition 呼び出し側は使用後、明示的に `free()` または `using` 構文で破棄しなければならない。
     * @param {bigint} bigIntNum 探索対象の数値。
     * @param {number} b1 第1段階限界値 B1。
     * @returns {EcmRunner} WASM上のランナーオブジェクト。
     */
    createEcmRunner(bigIntNum, b1) {
        let bytes = bigIntToBytesLE(bigIntNum);
        return new EcmRunner(bytes, b1);
    },

    /**
     * 指定されたECMランナーで楕円曲線を実行する。
     * 
     * @precondition runner が有効な `EcmRunner` インスタンスであり、既に `free()` されていないこと。
     * @param {EcmRunner} runner ECMランナーインスタンス。
     * @param {number} curves_to_run 今回実行するカーブ数。
     * @returns {bigint|null} 発見された因数（BigInt）、または見つからなければ null。
     */
    ecmRunCurves(runner, curves_to_run) {
        let factorBytes = runner.run_curves(curves_to_run);
        return factorBytes ? bytesToBigIntLE(factorBytes) : null;
    },

    /**
     * マイクロベンチマークを実行する。
     * 
     * @returns {number} 処理パフォーマンス評価スコア（値が大きいほど高速）。
     */
    runMicroBenchmark() {
        return run_micro_benchmark();
    },

    /**
     * 因数分解のセッションオブジェクトを作成し、SafeWasmWrapperでラップする。
     * 
     * @precondition nStr は有効な10進数表現の数字文字列であること。
     * @postcondition 返されるラッパーは `using` または `free()` でのメモリ解放が保証されなければならない。
     * @param {string} nStr ターゲット数。
     * @returns {SafeWasmWrapper} 解放処理を保証したセッションオブジェクト。
     */
    createSession(nStr) {
        let wasmInstance = new FactorizationSession(nStr);
        return new SafeWasmWrapper(wasmInstance);
    }
};

// Polyfill Symbol.dispose if not present
if (typeof Symbol !== 'undefined' && !Symbol.dispose) {
    Object.defineProperty(Symbol, 'dispose', {
        value: Symbol('Symbol.dispose'),
        configurable: false,
        enumerable: false,
        writable: false
    });
}

/**
 * WebAssemblyのヒープ領域で確保されたインスタンスの自動解放を管理するラッパー。
 * `Symbol.dispose` をサポートしており、JSの `using` 構文によってスコープを外れる際に自動的に Rust 側のメモリを解放します。
 */
export class SafeWasmWrapper {
    /**
     * @param {object} instance WebAssemblyのバインディングインスタンス。
     */
    constructor(instance) {
        this.instance = instance;
        /** @type {boolean} すでにメモリが解放されたかどうかのフラグ */
        this.isFreed = false;
    }

    /**
     * インスタンスメモリを明示的に解放する。二重解放を防止する。
     * 
     * @precondition なし。
     * @postcondition 内部の WASM インスタンスの `free()` が呼ばれ、`isFreed` が true になる。
     */
    free() {
        if (!this.isFreed && this.instance) {
            try {
                this.instance.free();
            } catch (e) {
                console.warn("Error freeing WASM instance:", e);
            }
            this.isFreed = true;
            this.instance = null;
        }
    }

    /**
     * JS `using` 構文サポート用。スコープを抜けた際に自動的に呼ばれる。
     */
    [Symbol.dispose]() {
        this.free();
    }
}

// ECMおよび因数分解セッションのプロトタイプに対し、グローバルに Symbol.dispose を追加
[EcmRunner, FactorizationSession].forEach(cls => {
    if (cls && cls.prototype && !cls.prototype[Symbol.dispose]) {
        cls.prototype[Symbol.dispose] = function() {
            this.free();
        };
    }
});

