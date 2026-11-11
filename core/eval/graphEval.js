/**
 * Graph eval: does the graph FIND the right files, and does it stay current?
 *
 * Model-free, deterministic, seconds. It goes through the real path: a sync writes a temporary Ladybug database, then
 * `graph_query` answers (merge, ranking, neighbour expansion). Nothing is seeded by hand: a graph test that writes its own
 * graph stays green while every real sync builds 0 nodes.
 *
 * Metrics: recall@k and MRR over positive queries, negativesClean (queries that must return nothing), freshness
 * (add/change/remove are seen after a sync), goldMissing (an expected path that no longer exists: the gold set drifted).
 * TODO(coverage): Current statement coverage is 80.5% (< 85% target). Raise to >= 85%.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createGraphSync, createGraphRepository } from '../graph/index.js';
import { graph_query } from '../search/index.js';
import { lensEnvName } from '../configuration/index.js';

export const FIXTURE_GOLD = JSON.parse(fs.readFileSync(new URL('./fixtureGold.json', import.meta.url), 'utf8'));
export const DEFAULT_THRESHOLDS = { recallAtK: 0.8, mrr: 0.5, negativesClean: 1, freshness: 1, k: 5 };
const FIXTURE_SETTINGS = { project: { graph_roots: ['.'], exclude_dirs: ['.git', '.memory', 'node_modules'], graph_extensions: ['.js', '.mjs', '.md'] }, graph: { ast: { enabled: false } } };

function restoreEnv(previous) {
    previous.forEach(([key, value]) => {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    });
}

/** Settings by their lens name (e.g. GRAPH_DB), set under the variable the host mapped them to, restored afterwards. */
async function withSettings(values, fn) {
    const entries = Object.entries(values).map(([name, value]) => [lensEnvName(name), value]);
    const previous = entries.map(([key]) => [key, process.env[key]]);
    for (const [key, value] of entries) process.env[key] = value;
    try {
        return await fn();
    } finally {
        restoreEnv(previous);
    }
}

async function ask(databasePath, query, k) {
    const result = await withSettings({ GRAPH_DB: databasePath }, () => graph_query({ sessionId: 'graph-eval', query, limit: k }));
    if (result.error) throw new Error(`graph_query failed: ${result.error}`);
    return (result.nodes || []).map(node => node.path).filter(Boolean);
}

/**
 * Score answers against gold queries `{ id, query, expected: [paths], tag? }`; `answers` maps id -> ranked paths.
 * An empty `expected` is a negative: it passes only when the answer is empty.
 */
export function scoreQueries(queries, answers, root, k) {
    const rows = queries.map(item => {
        const got = (answers.get(item.id) || []).slice(0, k);
        const ranks = item.expected.map(file => got.indexOf(file)).filter(index => index >= 0);
        const best = ranks.length ? Math.min(...ranks) + 1 : null;
        return {
            id: item.id, query: item.query, expected: item.expected, got, tag: item.tag || null,
            goldMissing: item.expected.filter(file => root && !fs.existsSync(path.join(root, file))),
            negative: item.expected.length === 0,
            hit: item.expected.length === 0 ? got.length === 0 : best !== null,
            rank: best
        };
    });
    const positives = rows.filter(row => !row.negative);
    const negatives = rows.filter(row => row.negative);
    return {
        rows,
        recallAtK: positives.length ? positives.filter(row => row.hit).length / positives.length : null,
        mrr: positives.length ? positives.reduce((sum, row) => sum + (row.rank ? 1 / row.rank : 0), 0) / positives.length : null,
        negativesClean: negatives.length ? negatives.filter(row => row.hit).length / negatives.length : null,
        goldMissing: rows.flatMap(row => row.goldMissing.map(file => ({ id: row.id, file }))),
        // Per category, so a regression in one kind of question cannot hide in the total.
        byTag: Object.fromEntries([...new Set(rows.map(row => row.tag).filter(Boolean))].map(tag => {
            const tagged = rows.filter(row => row.tag === tag);
            return [tag, { passed: tagged.filter(row => row.hit).length, total: tagged.length }];
        }))
    };
}

async function evaluateOn(root, queries, k, settings) {
    const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-eval-'));
    const databasePath = path.join(workdir, 'project.lbdb');
    try {
        const built = await createGraphSync({ root, repository: createGraphRepository({ databasePath }), settings }).sync({ mode: 'full' });
        const answers = new Map();
        for (const item of queries) answers.set(item.id, await ask(databasePath, item.query, k));
        return { nodes: built.nodes, edges: built.edges, syncMs: built.durationMs, ...scoreQueries(queries, answers, root, k) };
    } finally {
        fs.rmSync(workdir, { recursive: true, force: true });
    }
}

function writeFiles(root, files) {
    for (const [rel, content] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        fs.writeFileSync(path.join(root, rel), content);
    }
}

async function evaluateFreshness(fixture, k) {
    const rows = [];
    for (const scenario of fixture.freshness) {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-fresh-'));
        const databasePath = path.join(root, '.memory', 'graph', 'project.lbdb');
        try {
            writeFiles(root, fixture.files);
            const sync = createGraphSync({ root, repository: createGraphRepository({ databasePath }), settings: FIXTURE_SETTINGS });
            await sync.sync({ mode: 'full' });
            writeFiles(root, scenario.change.write || {});
            (scenario.change.remove || []).forEach(file => fs.rmSync(path.join(root, file), { force: true }));
            await sync.sync();
            const got = await ask(databasePath, scenario.query, k);
            const foundOk = (scenario.expectFound || []).every(file => got.includes(file));
            const absentOk = (scenario.expectAbsent || []).every(file => !got.includes(file));
            rows.push({ id: scenario.id, pass: foundOk && absentOk, got });
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    }
    return { rows, score: rows.length ? rows.filter(row => row.pass).length / rows.length : null };
}

/**
 * The frozen fixture (always) and, when `repo` is given, a real checkout with its own gold queries.
 * @param {{ repo?: { root: string, queries: object[], settings: object }, thresholds?: object, fixture?: object }} [options]
 * @returns {Promise<{fixture: object, repo: object|null, freshness: object, thresholds: object, failures: string[], pass: boolean}>}
 */
export async function runGraphEval({ repo = null, thresholds = DEFAULT_THRESHOLDS, fixture = FIXTURE_GOLD } = {}) {
    return withSettings({ PROJECT_GRAPH: '1' }, async () => {
        const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-fixture-'));
        let fixtureReport;
        try {
            writeFiles(fixtureRoot, fixture.files);
            fixtureReport = await evaluateOn(fixtureRoot, fixture.queries, thresholds.k, FIXTURE_SETTINGS);
        } finally {
            fs.rmSync(fixtureRoot, { recursive: true, force: true });
        }
        const repoReport = repo ? await evaluateOn(repo.root, repo.queries, thresholds.k, repo.settings) : null;
        const freshness = await evaluateFreshness(fixture, thresholds.k);

        const failures = [];
        const check = (label, value, min) => { if (value === null || value < min) failures.push(`${label} ${value === null ? 'n/a' : value.toFixed(2)} < ${min}`); };
        for (const [name, part] of Object.entries({ fixture: fixtureReport, repo: repoReport })) {
            if (!part) continue;
            if (part.nodes < 10) failures.push(`${name}: graph has only ${part.nodes} nodes`);
            check(`${name} recall@${thresholds.k}`, part.recallAtK, thresholds.recallAtK);
            check(`${name} MRR`, part.mrr, thresholds.mrr);
            check(`${name} negativesClean`, part.negativesClean, thresholds.negativesClean);
            for (const missing of part.goldMissing) failures.push(`${name}: gold path no longer exists (${missing.id}: ${missing.file})`);
        }
        check('freshness', freshness.score, thresholds.freshness);
        return { fixture: fixtureReport, repo: repoReport, freshness, thresholds, failures, pass: failures.length === 0 };
    });
}

/** The report as lines of text, ending in `GRAPH EVAL: PASS` or `GRAPH EVAL: FAIL` with the reasons. */
export function formatGraphEval(report) {
    const pct = (value) => (value === null ? 'n/a' : `${Math.round(value * 100)}%`);
    const lines = [];
    for (const [name, part] of Object.entries({ fixture: report.fixture, repo: report.repo })) {
        if (!part) continue;
        lines.push('', `${name}: ${part.nodes} nodes, ${part.edges} edges, sync ${part.syncMs} ms`);
        lines.push(`  recall@${report.thresholds.k}=${pct(part.recallAtK)}  MRR=${part.mrr?.toFixed(2)}  negativesClean=${pct(part.negativesClean)}`);
        for (const [tag, score] of Object.entries(part.byTag || {})) lines.push(`  ${tag}: ${score.passed}/${score.total}`);
        for (const row of part.rows) lines.push(`  ${row.hit ? 'PASS' : 'FAIL'} ${row.id.padEnd(20)} rank=${row.rank ?? '-'}  got: ${row.got.slice(0, 3).join(', ') || '(nothing)'}`);
    }
    lines.push('', `freshness: ${pct(report.freshness.score)}`);
    for (const row of report.freshness.rows) lines.push(`  ${row.pass ? 'PASS' : 'FAIL'} ${row.id}`);
    lines.push(report.pass ? '\nGRAPH EVAL: PASS' : `\nGRAPH EVAL: FAIL\n  - ${report.failures.join('\n  - ')}`);
    return lines.join('\n');
}
