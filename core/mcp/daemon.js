/**
 * Daemon process management for lady-lens MCP and UI servers.
 * Handles recording PID/ports and stopping background daemons.
 * TODO(coverage): Current line coverage is 70.27% (< 85% target). Raise to >= 85%.
 *
 * @module core/mcp/daemon
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
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

export function stopDaemon(daemonFile = DAEMON_FILE) {
    const info = readDaemonInfo(daemonFile);
    if (!info) {
        return { running: false, message: 'lady-lens daemon is not running (no daemon.json found)' };
    }

    const { pid } = info;
    if (!isProcessRunning(pid)) {
        clearDaemonInfo(daemonFile);
        return { running: false, message: `lady-lens daemon (PID: ${pid}) was not running (stale lock cleared)` };
    }

    try {
        if (process.platform === 'win32') {
            try {
                execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
            } catch {
                process.kill(pid, 'SIGKILL');
            }
        } else {
            process.kill(pid, 'SIGTERM');
        }
    } catch (err) {
        return { running: false, error: `Failed to stop PID ${pid}: ${err.message}` };
    }

    clearDaemonInfo(daemonFile);
    return {
        running: true,
        stopped: true,
        pid,
        message: `Stopped lady-lens daemon (PID: ${pid})`
    };
}
