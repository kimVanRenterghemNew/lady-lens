/**
 * `lens update [<version>|<file.tgz>]`. Every running lens (the daemon and the agents' stdio servers) holds Ladybug's
 * native module open, and on Windows npm then cannot replace the package (EBUSY). So: stop every lens process, install the
 * package globally, let the NEW lens refresh the agent registrations and installed skills, and start the daemon again if it ran.
 * This file imports nothing of the graph, so the updating process itself does not lock the native module.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

/** The npm install spec: latest from the registry, a version, or a local .tgz (made absolute). */
export function updateSpec(arg, cwd = process.cwd()) {
    if (!arg) return 'lady-lens@latest';
    if (/\.tgz$/i.test(arg)) return path.resolve(cwd, arg);
    return /^\d/.test(arg) ? `lady-lens@${arg}` : arg;
}

// npm and lens are .cmd shims on Windows: they need a shell, and then an argument with spaces needs quotes
export function runCommand(command, args) {
    const shell = process.platform === 'win32' && !path.isAbsolute(command);
    const quoted = shell ? args.map(arg => (/\s/.test(arg) ? `"${arg}"` : arg)) : args;
    // the lens processes of this command (and of a lens that started it on a chosen Node) must survive the `lens stop` it runs
    const keep = [process.env.LENS_KEEP_PIDS, process.pid, process.ppid].filter(Boolean).join(',');
    return spawnSync(command, quoted, { stdio: 'inherit', shell, env: { ...process.env, LENS_KEEP_PIDS: keep } }).status;
}

export function runLensUpdate({ arg, lensPath, daemonFile, run = runCommand, log = console.log }) {
    const spec = updateSpec(arg);
    const daemonRan = fs.existsSync(daemonFile);
    log('Stopping every lady-lens process (they keep the graph database module open)...');
    run(process.execPath, [lensPath, 'stop']);
    log(`Installing ${spec}...`);
    let status = run('npm', ['install', '-g', spec]);
    if (status !== 0) {
        // a lens an agent started in the meantime can lock the package again (EBUSY): stop once more and retry once
        log('Install failed; stopping lady-lens processes again and retrying...');
        run(process.execPath, [lensPath, 'stop']);
        status = run('npm', ['install', '-g', spec]);
    }
    if (status !== 0) {
        return { ok: false, text: `npm install -g ${spec} failed: lady-lens was not updated.${daemonRan ? ' Start it again with: lens mcp -d' : ''}` };
    }
    run('lens', ['version']);
    run('lens', ['install', '--refresh']);
    if (daemonRan) run('lens', ['mcp', '-d']);
    return { ok: true, text: `Updated${daemonRan ? ' and the daemon restarted' : ''}. Reconnect your agents (Claude Code: /mcp, VS Code: restart the server) so they start the new version.` };
}
