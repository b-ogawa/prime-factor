import { store } from '../state/index.js';

export class UIController {
    constructor() {
        this.consoleLogEl = document.getElementById('consoleLog');
        this.factorsContainer = document.getElementById('factorsContainer');
        this.equationDisplay = document.getElementById('equationDisplay');
        this.statTimer = document.getElementById('statTimer');
        this.statTarget = document.getElementById('statTarget');
        this.statFactorCount = document.getElementById('statFactorCount');
        this.engineStatusText = document.getElementById('engineStatusText');
        this.coreIndicator = document.getElementById('coreIndicator');
        this.btnStart = document.getElementById('btnStart');
        this.btnStop = document.getElementById('btnStop');
        this.engineModeEl = document.getElementById('engineMode');

        // SIQS UI Elements
        this.siqsProgressPanel = document.getElementById('siqsProgressPanel');
        this.siqsRelRatio = document.getElementById('siqsRelRatio');
        this.siqsProgressBar = document.getElementById('siqsProgressBar');
        this.siqsPolyCount = document.getElementById('siqsPolyCount');
        this.siqsRelSpeed = document.getElementById('siqsRelSpeed');

        this.coreCountEl = document.getElementById('coreCount');
        this.coreActivityContainer = document.getElementById('coreActivityContainer');

        this.tabBasic = document.getElementById('tabBasic');
        this.tabAdvanced = document.getElementById('tabAdvanced');
        this.panelBasic = document.getElementById('panelBasic');
        this.panelAdvanced = document.getElementById('panelAdvanced');

        if (this.tabBasic && this.tabAdvanced) {
            this.tabBasic.addEventListener('click', () => this.switchTab('basic'));
            this.tabAdvanced.addEventListener('click', () => this.switchTab('advanced'));
        }

        this.activeTab = 'basic';

        this.lastState = null;
        this.renderRequested = false;

        // Subscribe to store state changes
        store.on('stateChanged', () => this.requestRender());
    }

    switchTab(tabName) {
        this.activeTab = tabName;
        if (tabName === 'basic') {
            this.tabBasic.className = "px-4 py-2 text-xs font-bold text-emerald-600 border-b-2 border-emerald-600 transition-all uppercase tracking-wide";
            this.tabAdvanced.className = "px-4 py-2 text-xs font-bold text-slate-400 border-b-2 border-transparent hover:text-slate-600 transition-all uppercase tracking-wide";
            this.panelBasic.classList.remove('hidden');
            this.panelAdvanced.classList.add('hidden');
        } else {
            this.tabAdvanced.className = "px-4 py-2 text-xs font-bold text-emerald-600 border-b-2 border-emerald-600 transition-all uppercase tracking-wide";
            this.tabBasic.className = "px-4 py-2 text-xs font-bold text-slate-400 border-b-2 border-transparent hover:text-slate-600 transition-all uppercase tracking-wide";
            this.panelAdvanced.classList.remove('hidden');
            this.panelBasic.classList.add('hidden');
        }
    }

    requestRender() {
        if (this.renderRequested) return;
        this.renderRequested = true;
        requestAnimationFrame(() => {
            this.renderRequested = false;
            this.render(store.getState());
        });
    }

    render(state) {
        const { userConfig, hardwareProfile, runtimeState } = state;

        // Init Core UI if core count changes
        if (!this.lastState || this.lastState.hardwareProfile.coreCount !== hardwareProfile.coreCount) {
            this.setCoreCount(hardwareProfile.coreCount);
            this.initCoreUI(hardwareProfile.coreCount);
        }

        // Engine Status and Action buttons
        if (!this.lastState || this.lastState.runtimeState.status !== runtimeState.status || 
            this.lastState.runtimeState.activeTarget !== runtimeState.activeTarget) {
            
            const active = ['RUNNING', 'INITIALIZING', 'STOPPING'].includes(runtimeState.status);
            this.updateStatus(runtimeState.status, active, runtimeState.activeTarget);
            
            if (active) {
                this.setButtonsRunning();
            } else {
                this.setButtonsIdle();
            }
        }

        // Render factors
        if (!this.lastState || 
            this.lastState.runtimeState.factors !== runtimeState.factors || 
            this.lastState.runtimeState.unresolved !== runtimeState.unresolved) {
            this.renderFactors(runtimeState.factors, runtimeState.unresolved);
        }

        // Timer
        if (runtimeState.elapsedTime !== undefined) {
            this.updateTimer(runtimeState.elapsedTime);
        }

        // Cores activity status
        if (!this.lastState || this.lastState.runtimeState.coreStatus !== runtimeState.coreStatus) {
            for (let i = 0; i < hardwareProfile.coreCount; i++) {
                const stat = runtimeState.coreStatus[i] || { phase: 'IDLE', detail: '' };
                this.updateCoreStatus(i, stat.phase, stat.detail);
            }
        }

        // SIQS Progress
        const siqsActive = runtimeState.status === 'RUNNING' && runtimeState.siqsActive;
        if (siqsActive) {
            this.showSIQSPanel(runtimeState.siqsTargetRelations);
            this.updateSIQSProgress(
                runtimeState.siqsRelationsCount,
                runtimeState.siqsTargetRelations,
                runtimeState.siqsPolyCount,
                runtimeState.siqsRelSpeed
            );
        } else {
            this.hideSIQSPanel();
        }

        this.lastState = {
            hardwareProfile: { ...hardwareProfile },
            runtimeState: { ...runtimeState }
        };
    }

    setCoreCount(count) {
        this.coreCountEl.innerText = `${count} THREADS`;
    }

    log(message, type = "default") {
        const timeStr = new Date().toLocaleTimeString();
        let colorClass = "text-slate-600";
        if (type === "success") colorClass = "text-emerald-600 font-bold";
        else if (type === "error") colorClass = "text-rose-600 font-bold";
        else if (type === "warning") colorClass = "text-amber-600";
        else if (type === "info") colorClass = "text-blue-600";
        else if (type === "sys") colorClass = "text-slate-800 font-semibold";

        const logLine = document.createElement('div');
        logLine.className = `py-0.5 border-b border-slate-100/60 font-mono text-[11px] ${colorClass}`;
        logLine.innerHTML = `<span class="text-slate-400 select-none mr-2">[${timeStr}]</span>${message}`;
        this.consoleLogEl.appendChild(logLine);
        this.consoleLogEl.scrollTop = this.consoleLogEl.scrollHeight;
    }

    clearLogs() {
        this.consoleLogEl.innerHTML = `<div class="text-slate-400 font-mono text-[11px]">&gt; Memory buffers flushed.</div>`;
    }

    updateStatus(status, active = true, target = null) {
        this.engineStatusText.innerText = status;
        if (active) {
            this.engineStatusText.className = "font-mono text-sm font-bold text-emerald-500 animate-pulse";
            this.coreIndicator.className = "w-1.5 h-1.5 rounded-full bg-emerald-500 pulse-dot";
        } else {
            this.engineStatusText.className = "font-mono text-sm font-bold text-slate-500";
            this.coreIndicator.className = "w-1.5 h-1.5 rounded-full bg-slate-400";
        }
        if (target !== null) {
            this.statTarget.innerText = target;
        } else if (!active) {
            this.statTarget.innerText = "-";
        }
    }

    initCoreUI(maxWorkers) {
        if (!this.coreActivityContainer) return;
        this.coreActivityContainer.innerHTML = '';
        for (let i = 0; i < maxWorkers; i++) {
            let el = document.createElement('div');
            el.id = `core-stat-${i}`;
            el.className = "font-mono text-xs text-slate-300 bg-slate-800/50 rounded px-2 py-1.5 flex items-center shadow-inner border border-slate-700/50";
            el.innerHTML = `<span class="text-slate-500 w-14 inline-block font-bold">CORE ${i}</span> <div class="flex-1 truncate"><span class="font-bold text-slate-500">IDLE</span></div>`;
            this.coreActivityContainer.appendChild(el);
        }
    }

    updateCoreStatus(id, phase, detail) {
        let el = document.getElementById(`core-stat-${id}`);
        if (el) {
            let phaseStr = phase === 'IDLE' ? '<span class="text-slate-500">IDLE</span>' : `<span class="text-emerald-400">${phase}</span>`;
            let detailStr = detail ? `<span class="text-slate-400 text-[10px] ml-2">${detail}</span>` : '';
            el.innerHTML = `<span class="text-slate-500 w-14 inline-block font-bold">CORE ${id}</span> <div class="flex-1 truncate"><span class="font-bold">${phaseStr}</span>${detailStr}</div>`;
        }
    }

    resetCoreUI(maxWorkers) {
        for (let i = 0; i < maxWorkers; i++) this.updateCoreStatus(i, 'IDLE', '');
    }

    renderFactors(factors, unresolved) {
        this.factorsContainer.innerHTML = '';

        let allParsed = [
            ...factors.map(f => ({ val: f, prime: true })),
            ...unresolved.map(f => ({ val: f, prime: false }))
        ];

        if (allParsed.length === 0) {
            this.factorsContainer.innerHTML = `<div class="text-center py-8 text-slate-400 text-xs font-mono">No factors yet.</div>`;
            this.equationDisplay.innerText = "No active data.";
            this.statFactorCount.innerText = "0";
            return;
        }

        allParsed.sort((a, b) => (a.val < b.val ? -1 : a.val > b.val ? 1 : 0));
        let groups = [];
        for (let item of allParsed) {
            let existing = groups.find(g => g.val === item.val);
            if (existing) existing.count++;
            else groups.push({ val: item.val, prime: item.prime, count: 1 });
        }

        this.statFactorCount.innerText = allParsed.length.toString();

        groups.forEach(g => {
            const el = document.createElement('div');
            el.className = "bg-slate-50 border border-slate-200 rounded p-2 flex justify-between items-center text-xs";
            const typeBadge = g.prime
                ? `<span class="text-[9px] font-mono font-bold text-emerald-600 uppercase">Prime</span>`
                : `<span class="text-[9px] font-mono font-bold text-rose-500 uppercase">Composite</span>`;

            el.innerHTML = `
                <div class="flex flex-col max-w-[80%] font-mono">
                     <div class="flex items-center gap-2 mb-0.5">${typeBadge} <span class="text-slate-400 text-[10px]">${g.val.toString().length} digits</span></div>
                    <span class="text-slate-800 break-all text-xs font-semibold">${g.val.toString()}${g.count > 1 ? ` <span class="text-emerald-600">^ ${g.count}</span>` : ''}</span>
                </div>
            `;
            this.factorsContainer.appendChild(el);
        });

        let equationTerms = groups.map(g => {
            let term = g.val.toString();
            if (g.count > 1) term += `^${g.count}`;
            return g.prime ? term : `[${term}]`;
        });
        this.equationDisplay.innerText = equationTerms.join(" × ");
    }

    setButtonsRunning() {
        this.btnStart.disabled = true;
        this.btnStart.className = "flex-1 py-2.5 bg-slate-100 text-slate-400 border border-slate-200 rounded-lg font-medium text-xs cursor-not-allowed font-mono";
        this.btnStop.disabled = false;
        this.btnStop.className = "py-2.5 px-4 bg-rose-600 hover:bg-rose-700 text-white font-medium text-xs rounded-lg transition-all font-mono shadow-sm";
    }

    setButtonsIdle() {
        this.btnStart.disabled = false;
        this.btnStart.className = "flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-white font-medium text-xs rounded-lg transition-all font-mono shadow-sm";
        this.btnStop.disabled = true;
        this.btnStop.className = "py-2.5 px-4 bg-slate-100 text-slate-400 border border-slate-200 rounded-lg font-medium text-xs cursor-not-allowed font-mono";
    }

    updateSIQSProgress(relationsLength, targetCount, polyCount, speed) {
        this.siqsRelRatio.innerText = `${relationsLength} / ${targetCount}`;
        this.siqsProgressBar.style.width = `${Math.min(100, (relationsLength / targetCount) * 100)}%`;
        this.siqsPolyCount.innerText = polyCount;
        this.siqsRelSpeed.innerText = speed;
    }

    showSIQSPanel(targetCount) {
        this.siqsProgressPanel.classList.remove('hidden');
        this.siqsRelRatio.innerText = `0 / ${targetCount}`;
        this.siqsProgressBar.style.width = "0%";
    }

    hideSIQSPanel() {
        this.siqsProgressPanel.classList.add('hidden');
    }

    updateTimer(diff) {
        let min = Math.floor(diff / 60000).toString().padStart(2, '0');
        let sec = Math.floor((diff % 60000) / 1000).toString().padStart(2, '0');
        let ms = Math.floor((diff % 1000) / 100).toString();
        this.statTimer.innerText = `${min}:${sec}.${ms}`;
    }

    resetTimer() {
        this.statTimer.innerText = "00:00.0";
    }

    /**
     * Parses the values from the UI input elements to create a config object.
     * @precondition The DOM must have the expected input elements (numberInput, engineMode, paramTrialLimit, etc.).
     * @postcondition Returns a config object populated with user inputs.
     * @returns {Object} Configuration object.
     */
    getInputParams() {
        let inputStr = document.getElementById('numberInput').value.trim().replace(/\s/g, '');
        
        let detailedMode = this.activeTab === 'advanced';
        let parameterDerivation = document.getElementById('selParameterDerivation')?.value || 'dynamic';
        let manualM = parseInt(document.getElementById('paramManualM')?.value) || 65536;
        let concurrentPortfolio = document.getElementById('chkConcurrentPortfolio')?.checked || false;
        
        // Cores
        let brentCores = parseInt(document.getElementById('paramBrentCores')?.value) || 0;
        let p1Cores = parseInt(document.getElementById('paramP1Cores')?.value) || 0;
        let ecmCores = parseInt(document.getElementById('paramEcmCores')?.value) || 0;
        let siqsCores = parseInt(document.getElementById('paramSiqsCores')?.value) || 0;

        // Worker-specific configs
        let ecmWorkerConfig = {
            brentIters: parseInt(document.getElementById('ecm_brentIters')?.value) || 0,
            brentLimit: parseInt(document.getElementById('ecm_brentLimit')?.value) || 0,
            p1Iters: parseInt(document.getElementById('ecm_p1Iters')?.value) || 0,
            p1Limit: parseInt(document.getElementById('ecm_p1Limit')?.value) || 0,
            ecmLimit: parseInt(document.getElementById('ecm_ecmLimit')?.value) || 0,
            b2Multiplier: parseInt(document.getElementById('ecm_b2Multiplier')?.value) || 50,
        };

        let p1WorkerConfig = {
            brentIters: parseInt(document.getElementById('p1_brentIters')?.value) || 0,
            brentLimit: parseInt(document.getElementById('p1_brentLimit')?.value) || 0,
            p1Limit: parseInt(document.getElementById('p1_p1Limit')?.value) || 0,
            b2Multiplier: parseInt(document.getElementById('p1_b2Multiplier')?.value) || 10,
        };

        let brentWorkerConfig = {
            brentLimit: parseInt(document.getElementById('brent_brentLimit')?.value) || 0,
        };

        let lanczosExtraRelations = 15; // default
        let sieveBlockSize = parseInt(document.getElementById('paramSieveBlockSize')?.value) || 32768;

        return {
            inputStr: inputStr,
            mode: this.engineModeEl.value,
            trialLimit: parseInt(document.getElementById('paramTrialLimit').value) || 0,
            b1: parseInt(document.getElementById('paramB1').value) || 0,
            p1Limit: parseInt(document.getElementById('paramP1Limit').value) || 0,
            rhoLimit: parseInt(document.getElementById('paramRhoLimit').value) || 0,
            maxCurves: parseInt(document.getElementById('paramMaxCurves').value) || 0,
            detailedMode,
            parameterDerivation,
            manualM,
            concurrentPortfolio,
            brentCores,
            p1Cores,
            ecmCores,
            siqsCores,
            ecmWorkerConfig,
            p1WorkerConfig,
            brentWorkerConfig,
            lanczosExtraRelations,
            sieveBlockSize
        };
    }

    /**
     * Formats a BigInt for display, truncating the middle if it is too long.
     * @param {string|BigInt} n - The number to format.
     * @param {number} maxLen - The maximum length before truncating.
     * @returns {string} The formatted string.
     */
    formatBigInt(n, maxLen = 30) {
        let str = n.toString();
        if (str.length <= maxLen) return str;
        return str.substring(0, 15) + "..." + str.substring(str.length - 15) + " (" + str.length + " digits)";
    }
}