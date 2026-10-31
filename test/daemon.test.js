import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
    writeDaemonInfo,
    readDaemonInfo,
    clearDaemonInfo,
    isProcessRunning,
    stopDaemon
} from '../core/mcp/index.js';

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

        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('detects running and non-running processes', () => {
        expect(isProcessRunning(process.pid)).toBe(true);
        expect(isProcessRunning(99999999)).toBe(false);
    });

    it('handles stopDaemon cleanly when not running or stale', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-daemon-test-'));
        const file = path.join(tmpDir, 'daemon.json');

        // Not running
        const res1 = stopDaemon(file);
        expect(res1.running).toBe(false);

        // Stale PID
        writeDaemonInfo({ pid: 99999999, mcpPort: 4318, uiPort: 4317, repo: '/test' }, file);
        const res2 = stopDaemon(file);
        expect(res2.running).toBe(false);
        expect(fs.existsSync(file)).toBe(false);

        fs.rmSync(tmpDir, { recursive: true, force: true });
    });
});
