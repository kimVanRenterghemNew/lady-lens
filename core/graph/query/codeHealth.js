/**
 * Code health from the graph, per file and per module (a folder with an index.js).
 * - test reach: a test reaches a file it imports, also through barrels (test -> index.js -> file); naive TESTS edges
 *   miss everything imported via index.js. untestedExports = exports no reaching test names (a name match, not a call).
 * - coupling: fan-in / fan-out over IMPORTS; import cycles (strongly connected components of size > 1), each with its
 *   shortest loop: barrels pull a whole layer into one component, the shortest loop is what to cut.
 * - boundary: an import into a module's inside (not its index.js) from outside that module.
 * - size: lines and exports; hotspot = churn (commits touching the file) x lines.
 * - coverage: % of lines a coverage run covered (istanbul json-summary), when the repository has one.
 */
import { cyclesOf, shortestLoop } from './importCycles.js';
import { calculateArchitectureMetrics } from './architectureMetrics.js';

const isTest = (node) => node.kind === 'test' || node.type === 'Test';
const isBarrel = (path) => /(^|\/)index\.[cm]?js$/.test(path);
const dirOf = (path) => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
const LARGE_LINES = 400;
const HIGH_FAN_IN = 40;
const HIGH_FAN_OUT = 20;
const LOW_COVERAGE = 50;

/**
 * Pure: an istanbul `coverage-summary.json` (keys are absolute paths, plus `total`) -> repo-relative path -> % lines covered.
 * @param {Object} summary - the parsed file
 * @param {(absolute: string) => string|null} toRepoPath - null for a path outside the repository
 */
export function coverageFromSummary(summary, toRepoPath) {
    const coverage = new Map();
    for (const [key, value] of Object.entries(summary || {})) {
        const path = key === 'total' ? null : toRepoPath(key);
        if (path && Number.isFinite(value?.lines?.pct)) coverage.set(path, value.lines.pct);
    }
    return coverage;
}

// What a host knows from running code that the graph cannot read from files: how often work on a file failed live
// (e.g. an edit refused by a static check, a failed verification). `({ root }) => Map<path, { <failure name>: count }>`.
let signalSource = null;
export function configureLensHealthSignals(source = null) {
    signalSource = source;
}

/** The host's live failure counts per file; none when no host gave a source or it failed (then logged). */
export async function healthSignals({ root, log = () => {} } = {}) {
    if (!signalSource) return new Map();
    try {
        return new Map(await signalSource({ root }));
    } catch (error) {
        log(`health signals failed and were skipped: ${error.message}`);
        return new Map();
    }
}

function wordIn(text, name) {
    return new RegExp(`(^|[^\\w$])${name.replace(/[$]/g, '\\$')}(?![\\w$])`).test(text);
}

/**
 * @param {Object} graph - graph model (nodes Map, edges array)
 * @param {{readFile?: (path: string) => string|null, churn?: Map<string, number>, coverage?: Map<string, number>, signals?: Map<string, Object>, file?: string, module?: string, only?: string[]}} options
 *   coverage: repo-relative path -> % of lines covered (see coverageFromSummary)
 *   signals: repo-relative path -> { <failure name>: count } from the host's live runs (see configureLensHealthSignals)
 *   only: compute the entries of these files only (no shortest cycle loops); the module rollup then covers just them
 */
export function codeHealth(graph, { readFile = () => null, churn = new Map(), coverage = new Map(), signals = new Map(), file, module, only } = {}) {
    const nodes = [...graph.nodes.values()].filter(node => node.type === 'CodeFile' && typeof node.path === 'string');
    const byId = new Map(nodes.map(node => [node.id, node]));
    const out = new Map(nodes.map(node => [node.path, new Set()]));
    const inn = new Map(nodes.map(node => [node.path, new Set()]));
    for (const edge of graph.edges) {
        if (edge.type !== 'IMPORTS' && edge.type !== 'TESTS') continue;
        const from = byId.get(edge.from), to = byId.get(edge.to);
        if (!from || !to || from === to) continue;
        out.get(from.path).add(to.path);
        inn.get(to.path).add(from.path);
    }
    const barrels = new Set(nodes.filter(node => isBarrel(node.path)).map(node => dirOf(node.path)));

    // test reach: from every test, its imports, and on through barrels
    const reachedBy = new Map();
    for (const test of nodes.filter(isTest)) {
        const seen = new Set();
        const queue = [...out.get(test.path)];
        while (queue.length) {
            const path = queue.shift();
            if (seen.has(path)) continue;
            seen.add(path);
            if (!reachedBy.has(path)) reachedBy.set(path, []);
            reachedBy.get(path).push(test.path);
            if (isBarrel(path)) queue.push(...out.get(path));
        }
    }

    const sources = nodes.filter(node => !isTest(node));
    const sourceOut = new Map(sources.map(node => [node.path, [...out.get(node.path)].filter(to => !isTest(byId.get(`file:${to}`) || {}))]));
    const components = cyclesOf(sources.map(node => node.path).sort(), sourceOut);
    const inCycle = new Set(components.flat());
    // `only`: the entries of just these files (a graph_query answer needs ~10, not every file and every test text)
    const wanted = Array.isArray(only) ? new Set(only) : null;
    const cycles = wanted ? [] : components.map(members => ({ size: members.length, shortest: shortestLoop(members, sourceOut) })).sort((a, b) => b.size - a.size);
    const testTexts = new Map();
    const textOf = (path) => { if (!testTexts.has(path)) testTexts.set(path, readFile(path) ?? ''); return testTexts.get(path); };

    let files = (wanted ? sources.filter(node => wanted.has(node.path)) : sources).map(node => {
        const path = node.path;
        const tests = [...new Set(reachedBy.get(path) || [])].sort();
        const exports = Array.isArray(node.exports) ? node.exports : [];
        const readable = tests.filter(test => textOf(test));
        const untestedExports = readable.length ? exports.filter(name => !readable.some(test => wordIn(textOf(test), name))) : [];
        // an import into dir/x.js of a module dir (it has an index.js) from outside dir
        const boundaryViolations = [...out.get(path)].filter(to => !isBarrel(to) && [...barrels].some(dir => dir && to.startsWith(`${dir}/`) && !path.startsWith(`${dir}/`))).sort();
        const lines = Number(node.lines) || 0;
        const commits = churn.get(path) || 0;
        const covered = coverage.get(path);
        const live = signals.get(path);
        const entry = {
            path, kind: node.kind, lines, exports: exports.length, fanIn: inn.get(path).size, fanOut: out.get(path).size,
            tested: tests.length > 0, tests, untestedExports, inCycle: inCycle.has(path), boundaryViolations, churn: commits, hotspot: commits * lines,
            ...(covered === undefined ? {} : { coverage: covered }),
            ...(live ? { live } : {})
        };
        entry.issues = [
            // scripts and config are run or read, not imported by a test
            !entry.tested && node.kind === 'source' && !isBarrel(path) && 'untested',
            untestedExports.length && 'untested-exports',
            covered !== undefined && covered < LOW_COVERAGE && 'low-coverage',
            live && Object.values(live).some(count => count > 0) && 'live-failures',
            entry.inCycle && 'cycle',
            boundaryViolations.length && 'boundary',
            lines > LARGE_LINES && 'large',
            entry.fanIn >= HIGH_FAN_IN && 'high-fan-in',
            entry.fanOut >= HIGH_FAN_OUT && 'high-fan-out'
        ].filter(Boolean);
        return entry;
    });

    const moduleOf = (path) => {
        for (let dir = dirOf(path); dir; dir = dirOf(dir)) if (barrels.has(dir)) return dir;
        return dirOf(path) || '.';
    };
    const modules = new Map();
    for (const entry of files) {
        const name = moduleOf(entry.path);
        const rollup = modules.get(name) || { module: name, files: 0, lines: 0, untested: 0, cycles: 0, boundary: 0, churn: 0 };
        rollup.files++; rollup.lines += entry.lines; rollup.churn += entry.churn;
        if (entry.issues.includes('untested')) rollup.untested++;
        if (entry.inCycle) rollup.cycles++;
        if (entry.boundaryViolations.length) rollup.boundary++;
        modules.set(name, rollup);
    }

    if (file) files = files.filter(entry => entry.path === file);
    if (module) files = files.filter(entry => entry.path.startsWith(`${module.replace(/\/$/, '')}/`));
    files.sort((a, b) => b.issues.length - a.issues.length || b.hotspot - a.hotspot || a.path.localeCompare(b.path));
    const hotspots = files.filter(entry => entry.hotspot > 0).sort((a, b) => b.hotspot - a.hotspot).slice(0, 10)
        .map(({ path, churn: commits, lines, hotspot }) => ({ path, churn: commits, lines, hotspot }));
    const { topCentralNodes, zoneOfPain, complexFunctions } = calculateArchitectureMetrics(graph, files);
    const summary = {
        files: files.length,
        untested: files.filter(entry => entry.issues.includes('untested')).length,
        inCycles: files.filter(entry => entry.inCycle).length,
        boundary: files.filter(entry => entry.boundaryViolations.length).length,
        large: files.filter(entry => entry.issues.includes('large')).length,
        zoneOfPain: zoneOfPain.length,
        complexFunctions: complexFunctions.length
    };
    return {
        summary,
        files,
        modules: [...modules.values()].sort((a, b) => a.module.localeCompare(b.module)),
        cycles,
        hotspots,
        topCentralNodes,
        zoneOfPain,
        complexFunctions
    };
}
