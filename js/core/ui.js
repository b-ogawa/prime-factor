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

    getInputParams() {
        let inputStr = document.getElementById('numberInput').value.trim().replace(/\s/g, '');
        return {
            inputStr: inputStr,
            mode: this.engineModeEl.value,
            trialLimit: parseInt(document.getElementById('paramTrialLimit').value) || 0,
            b1: parseInt(document.getElementById('paramB1').value) || 0,
            p1Limit: parseInt(document.getElementById('paramP1Limit').value) || 0,
            rhoLimit: parseInt(document.getElementById('paramRhoLimit').value) || 0,
            maxCurves: parseInt(document.getElementById('paramMaxCurves').value) || 0
        };
    }

    formatBigInt(n, maxLen = 30) {
        let str = n.toString();
        if (str.length <= maxLen) return str;
        return str.substring(0, 15) + "..." + str.substring(str.length - 15) + " (" + str.length + " digits)";
    }
}