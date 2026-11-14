#!/usr/bin/env node
/**
 * Behaviour eval (backlog/zoeken-op-gedrag.md): does a question about behaviour, in plain Dutch or English, bring the file
 * where that behaviour lives into the top 3 of graph_query, on the repository as it was BEFORE the change?
 *
 * Each commit of evals/behaviour-gold.json is read through the git port (`listTree`, `readBlobs`: nothing is checked out,
 * no worktree is added to the measured repository), written to a temporary folder, synced into a temporary database and
 * asked every question of that commit.
 *
 *   node evals/behaviourEval.mjs                 report (exit 0)
 *   node evals/behaviourEval.mjs --strict        exit 1 when a case fails
 *   node evals/behaviourEval.mjs --repo <dir>    another checkout of the repository named in the gold file
 *   node evals/behaviourEval.mjs --state         the states of evals/state-gold.json (backlog/toestand-in-de-code.md): the
 *                                                function and line of graph_query places, or no place for a refuse case
 *   node evals/behaviourEval.mjs --host-gold <commit>   the host's own graph eval (its evals/graph-gold.json, repo queries) at
 *                                                that commit: a gain on the behaviour set must not cost the host's set
 *   node evals/behaviourEval.mjs --gold <file>   another set, mined from a repo's history (evals/gold/ or localtests/gold/)
 *   node evals/behaviourEval.mjs --lexicon <file>  the host's lexicon of today for every commit
 *   node evals/behaviourEval.mjs --cache <dir>   keep each commit's folder and database there: the next run only syncs what
 *                                                changed (a change in the facts of a file re-reads it)
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { createGit } from '../core/git/index.js';
import { configureLensRoot } from '../core/configuration/index.js';
import { createGraphSync, createGraphRepository } from '../core/graph/index.js';
import { graph_query, invalidateGraphCache } from '../core/search/index.js';
import { runGraphEval } from '../core/eval/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const STATE = argv.includes('--state');
// --gold <file>: another set in the same shape (mined by evals/mineCases.mjs: evals/gold/ public, localtests/gold/ local)
const GOLD_FILE = argv.includes('--gold') ? path.resolve(argv[argv.indexOf('--gold') + 1]) : path.join(ROOT, 'evals', STATE ? 'state-gold.json' : 'behaviour-gold.json');
const GOLD = JSON.parse(fs.readFileSync(GOLD_FILE, 'utf8'));
const repo = argv.includes('--repo') ? path.resolve(argv[argv.indexOf('--repo') + 1]) : GOLD.repo;
// --lexicon <file>: one lexicon for every commit (the host's file of today), instead of the one at each commit
const LEXICON = argv.includes('--lexicon') ? path.resolve(argv[argv.indexOf('--lexicon') + 1]) : null;
const cacheDir = argv.includes('--cache') ? path.resolve(argv[argv.indexOf('--cache') + 1]) : null;
const BINARY = /\.(tgz|gz|zip|png|jpe?g|gif|ico|pdf|woff2?|ttf|lbdb|mpr|exe|dll|bin)$/i;

/** The text files of `commit`, written under `dir`. */
function materialize(git, commit, dir) {
    const paths = (git.listTree(commit) || []).filter(file => !BINARY.test(file));
    const texts = git.readBlobs(commit, paths);
    for (const [file, text] of texts) {
        if (text == null) continue;
        fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
        fs.writeFileSync(path.join(dir, file), text);
    }
    return paths.length;
}

// what a caller's model picks from (graph_query's default for a text question)
const CANDIDATES = 20;

const rankOf = (paths, expected) => {
    const index = paths.findIndex(file => expected.includes(file));
    return index < 0 ? null : index + 1;
};

async function ask(query, kind) {
    const result = await graph_query({ query, kind, limit: CANDIDATES });
    return (result.nodes || []).map(node => node.path).filter(Boolean);
}

/** One case: the rank of the expected file; a docs-only case also may not bring those docs with kind code. */
async function judge(item) {
    const paths = await ask(item.query, item.kind);
    const rank = rankOf(paths, item.expected);
    const pass = rank !== null && rank <= GOLD.top;
    if (!item.refuseCode) return { ...item, rank, top: paths.slice(0, 5), pass };
    const codeAnswer = await ask(item.query, 'code');
    return { ...item, rank, top: paths.slice(0, 5), pass: pass && rankOf(codeAnswer, item.expected) === null, codeAnswer: codeAnswer.slice(0, 3) };
}

/** A state case: the expected function (or, without one, any function of the file) whose range holds an expected line. */
async function judgeState(item) {
    const { places = [] } = await graph_query({ query: item.query, kind: 'code', limit: 10, places: true });
    const top = places.map(p => `${p.path}#${p.function}:${p.lines.join(',')}`);
    if (item.refuse) return { ...item, rank: null, top, pass: places.length === 0 };
    const index = places.findIndex(p => p.path === item.path && (!item.function || p.function === item.function) && item.lines.some(line => line >= p.startLine && line <= p.endLine));
    const rank = index < 0 ? null : index + 1;
    return { ...item, rank, top, pass: rank !== null && rank <= GOLD.top };
}

async function evalCommit(git, commit, cases) {
    const dir = cacheDir ? path.join(cacheDir, commit) : fs.mkdtempSync(path.join(os.tmpdir(), `lens-behaviour-${commit}-`));
    const fresh = !fs.existsSync(path.join(dir, '.lens-eval.lbdb'));
    const database = path.join(dir, '.lens-eval.lbdb');
    // the host's own lexicon at that commit, as Kura passes it (LENS_LEXICON_FILE); --no-host-lexicon measures lens alone
    const lexicon = LEXICON ?? (GOLD.lexicon && !argv.includes('--no-host-lexicon') ? path.join(dir, GOLD.lexicon) : path.join(dir, '.no-lexicon.json'));
    Object.assign(process.env, { LENS_REPO_ROOT: dir, LENS_GRAPH_DB: database, LENS_PROJECT_GRAPH: '1', LENS_LEXICON_FILE: lexicon });
    configureLensRoot(dir);
    try {
        const files = fresh ? materialize(git, commit, dir) : 0;
        const started = Date.now();
        await createGraphSync({ root: dir, repository: createGraphRepository({ databasePath: database }) }).sync({ mode: fresh ? 'full' : 'incremental' });
        process.stderr.write(`  ${commit}: ${files} files, synced in ${Date.now() - started} ms\n`);
        invalidateGraphCache();
        const results = [];
        for (const item of cases) results.push(await (STATE ? judgeState : judge)(item));
        return results;
    } finally {
        invalidateGraphCache();
        if (!cacheDir) fs.rmSync(dir, { recursive: true, force: true });
    }
}

/** The host's graph eval at `commit`: its repo queries, scored by runGraphEval as the host runs it. */
export async function runHostGoldEval(commit) {
    const git = createGit({ root: repo });
    const dir = cacheDir ? path.join(cacheDir, `host-${commit}`) : fs.mkdtempSync(path.join(os.tmpdir(), `lens-host-${commit}-`));
    if (!fs.existsSync(path.join(dir, 'evals', 'graph-gold.json'))) materialize(git, commit, dir);
    process.env.LENS_LEXICON_FILE = path.join(dir, GOLD.lexicon || '.no-lexicon.json');
    configureLensRoot(dir);
    const queries = JSON.parse(fs.readFileSync(path.join(dir, 'evals', 'graph-gold.json'), 'utf8')).repo.queries;
    const report = await runGraphEval({ repo: { root: dir, queries } });
    const rows = report.repo?.rows || [];
    return { commit, recallAtK: report.repo?.recallAtK, failing: rows.filter(row => !row.hit).map(row => `${row.id} rank=${row.rank ?? '-'} got: ${(row.got || []).slice(0, 3).join(', ')}`) };
}

export async function runBehaviourEval() {
    const git = createGit({ root: repo });
    const commits = [...new Set(GOLD.cases.map(item => item.commit))];
    const results = [];
    for (const commit of commits) results.push(...await evalCommit(git, commit, GOLD.cases.filter(item => item.commit === commit)));
    return { repo, top: GOLD.top, passed: results.filter(r => r.pass).length, total: results.length, results };
}

function format({ top, passed, total, results }) {
    const candidates = STATE ? '' : `; ${results.filter(r => r.rank !== null && r.rank <= CANDIDATES).length} of ${total} in the top ${CANDIDATES} (the candidates)`;
    const lines = [`${STATE ? 'state' : 'behaviour'} eval: ${passed} of ${total} cases with the expected ${STATE ? 'function and line' : 'file'} in the top ${top}${candidates}`, ''];
    for (const r of results) {
        lines.push(`${r.pass ? 'PASS' : 'FAIL'} ${r.id.padEnd(30)} rank=${r.rank ?? '-'}  got: ${r.top.join(', ') || '(nothing)'}`);
        if (r.refuseCode && r.codeAnswer) lines.push(`     with kind code: ${r.codeAnswer.join(', ') || '(nothing)'}`);
    }
    return lines.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && argv.includes('--host-gold')) {
    const report = await runHostGoldEval(argv[argv.indexOf('--host-gold') + 1]);
    console.log([`host graph eval at ${report.commit}: recall@5 ${report.recallAtK}`, ...report.failing].join('\n'));
    process.exit(0);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const report = await runBehaviourEval();
    console.log(argv.includes('--json') ? JSON.stringify(report, null, 2) : format(report));
    process.exit(argv.includes('--strict') && report.passed < report.total ? 1 : 0);
}
