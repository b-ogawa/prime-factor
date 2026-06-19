// Define global check_abort fallback for main thread to prevent ReferenceError in WASM
if (typeof globalThis.check_abort === 'undefined') {
    globalThis.check_abort = () => 0;
}

import { UIController } from './ui/index.js';
import { FactorizationEngine } from './orchestration/index.js';
import init from './wasm/wasm_engine.js';
import { WasmAdapter } from './interop/index.js';
import { store, ActionTypes } from './state/index.js';
import { MicroBenchmark } from './orchestration/index.js';

let engine;
let ui;

window.onload = async () => {
    // SharedArrayBuffer is required for worker pool.
    // If it's not defined, coi-serviceworker is likely registering and will reload the page soon.
    if (typeof SharedArrayBuffer === 'undefined') {
        console.warn("SharedArrayBuffer is not defined. Waiting for COOP/COEP headers via coi-serviceworker...");
        document.getElementById('consoleLog').innerHTML = '<div class="text-slate-400 font-mono text-[11px]">&gt; Waiting for Cross-Origin Isolation headers. Page will reload shortly...</div>';
        return;
    }

    // Initialize WASM module on the main thread for SIQS Coordinator
    let wasm = await init();
    WasmAdapter.wasm = wasm;

    // Run micro-benchmark to calculate tDevice for the hardware profile
    let tDevice = 1.0;
    try {
        tDevice = MicroBenchmark.run();
    } catch (e) {
        console.error("Benchmark failed, defaulting to 1.0:", e);
    }

    // Initialize Store profile
    store.dispatch({
        type: ActionTypes.UPDATE_PROFILE,
        payload: {
            tDevice,
            isProfiled: true,
            coreCount: Math.max(1, (navigator.hardwareConcurrency || 4))
        }
    });

    ui = new UIController();
    engine = new FactorizationEngine();

    // Bind Stream Events to UI (logs are stream events bypassed from Store for performance)
    engine.on('log', (m, t) => ui.log(m, t));

    engine.initWorkers();

    // Set up event listeners
    ui.btnStart.addEventListener('click', () => {
        let inputParams = ui.getInputParams();
        if (inputParams.inputStr) {
            engine.start(inputParams);
        }
    });

    ui.btnStop.addEventListener('click', () => {
        engine.stop();
    });

    document.getElementById('btnClear').addEventListener('click', () => {
        engine.clear();
    });

    document.getElementById('numberInput').addEventListener('input', function () {
        let val = this.value.replace(/\D/g, '');
        document.getElementById('digitCounter').innerText = `${val.length} digits`;
    });
};