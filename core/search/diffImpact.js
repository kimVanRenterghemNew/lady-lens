/**
 * What does my change touch? The functions a diff changes (work not committed yet, or a range) and per function its
 * callers, tests and discussions from functionView. A changed function that no test names is a test gap. Riskiest first:
 * test gaps, then most callers, then highest complexity.
 */
import { REPO_ROOT } from '../configuration/index.js';
import { createGraphRepository, createMemoryRepositoryStore, PROJECT_SCOPE } from '../graph/index.js';
import { changedFunctions } from '../branches/index.js';
import { refreshProjectGraph, readRepoFile } from './graphModelLoader.js';
import { viewOf } from './functionView.js';

const DEFAULT_LIMIT = 50;
const MEMORY_VIEWS_FROM = 10;

/**
 * Many names: one load of the project graph and the views from memory. One Ladybug query per name took 53 s for the
 * 872 names of a feature branch, and held the database for every other agent meanwhile (same answers, 4.9 s).
 */
async function viewSource(store, names) {
    if (names.size <= MEMORY_VIEWS_FROM) return store;
    const memory = createGraphRepository({ store: createMemoryRepositoryStore() });
    await memory.replaceScope(PROJECT_SCOPE, await store.loadGraph({ scopes: [PROJECT_SCOPE] }));
    return memory;
}

function impactEntry(fn, view) {
    const callers = view?.callers ?? [];
    const tests = view?.tests ?? [];
    return {
        function: fn.name, file: fn.file, change: fn.change, line: fn.line, complexity: fn.complexity,
        ...(fn.oldName ? { oldName: fn.oldName, oldFile: fn.oldFile } : {}),
        callers: callers.map(({ path, lines, reference }) => ({ path, lines, ...(reference ? { reference } : {}) })),
        tests: tests.map(({ path, names }) => ({ path, names })),
        ...(view?.discussions ? { discussions: view.discussions } : {}),
        testGap: fn.change !== 'removed' && tests.length === 0,
        resolved: view?.resolved ?? 0, unresolved: view?.unresolved ?? 0,
        ...(view?.note ? { note: view.note } : {})
    };
}

const risk = entry => [Number(entry.testGap), entry.callers.length, entry.complexity ?? 0];
const riskiestFirst = (a, b) => { const [x, y] = [risk(a), risk(b)]; return y[0] - x[0] || y[1] - x[1] || y[2] - x[2]; };

/**
 * @param {{from?: string, to?: string, limit?: number}} args - without `from`: the work not committed yet
 * @param {{refresh?: Function, git?: object, repository?: object, readFile?: Function}} deps - readFile: repo-relative read of the working copy
 */
export async function diffImpact(args = {}, { refresh = refreshProjectGraph, git, repository, readFile = readRepoFile } = {}) {
    const { from, to, limit = DEFAULT_LIMIT } = args ?? {};
    const root = process.env.LENS_REPO_ROOT || REPO_ROOT;
    const changed = changedFunctions({ from, to: to || 'HEAD', root, readFile, ...(git ? { git } : {}) });
    if (changed.error) return changed;
    const freshness = await refresh();
    const store = repository ?? createGraphRepository();
    const max = Math.max(1, Math.min(Number(limit) || DEFAULT_LIMIT, 500));
    // one view per name (a repeated name `f#2` asks once); a removed function is no longer in the graph of the working copy
    const names = new Set(changed.functions.map(fn => fn.name.replace(/#\d+$/, '')));
    const viewStore = await viewSource(store, names);
    const views = new Map();
    for (const name of names) views.set(name, viewOf(viewStore, name, { readFile }));
    const entries = [];
    for (const fn of changed.functions) entries.push(impactEntry(fn, await views.get(fn.name.replace(/#\d+$/, ''))));
    entries.sort(riskiestFirst);
    const { functions: _functions, ...source } = changed;
    return {
        relation: 'diffImpact', ...source,
        functions: entries.slice(0, max),
        testGaps: entries.filter(entry => entry.testGap).map(entry => `${entry.file}#${entry.function}`),
        total: entries.length, truncated: entries.length > max,
        freshness
    };
}
