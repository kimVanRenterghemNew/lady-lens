/** lens update: stop every lens (they lock the native module), install, let the new lens refresh, restart the daemon if it ran. */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runLensUpdate, updateSpec, runCommand } from '../core/update/index.js';

const dirs = [];
const daemonFile = (exists) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-update-'));
    dirs.push(dir);
    const file = path.join(dir, 'daemon.json');
    if (exists) fs.writeFileSync(file, '{"pid":1}');
    return file;
};
afterEach(() => dirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));

function fakeRun(failOn = null, failures = Infinity) {
    const calls = [];
    const run = (command, args) => { calls.push([command === process.execPath ? 'node' : command, ...args].join(' ')); return command === failOn && failures-- > 0 ? 1 : 0; };
    return { calls, run };
}

describe('lens update', () => {
    it('installs the latest, a version, or a local tgz (made absolute)', () => {
        expect(updateSpec()).toBe('lady-lens@latest');
        expect(updateSpec('1.2.4')).toBe('lady-lens@1.2.4');
        expect(updateSpec('dist/lady-lens-1.2.4.tgz', '/work')).toBe(path.resolve('/work', 'dist/lady-lens-1.2.4.tgz'));
        expect(updateSpec('lady-lens@next')).toBe('lady-lens@next');
    });

    it('stops lens first, installs, refreshes with the new lens and restarts a daemon that ran', () => {
        const { calls, run } = fakeRun();
        const out = runLensUpdate({ arg: '1.2.4', lensPath: '/g/lens.mjs', daemonFile: daemonFile(true), run, log: () => {} });
        expect(calls).toEqual(['node /g/lens.mjs stop', 'npm install -g lady-lens@1.2.4', 'lens version', 'lens install --refresh', 'lens mcp -d']);
        expect(out).toMatchObject({ ok: true });
        expect(out.text).toContain('daemon restarted');
    });

    it('a locked package (EBUSY from an agent that started lens again): stops lens once more and the retry installs', () => {
        const busy = fakeRun('npm', 1);
        const out = runLensUpdate({ lensPath: '/g/lens.mjs', daemonFile: daemonFile(false), run: busy.run, log: () => {} });
        expect(busy.calls.slice(0, 4)).toEqual(['node /g/lens.mjs stop', 'npm install -g lady-lens@latest', 'node /g/lens.mjs stop', 'npm install -g lady-lens@latest']);
        expect(busy.calls).toContain('lens install --refresh');
        expect(out).toMatchObject({ ok: true });
    });

    it('does not start a daemon that did not run, and stops after a failed install', () => {
        const quiet = fakeRun();
        runLensUpdate({ lensPath: '/g/lens.mjs', daemonFile: daemonFile(false), run: quiet.run, log: () => {} });
        expect(quiet.calls).not.toContain('lens mcp -d');
        const failed = fakeRun('npm');
        const out = runLensUpdate({ lensPath: '/g/lens.mjs', daemonFile: daemonFile(true), run: failed.run, log: () => {} });
        expect(failed.calls).toEqual(['node /g/lens.mjs stop', 'npm install -g lady-lens@latest', 'node /g/lens.mjs stop', 'npm install -g lady-lens@latest']);
        expect(out).toMatchObject({ ok: false });
        expect(out.text).toContain('lens mcp -d');
    });

    it('runs a command and gives its exit code; a command on the PATH gets a shell on Windows, with an argument with spaces quoted', () => {
        expect(runCommand(process.execPath, ['-e', 'process.exit(3)'])).toBe(3);
        expect(runCommand('node', ['-e', 'process.exit( 4 )'])).toBe(4);
    });

    it('tells the command it runs which lens processes to spare, so its `lens stop` does not kill the update itself', () => {
        const check = `process.exit(process.env.LENS_KEEP_PIDS.split(',').map(Number).includes(${process.pid}) ? 7 : 1)`;
        expect(runCommand(process.execPath, ['-e', check])).toBe(7);
    });
});
