/**
 * Traces of lady-lens: one JSON line per finished span, in the OpenTelemetry-like shape a host application
 * writes (trace_id, span_id, parent_span_id, name, kind, start_time, end_time, duration_ms, status, attributes), so the
 * host's trace view shows lens spans as well. Off unless `LENS_TRACE_FILE=<file>` is set; writing a span never throws.
 *
 * Parent spans travel through AsyncLocalStorage, not a stack: tool calls in the daemon and the steps of a sync overlap.
 * `TRACEPARENT` (W3C, `00-{trace id}-{span id}-01`) makes the first span a child of the caller's span, so a
 * `lens ask` started by a host lands in the host's trace; a traced process passes its own span on to its children.
 * @module core/observability/tracing
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { AsyncLocalStorage } from 'async_hooks';
import { lensEnv } from '../configuration/index.js';

const context = new AsyncLocalStorage();
let failedFile = null;

const newId = (bytes) => crypto.randomBytes(bytes).toString('hex');
const traceFile = () => lensEnv('TRACE_FILE') || null;

/** @returns {boolean} whether spans are written */
export const isTracing = () => Boolean(traceFile());

/** The caller's span from `TRACEPARENT`, or null. */
function remoteParent(env = process.env) {
    const match = /^[\da-f]{2}-([\da-f]{32})-([\da-f]{16})-[\da-f]{2}$/.exec(String(env.TRACEPARENT || '').trim());
    return match ? { traceId: match[1], spanId: match[2] } : null;
}

function write(line) {
    const file = traceFile();
    if (!file || file === failedFile) return;
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.appendFileSync(file, `${JSON.stringify(line)}\n`);
    } catch {
        failedFile = file; // one failure stops writing to that file for this process; tracing never breaks a command
    }
}

const NO_SPAN = Object.freeze({ traceId: null, spanId: null, end: () => {} });

const statusOf = (error) => (error ? { code: 'ERROR', message: error.message ?? String(error) } : { code: 'OK' });
const errorAttributes = (error) => (error ? { 'error.type': error.name || 'Error' } : {});

function spanLine(span, ended, { attributes = {}, error = null } = {}) {
    return {
        trace_id: span.traceId, span_id: span.spanId, parent_span_id: span.parentSpanId, name: span.name, kind: span.kind,
        start_time: new Date(span.started).toISOString(), end_time: new Date(ended).toISOString(), duration_ms: ended - span.started,
        status: statusOf(error), attributes: { ...span.attributes, ...attributes, ...errorAttributes(error) }
    };
}

/** The current span, else the `TRACEPARENT` caller, else a new trace. */
const parentOf = () => context.getStore() ?? remoteParent() ?? { traceId: newId(16), spanId: null };

function openSpan(name, { kind = 'INTERNAL', attributes = {} }) {
    const parent = parentOf();
    const span = { traceId: parent.traceId, spanId: newId(8), parentSpanId: parent.spanId, name, kind, attributes, started: Date.now() };
    return { traceId: span.traceId, spanId: span.spanId, end: (options) => write(spanLine(span, Date.now(), options)) };
}

/**
 * Start a span under the current one (or the `TRACEPARENT` caller). End it with `span.end({ attributes, error })`.
 * @param {string} name
 * @param {{kind?: string, attributes?: Object}} [options]
 */
export function startSpan(name, options = {}) {
    return isTracing() ? openSpan(name, options) : NO_SPAN;
}

/** Attributes only known afterwards (counts, status); a throwing describer never fails the work. */
function describe(options, result) {
    try { return options?.endAttributes?.(result); } catch { return undefined; }
}

async function runInSpan(span, options, fn) {
    try {
        const result = await context.run({ traceId: span.traceId, spanId: span.spanId }, fn);
        span.end({ attributes: describe(options, result) });
        return result;
    } catch (error) {
        span.end({ error });
        throw error;
    }
}

/**
 * Run `fn` inside a span: the spans it starts are its children. Ends the span with OK, or ERROR and rethrows.
 * @template T
 * @param {string} name
 * @param {{kind?: string, attributes?: Object, endAttributes?: (result: T) => Object}} options
 * @param {() => Promise<T>|T} fn
 * @returns {Promise<T>}
 */
export async function traceAsync(name, options, fn) {
    if (!isTracing()) return fn();
    return runInSpan(openSpan(name, options ?? {}), options, fn);
}

/**
 * The root span of this process: it ends when the process exits (every `process.exit` of the CLI included), and its
 * `TRACEPARENT` goes to child processes. `node.startup_ms` is the time Node and the static imports took before it.
 * @param {string} name
 */
export function traceProcess(name) {
    const span = startSpan(name, { attributes: { 'node.startup_ms': Math.round(performance.now()), 'process.pid': process.pid } });
    if (!span.spanId) return;
    context.enterWith({ traceId: span.traceId, spanId: span.spanId });
    process.env.TRACEPARENT = `00-${span.traceId}-${span.spanId}-01`;
    process.once('exit', code => span.end({ attributes: { 'process.exit_code': code } }));
}
