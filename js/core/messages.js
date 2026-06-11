// Message types between main thread and workers
export const MSG_CMD_INIT = "INIT";
export const MSG_CMD_STOP = "STOP";
export const MSG_CMD_SIQS_FACTORIZE = "SIQS_FACTORIZE";
export const MSG_CMD_FACTORIZE = "FACTORIZE";

export const MSG_TYPE_WASM_READY = "WASM_READY";
export const MSG_TYPE_INIT_COMPLETE = "INIT_COMPLETE";
export const MSG_TYPE_LOG = "LOG";
export const MSG_TYPE_PHASE_UPDATE = "PHASE_UPDATE";
export const MSG_TYPE_PRIME_FOUND = "PRIME_FOUND";
export const MSG_TYPE_FACTOR_FOUND = "FACTOR_FOUND";
export const MSG_TYPE_EXHAUSTED = "EXHAUSTED";
export const MSG_TYPE_RELATION_FOUND = "RELATION_FOUND";
export const MSG_TYPE_STOP_ACK = "STOP_ACK";

export const Messages = {
    createInit(workerId, sieveLimit, sab) {
        return { cmd: MSG_CMD_INIT, workerId, params: { sieveLimit, sab } };
    },
    createStop() {
        return { cmd: MSG_CMD_STOP };
    },
    createSiqsFactorize(target, kN, sessionId, params) {
        return { cmd: MSG_CMD_SIQS_FACTORIZE, target, kN, sessionId, params };
    },
    createFactorize(target, sessionId, params) {
        return { cmd: MSG_CMD_FACTORIZE, target, sessionId, params };
    },
    createLog(workerId, sessionId, msg, level) {
        return { type: MSG_TYPE_LOG, workerId, sessionId, msg, level };
    },
    createPrimeFound(workerId, sessionId, target) {
        return { type: MSG_TYPE_PRIME_FOUND, workerId, sessionId, target };
    },
    createFactorFound(workerId, sessionId, target, factor, method) {
        return { type: MSG_TYPE_FACTOR_FOUND, workerId, sessionId, target, factor, method };
    },
    createExhausted(workerId, sessionId, target) {
        return { type: MSG_TYPE_EXHAUSTED, workerId, sessionId, target };
    }
};
