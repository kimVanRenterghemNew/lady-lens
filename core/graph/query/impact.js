/**
 * What a change to a file reaches and what is known to be fragile about it, as two short fields for `graph_query`:
 * - consequences: files that import it (through barrels: a module is imported via its index.js), files that call it
 *   (CALLS, most call sites first), tests that reach it, and files that usually change with it (CO_CHANGES).
 * - risks: the issues `codeHealth` finds for the file (untested, untested-exports, cycle, boundary, large, high fan-in/out).
 */
import { codeHealth } from './codeHealth.js';

const isBarrel = (path) => /(^|\/)index\.[cm]?js$/.test(String(path));
const isTest = (node) => node?.kind === 'test' || node?.type === 'Test';
const TOP = 3;

const pushMap = (map, key, val) => {
    const list = map.get(key) || [];
    if (!map.has(key)) map.set(key, list);
    list.push(val);
};

function recordBarrelImport(edge, idToPath, barrelImporters) {
    if (edge.type !== 'IMPORTS') return;
    const from = idToPath.get(edge.from);
    const to = idToPath.get(edge.to);
    if (from && to && isBarrel(from)) {
        pushMap(barrelImporters, to, from);
    }
}

function expandBarrelQueue(cur, barrelImporters, reach, queue) {
    const importers = barrelImporters.get(cur) || [];
    importers.forEach(b => {
        if (!reach.has(b)) {
            reach.add(b);
            queue.push(b);
        }
    });
}

/** `paths` plus every barrel that (transitively) imports one of them: what an importer may import to reach them. */
export function barrelReach(graph, paths, idToPathMap = null) {
    const idToPath = idToPathMap || new Map([...graph.nodes.values()].map(node => [node.id, node.path]));
    const reach = new Set(paths);
    const barrelImporters = new Map();
    graph.edges.forEach(edge => recordBarrelImport(edge, idToPath, barrelImporters));
    const queue = [...paths];
    while (queue.length) {
        expandBarrelQueue(queue.shift(), barrelImporters, reach, queue);
    }
    return reach;
}

const EDGE_COLLECTORS = {
    DISCUSSES(edge, _from, to, { discussionsByPath }) {
        if (to) pushMap(discussionsByPath, to, edge);
    },
    DISCUSSED_IN(edge, from, _to, { discussionsByPath }) {
        if (from) pushMap(discussionsByPath, from, edge);
    },
    CALLS(edge, from, to, { callsByTo, byId }) {
        if (from !== to && !isTest(byId.get(edge.from))) pushMap(callsByTo, to, edge);
    },
    CO_CHANGES(edge, from, to, { coChangesByPath }) {
        if (from) pushMap(coChangesByPath, from, edge);
        if (to) pushMap(coChangesByPath, to, edge);
    },
    IMPORTS(_edge, from, to, { directImportersByTo }) {
        if (to && from) pushMap(directImportersByTo, to, from);
    }
};

function collectOutsideImporters(reach, directImportersByTo) {
    const importers = new Set();
    for (const target of reach) {
        const list = directImportersByTo.get(target) || [];
        list.forEach(from => {
            if (!reach.has(from)) importers.add(from);
        });
    }
    return importers;
}

function compileExportRegex(exports) {
    if (!exports.length) return null;
    const escaped = exports.map(e => String(e).replace(/[$]/g, '\\$')).join('|');
    return escaped ? new RegExp(`(^|[^\\w$])(?:${escaped})(?![\\w$])`) : null;
}

function resolveAffectedTests(entry, byPath, path, readCached) {
    const rawExports = byPath.get(path)?.exports;
    const exports = Array.isArray(rawExports) ? rawExports.filter(Boolean) : [];
    const exportRegex = compileExportRegex(exports);
    if (!exportRegex) return entry.tests;
    return entry.tests.filter(test => exportRegex.test(readCached(test)));
}

function resolveLinkedDiscussions(discEdges, byId) {
    const linked = discEdges.map(edge => {
        const targetId = edge.from.startsWith('discussion:') ? edge.from : edge.to;
        const discNode = byId.get(targetId);
        return discNode ? (discNode.title || discNode.name || discNode.id) : targetId;
    });
    return [...new Set(linked)];
}

const coChangeOther = (edge, path, idToPath) =>
    (idToPath.get(edge.from) === path ? idToPath.get(edge.to) : idToPath.get(edge.from));

function buildConsequences(path, reach, context) {
    const { idToPath, directImportersByTo, callsByTo, coChangesByPath, strongest } = context;
    const importers = collectOutsideImporters(reach, directImportersByTo);
    const calls = callsByTo.get(path) || [];
    const together = coChangesByPath.get(path) || [];
    return {
        importedBy: importers.size,
        calledBy: strongest(calls, edge => idToPath.get(edge.from)),
        changesWith: strongest(together, edge => coChangeOther(edge, path, idToPath))
    };
}

function computePathImpact(path, context) {
    const entry = context.health.get(path);
    if (!entry) return null;

    const reach = barrelReach(context.graph, [path], context.idToPath);
    const consequences = buildConsequences(path, reach, context);
    const tests = resolveAffectedTests(entry, context.byPath, path, context.readCached);
    consequences.tests = tests.length;
    const discussions = resolveLinkedDiscussions(context.discussionsByPath.get(path) || [], context.byId);

    const result = { consequences, risks: entry.issues };
    if (discussions.length) result.discussions = discussions;
    return result;
}

function createCachedReader(readFile) {
    const fileCache = new Map();
    return (path) => {
        if (!path) return '';
        let text = fileCache.get(path);
        if (text === undefined) {
            text = readFile ? (readFile(path) || '') : '';
            fileCache.set(path, text);
        }
        return text;
    };
}

function collectEdgeImpacts(edges, idToPath, edgeContext) {
    for (const edge of edges) {
        const fromPath = idToPath.get(edge.from);
        const toPath = idToPath.get(edge.to);
        EDGE_COLLECTORS[edge.type]?.(edge, fromPath, toPath, edgeContext);
    }
}

const strength = (edge) => edge.strength ?? edge.weight ?? 0;
const strongest = (edges, other) => edges.sort((a, b) => strength(b) - strength(a)).map(other).filter(Boolean).slice(0, TOP);

/**
 * @param {Object} graph - graph model (nodes Map, edges array)
 * @param {string[]} paths - the code files to describe
 * @param {{readFile?: (path: string) => string|null, coverage?: Map<string, number>}} [deps]
 * @returns {Map<string, {consequences: object, risks: string[]}>}
 */
export function fileImpact(graph, paths, { readFile, coverage } = {}) {
    const result = new Map();
    if (!paths.length) return result;

    const readCached = createCachedReader(readFile);
    const health = new Map(codeHealth(graph, { readFile: readCached, coverage, only: paths }).files.map(entry => [entry.path, entry]));
    const idToPath = new Map([...graph.nodes.values()].map(node => [node.id, node.path]));
    const byId = graph.nodes;
    const byPath = new Map([...graph.nodes.values()].map(node => [node.path, node]));

    const callsByTo = new Map();
    const coChangesByPath = new Map();
    const discussionsByPath = new Map();
    const directImportersByTo = new Map();

    collectEdgeImpacts(graph.edges, idToPath, { callsByTo, coChangesByPath, directImportersByTo, discussionsByPath, byId });

    const context = { health, graph, idToPath, byId, byPath, directImportersByTo, callsByTo, coChangesByPath, discussionsByPath, readCached, strongest };
    for (const path of paths) {
        const impact = computePathImpact(path, context);
        if (impact) result.set(path, impact);
    }
    return result;
}
