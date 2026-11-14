/**
 * A live Mendix project (2026-11-12): `mxcli -c refresh catalog full source` took 617 s inside the sync, and every MCP call queued
 * behind it timed out. The MDL export now runs in its own process; a sync starts it and goes on. Every mxcli call has a
 * time limit.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { startMdlExport, projectKey } from '../core/graph/sync/mendixExport.js';
import { mxcli, mxcliPath } from '../core/graph/sync/mxcli.js';

const hasSqlite = await import('node:sqlite').then(() => true, () => false);
const project = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-mdl-'));
    fs.writeFileSync(path.join(root, 'App.mpr'), 'binary placeholder');
    return path.join(root, 'App.mpr');
};
const until = async (done, ms = 30_000) => {
    for (const end = Date.now() + ms; Date.now() < end; await new Promise(resolve => setTimeout(resolve, 100))) if (done()) return true;
    return false;
};

describe('the MDL export runs beside the sync, not in it', () => {
    it.skipIf(!hasSqlite)('starts once in the background, says it is running, and is up to date when it is done', async () => {
        const mpr = project();
        const mxcliDir = path.join(path.dirname(mpr), '.mxcli');
        process.env.LENS_MDL_EXPORT = 'background';
        process.env.LENS_MXCLI_PATH = path.join(path.dirname(mpr), 'missing-mxcli');
        try {
            const started = Date.now();
            expect(await startMdlExport(mpr)).toMatch(/^started in the background \(pid \d+\)$/);
            expect(Date.now() - started).toBeLessThan(2000);
            const second = await startMdlExport(mpr);
            expect(second === 'up to date' || /^running \(pid \d+\)$/.test(second)).toBe(true);
            expect(await until(() => !fs.existsSync(path.join(mxcliDir, 'lens-mdl.lock')))).toBe(true);
            expect(JSON.parse(fs.readFileSync(path.join(mxcliDir, 'lens-mdl.json'), 'utf8'))).toMatchObject({ key: projectKey(mpr), documents: 0 });
            expect(await startMdlExport(mpr)).toBe('up to date');
            fs.writeFileSync(mpr, 'binary placeholder, saved');
            expect(await startMdlExport(mpr)).toMatch(/^started/);
            await until(() => !fs.existsSync(path.join(mxcliDir, 'lens-mdl.lock')));
        } finally {
            process.env.LENS_MDL_EXPORT = 'off';
            delete process.env.LENS_MXCLI_PATH;
        }
    }, 90_000);

    it('does nothing when it is off', async () => {
        expect(await startMdlExport(project())).toBe('off');
    });

    it('stops an mxcli call past its time limit instead of waiting for it', async () => {
        const started = Date.now();
        // node stands in for an mxcli that hangs: it ignores the -p/--json arguments and waits 20 s
        expect(await mxcli(project(), ['-e', 'setTimeout(() => {}, 20000)'], process.execPath, 500)).toBeNull();
        expect(Date.now() - started).toBeLessThan(5000);
    });

    it('reads JSON after warnings, and gives null for a failing mxcli or output without JSON', async () => {
        // a script file, not -e: node would read the -p that every mxcli call ends with as its own --print
        const node = script => { const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fake-mxcli-')), 'mxcli.mjs'); fs.writeFileSync(file, script); return mxcli(project(), [file], process.execPath); };
        expect(await node("console.log('warning [old catalog] ' + JSON.stringify({ a: 1 }))")).toEqual({ a: 1 });
        expect(await node("console.log('no json here')")).toBeNull();
        expect(await node("console.error('broken model'); process.exit(2)")).toBeNull();
    });

    it('takes its time limit from LENS_MXCLI_TIMEOUT_MS', async () => {
        process.env.LENS_MXCLI_TIMEOUT_MS = '400';
        try {
            const started = Date.now();
            expect(await mxcli(project(), ['-e', 'setTimeout(() => {}, 20000)'], process.execPath)).toBeNull();
            expect(Date.now() - started).toBeLessThan(5000);
        } finally {
            delete process.env.LENS_MXCLI_TIMEOUT_MS;
        }
    });

    it('uses the mxcli on PATH unless LENS_MXCLI_PATH names another', () => {
        delete process.env.LENS_MXCLI_PATH;
        expect(mxcliPath()).toBe('mxcli');
        process.env.LENS_MXCLI_PATH = 'C:/tools/mxcli.exe';
        expect(mxcliPath()).toBe('C:/tools/mxcli.exe');
        delete process.env.LENS_MXCLI_PATH;
    });
});
