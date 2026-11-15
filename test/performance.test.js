/**
 * Performance gate: every measurement has a budget in test/perf-budgets.json, and a median over its budget fails.
 * It runs apart from the other tests (scripts/perf.mjs: alone, no coverage, one file after the other; PERF_TESTS=1), as the
 * last step of `npm run check` and on CI. The budgets leave 5x room for slower machines, so they catch a big slowdown; a
 * regression of 25% is what `npm run bench:compare` catches, on one machine. `npm run bench:ratchet` makes the budgets
 * stricter after a speed-up (PERF_RATCHET=1: measure and write, do not fail); a budget is never raised.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { performance } from 'perf_hooks';
import { spawnSync } from 'child_process';
import { createProfiler, globalProfiler, NESTED } from '../core/observability/index.js';
import { createGraphSync, createGraphRepository, rankGraphNodes, codeHealth, hubsAndBridges } from '../core/graph/index.js';
import { loadGraphModel, definedInTool, exportsTool, fileExists, diffImpact, graph_query, functionViewTool, folderViewTool, invalidateGraphCache } from '../core/search/index.js';
import { createFakeGit } from '../core/git/index.js';
import { crossRepoSearch } from '../core/mcp/handlers/index.js';
import { measureRuns, measurePhases, checkBudgets, ratchetBudgets, LENS_BIN } from '../core/bench/index.js';

const BUDGET_FILE = path.join(process.cwd(), 'test', 'perf-budgets.json');
const RATCHET = process.env.PERF_RATCHET === '1';
const budgets = JSON.parse(fs.readFileSync(BUDGET_FILE, 'utf8'));
const measured = {};

/** Measures `fn` (median of `runs` after a warm-up) and holds it to its budget. */
async function withinBudget(label, fn, options = { runs: 3 }) {
    const { medianMs } = await measureRuns(fn, options);
    measured[label] = medianMs;
    if (!RATCHET) expect(checkBudgets({ [label]: medianMs }, budgets)).toEqual([]);
    return medianMs;
}

describe('Performance Diagnostics & Benchmarks', () => {
    let repo;
    let sync;
    let tempDir;
    let loadedModel;

    beforeAll(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-test-'));
        process.env.LENS_GRAPH_DB = path.join(tempDir, 'project.lbdb');
        process.env.LENS_PROJECT_GRAPH = '1';
        repo = createGraphRepository({ databasePath: process.env.LENS_GRAPH_DB });
        sync = createGraphSync({ root: process.cwd(), repository: repo });
        const t0 = performance.now();
        await sync.sync({ mode: 'full' });
        measured['sync: full'] = Math.round(performance.now() - t0);
        loadedModel = await loadGraphModel({ sessionId: 'perf-test', text: 'code graph search', includeProject: true });
        return () => { try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ } };
    });

    afterAll(() => {
        if (!RATCHET) return;
        const { budgets: next, changed } = ratchetBudgets(measured, budgets);
        fs.writeFileSync(BUDGET_FILE, `${JSON.stringify(next, null, 2)}\n`);
        console.log(changed.length ? `budgets made stricter:\n${changed.map(c => `  ${c.label}: ${c.from ?? 'none'} -> ${c.to} ms`).join('\n')}` : 'no budget could be made stricter');
    });

    it('profiler accurately records metrics and detects bottlenecks', () => {
        const profiler = createProfiler('test-tracker');
        profiler.enable();
        profiler.record('fast-op', 2.0);
        profiler.record('fast-op', 3.0);
        profiler.record('slow-bottleneck-op', 120.0);
        profiler.record('slow-bottleneck-op', 150.0);
        profiler.record('slow-bottleneck-op', 140.0);
        const stats = profiler.getStats();
        expect(stats.length).toBe(2);
        const slow = stats.find(s => s.label === 'slow-bottleneck-op');
        expect(slow).toMatchObject({ count: 3, isBottleneck: true });
        expect(slow.pctOfTotal).toBeGreaterThan(90);
        const report = profiler.formatReport({ title: 'Test Report' });
        expect(report).toContain('⚠️ BOTTLENECK');
        expect(report).toContain('slow-bottleneck-op');
    });

    it('a full sync stays within its budget', () => {
        if (!RATCHET) expect(checkBudgets({ 'sync: full': measured['sync: full'] }, budgets)).toEqual([]);
    });

    it('the phases of a sync add up to the time of the whole sync (J2)', async () => {
        const { summary, phases, topLevelMs } = await measurePhases(() => sync.sync({ mode: 'full' }), { runs: 1, warmup: 0 });
        expect(Object.keys(phases)).toEqual(expect.arrayContaining(['sync: stored files', 'sync: scan', 'sync: scan > read and hash', 'sync: parse', 'sync: parse > .js', 'sync: derive relations', 'sync: write to graph', 'sync: co-change (git history)', 'sync: record head']));
        // what is outside every phase (comparing hashes, building maps) is small: within 10% plus 50 ms
        expect(Math.abs(summary.medianMs - topLevelMs)).toBeLessThan(summary.medianMs * 0.1 + 50);
        expect(Object.keys(phases).filter(label => label.includes(NESTED)).every(label => phases[label] <= phases[label.split(NESTED)[0]] + 1)).toBe(true);
        expect(globalProfiler.getStats()).toEqual([]);
    });

    it('incremental sync (unchanged), cold graph load, graph_query, functionView and folderView stay within budget', async () => {
        await withinBudget('sync: incremental (unchanged)', () => sync.sync({ mode: 'incremental' }));
        await withinBudget('load graph: cold', async () => { invalidateGraphCache(); await loadGraphModel({ sessionId: 'perf-test', text: 'code graph search', includeProject: true }); });
        await withinBudget('query: graph_query', () => graph_query({ sessionId: 'perf-test', query: 'graph sync repository', limit: 10 }));
        await withinBudget('view: functionView', () => functionViewTool({ symbol: 'createGraphSync' }));
        await withinBudget('view: folderView', () => folderViewTool({ folder: 'core/graph/sync' }));
    });

    it('codeHealth and rankGraphNodes on the loaded graph stay within budget', async () => {
        await withinBudget('analysis: codeHealth', () => expect(codeHealth(loadedModel.graph).summary.files).toBeGreaterThan(0), { runs: 5 });
        await withinBudget('query: rankGraphNodes', () => expect(rankGraphNodes(loadedModel.graph, 'graph sync repository', { limit: 10 }).length).toBeGreaterThan(0), { runs: 5, repeat: 2 });
    });

    it('diff_impact for 10 changed functions, cross_repo_search over 3 projects and bridges stay within budget', async () => {
        // compare.js has 10 functions; an empty HEAD version makes all of them changed
        const file = 'core/branches/compare.js';
        const git = createFakeGit({ commits: [{ name: 'c1', parents: [], files: { [file]: '' } }], branches: { main: 'c1' }, head: 'main', worktree: { [file]: fs.readFileSync(file, 'utf8') } });
        const readFile = rel => { try { return fs.readFileSync(rel, 'utf8'); } catch { return null; } };
        await withinBudget('analysis: diff_impact', async () => expect((await diffImpact({}, { refresh: async () => null, git, repository: repo, readFile })).total).toBeGreaterThanOrEqual(10), { runs: 1, warmup: 0 });
        const projects = ['core/branches', 'core/git', 'core/search'].map((dir, i) => ({ id: `p${i}`, path: path.resolve(dir) }));
        await withinBudget('search: cross_repo_search', () => expect(crossRepoSearch({ query: 'function', limit: 50 }, { list: () => projects, find: () => null }).repos).toHaveLength(3));
        await withinBudget('analysis: bridges', () => expect(hubsAndBridges(loadedModel.graph, { bridges: true }).bridges.total).toBeGreaterThan(0), { runs: 1, warmup: 0 });
    });

    it('direct queries (definedIn, exports, exists) stay within budget', async () => {
        await withinBudget('direct: definedIn + exports + exists', async () => {
            expect((await definedInTool({ symbol: 'createGraphSync' })).found).toBe(true);
            expect((await exportsTool({ file: 'core/graph/sync/graphSync.js' })).names.length).toBeGreaterThan(0);
            expect((await fileExists({ file: 'core/graph/sync/graphSync.js' })).exists).toBe(true);
        });
    });

    // backlog/cli-snelheid.md: these load only what they need (no yaml, no MCP SDK, no graph), so they stay near bare Node
    it('lens v and lens status as a new process stay within budget', async () => {
        const run = (...args) => () => expect(spawnSync(process.execPath, [LENS_BIN, ...args], { env: { ...process.env, LENS_NODE_CHILD: '1' }, windowsHide: true }).status).toBe(0);
        await withinBudget('process: lens v', run('v'));
        await withinBudget('process: lens status', run('status'));
    });

    it('a deliberate slowdown over the budget fails the gate (J4)', async () => {
        const fast = () => new Promise(resolve => setTimeout(resolve, 1));
        const slowed = () => new Promise(resolve => setTimeout(resolve, 80));
        const budget = { 'op': 50 };
        expect(checkBudgets({ op: (await measureRuns(fast, { runs: 3 })).medianMs }, budget)).toEqual([]);
        expect(checkBudgets({ op: (await measureRuns(slowed, { runs: 3 })).medianMs }, budget)).toMatchObject([{ label: 'op', budgetMs: 50 }]);
        expect(checkBudgets({ unknown: 1 }, budget)).toMatchObject([{ label: 'unknown', budgetMs: null }]);
    });
});
