// Main entry point for the Factorization Engine App

let engine;
let ui;

window.onload = async () => {
    // Initialize WASM module on the main thread for SIQS Coordinator
    await wasm_bindgen({ module_or_path: 'js/wasm/wasm_engine_bg.wasm' });

    ui = new UIController();
    engine = new FactorizationEngine();

    // Bind Engine Events to UI
    engine.on('setCoreCount', (c) => ui.setCoreCount(c));
    engine.on('initCoreUI', (c) => ui.initCoreUI(c));
    engine.on('log', (m, t) => ui.log(m, t));
    engine.on('updateStatus', (s, a, t) => ui.updateStatus(s, a, t));
    engine.on('renderFactors', (f, u) => ui.renderFactors(f, u));
    engine.on('setButtonsRunning', () => ui.setButtonsRunning());
    engine.on('setButtonsIdle', () => ui.setButtonsIdle());
    engine.on('hideSIQSPanel', () => ui.hideSIQSPanel());
    engine.on('showSIQSPanel', (c) => ui.showSIQSPanel(c));
    engine.on('updateSIQSProgress', (r, t, p, s) => ui.updateSIQSProgress(r, t, p, s));
    engine.on('resetCoreUI', (c) => ui.resetCoreUI(c));
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