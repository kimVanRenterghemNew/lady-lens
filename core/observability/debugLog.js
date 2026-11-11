/**
 * Debug logging of lady-lens. Silent by default. `LENS_DEBUG_LOG_FILE=<file>` (and `LENS_DEBUG_LEVEL`, default 2)
 * appends lines to a file; a host application passes its own logger with `configureLensLog({ debug })`.
 * TODO(coverage): Current line coverage is 71.42% (< 85% target). Raise to >= 85%.
 */
import fs from 'fs';
import { lensEnv } from '../configuration/index.js';

let hostDebug = null;

/** @param {{debug?: (level: number, tag: string, message: string|Function) => void}} options */
export function configureLensLog({ debug: forward = null } = {}) {
    hostDebug = typeof forward === 'function' ? forward : null;
}

/** `message` may be a function, so an expensive message is only built when it is written. */
export function debug(level, tag, message) {
    if (hostDebug) return hostDebug(level, tag, message);
    const file = lensEnv('DEBUG_LOG_FILE');
    if (!file || level > (Number(lensEnv('DEBUG_LEVEL')) || 2)) return;
    const text = typeof message === 'function' ? message() : message;
    try { fs.appendFileSync(file, `${new Date().toISOString()} [${tag}] ${text}\n`); } catch { /* logging never breaks the graph */ }
}

const heapMb = () => Math.round(process.memoryUsage().rss / 1048576);

/** Runs `fn` and logs (level 1) how long it took, `summary(result)` and the process memory; a failure is logged with its stack and rethrown. */
export async function debugStep(tag, label, fn, summary = () => '') {
    const started = Date.now();
    debug(1, tag, () => `${label}: start (rss ${heapMb()} MB)`);
    try {
        const result = await fn();
        debug(1, tag, () => `${label}: ${Date.now() - started} ms ${summary(result)} (rss ${heapMb()} MB)`.replace(/ {2,}/g, ' '));
        return result;
    } catch (error) {
        debug(1, tag, () => `${label}: FAILED after ${Date.now() - started} ms (rss ${heapMb()} MB)\n${error?.stack || error}${error?.cause ? `\ncause: ${error.cause.stack || error.cause}` : ''}`);
        throw error;
    }
}
