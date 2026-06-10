import { WasmAdapter } from './wasm_adapter.js';

export class MicroBenchmark {
    static run() {
        const t0 = performance.now();
        WasmAdapter.runMicroBenchmark();
        const t1 = performance.now();
        const elapsedMs = t1 - t0;
        
        // Baseline: Standard desktop runs 500k Montgomery multiplications in ~100ms
        const baselineMs = 100.0; 
        const tDevice = baselineMs / Math.max(1, elapsedMs);
        
        // Safeguard scaling factor between 0.1 and 5.0
        return Math.max(0.1, Math.min(5.0, tDevice));
    }
}
