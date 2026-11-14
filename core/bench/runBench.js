/**
 * One bench run on a repository, in a temporary database: the sync with its phases, the questions of
 * `operations.js`, and (optionally) `lens ask` and the daemon start as separate processes. The registry and the
 * repository's own database are never opened. The result holds numbers and the environment, no paths or code.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { performance } from 'perf_hooks';
import { configureLensRoot, REPO_ROOT } from '../configuration/index.js';
import { createGraphSync, createGraphRepository } from '../graph/index.js';
import { globalProfiler, NESTED } from '../observability/index.js';
import { measureRuns, summarizeSamples, median } from './measure.js';
import { benchEnvironment } from './environment.js';
import { benchTargets, benchOperations } from './operations.js';
import { lensAsk, daemonStart } from './processTimes.js';

const PHASE_DEFAULTS = Object.freeze({ runs: 5, warmup: 1 });
const ENV_KEYS = ['LENS_REPO_ROOT', 'LENS_GRAPH_DB', 'LENS_PROJECT_GRAPH'];
const round = value => Math.round(value * 100) / 100;
const topLevelSum = run => Object.entries(run).filter(([label]) => !label.includes(NESTED)).reduce((sum, [, ms]) => sum + ms, 0);

/** One run of `fn` with the profiler on: its time and the total per phase. */
async function profiledRun(fn) {
    globalProfiler.reset();
    const started = performance.now();
    await fn();
    return { ms: performance.now() - started, phases: Object.fromEntries(globalProfiler.getStats().map(stat => [stat.label, stat.totalMs])) };
}

/** Runs `fn` like `measureRuns`, and records the profiler phases of each counted run; per phase the median. */
export async function measurePhases(fn, options) {
    const { runs, warmup } = { ...PHASE_DEFAULTS, ...options };
    const counted = [];
    globalProfiler.enable();
    try {
        for (let i = 0; i < warmup; i++) await profiledRun(fn);
        for (let i = 0; i < runs; i++) counted.push(await profiledRun(fn));
    } finally {
        globalProfiler.reset();
        if (process.env.LENS_PROFILE !== '1') globalProfiler.disable();
    }
    const labels = [...new Set(counted.flatMap(run => Object.keys(run.phases)))];
    return {
        summary: summarizeSamples(counted.map(run => run.ms)),
        phases: Object.fromEntries(labels.map(label => [label, round(median(counted.map(run => run.phases[label] || 0)))])),
        topLevelMs: round(median(counted.map(run => topLevelSum(run.phases))))
    };
}

const restoreEnv = (key, value) => { if (value === undefined) delete process.env[key]; else process.env[key] = value; };

/** Sets the LENS_* variables of the bench for the duration of `fn`, and puts the old ones back. */
async function withBenchEnv(env, fn) {
    const saved = ENV_KEYS.map(key => [key, process.env[key]]);
    for (const key of ENV_KEYS) process.env[key] = env[key];
    try { return await fn(); } finally {
        for (const [key, value] of saved) restoreEnv(key, value);
    }
}

async function measureSync(sync, runs, log) {
    log('sync: full');
    let synced = null;
    const full = await measurePhases(async () => { synced = await sync.sync({ mode: 'full' }); }, { runs });
    log('sync: incremental (unchanged)');
    const incremental = await measurePhases(() => sync.sync({ mode: 'incremental' }), { runs });
    return {
        synced,
        measurements: { 'sync: full': full.summary, 'sync: incremental (unchanged)': incremental.summary },
        phases: { full: { ...full.phases, 'sum of phases': full.topLevelMs }, incremental: { ...incremental.phases, 'sum of phases': incremental.topLevelMs } }
    };
}

async function measureQuestions({ root, repository, runs, log }) {
    const targets = await benchTargets();
    const measurements = {};
    for (const [label, fn, options] of benchOperations({ root, repository, targets })) {
        log(label);
        measurements[label] = await measureRuns(fn, { ...options, runs });
    }
    return { targets, measurements };
}

async function measureProcesses({ root, env, file, runs, log }) {
    log('process: lens ask');
    const ask = await measureRuns(() => lensAsk({ root, env, tool: 'exists', args: { file } }), { runs });
    log('process: daemon start');
    return { 'process: lens ask': ask, 'process: daemon start': await measureRuns(() => daemonStart({ root, env }), { runs }) };
}

/**
 * @param {{root: string, runs?: number, repoKey?: string, lensVersion: string, commit: string, processes?: boolean, log?: (text: string) => void}} options
 */
export async function runBench(options) {
    const { root, runs, repoKey, lensVersion, commit, processes, log } = { runs: 5, processes: true, log: () => {}, ...options };
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-bench-'));
    const env = { ...process.env, LENS_REPO_ROOT: root, LENS_GRAPH_DB: path.join(tempDir, 'project.lbdb'), LENS_PROJECT_GRAPH: '1', LENS_HOME: path.join(tempDir, 'home') };
    const previousRoot = REPO_ROOT;
    configureLensRoot(root);
    try {
        return await withBenchEnv(env, async () => {
            const repository = createGraphRepository({ databasePath: env.LENS_GRAPH_DB });
            const sync = await measureSync(createGraphSync({ root, repository }), runs, log);
            const questions = await measureQuestions({ root, repository, runs, log });
            const spawned = processes ? await measureProcesses({ root, env, file: questions.targets.file, runs, log }) : {};
            const { synced } = sync;
            return {
                schema: 1, createdAt: new Date().toISOString(), commit, runs,
                environment: benchEnvironment({ lensVersion }),
                repo: { key: repoKey, files: synced.added + synced.updated, nodes: synced.nodes, edges: synced.edges ?? null },
                measurements: { ...sync.measurements, ...questions.measurements, ...spawned },
                phases: sync.phases
            };
        });
    } finally {
        configureLensRoot(previousRoot);
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* a locked file in temp is no failure */ }
    }
}
