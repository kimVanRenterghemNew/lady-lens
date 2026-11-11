/**
 * Daemon process management for lady-lens MCP and UI servers.
 * Handles recording PID/ports and stopping background daemons.
 * TODO(coverage): Current line coverage is 70.27% (< 85% target). Raise to >= 85%.
 *
 * @module core/mcp/daemon
 */
import fs from 'fs';
import net from 'net';
import path from 'path';
import { execFileSync, execSync } from 'child_process';
import { LENS_HOME } from '../repository/index.js';

export const DAEMON_FILE = path.join(LENS_HOME, 'daemon.json');

export function readDaemonInfo(daemonFile = DAEMON_FILE) {
    try {
        const content = fs.readFileSync(daemonFile, 'utf8');
        const parsed = JSON.parse(content);
        return parsed && typeof parsed === 'object' && parsed.pid ? parsed : null;
    } catch {
        return null;
    }
}

export function writeDaemonInfo(info, daemonFile = DAEMON_FILE) {
    fs.mkdirSync(path.dirname(daemonFile), { recursive: true });
    const tmp = `${daemonFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(info, null, 2), 'utf8');
    fs.renameSync(tmp, daemonFile);
}

export function addDaemonPid(pid, daemonFile = DAEMON_FILE) {
    const info = readDaemonInfo(daemonFile);
    if (!info || !pid) return;
    writeDaemonInfo({ ...info, pids: [...new Set([...(info.pids || [info.pid]), pid])] }, daemonFile);
}

export function clearDaemonInfo(daemonFile = DAEMON_FILE) {
    try {
        if (fs.existsSync(daemonFile)) {
            fs.unlinkSync(daemonFile);
            return true;
        }
    } catch {
        return false;
    }
    return false;
}

export function isProcessRunning(pid) {
    if (!pid || typeof pid !== 'number') return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

export function listeningPids(ports) {
    try {
        const output = execSync('netstat -ano -p tcp', { encoding: 'utf8', windowsHide: true });
        const wanted = new Set(ports.map(Number));
        return [...new Set(output.split(/\r?\n/).flatMap(line => {
            const match = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i);
            return match && wanted.has(Number(match[1])) ? [Number(match[2])] : [];
        }))];
    } catch {
        return [];
    }
}

export function arePortsBusy(ports, host = '127.0.0.1') {
    return Promise.all(ports.map(port => new Promise(resolve => {
        const probe = net.createServer();
        probe.once('error', () => resolve(true));
        probe.once('listening', () => probe.close(() => resolve(false)));
        probe.listen(port, host);
    })));
}

export function existingDaemonMessage({ info, mcpBusy, uiBusy, port }) {
    if (!((info && isProcessRunning(info.pid)) || (mcpBusy && uiBusy))) return null;
    const activePort = info?.mcpPort || port;
    return `lady-lens is already running or both configured ports are occupied:\n  MCP Link:     http://127.0.0.1:${activePort}/mcp\n  Legacy SSE:   http://127.0.0.1:${activePort}/sse\n  MCP Status:   http://127.0.0.1:${activePort}/\n  To stop:      lens stop`;
}

function killPid(target) {
    try {
        if (process.platform === 'win32') execSync(`taskkill /pid ${target} /T /F`, { stdio: 'ignore', windowsHide: true });
        else process.kill(target, 'SIGTERM');
    } catch { /* process may already be gone */ }
}

function stopWindowsLadyLensProcesses() {
    // machine-wide: it also stops the lens the developer works with, so a test run may never reach it
    if (process.platform !== 'win32' || process.env.VITEST) return 0;
    try {
        const command = "$p = Get-CimInstance Win32_Process -Filter \"Name = 'node.exe'\" | Where-Object { $_.CommandLine -match 'lens\\.mjs|node_modules[\\\\/]lady-lens[\\\\/]' } | Select-Object -ExpandProperty ProcessId; $p";
        // spare this process, its parent and the lens command that asked for the stop (`lens update`, `lens node`: through a
        // shell, and with a chosen Node a second process that started the first), or the sweep kills the command itself
        const keep = new Set([process.pid, process.ppid, ...String(process.env.LENS_KEEP_PIDS || '').split(',').map(Number)]);
        const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true });
        const pids = [...new Set(String(output).split(/\r?\n/).map(value => Number(value.trim())).filter(pid => pid > 0 && !keep.has(pid)))];
        pids.forEach(killPid);
        return pids.length;
    } catch {
        return 0;
    }
}

export function listDaemonProcesses(daemonFile = DAEMON_FILE) {
    const info = readDaemonInfo(daemonFile);
    if (!info) return [];
    const pids = [...new Set([info.pid, ...(info.pids || [])])];
    return [{
        repo: info.repo,
        mcpPort: info.mcpPort,
        uiPort: info.uiPort,
        startedAt: info.startedAt,
        processes: pids.map(pid => ({ pid, main: pid === info.pid, running: isProcessRunning(pid) }))
    }];
}

export function stopDaemonPid(pid, daemonFile = DAEMON_FILE) {
    const info = readDaemonInfo(daemonFile);
    const known = info && (info.pid === pid || (info.pids || []).includes(pid));
    if (!known) return { stopped: false, error: `PID ${pid} is not tracked by lady-lens (see 'lens ps')` };
    if (pid === process.pid) return { stopped: false, error: 'Refusing to stop the current process' };
    killPid(pid);
    if (pid === info.pid) return stopDaemon(daemonFile);
    writeDaemonInfo({ ...info, pids: (info.pids || []).filter(p => p !== pid) }, daemonFile);
    return { stopped: true, pid, message: `Stopped PID ${pid}` };
}

export function daemonCommand(command, args, daemonFile = DAEMON_FILE) {
    if (command === 'ps') {
        const groups = listDaemonProcesses(daemonFile);
        if (!groups.length) return { text: 'No lady-lens processes tracked', code: 0 };
        const lines = groups.flatMap(g => [
            `${g.repo}  (MCP :${g.mcpPort}, UI :${g.uiPort}, since ${g.startedAt})`,
            ...g.processes.map(p => `  ${p.pid}  ${p.running ? 'running' : 'dead'}${p.main ? '  main' : ''}`)
        ]);
        return { text: lines.join('\n'), code: 0 };
    }
    const pidArg = args.find(a => /^\d+$/.test(a));
    const result = pidArg ? stopDaemonPid(Number(pidArg), daemonFile) : stopDaemon(daemonFile);
    return { text: result.error || result.message || 'Daemon not running', code: result.error ? 1 : 0 };
}

function killDaemonPid(pid) {
    if (process.platform === 'win32') {
        try { execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore', windowsHide: true }); } catch { process.kill(pid, 'SIGKILL'); }
        return;
    }
    process.kill(pid, 'SIGTERM');
}

export function stopDaemon(daemonFile = DAEMON_FILE) {
    const info = readDaemonInfo(daemonFile);
    if (!info) {
        // the machine-wide sweep is only for the real daemon file: a test with its own file killed the user's daemon (2026-11-04)
        const stopped = daemonFile === DAEMON_FILE ? stopWindowsLadyLensProcesses() : 0;
        return { running: false, stopped: stopped > 0, message: stopped ? `Stopped ${stopped} remaining lady-lens process(es); no daemon.json found` : 'lady-lens daemon is not running (no daemon.json found)' };
    }

    const { pid } = info;
    const extraPids = [...new Set([...(info.pids || []), ...listeningPids([info.mcpPort, info.uiPort])])]
        .filter(p => p !== pid && p !== process.pid && isProcessRunning(p));

    if (!isProcessRunning(pid)) {
        const staleOwners = extraPids;
        staleOwners.forEach(killPid);
        // the agents' stdio servers still hold the native module open (npm update: EBUSY), also when the daemon is gone
        const swept = daemonFile === DAEMON_FILE ? stopWindowsLadyLensProcesses() : 0;
        clearDaemonInfo(daemonFile);
        const stopped = staleOwners.length + swept;
        return { running: false, stopped: stopped > 0, message: `lady-lens daemon (PID: ${pid}) was not running (stale lock cleared${stopped ? `; stopped ${stopped} remaining lady-lens process(es)` : ''})` };
    }

    try {
        killDaemonPid(pid);
    } catch (err) {
        return { running: false, error: `Failed to stop PID ${pid}: ${err.message}` };
    }

    extraPids.forEach(killPid);
    stopWindowsLadyLensProcesses();
    clearDaemonInfo(daemonFile);
    return {
        running: true,
        stopped: true,
        pid,
        message: `Stopped lady-lens daemon (PID: ${pid})`
    };
}
