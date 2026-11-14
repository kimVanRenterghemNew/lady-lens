/**
 * Calls to mxcli, the Mendix command line. Every call has a time limit: one that hangs held the sync, and with it every
 * MCP call queued behind it, until the client gave up (-32001 Request timed out).
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import { debug } from '../../observability/index.js';
import { lensEnv } from '../../configuration/index.js';

const execFileAsync = promisify(execFile);
/** A question to the catalog or the model; the full catalog refresh of the MDL export gets its own, longer limit. */
export const MXCLI_TIMEOUT_MS = 120_000;

export const mxcliPath = () => process.env.LENS_MXCLI_PATH || 'mxcli';

function parseJsonOutput(output) {
    const text = String(output).trim();
    const starts = [text.indexOf('['), text.indexOf('{')].filter(index => index >= 0).sort((a, b) => a - b);
    for (const start of starts) {
        try { return JSON.parse(text.slice(start)); } catch { /* mxcli may print warnings after JSON */ }
    }
    return null;
}

function logFailure(call, ms, timeoutMs, error) {
    const limit = error.killed ? ` (time limit ${timeoutMs} ms)` : '';
    const stderr = error.stderr ? `\nstderr: ${String(error.stderr).slice(0, 2000)}` : '';
    debug(1, 'mxcli', () => `${call}: FAILED after ${ms} ms${limit}: ${error.message}${stderr}`);
}

/** The JSON answer of `mxcli <command> -p <project> --json`, or null when it fails or takes longer than `timeoutMs`. */
export async function mxcli(project, command, path = mxcliPath(), timeoutMs = Number(lensEnv('MXCLI_TIMEOUT_MS')) || MXCLI_TIMEOUT_MS) {
    const started = Date.now();
    try {
        const { stdout } = await execFileAsync(path, [...command, '-p', project, '--json'], { maxBuffer: 32 * 1024 * 1024, windowsHide: true, timeout: timeoutMs });
        debug(1, 'mxcli', () => `${path} ${command.join(' ')}: ${Date.now() - started} ms, ${stdout.length} chars`);
        return parseJsonOutput(stdout);
    } catch (error) {
        logFailure(`${path} ${command.join(' ')}`, Date.now() - started, timeoutMs, error);
        return null;
    }
}

// mxcli aborts a catalog query past 10,000 output lines (4,184 widgets did): ask page by page; a failed page keeps what came
const PAGE_ROWS = 500;
export async function mxcliRows(project, sql) {
    const rows = [];
    for (let offset = 0; ; offset += PAGE_ROWS) {
        const page = await mxcli(project, ['-c', `${sql} LIMIT ${PAGE_ROWS} OFFSET ${offset}`]);
        if (!Array.isArray(page)) return offset ? rows : mxcli(project, ['-c', sql]); // no LIMIT support: one query
        rows.push(...page);
        if (page.length < PAGE_ROWS) return rows;
    }
}
