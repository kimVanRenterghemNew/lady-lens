/**
 * Which Node runs lens. `LENS_NODE` wins; otherwise `~/.lady-lens/lens.json` `{ "node": ... }`, written by `lens node <path>`.
 * A file works at once: unlike `setx`, which only reaches terminals started later (and in cmder not even those), it holds in
 * the open terminal, in every new one and for agents started from the desktop. PATH and nvm keep their own Node.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { runCommand } from './lensUpdate.js';

export const settingsFile = home => path.join(home, '.lady-lens', 'lens.json');
const readSettings = home => { try { return JSON.parse(fs.readFileSync(settingsFile(home), 'utf8')); } catch { return {}; } };
const nodeVersion = node => spawnSync(node, ['-v'], { encoding: 'utf8' }).stdout?.trim() || null;

/** The Node lens should run on, or null for the one that started it. */
export function chosenNode({ home, env = process.env }) {
    const node = env.LENS_NODE || readSettings(home).node;
    return node && fs.existsSync(node) ? node : null;
}

/**
 * `lens node` shows the choice, `lens node <path>` sets it, `lens node --clear` drops it. A change stops lens and
 * re-registers the agents with the new Node (`lens install --refresh`), and starts the daemon again if it ran.
 */
export function lensNodeCommand(arg, { home, daemonFile, version = nodeVersion, run = runCommand }) {
    const settings = readSettings(home);
    if (!arg) {
        return { ok: true, text: settings.node ? `lens runs on ${settings.node} (${version(settings.node) ?? 'not working'})` : `lens runs on the Node that starts it (${process.version}). Choose another: lens node <path to node.exe>` };
    }
    const node = arg === '--clear' ? null : path.resolve(arg);
    const found = node && version(node);
    if (node && !found) return { ok: false, text: `${node} is not a working node.exe; nothing changed` };
    if (node) settings.node = node; else delete settings.node;
    fs.mkdirSync(path.dirname(settingsFile(home)), { recursive: true });
    fs.writeFileSync(settingsFile(home), `${JSON.stringify(settings, null, 2)}\n`);
    const daemonRan = fs.existsSync(daemonFile);
    run('lens', ['stop']);
    run('lens', ['install', '--refresh']);
    if (daemonRan) run('lens', ['mcp', '-d']);
    return { ok: true, text: `${node ? `lens now runs on ${node} (${found})` : 'lens runs on the Node that starts it again'}. Reconnect your agents (Claude Code: /mcp, VS Code: restart the server).` };
}
