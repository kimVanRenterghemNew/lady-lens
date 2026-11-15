import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { describe, expect, it } from 'vitest';
import {
    writeDaemonInfo,
    readDaemonInfo,
    clearDaemonInfo,
    isProcessRunning,
    stopDaemon,
    addDaemonPid,
    listDaemonProcesses,
    stopDaemonPid,
    daemonCommand,
    existingDaemonMessage,
    arePortsBusy,
    DAEMON_FILE
} from '../core/mcp/index.js';
import { parseListening } from '../core/daemon/index.js';

describe('daemon management', () => {
    it('writes, reads, and clears daemon info', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-daemon-test-'));
        const file = path.join(tmpDir, 'daemon.json');

        expect(readDaemonInfo(file)).toBeNull();

        writeDaemonInfo({ pid: process.pid, mcpPort: 4318, uiPort: 4317, repo: '/test' }, file);
        const info = readDaemonInfo(file);
        expect(info).not.toBeNull();
        expect(info.pid).toBe(process.pid);
        expect(info.mcpPort).toBe(4318);

        clearDaemonInfo(file);
        expect(readDaemonInfo(file)).toBeNull();
        fs.writeFileSync(file, JSON.stringify({ repo: '/test' }), 'utf8');
        expect(readDaemonInfo(file)).toBeNull();
        expect(clearDaemonInfo(path.join(tmpDir, 'missing.json'))).toBe(false);
        expect(daemonCommand('ps', [], path.join(tmpDir, 'missing.json')).text).toContain('No lady-lens processes');

        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('never reaches the developer\'s running lens: own daemon.json, and stopDaemon() stops no other process', () => {
        expect(path.relative(path.join(os.homedir(), '.lady-lens'), DAEMON_FILE).startsWith('..')).toBe(true);
        const result = stopDaemon();
        expect(result.stopped).toBe(false);
    });

    it('detects running and non-running processes', () => {
        expect(isProcessRunning(process.pid)).toBe(true);
        expect(isProcessRunning(99999999)).toBe(false);
        expect(isProcessRunning()).toBe(false);
        expect(isProcessRunning('123')).toBe(false);
    });

    it('handles daemon state branches and process listings', async () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-daemon-branches-'));
        const file = path.join(tmpDir, 'daemon.json');

        fs.writeFileSync(file, '{invalid', 'utf8');
        expect(readDaemonInfo(file)).toBeNull();
        fs.writeFileSync(file, '{}', 'utf8');
        expect(readDaemonInfo(file)).toBeNull();
        writeDaemonInfo({ pid: 99999998 }, file);
        addDaemonPid(99999997, file);
        expect(readDaemonInfo(file).pids).toEqual([99999998, 99999997]);
        writeDaemonInfo({ pid: process.pid, pids: [process.pid, 12345], mcpPort: 4318, uiPort: 4317, repo: '/test' }, file);
        addDaemonPid(12345, file);
        addDaemonPid(null, file);
        expect(listDaemonProcesses(file)[0].processes).toHaveLength(2);
        expect(daemonCommand('ps', [], file).text).toContain('running');
        expect(daemonCommand('stop', ['99999999'], file).code).toBe(1);
        expect(stopDaemonPid(99999999, file).stopped).toBe(false);
        expect(stopDaemonPid(process.pid, file).error).toContain('current process');
        expect(existingDaemonMessage({ info: { pid: 99999999, mcpPort: 4318 }, mcpBusy: false, uiBusy: false, port: 4318 })).toBeNull();
        expect(existingDaemonMessage({ info: { pid: 99999999, mcpPort: 4318 }, mcpBusy: true, uiBusy: true, port: 4318 })).toContain('already running');
        expect(await arePortsBusy([])).toEqual([]);
        clearDaemonInfo(file);
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    // found 2026-11-15 on Linux CI: the netstat lines and a real stop never ran there, so daemon.js fell under 70% branches
    it('reads the PIDs that listen on the asked ports from netstat output, once each', () => {
        const output = [
            '  Proto  Local Address          Foreign Address        State           PID',
            '  TCP    127.0.0.1:4318         0.0.0.0:0              LISTENING       100',
            '  TCP    [::1]:4318             [::]:0                 LISTENING       100',
            '  TCP    127.0.0.1:4317         0.0.0.0:0              LISTENING       200',
            '  TCP    127.0.0.1:9999         0.0.0.0:0              LISTENING       300',
            '  TCP    127.0.0.1:4318         127.0.0.1:50000        ESTABLISHED     400'
        ].join('\r\n');
        expect(parseListening(output, [4318, '4317'])).toEqual([100, 200]);
        expect(parseListening('', [4318])).toEqual([]);
    });

    it('stops a tracked extra PID, then the daemon and the rest it tracks: only processes this test started', async () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-daemon-stop-'));
        const file = path.join(tmpDir, 'daemon.json');
        const sleeper = () => spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
        const [main, extra, second] = [sleeper(), sleeper(), sleeper()];
        const gone = child => new Promise(resolve => (child.exitCode !== null || child.signalCode ? resolve() : child.once('exit', resolve)));
        try {
            writeDaemonInfo({ pid: main.pid, pids: [main.pid, extra.pid, second.pid], mcpPort: 1, uiPort: 2, repo: '/test' }, file);
            expect(stopDaemonPid(extra.pid, file)).toMatchObject({ stopped: true, pid: extra.pid });
            await gone(extra);
            expect(readDaemonInfo(file).pids).toEqual([main.pid, second.pid]);

            expect(daemonCommand('stop', [], file)).toMatchObject({ code: 0, text: `Stopped lady-lens daemon (PID: ${main.pid})` });
            await Promise.all([gone(main), gone(second)]);
            expect(fs.existsSync(file)).toBe(false);
        } finally {
            [main, extra, second].forEach(child => { try { child.kill(); } catch { /* gone */ } });
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    }, 30_000);

    it('handles stopDaemon cleanly when not running or stale', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-daemon-test-'));
        const file = path.join(tmpDir, 'daemon.json');

        // Not running
        const res1 = stopDaemon(file);
        expect(res1.running).toBe(false);

        // Stale PID; ports nobody listens on: a stale stop kills the port owners, and 4318/4317 are the user's real daemon
        writeDaemonInfo({ pid: 99999999, mcpPort: 1, uiPort: 2, repo: '/test' }, file);
        const res2 = stopDaemon(file);
        expect(res2.running).toBe(false);
        expect(fs.existsSync(file)).toBe(false);

        fs.rmSync(tmpDir, { recursive: true, force: true });
    });
});
