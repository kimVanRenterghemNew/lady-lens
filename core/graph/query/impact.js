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

/** `paths` plus every barrel that (transitively) imports one of them: what an importer may import to reach them. */
export function barrelReach(graph, paths, idToPathMap = null) {
    const idToPath = idToPathMap || new Map([...graph.nodes.values()].map(node => [node.id, node.path]));
    const reach = new Set(paths);
    const barrelImporters = new Map();
    for (const edge of graph.edges) {
        if (edge.type !== 'IMPORTS') continue;
        const from = idToPath.get(edge.from);
        if (from && isBarrel(from)) {
            const to = idToPath.get(edge.to);
            if (to) {
                let list = barrelImporters.get(to);
                if (!list) { list = []; barrelImporters.set(to, list); }
                list.push(from);
            }
        }
    }
    const queue = [...paths];
    while (queue.length) {
        const cur = queue.shift();
        const importers = barrelImporters.get(cur);
        if (importers) {
            for (const b of importers) {
                if (!reach.has(b)) {
                    reach.add(b);
                    queue.push(b);
                }
            }
        }
    }
    return reach;
}

/**
 * @param {Object} graph - graph model (nodes Map, edges array)
 * @param {string[]} paths - the code files to describe
 * @param {{readFile?: (path: string) => string|null, coverage?: Map<string, number>}} [deps] - tests are read to see which
 *   exports they name; coverage (% lines per file) adds the low-coverage risk
 * @returns {Map<string, {consequences: object, risks: string[]}>}
 */
export function fileImpact(graph, paths, { readFile, coverage } = {}) {
    const result = new Map();
    if (!paths.length) return result;

    const fileCache = new Map();
    const readCached = (path) => {
        if (!path) return '';
        let text = fileCache.get(path);
        if (text === undefined) {
            text = readFile ? (readFile(path) ?? '') : '';
            fileCache.set(path, text);
        }
        return text;
    };

    const health = new Map(codeHealth(graph, { readFile: readCached, coverage, only: paths }).files.map(entry => [entry.path, entry]));
    const idToPath = new Map([...graph.nodes.values()].map(node => [node.id, node.path]));
    const byId = graph.nodes;
    const byPath = new Map([...graph.nodes.values()].map(node => [node.path, node]));
    const strength = (edge) => edge.strength ?? edge.weight ?? 0;
    const strongest = (edges, other) => edges.sort((a, b) => strength(b) - strength(a)).map(other).filter(Boolean).slice(0, TOP);

    // Pre-index edges for O(1) lookup per path instead of full edge scans per path
    const callsByTo = new Map();
    const coChangesByPath = new Map();
    const discussionsByPath = new Map();
    const directImportersByTo = new Map();

    for (const edge of graph.edges) {
        if (edge.type === 'DISCUSSES' || edge.type === 'DISCUSSED_IN') {
            const discTarget = edge.type === 'DISCUSSES' ? idToPath.get(edge.to) : idToPath.get(edge.from);
            if (discTarget) {
                let list = discussionsByPath.get(discTarget);
                if (!list) { list = []; discussionsByPath.set(discTarget, list); }
                list.push(edge);
            }
            continue;
        }

        const fromPath = idToPath.get(edge.from);
        const toPath = idToPath.get(edge.to);
        if (!fromPath || !toPath) continue;

        if (edge.type === 'CALLS' && fromPath !== toPath && !isTest(byId.get(edge.from))) {
            let list = callsByTo.get(toPath);
            if (!list) { list = []; callsByTo.set(toPath, list); }
            list.push(edge);
        } else if (edge.type === 'CO_CHANGES') {
            let listFrom = coChangesByPath.get(fromPath);
            if (!listFrom) { listFrom = []; coChangesByPath.set(fromPath, listFrom); }
            listFrom.push(edge);

            let listTo = coChangesByPath.get(toPath);
            if (!listTo) { listTo = []; coChangesByPath.set(toPath, listTo); }
            listTo.push(edge);
        } else if (edge.type === 'IMPORTS') {
            let list = directImportersByTo.get(toPath);
            if (!list) { list = []; directImportersByTo.set(toPath, list); }
            list.push(fromPath);
        }
    }

    for (const path of paths) {
        const entry = health.get(path);
        if (!entry) continue;

        const reach = barrelReach(graph, [path], idToPath);
        const importers = new Set();
        for (const target of reach) {
            const list = directImportersByTo.get(target);
            if (list) {
                for (const from of list) {
                    if (!reach.has(from)) importers.add(from);
                }
            }
        }

        const calls = callsByTo.get(path) || [];
        const together = coChangesByPath.get(path) || [];

        // Compile export regex once for this file
        const exports = Array.isArray(byPath.get(path)?.exports) ? byPath.get(path).exports.filter(Boolean) : [];
        let exportRegex = null;
        if (exports.length) {
            const escaped = exports.map(e => String(e).replace(/[$]/g, '\\$')).join('|');
            if (escaped) exportRegex = new RegExp(`(^|[^\\w$])(?:${escaped})(?![\\w$])`);
        }
        const tests = exportRegex ? entry.tests.filter(test => exportRegex.test(readCached(test))) : entry.tests;

        const discEdges = discussionsByPath.get(path) || [];
        const linkedDiscussions = discEdges.map(edge => {
            const discNode = byId.get(edge.from.startsWith('discussion:') ? edge.from : edge.to);
            return discNode ? (discNode.title || discNode.name || discNode.id) : (edge.from.startsWith('discussion:') ? edge.from : edge.to);
        });
        const uniqueDiscussions = [...new Set(linkedDiscussions)];

        result.set(path, {
            consequences: {
                importedBy: importers.size,
                calledBy: strongest(calls, edge => idToPath.get(edge.from)),
                tests: tests.length,
                changesWith: strongest(together, edge => idToPath.get(edge.from) === path ? idToPath.get(edge.to) : idToPath.get(edge.from))
            },
            risks: entry.issues,
            ...(uniqueDiscussions.length ? { discussions: uniqueDiscussions } : {})
        });
    }
    return result;
}
