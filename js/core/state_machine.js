const STATE_IDLE = 'IDLE';
const STATE_INITIALIZING = 'INITIALIZING';
const STATE_RUNNING = 'RUNNING';
const STATE_STOPPING = 'STOPPING';
const STATE_COMPLETED = 'COMPLETED';
const STATE_ABORTED = 'ABORTED';

class EngineStateMachine extends EventEmitter {
    constructor() {
        super();
        this.state = STATE_IDLE;
    }

    transition(newState) {
        // Guard against invalid transitions if necessary
        if (this.state === newState) return;

        // Example: Only allow ABORTED from STOPPING
        if (newState === STATE_ABORTED && this.state !== STATE_STOPPING) {
            console.warn(`Invalid state transition: ${this.state} -> ${newState}`);
            return;
        }
        
        this.state = newState;
        this.emit('engineStateChanged', this.state);
    }

    get() { return this.state; }
    is(state) { return this.state === state; }
}
