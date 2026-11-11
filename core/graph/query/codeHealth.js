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
import {
    buildHealthSummary,
    normalizeHealthOptions,
    assembleHealthEntry,
    topHotspots,
    filterHealthFiles,
    rollupModules
} from './healthIssues.js';

export {
    ISSUE_RULES,
    evaluateIssues,
    buildHealthSummary,
    coverageFromSummary,
    topHotspots,
    filterHealthFiles,
    rollupModules
} from './healthIssues.js';

const isTest = (node) => node.kind === 'test' || node.type === 'Test';
const isBarrel = (path) => /(^|\/)index\.[cm]?js$/.test(path);
const dirOf = (path) => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';

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

function recordTestPath(path, testPath, out, reachedBy, queue) {
    const list = reachedBy.get(path) || [];
    if (!reachedBy.has(path)) reachedBy.set(path, list);
    list.push(testPath);
    if (isBarrel(path)) queue.push(...(out.get(path) || []));
}

function traceTestReach(testPath, out, reachedBy) {
    const seen = new Set();
    const queue = [...(out.get(testPath) || [])];
    while (queue.length) {
        const path = queue.shift();
        if (!seen.has(path)) {
            seen.add(path);
            recordTestPath(path, testPath, out, reachedBy, queue);
        }
    }
}

function isHealthEdge(type) {
    return type === 'IMPORTS' || type === 'TESTS';
}

function recordHealthEdge(edge, byId, out, inn) {
    if (!isHealthEdge(edge.type)) return;
    const from = byId.get(edge.from), to = byId.get(edge.to);
    if (!from || !to || from === to) return;
    out.get(from.path).add(to.path);
    inn.get(to.path).add(from.path);
}

function findUntestedExports(exports, readable, covered, barrel, textOf) {
    if (!readable.length) return [];
    if (covered !== undefined) return [];
    if (barrel) return [];
    return exports.filter(name => !readable.some(test => wordIn(textOf(test), name)));
}

function findBoundaryViolations(path, out, barrels) {
    return [...out.get(path)].filter(to => !isBarrel(to) && [...barrels].some(dir => dir && to.startsWith(`${dir}/`) && !path.startsWith(`${dir}/`))).sort();
}

function nodeLines(node) {
    return Number(node.lines) || 0;
}

function nodeExports(node) {
    if (Array.isArray(node.exports)) return node.exports;
    return [];
}

function buildFileEntry(node, helpers, textOf) {
    const { path, kind } = node;
    const barrel = isBarrel(path);
    const tests = [...new Set(helpers.reachedBy.get(path) || [])].sort();
    const exports = nodeExports(node);
    const readable = tests.filter(test => textOf(test));
    const covered = helpers.coverage.get(path);
    const untestedExports = findUntestedExports(exports, readable, covered, barrel, textOf);
    const boundaryViolations = findBoundaryViolations(path, helpers.out, helpers.barrels);
    const lines = nodeLines(node);
    const commits = helpers.churn.get(path) || 0;
    const isTested = tests.length > 0 || covered > 0;

    const meta = { path, kind, lines, exports: exports.length, inCycle: helpers.inCycle.has(path) };
    const metrics = {
        fanIn: helpers.inn.get(path).size, fanOut: helpers.out.get(path).size,
        tested: isTested, tests, untestedExports, boundaryViolations,
        churn: commits, hotspot: commits * lines
    };
    return assembleHealthEntry(meta, metrics, { covered, live: helpers.signals.get(path), barrel });
}

function collectDesignSmells(complexFunctions, files) {
    const fnSmells = complexFunctions.flatMap(fn => (fn.smells || []).map(s => ({ ...s, file: fn.file, name: fn.name })));
    const fileSmells = files.flatMap(entry => (entry.fileSmells || []).map(s => ({ ...s, file: entry.path })));
    return [...fnSmells, ...fileSmells];
}

function createGraphAdjacency(graph) {
    const nodes = [...graph.nodes.values()].filter(node => node.type === 'CodeFile' && typeof node.path === 'string');
    const byId = new Map(nodes.map(node => [node.id, node]));
    const out = new Map(nodes.map(node => [node.path, new Set()]));
    const inn = new Map(nodes.map(node => [node.path, new Set()]));
    graph.edges.forEach(edge => recordHealthEdge(edge, byId, out, inn));
    return { nodes, byId, out, inn };
}

function resolveCycles(sources, sourceOut, wanted) {
    const components = cyclesOf(sources.map(node => node.path).sort(), sourceOut);
    const inCycle = new Set(components.flat());
    const cycles = wanted ? [] : components.map(members => ({ size: members.length, shortest: shortestLoop(members, sourceOut) })).sort((a, b) => b.size - a.size);
    return { inCycle, cycles };
}

/** Pure code health metrics from the graph, test reach, git churn and live health signals. */
export function codeHealth(graph, options) {
    const opts = normalizeHealthOptions(options);
    const { nodes, byId, out, inn } = createGraphAdjacency(graph);
    const barrels = new Set(nodes.filter(node => isBarrel(node.path)).map(node => dirOf(node.path)));

    const reachedBy = new Map();
    nodes.filter(isTest).forEach(test => traceTestReach(test.path, out, reachedBy));

    const sources = nodes.filter(node => !isTest(node));
    const sourceOut = new Map(sources.map(node => [node.path, [...out.get(node.path)].filter(to => !isTest(byId.get(`file:${to}`) || {}))]));
    const wanted = Array.isArray(opts.only) ? new Set(opts.only) : null;
    const { inCycle, cycles } = resolveCycles(sources, sourceOut, wanted);

    const testTexts = new Map();
    const textOf = (path) => {
        if (!testTexts.has(path)) testTexts.set(path, opts.readFile(path) ?? '');
        return testTexts.get(path);
    };

    const helpers = { reachedBy, coverage: opts.coverage, churn: opts.churn, signals: opts.signals, inCycle, out, inn, barrels };
    const targets = wanted ? sources.filter(node => wanted.has(node.path)) : sources;
    const allFiles = targets.map(node => buildFileEntry(node, helpers, textOf));
    const modules = rollupModules(allFiles, barrels);
    const files = filterHealthFiles(allFiles, opts.file, opts.module);
    const hotspots = topHotspots(files);

    const { topCentralNodes, zoneOfPain, complexFunctions } = calculateArchitectureMetrics(graph, files);
    const designSmells = collectDesignSmells(complexFunctions, files);
    const summary = buildHealthSummary(files, zoneOfPain, complexFunctions, designSmells);

    return {
        summary, files, modules, cycles, hotspots,
        topCentralNodes, zoneOfPain, complexFunctions, designSmells
    };
}
