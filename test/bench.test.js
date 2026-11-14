/**
 * Measuring before optimizing (backlog/meten-voor-optimaliseren.md): repeated runs with a median, runs saved without
 * paths or code, a comparison that marks a regression and warns about another machine, a bench of an unknown
 * repository that leaves the registry and its database alone, budgets that only get stricter, reproducible scale repos.
 */
import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync, spawn } from 'child_process';
import {
    measureRuns, summarizeSamples, benchEnvironment, saveRun, readRun, listRuns, compareRuns, formatComparison,
    ratchetBudgets, checkBudgets, benchCommand, compareCommand, formatRun, BASELINE_FILE, generateScaleRepo, SCALE_PROFILES,
    median, measurePhases, runBench, untilPrinted, lensAsk, sampleFile
} from '../core/bench/index.js';
import { globalProfiler } from '../core/observability/index.js';

const temp = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const hashOf = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** A clock that only moves when `work(ms)` is called: runs of exactly known length, without timer noise. */
function fakeClock() {
    let now = 0;
    return { clock: () => now, work: ms => { now += ms; } };
}

async function runOf(phaseMs, environment = benchEnvironment({ lensVersion: 'test' })) {
    const { clock, work } = fakeClock();
    const measurements = {};
    for (const [label, ms] of Object.entries(phaseMs)) measurements[label] = await measureRuns(() => work(ms), { clock });
    return { schema: 1, createdAt: new Date().toISOString(), commit: 'abc1234', runs: 5, environment, repo: { key: 'lady-lens', files: 1, nodes: 1, edges: 1 }, measurements };
}

describe('measuring before optimizing', () => {
    it('takes the median after a warm-up and marks a wandering measurement as unstable (AC2)', async () => {
        const { clock, work } = fakeClock();
        const durations = [500, 10, 10, 11, 10, 10];
        let call = 0;
        expect(await measureRuns(() => work(durations[call++]), { clock, runs: 5 })).toMatchObject({ runs: 5, medianMs: 10, maxMs: 11, unstable: false });
        expect(summarizeSamples([10, 20, 10, 30, 12])).toMatchObject({ medianMs: 12, unstable: true });
    });

    it('saves a run, and a comparison marks exactly the measurement that got 30% slower (J1, AC3, AC4)', async () => {
        const dir = temp('bench-store-');
        const before = await runOf({ 'sync: parse': 100, 'sync: write to graph': 200 });
        const after = await runOf({ 'sync: parse': 130, 'sync: write to graph': 201 });
        saveRun(before, dir, { baseline: true });
        const { file } = saveRun({ ...after, createdAt: new Date(Date.now() + 1000).toISOString() }, dir);
        expect(listRuns(dir)).toHaveLength(2);
        expect(readRun(file).measurements['sync: parse'].medianMs).toBe(130);

        const comparison = compareRuns(after, before);
        expect(comparison.regressions.map(row => row.label)).toEqual(['sync: parse']);
        expect(comparison.warnings).toEqual([]);
        expect(formatComparison(comparison)).toMatch(/sync: parse .*\+30% REGRESSION/);
        const command = compareCommand({ outDir: dir });
        expect(command.ok).toBe(false);
        expect(command.text).toContain(`against ${BASELINE_FILE}`);
    });

    it('warns when two runs come from different machines or repositories (J5)', async () => {
        const here = await runOf({ op: 10 });
        const there = await runOf({ op: 10 }, { ...here.environment, machine: 'elsewhere', cpus: here.environment.cpus + 2 });
        const { warnings } = compareRuns(here, { ...there, repo: { key: 'other' } });
        expect(warnings).toEqual([expect.stringContaining('different machine (machine, cpus)'), expect.stringContaining('different repository')]);
        expect(compareCommand({ outDir: temp('bench-empty-') })).toMatchObject({ ok: false });
    });

    it('holds each median to its budget, and a measurement without a budget fails too (AC6, J4)', () => {
        expect(checkBudgets({ fast: 10 }, { fast: 50 })).toEqual([]);
        expect(checkBudgets({ slow: 80 }, { slow: 50 })).toMatchObject([{ label: 'slow', medianMs: 80, budgetMs: 50 }]);
        expect(checkBudgets({ unknown: 1 }, {})).toMatchObject([{ label: 'unknown', budgetMs: null, reason: expect.stringContaining('bench:ratchet') }]);
    });

    it('makes budgets only stricter, and gives a new measurement a budget (AC6)', () => {
        const { budgets, changed } = ratchetBudgets({ fast: 10, slow: 900, fresh: 4 }, { fast: 500, slow: 1000 });
        expect(budgets).toEqual({ fast: 50, fresh: 50, slow: 1000 });
        expect(changed.map(c => c.label)).toEqual(['fast', 'fresh']);
    });

    it('benches an unknown repository in a temporary database: registry and its database stay the same, the run holds no paths or code (J3, AC5)', async () => {
        const repo = temp('bench-repo-');
        fs.mkdirSync(path.join(repo, 'src'));
        fs.writeFileSync(path.join(repo, 'src', 'secretName.js'), "import { helper } from './helper.js';\nexport function secretName() { return helper(); }\n");
        fs.writeFileSync(path.join(repo, 'src', 'helper.js'), 'export function helper() { return 1; }\n');
        const home = process.env.LENS_HOME;
        fs.mkdirSync(home, { recursive: true });
        const registry = path.join(home, 'repos.json');
        const database = path.join(home, 'repos', 'known', 'graph.lbdb');
        fs.mkdirSync(path.dirname(database), { recursive: true });
        fs.writeFileSync(database, 'the real database');
        fs.writeFileSync(registry, JSON.stringify({ repos: { known: { id: 'known', path: repo, database } } }));
        const before = [hashOf(registry), hashOf(database), process.env.LENS_GRAPH_DB];

        const outDir = path.join(temp('bench-out-'), 'bench');
        const out = await benchCommand({ root: repo, outDir, repoKey: 'repo:known', runs: 1 });
        expect(out.ok).toBe(true);
        expect(out.text).toContain('phases of sync: full');
        expect([hashOf(registry), hashOf(database), process.env.LENS_GRAPH_DB]).toEqual(before);
        const saved = fs.readFileSync(out.file, 'utf8');
        expect(saved).not.toContain(repo.replace(/\\/g, '\\\\'));
        expect(saved).not.toContain('secretName');
        expect(Object.keys(JSON.parse(saved).measurements)).toEqual(expect.arrayContaining(['sync: full', 'view: functionView', 'process: lens ask', 'process: daemon start']));
        expect(formatRun(JSON.parse(saved))).toContain('sync: scan');
    }, 120_000);

    it('lens bench compare answers through the CLI', () => {
        let output = '';
        try { execFileSync(process.execPath, ['bin/lens.mjs', 'bench', 'compare'], { encoding: 'utf8', stdio: 'pipe' }); } catch (error) { output = error.stdout; }
        expect(output).toContain('nothing to compare');
    });

    it('generates the same scale repository for the same seed, in every profile (step 8)', () => {
        const listing = dir => fs.readdirSync(dir, { recursive: true }).sort().map(name => [name, fs.statSync(path.join(dir, name)).isFile() ? hashOf(path.join(dir, name)) : 'dir']);
        const [a, b] = [temp('scale-a-'), temp('scale-b-')];
        generateScaleRepo({ dir: a, profile: 'mixed-languages', count: 60, seed: 7 });
        generateScaleRepo({ dir: b, profile: 'mixed-languages', count: 60, seed: 7 });
        expect(listing(a)).toEqual(listing(b));
        expect(listing(a).some(([name]) => name.endsWith('.py'))).toBe(true);
        expect(Object.keys(SCALE_PROFILES)).toEqual(['default', 'small-files', 'large-files', 'mixed-languages', 'many-imports']);
        expect(() => generateScaleRepo({ dir: a, profile: 'nope' })).toThrow(/unknown scale profile/);
    });
});

describe('bench edge cases', () => {
    const node = script => spawn(process.execPath, ['-e', script]);

    it('takes the middle of an even number of runs, and a run of zero ms has no spread', () => {
        expect(median([4, 1, 3, 2])).toBe(2.5);
        expect(summarizeSamples([0, 0, 0])).toMatchObject({ medianMs: 0, spreadPct: 0, unstable: false });
    });

    it('compares a new measurement, a speed-up, an unstable one and a zero baseline without calling them regressions', async () => {
        const before = { environment: {}, repo: { key: 'k' }, measurements: { faster: { medianMs: 100 }, shaky: { medianMs: 10, unstable: true }, zero: { medianMs: 0 } } };
        const after = { environment: {}, repo: { key: 'k' }, measurements: { faster: { medianMs: 50 }, shaky: { medianMs: 11 }, zero: { medianMs: 1 }, added: { medianMs: 5 } } };
        const comparison = compareRuns(after, before);
        expect(comparison.regressions).toEqual([]);
        const text = formatComparison(comparison, { currentName: 'b.json', previousName: 'a.json' });
        expect(text).toMatch(/faster .*-50%/);
        expect(text).toMatch(/shaky .*\(unstable\)/);
        expect(text).toMatch(/added +- +5 ms +new/);
        expect(text).toContain('no regressions');
        expect(compareRuns(after, { environment: {}, repo: { key: 'k' } }).rows.every(row => row.status === 'new')).toBe(true);
    });

    it('waits for a marker, and fails when the process exits first or stays silent', async () => {
        await untilPrinted(node("console.log('services listening'); setInterval(() => {}, 1000)"), 'services listening');
        await expect(untilPrinted(node("console.error('boom'); process.exit(3)"), 'services listening')).rejects.toThrow(/exited \(3\).*boom/s);
        await expect(untilPrinted(node('setInterval(() => {}, 1000)'), 'services listening', 300)).rejects.toThrow(/within 300 ms/);
    });

    it('reports a failing lens ask with its output', () => {
        expect(() => lensAsk({ root: process.cwd(), env: process.env, tool: 'noSuchTool', args: {} })).toThrow(/lens ask noSuchTool failed/);
    });

    it('picks a code file to ask about, also one without exports, and refuses a graph without code', () => {
        const graphOf = nodes => ({ nodes: new Map(nodes.map(n => [n.path, n])) });
        expect(sampleFile(graphOf([{ type: 'Document', path: 'a.md' }, { type: 'CodeFile', path: 'b.js' }])).path).toBe('b.js');
        expect(sampleFile(graphOf([{ type: 'CodeFile', path: 'b.js' }, { type: 'CodeFile', path: 'c.js', exports: ['c'] }])).path).toBe('c.js');
        expect(() => sampleFile(graphOf([]))).toThrow(/no code files/);
    });

    it('counts phases only over the counted runs and leaves the profiler on when LENS_PROFILE asks for it', async () => {
        process.env.LENS_PROFILE = '1';
        try {
            const { phases, summary } = await measurePhases(() => globalProfiler.record('sync: x', 5), { runs: 2, warmup: 1 });
            expect(summary.runs).toBe(2);
            expect(phases['sync: x']).toBe(5);
            expect(globalProfiler.startTimer('on')()).toBeGreaterThanOrEqual(0);
            expect(globalProfiler.getStats().map(s => s.label)).toEqual(['on']);
        } finally {
            delete process.env.LENS_PROFILE;
            globalProfiler.reset();
            globalProfiler.disable();
        }
    });

    it('a run without processes holds no process measurements and puts the environment back', async () => {
        const repo = temp('bench-small-');
        fs.writeFileSync(path.join(repo, 'one.js'), 'export function one() { return 1; }\n');
        const graphDb = process.env.LENS_GRAPH_DB;
        const run = await runBench({ root: repo, runs: 1, processes: false, repoKey: 'small', lensVersion: 't', commit: 'c' });
        expect(Object.keys(run.measurements).some(label => label.startsWith('process:'))).toBe(false);
        expect(run.repo).toMatchObject({ key: 'small', files: 1 });
        expect(process.env.LENS_GRAPH_DB).toBe(graphDb);
        expect(process.env.LENS_REPO_ROOT).toBeUndefined();
    }, 60_000);
});
