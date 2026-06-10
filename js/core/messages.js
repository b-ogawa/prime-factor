// Message types between main thread and workers
const MSG_CMD_INIT = "INIT";
const MSG_CMD_STOP = "STOP";
const MSG_CMD_SIQS_FACTORIZE = "SIQS_FACTORIZE";
const MSG_CMD_FACTORIZE = "FACTORIZE";

const MSG_TYPE_WASM_READY = "WASM_READY";
const MSG_TYPE_INIT_COMPLETE = "INIT_COMPLETE";
const MSG_TYPE_LOG = "LOG";
const MSG_TYPE_PHASE_UPDATE = "PHASE_UPDATE";
const MSG_TYPE_PRIME_FOUND = "PRIME_FOUND";
const MSG_TYPE_FACTOR_FOUND = "FACTOR_FOUND";
const MSG_TYPE_EXHAUSTED = "EXHAUSTED";
const MSG_TYPE_RELATION_FOUND = "RELATION_FOUND";
const MSG_TYPE_STOP_ACK = "STOP_ACK";

const Messages = {
    createInit(workerId, sieveLimit) {
        return { cmd: MSG_CMD_INIT, workerId, params: { sieveLimit } };
    },
    createStop() {
        return { cmd: MSG_CMD_STOP };
    },
    createSiqsFactorize(target, kN, params) {
        return { cmd: MSG_CMD_SIQS_FACTORIZE, target, kN, params };
    },
    createFactorize(target, params) {
        return { cmd: MSG_CMD_FACTORIZE, target, params };
    },
    createLog(workerId, msg, level) {
        return { type: MSG_TYPE_LOG, workerId, msg, level };
    },
    createPrimeFound(workerId, target) {
        return { type: MSG_TYPE_PRIME_FOUND, workerId, target };
    },
    createFactorFound(workerId, target, factor, method) {
        return { type: MSG_TYPE_FACTOR_FOUND, workerId, target, factor, method };
    },
    createExhausted(workerId, target) {
        return { type: MSG_TYPE_EXHAUSTED, workerId, target };
    }
};
