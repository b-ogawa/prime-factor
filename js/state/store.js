import { EventEmitter } from '../utils/index.js';

/**
 * @module js/state/store
 * @description Centralized state management for the Factorization Engine.
 */

// Action Types
export const ActionTypes = {
    UPDATE_CONFIG: 'UPDATE_CONFIG',
    UPDATE_PROFILE: 'UPDATE_PROFILE',
    UPDATE_RUNTIME_STATE: 'UPDATE_RUNTIME_STATE',
    RESET_RUNTIME_STATE: 'RESET_RUNTIME_STATE',
};

// Initial State Definitions
const initialState = {
    userConfig: {
        mode: 'auto',
        trialLimit: 10000,
        b1: 10000,
        curves: 100,
        p1Limit: 100000,
        rhoLimit: 250000,
        
        // 詳細モード/デバッグモード拡張
        detailedMode: false,
        parameterDerivation: 'dynamic', // 'dynamic' | 'manual'
        manualM: 65536,
        concurrentPortfolio: false,
        ecmCores: 1,
        siqsCores: 3,
        lanczosExtraRelations: 15,
        sieveBlockSize: 32768,
    },
    hardwareProfile: {
        coreCount: navigator.hardwareConcurrency || 4,
        tDevice: 1.0, // Calculated from benchmark
        isProfiled: false
    },
    runtimeState: {
        status: 'IDLE', // IDLE, INITIALIZING, RUNNING, STOPPING, COMPLETED, ABORTED
        activeTarget: null,
        factors: [],
        unresolved: [],
        startTime: null,
        elapsedTime: 0,
        coreStatus: {}, // workerId -> { phase, detail }
        siqsActive: false,
        siqsTargetRelations: 0,
        siqsRelationsCount: 0,
        siqsPolyCount: 0,
        siqsRelSpeed: 0
    }
};

/**
 * Application state store holding user configurations, hardware profiles, and runtime statuses.
 */
export class Store extends EventEmitter {
    constructor() {
        super();
        this.state = JSON.parse(JSON.stringify(initialState));
    }

    // Retrieves the current state tree
    getState() {
        return this.state;
    }

    // Dispatches an action to mutate the state and emits change events
    dispatch(action) {
        switch (action.type) {
            case ActionTypes.UPDATE_CONFIG:
                this.state = {
                    ...this.state,
                    userConfig: { ...this.state.userConfig, ...action.payload }
                };
                this.emit('configChanged', this.state.userConfig);
                break;
            case ActionTypes.UPDATE_PROFILE:
                this.state = {
                    ...this.state,
                    hardwareProfile: { ...this.state.hardwareProfile, ...action.payload }
                };
                this.emit('profileChanged', this.state.hardwareProfile);
                break;
            case ActionTypes.UPDATE_RUNTIME_STATE:
                this.state = {
                    ...this.state,
                    runtimeState: { ...this.state.runtimeState, ...action.payload }
                };
                this.emit('runtimeStateChanged', this.state.runtimeState);
                break;
            case ActionTypes.RESET_RUNTIME_STATE:
                this.state = {
                    ...this.state,
                    runtimeState: JSON.parse(JSON.stringify(initialState.runtimeState))
                };
                this.emit('runtimeStateChanged', this.state.runtimeState);
                break;
            default:
                console.warn(`Unknown action type: ${action.type}`);
        }
        this.emit('stateChanged', this.state);
    }
}

// Singleton instance
export const store = new Store();
