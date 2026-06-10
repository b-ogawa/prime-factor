class TaskQueue extends EventEmitter {
    constructor() {
        super();
        this.queue = [];
        this.factors = [];
        this.unresolved = [];
        this.activeTarget = null;
    }

    reset() {
        this.queue = [];
        this.factors = [];
        this.unresolved = [];
        this.activeTarget = null;
        this.emitChange();
    }

    init(targetBig) {
        this.reset();
        this.queue = [targetBig];
    }

    addFactors(f1, f2) {
        if (f1 === this.activeTarget) {
            this.factors.push(f1);
        } else {
            this.queue.push(f1);
            this.queue.push(f2);
        }
        this.emitChange();
    }

    addPrime(p) {
        this.factors.push(p);
        this.emitChange();
    }

    addUnresolved(u) {
        this.unresolved.push(u);
        this.emitChange();
    }

    rollbackActiveTarget() {
        if (this.activeTarget !== null) {
            this.unresolved.push(this.activeTarget);
            this.activeTarget = null;
            this.emitChange();
        }
    }

    next() {
        if (this.queue.length === 0) {
            this.activeTarget = null;
            return null;
        }

        this.queue.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
        this.activeTarget = this.queue.shift();

        // Extract 2s early
        while (this.activeTarget !== null && this.activeTarget % 2n === 0n) {
            this.factors.push(2n);
            this.activeTarget /= 2n;
            this.emit('log', `[FACTOR DISCOVERED] 2`, 'success');
            this.emitChange();
        }
        if (this.activeTarget === 1n) {
            this.activeTarget = null;
            return this.next();
        }

        return this.activeTarget;
    }

    getActive() {
        return this.activeTarget;
    }

    clearActive() {
        this.activeTarget = null;
    }

    isEmpty() {
        return this.queue.length === 0 && this.activeTarget === null;
    }

    emitChange() {
        this.emit('factorsUpdated', this.factors, this.unresolved);
    }
}
