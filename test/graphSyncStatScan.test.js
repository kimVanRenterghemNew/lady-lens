/**
 * every question re-read and re-hashed all 25,000 files to check freshness
 * (3.5 s of a 9.8 s question). A file whose size and modification time did not change is not read again; a full
 * sync still reads everything.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createGraphSync, createGraphRepository } from '../core/graph/index.js';

const SETTINGS = { project: { graph_roots: ['.'], exclude_dirs: ['.git', '.memory'], graph_extensions: ['.js', '.md'] }, graph: { ast: { enabled: false } } };
const FILES = { 'core/a.js': "import { b } from './b.js';\nexport const a = () => b();\n", 'core/b.js': 'export const b = () => 1;\n', 'docs/x.md': '# X\n' };
const posix = (p) => String(p).split(path.sep).join('/');

describe('freshness by size and mtime', () => {
    let root, sync;
    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'statscan-'));
        for (const [rel, text] of Object.entries(FILES)) { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); }
        sync = createGraphSync({ root, repository: createGraphRepository({ databasePath: path.join(root, '.memory', 'graph.lbdb') }), settings: SETTINGS });
    });
    afterEach(() => { vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });

    const readsDuring = async (fn) => {
        const spy = vi.spyOn(fs, 'readFileSync');
        await fn();
        const reads = spy.mock.calls.map(call => posix(call[0])).filter(p => p.startsWith(posix(root)) && !p.includes('/.memory/'));
        spy.mockRestore();
        return reads;
    };

    it('MUST NOT read an unchanged file again; reads exactly the changed one; status agrees', async () => {
        await sync.sync();
        expect(await readsDuring(() => sync.sync())).toEqual([]);
        fs.writeFileSync(path.join(root, 'core/b.js'), 'export const b = () => 22;\n');
        const reads = await readsDuring(async () => expect(await sync.status()).toMatchObject({ changedFiles: ['core/b.js'], stale: true }));
        expect(reads.map(p => p.split('/').slice(-2).join('/'))).toEqual(['core/b.js']);
        expect(await sync.sync()).toMatchObject({ updated: 1, added: 0, removed: 0 });
    });

    it('a full sync still reads every file', async () => {
        await sync.sync();
        const indexed = (await readsDuring(() => sync.sync({ mode: 'full' }))).filter(p => /\.(js|md)$/.test(p));
        expect(new Set(indexed).size).toBe(3);
    });
});
