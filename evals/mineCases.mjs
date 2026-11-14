#!/usr/bin/env node
/**
 * Behaviour cases mined from a repository's history, so the ranking is measured on code lens was not tuned to
 * (backlog/zoeken-op-gedrag.md): the question is a commit subject, the state is its parent, the expected files are the
 * source files the commit changed. Nobody picks the cases by hand: a seeded sample of every commit that qualifies.
 *
 *   node evals/mineCases.mjs <repo> --name <name> [--count 20] [--seed 1] [--max 5000]
 *
 * Writes localtests/gold/<name>.json (ignored by git: subjects and paths of a customer repository are never pushed) in
 * the shape of evals/behaviour-gold.json; measure it with `node evals/behaviourEval.mjs --gold localtests/gold/<name>.json`.
 * Only a set of a public repository goes to evals/gold/, on purpose.
 *
 * A commit qualifies when it has one parent, a subject of at least 4 words that is not a merge, revert, release or
 * version bump, changes 1 or 2 source files that existed before (no test, no generated or vendored code) and at most
 * 8 files in all, and its subject does not name an expected file: the question describes behaviour, it does not point.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createGit } from '../core/git/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = /\.(js|mjs|cjs|jsx|ts|tsx|py|cs|java|go|rb|php|rs|kt|swift|c|cc|cpp|h|hpp)$/i;
const TEST = /(^|\/)(tests?|__tests__|spec|specs)\/|[._-](test|spec)s?\.[a-z]+$|(^|\/)test_[^/]+\.py$|_test\.(py|go)$|Tests?\.cs$|\.Tests?\//i;
const GENERATED = /(^|\/)(dist|build|out|bin|obj|vendor|vendorlib|node_modules|deployment|coverage|\.mendix-cache)\/|\.min\.js$|\.d\.ts$|\.designer\.cs$/i;
const NOT_A_QUESTION = /^(merge|revert|bump|release|version|v?\d+\.\d+|wip|chore|update dependencies|initial commit)\b/i;

// the squash message of a pull request starts with its number, which says nothing about the behaviour
const PULL_REQUEST = /^Merged PR \d+:\s*/i;

const isSource = file => SOURCE.test(file) && !TEST.test(file) && !GENERATED.test(file);
const stem = file => path.posix.basename(file).replace(/\.[^.]+$/, '').toLowerCase();

/** The case a commit gives, or null when it does not qualify. */
export function caseOf(commit) {
    const subject = String(commit.subject || '').trim().replace(PULL_REQUEST, '');
    if (commit.parents?.length !== 1 || NOT_A_QUESTION.test(subject) || subject.split(/\s+/).length < 4) return null;
    const sources = commit.files.filter(file => isSource(file.path));
    if (!sources.length || sources.length > 2 || commit.files.length > 8 || sources.some(file => file.status !== 'M')) return null;
    if (sources.some(file => subject.toLowerCase().includes(stem(file.path)))) return null;
    return { id: `${commit.sha.slice(0, 7)}`, kind: 'code', commit: commit.parents[0].slice(0, 10), expected: sources.map(file => file.path), query: subject };
}

/** Deterministic shuffle (mulberry32): the same seed gives the same sample. */
function shuffled(items, seed) {
    let state = seed >>> 0;
    const random = () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

export function mineCases(repo, { count = 20, seed = 1, max = 5000 } = {}) {
    const commits = createGit({ root: repo }).commitsWithFiles(max);
    const candidates = commits.map(caseOf).filter(Boolean);
    return { scanned: commits.length, qualified: candidates.length, cases: shuffled(candidates, seed).slice(0, count) };
}

const argv = process.argv.slice(2);
const option = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const repo = path.resolve(argv[0] || '.');
    const name = option('--name', path.basename(repo).toLowerCase().replace(/[^a-z0-9]+/g, '-'));
    const seed = Number(option('--seed', 1));
    const { scanned, qualified, cases } = mineCases(repo, { count: Number(option('--count', 20)), seed, max: Number(option('--max', 5000)) });
    const gold = {
        about: `Behaviour cases mined from the history of ${path.basename(repo)} (evals/mineCases.mjs, seed ${seed}): a commit subject as the question, its parent as the state, the source files it changed as the answer. ${qualified} of ${scanned} commits qualified.`,
        repo: repo.split(path.sep).join('/'),
        top: 3,
        cases
    };
    const file = path.join(ROOT, 'localtests', 'gold', `${name}.json`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(gold, null, 2)}\n`);
    console.log(`${name}: ${scanned} commits, ${qualified} qualify, ${cases.length} cases -> ${path.relative(ROOT, file)}`);
    for (const item of cases) console.log(`  ${item.id}  ${item.expected.join(', ')}  "${item.query}"`);
}
