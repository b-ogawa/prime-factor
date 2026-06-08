// Main entry point for the Factorization Engine App

let engine;
let ui;

window.onload = () => {
    ui = new UIController();
    engine = new FactorizationEngine(ui);
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