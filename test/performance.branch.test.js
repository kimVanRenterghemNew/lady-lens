/**
 * AC11: thresholds for branch indexing and the commit/branch nodes, on a generated repository with real git.
 * The limits are relative to a full scan of the same repository, so a slow machine does not fail them but a regression does.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { performance } from 'perf_hooks';
import { createGraphSync, createGraphRepository, createMemoryRepositoryStore, indexBranch, recordHead } from '../core/graph/index.js';
import { createGit } from '../core/git/index.js';

const FILES = 1500;
const SETTINGS = { project: { graph_roots: ['.'], exclude_dirs: ['.git', '.memory'], graph_extensions: ['.js'] }, graph: { ast: { enabled: false } } };
const THRESHOLDS = { branchFullVsScan: 3, branchIncrementalVsFull: 0.5, recordHeadMs: 200 }; // recordHeadMs: the work besides git process starts, which every limit adds per call

let root;
let git;
let fullScanMs;
const run = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root, encoding: 'utf8', stdio: 'pipe' });
const file = index => path.join(root, 'src', `m${index % 10}`, `f${index}.js`);
const source = (index, version = 1) => `import { f${(index + 1) % FILES} } from '../m${(index + 1) % 10}/f${(index + 1) % FILES}.js';\nexport function f${index}() { return f${(index + 1) % FILES}() + ${version}; }\n`;
const timed = async fn => { const t0 = performance.now(); gitCalls = 0; const value = await fn(); return { value, ms: performance.now() - t0, starts: gitCalls * spawnMs }; };
const timedSync = fn => { const t0 = performance.now(); fn(); return performance.now() - t0; };
let spawnMs = 0;
let gitCalls = 0;

describe('branch indexing and commit nodes stay cheap', () => {
    beforeAll(async () => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-perf-branch-'));
        run('init', '-q', '-b', 'main');
        for (let i = 0; i < FILES; i++) { fs.mkdirSync(path.dirname(file(i)), { recursive: true }); fs.writeFileSync(file(i), source(i)); }
        run('add', '-A'); run('commit', '-qm', 'base');
        run('checkout', '-qb', 'feature-x');
        for (const i of [1, 2, 3]) fs.writeFileSync(file(i), source(i, 2));
        run('add', '-A'); run('commit', '-qm', 'feature');
        run('checkout', '-q', 'main');
        // packed like a real clone: on Windows each loose object costs ~2 ms to open (1500 loose blobs: 2.7 s vs 0.18 s packed),
        // which made this test measure the file system instead of the indexer
        run('gc', '-q');
        // every git call starts a process (~100 ms on a Windows machine with a virus scanner): the limits count them, so they
        // catch a slower indexer, not a slower process start
        const starts = Array.from({ length: 5 }, () => timedSync(() => run('rev-parse', 'HEAD'))).sort((a, b) => a - b);
        spawnMs = starts[2];
        git = createGit({ root, run: (cwd, args, { input, encoding = 'utf8' } = {}) => {
            gitCalls += 1;
            return execFileSync('git', args, { cwd, encoding, input, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 });
        } });

        const scan = await timed(() => createGraphSync({ root, repository: createGraphRepository({ store: createMemoryRepositoryStore() }), settings: SETTINGS }).syncFiles({ mode: 'full' }));
        fullScanMs = scan.ms;
    }, 120000);
    afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

    it('indexes a whole branch within a multiple of a full scan', async () => {
        const repository = createGraphRepository({ store: createMemoryRepositoryStore() });
        const { value, ms, starts } = await timed(() => indexBranch({ repository, git, branch: 'feature-x', settings: SETTINGS }));
        expect(value).toMatchObject({ mode: 'full', added: FILES });
        expect(ms).toBeLessThan(fullScanMs * THRESHOLDS.branchFullVsScan + 1000 + starts);
    }, 120000);

    it('re-indexes only what changed, and an unchanged branch costs almost nothing', async () => {
        const repository = createGraphRepository({ store: createMemoryRepositoryStore() });
        const first = await timed(() => indexBranch({ repository, git, branch: 'main', settings: SETTINGS }));
        run('checkout', '-q', 'feature-x');
        run('branch', '-f', 'main', 'feature-x');
        run('checkout', '-q', 'main');
        const incremental = await timed(() => indexBranch({ repository, git, branch: 'main', settings: SETTINGS }));
        expect(incremental.value).toMatchObject({ mode: 'incremental', updated: 3 });
        expect(incremental.ms).toBeLessThan(first.ms * THRESHOLDS.branchIncrementalVsFull + 200 + incremental.starts);

        const unchanged = await timed(() => indexBranch({ repository, git, branch: 'main', settings: SETTINGS }));
        expect(unchanged.value).toMatchObject({ mode: 'incremental', updated: 0, wrote: false });
        expect(unchanged.ms).toBeLessThan(THRESHOLDS.recordHeadMs + unchanged.starts);
    }, 120000);

    it('records commit and branch nodes in well under a second', async () => {
        const repository = createGraphRepository({ store: createMemoryRepositoryStore() });
        const { value, ms, starts } = await timed(() => recordHead({ repository, git }));
        expect(value).toMatchObject({ branch: 'main' });
        expect(ms).toBeLessThan(THRESHOLDS.recordHeadMs + starts);
    });
});
