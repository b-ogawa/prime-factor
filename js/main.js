import { UIController } from './core/ui.js';
import { FactorizationEngine } from './core/engine.js';
import init from './wasm/wasm_engine.js';

let engine;
let ui;

window.onload = async () => {
    // Initialize WASM module on the main thread for SIQS Coordinator
    await init();

    ui = new UIController();
    engine = new FactorizationEngine();

    // Bind Engine Events to UI
    engine.on('setCoreCount', (c) => ui.setCoreCount(c));
    engine.on('initCoreUI', (c) => ui.initCoreUI(c));
    engine.on('log', (m, t) => ui.log(m, t));
    engine.on('renderFactors', (f, u) => ui.renderFactors(f, u));
    
    // Map Domain Events to UI Actions
    engine.on('engineStateChanged', (state) => {
        if (state === 'IDLE' || state === 'COMPLETED' || state === 'ABORTED') {
            ui.setButtonsIdle();
            ui.updateStatus(state, false);
        } else if (state === 'INITIALIZING' || state === 'RUNNING') {
            ui.setButtonsRunning();
            ui.updateStatus(state, true);
        } else if (state === 'STOPPING') {
            ui.setButtonsIdle(); // Or disabled
            ui.updateStatus('STOPPING...', true);
        }
    });

    engine.on('targetStarted', (target) => {
        ui.updateStatus("RUNNING", true, target);
    });

    engine.on('siqsActivated', (targetCount) => {
        ui.showSIQSPanel(targetCount);
    });

    engine.on('siqsDeactivated', () => {
        ui.hideSIQSPanel();
    });

    engine.on('coreUIResetRequest', () => {
        ui.resetCoreUI(engine.maxWorkers);
    });

    engine.on('updateSIQSProgress', (r, t, p, s) => ui.updateSIQSProgress(r, t, p, s));
    engine.on('clearLogs', () => ui.clearLogs());
    engine.on('resetTimer', () => ui.resetTimer());
    engine.on('updateTimer', (d) => ui.updateTimer(d));
    engine.on('updateCoreStatus', (i, p, d) => ui.updateCoreStatus(i, p, d));
    
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