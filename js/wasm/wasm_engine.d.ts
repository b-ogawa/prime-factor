/* tslint:disable */
/* eslint-disable */

export enum ActionType {
    Idle = 0,
    Complete = 1,
    LocalFactor = 2,
    StartSiqs = 3,
    StartEcm = 4,
    Wait = 5,
}

export class EcmRunner {
    free(): void;
    [Symbol.dispose](): void;
    constructor(n_bytes: Uint8Array, b1: number);
    run_curves(curves_to_run: number): Uint8Array | undefined;
}

export class FactorizationSession {
    free(): void;
    [Symbol.dispose](): void;
    factor_locally(target_str: string): boolean;
    get_available_buffer(): number;
    get_buffer_ptr(slot_id: number): number;
    get_current_target(): string;
    get_factors_json(): string;
    get_metrics_ptr(): number;
    get_next_action(): ActionType;
    get_siqs_fb_logs(): Uint8Array;
    get_siqs_fb_primes(): Uint32Array;
    get_siqs_fb_r(): Uint8Array;
    get_siqs_kn(): string;
    get_siqs_m(): number;
    get_unresolved_json(): string;
    constructor(n_str: string);
    release_buffer(slot_id: number): void;
    report_exhausted(target_str: string): ActionType;
    report_factor(target_str: string, factor_str: string): ActionType;
    report_prime(target_str: string): ActionType;
    siqs_reduce_matrix(): string | undefined;
    submit_worker_result(slot_id: number, length: number): ActionType;
}

export class SiqsReducer {
    free(): void;
    [Symbol.dispose](): void;
    add_relation(sign: number, x_bytes: Uint8Array, b_bytes: Uint8Array, a_bytes: Uint8Array, factors: Uint32Array): void;
    constructor(n_bytes: Uint8Array, kn_bytes: Uint8Array, fb_primes: Uint32Array);
    reduce_matrix(): Uint8Array | undefined;
}

export class SiqsWorker {
    free(): void;
    [Symbol.dispose](): void;
    constructor(kn_bytes: Uint8Array, fb_primes: Uint32Array, fb_logs: Uint8Array, fb_r_bytes: Uint8Array, sieve_limit: number, worker_id: number, core_count: number);
    result_len(): number;
    result_ptr(): number;
    step(batch_size: number): number;
}

export function is_prime_bpsw_bytes(n_bytes: Uint8Array): boolean;

export function pollard_brent_bytes(n_bytes: Uint8Array, max_iters: number, worker_id: number): Uint8Array | undefined;

export function pollard_p1_bytes(n_bytes: Uint8Array, b1: number, primes: Uint32Array, worker_id: number): Uint8Array | undefined;

export function run_micro_benchmark(): number;

export function sieve_primes_wasm(max: number): Uint32Array;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_factorizationsession_free: (a: number, b: number) => void;
    readonly __wbg_siqsreducer_free: (a: number, b: number) => void;
    readonly factorizationsession_factor_locally: (a: number, b: number, c: number) => number;
    readonly factorizationsession_get_available_buffer: (a: number) => number;
    readonly factorizationsession_get_buffer_ptr: (a: number, b: number) => number;
    readonly factorizationsession_get_current_target: (a: number) => [number, number];
    readonly factorizationsession_get_factors_json: (a: number) => [number, number];
    readonly factorizationsession_get_metrics_ptr: (a: number) => number;
    readonly factorizationsession_get_next_action: (a: number) => number;
    readonly factorizationsession_get_siqs_fb_logs: (a: number) => [number, number];
    readonly factorizationsession_get_siqs_fb_primes: (a: number) => [number, number];
    readonly factorizationsession_get_siqs_fb_r: (a: number) => [number, number];
    readonly factorizationsession_get_siqs_kn: (a: number) => [number, number];
    readonly factorizationsession_get_siqs_m: (a: number) => number;
    readonly factorizationsession_get_unresolved_json: (a: number) => [number, number];
    readonly factorizationsession_new: (a: number, b: number) => number;
    readonly factorizationsession_release_buffer: (a: number, b: number) => void;
    readonly factorizationsession_report_exhausted: (a: number, b: number, c: number) => number;
    readonly factorizationsession_report_factor: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly factorizationsession_report_prime: (a: number, b: number, c: number) => number;
    readonly factorizationsession_siqs_reduce_matrix: (a: number) => [number, number];
    readonly factorizationsession_submit_worker_result: (a: number, b: number, c: number) => number;
    readonly is_prime_bpsw_bytes: (a: number, b: number) => number;
    readonly run_micro_benchmark: () => number;
    readonly sieve_primes_wasm: (a: number) => [number, number];
    readonly siqsreducer_add_relation: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => void;
    readonly siqsreducer_new: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly siqsreducer_reduce_matrix: (a: number) => [number, number];
    readonly __wbg_siqsworker_free: (a: number, b: number) => void;
    readonly siqsworker_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => [number, number, number];
    readonly siqsworker_result_len: (a: number) => number;
    readonly siqsworker_result_ptr: (a: number) => number;
    readonly siqsworker_step: (a: number, b: number) => number;
    readonly __wbg_ecmrunner_free: (a: number, b: number) => void;
    readonly ecmrunner_new: (a: number, b: number, c: number) => number;
    readonly ecmrunner_run_curves: (a: number, b: number) => [number, number];
    readonly pollard_brent_bytes: (a: number, b: number, c: number, d: number) => [number, number];
    readonly pollard_p1_bytes: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
