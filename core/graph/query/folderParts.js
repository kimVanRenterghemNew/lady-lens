/**
 * Parts and entry point building for folder view.
 */
import { isExternalUsageEdge, reexportedPackage } from './folderPredicates.js';

const MAX_EXPORTS = 8;
const MAX_SPEAKERS = 3;

function calculateUsedCounts(edges, idToPath, prefix, partOf) {
    const usedCount = new Map();
    for (const edge of edges) {
        const from = idToPath.get(edge.from);
        const to = idToPath.get(edge.to);
        if (isExternalUsageEdge(edge, from, to, prefix, partOf)) {
            usedCount.set(to, (usedCount.get(to) || 0) + 1);
        }
    }
    return usedCount;
}

function addGroupNode(groups, node, part) {
    if (part === 'index.js') return;
    const list = groups.get(part) || [];
    if (!groups.has(part)) groups.set(part, list);
    list.push(node);
}

function groupParts(inside, partOf) {
    const groups = new Map();
    inside.forEach(node => addGroupNode(groups, node, partOf(node.path)));
    return groups;
}

function resolvePartSpeakers(index, ranked) {
    if (index?.purpose) return [index];
    return ranked.filter(node => node.purpose && !node.path.endsWith('/index.js')).slice(0, MAX_SPEAKERS);
}

function resolvePartExports(index, ranked) {
    if (Array.isArray(index?.exports) && index.exports.length) return index.exports;
    return ranked.flatMap(node => node.exports || []);
}

function buildSinglePart(part, nodes, ctx) {
    const index = part.endsWith('/') ? ctx.byPath.get(`${ctx.prefix}${part}index.js`) : nodes[0];
    const ranked = [...nodes].sort((a, b) => (ctx.usedCount.get(b.path) || 0) - (ctx.usedCount.get(a.path) || 0) || a.path.localeCompare(b.path));
    const speakers = resolvePartSpeakers(index, ranked);
    const exports = resolvePartExports(index, ranked);
    const offset = ctx.prefix.length + (part.endsWith('/') ? part.length : 0);
    const roles = speakers.map(node => ({ file: node.path.slice(offset), purpose: node.purpose }));
    const lines = nodes.reduce((sum, node) => sum + (Number(node.lines) || 0), 0);
    return {
        part, files: nodes.length, lines, roles,
        exports: [...new Set(exports)].slice(0, MAX_EXPORTS),
        exportCount: new Set(exports).size
    };
}

export function buildParts(inside, edges, idToPath, byPath, prefix, partOf) {
    const usedCount = calculateUsedCounts(edges, idToPath, prefix, partOf);
    const groups = groupParts(inside, partOf);
    const ctx = { byPath, usedCount, prefix };
    return [...groups.entries()]
        .map(([part, nodes]) => buildSinglePart(part, nodes, ctx))
        .sort((a, b) => a.part.localeCompare(b.part));
}

export function buildEntry(byPath, prefix, readFile) {
    const entryNode = byPath.get(`${prefix}index.js`);
    if (!entryNode) return null;
    const exports = entryNode.exports || [];
    return {
        path: entryNode.path,
        exportCount: exports.length,
        exports: exports.slice(0, MAX_EXPORTS),
        purpose: entryNode.purpose || null,
        package: reexportedPackage(readFile(entryNode.path))
    };
}
