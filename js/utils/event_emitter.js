/**
 * @module js/utils/event_emitter
 * @description Provides a lightweight event emitter for decoupled communication between components.
 */

export class EventEmitter {
    constructor() {
        /**
         * @private
         * @type {Object.<string, Array<Function>>}
         */
        this.events = {};
    }

    // Registers a listener for a specific event
    on(event, listener) {
        if (!this.events[event]) {
            this.events[event] = [];
        }
        this.events[event].push(listener);
    }

    // Emits an event synchronously
    emit(event, ...args) {
        if (this.events[event]) {
            this.events[event].forEach(listener => listener(...args));
        }
    }
}
