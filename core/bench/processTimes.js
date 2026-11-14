/**
 * What a user waits for, measured from outside: `lens ask` from start to answer (Node start-up included) and the
 * daemon from start to listening. Both run with their own LENS_HOME, so the real daemon.json and registry stay untouched.
 */
import { spawn, spawnSync } from 'child_process';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';

export const LENS_BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'lens.mjs');
const START_TIMEOUT_MS = 60_000;

/** One `lens ask <tool> <args>` in a new process; throws when it fails. */
export function lensAsk({ root, env, tool, args }) {
    const result = spawnSync(process.execPath, [LENS_BIN, 'ask', tool, JSON.stringify(args), '--repo', root], { env, encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) throw new Error(`lens ask ${tool} failed (${result.status}): ${result.stderr || result.stdout}`);
}

function freePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); });
    });
}

/** Resolves when `child` prints `marker`; rejects when it exits first or `timeoutMs` passes. Stops it either way. */
export async function untilPrinted(child, marker, timeoutMs = START_TIMEOUT_MS) {
    try {
        await new Promise((resolve, reject) => {
            let output = '';
            const timer = setTimeout(() => reject(new Error(`no "${marker}" within ${timeoutMs} ms: ${output}`)), timeoutMs);
            const read = chunk => { output += chunk; if (output.includes(marker)) { clearTimeout(timer); resolve(); } };
            child.stdout.on('data', read);
            child.stderr.on('data', chunk => { output += chunk; });
            child.once('exit', code => { clearTimeout(timer); reject(new Error(`exited (${code}) before "${marker}": ${output}`)); });
        });
    } finally {
        child.removeAllListeners('exit');
        // wait for the exit: the next run must not find this one still holding the database
        if (child.exitCode === null) { const gone = new Promise(resolve => child.once('exit', resolve)); child.kill(); await gone; }
    }
}

/** Starts `lens mcp` in the foreground on free ports, waits until it listens, and stops it. */
export async function daemonStart({ root, env }) {
    const [port, uiPort] = [await freePort(), await freePort()];
    await untilPrinted(spawn(process.execPath, [LENS_BIN, 'mcp', '--port', String(port), '--ui-port', String(uiPort), '--repo', root], { env, windowsHide: true }), 'services listening');
}
