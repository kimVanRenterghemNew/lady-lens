import { PROJECT_SCOPE, parseJson, rowToNode, rowToEdge } from '../../model/index.js';

const isProjectCodeFile = r => Boolean(r && r.scope === PROJECT_SCOPE && r.type === 'CodeFile');
const isValidImportNode = (node, matchedPath) => isProjectCodeFile(node) && node.path !== matchedPath;
const isBarrelPath = r => r.name === 'index.js' || String(r.path || '').endsWith('/index.js');
const isImportToDef = (e, fromId, defIds) => e.from_id === fromId && defIds.has(e.to_id) && e.relation === 'IMPORTS';
const hasSymbolExport = (exportsList, symbol) => Array.isArray(exportsList) && exportsList.includes(symbol);
const isProjectFile = row => row.scope === PROJECT_SCOPE && (row.type === 'CodeFile' || row.type === 'Document');
const normalize = s => String(s ?? '').trim().replace(/\\/g, '/').replace(/^file:/i, '').replace(/^\.\//, '');

function isBarrelRow(r, defIds, edges) {
    if (r.scope !== PROJECT_SCOPE || !isBarrelPath(r)) return false;
    for (const edge of edges.values()) if (isImportToDef(edge, r.id, defIds)) return true;
    return false;
}

function getSymbolRange(meta, symbol) {
    const range = meta.symbolRanges ? meta.symbolRanges[symbol] : null;
    return Array.isArray(range) ? range : null;
}

function findDefinedLocations(row, symbol) {
    if (!isProjectCodeFile(row) || row.kind === 'test') return null;
    const meta = parseJson(row.metadata_json, {});
    const range = getSymbolRange(meta, symbol);
    if (range) return { path: row.path, startLine: range[0], endLine: range[1] };
    return hasSymbolExport(meta.exports, symbol) ? { path: row.path } : null;
}

function isRowCandidate(row, wantedLower) {
    if (!isProjectCodeFile(row)) return false;
    const matchPath = row.path.toLowerCase() === wantedLower;
    const matchName = Boolean(row.name && row.name.toLowerCase() === wantedLower);
    return matchPath || matchName;
}

function findCandidates(nodes, wantedLower) {
    const candidates = [];
    for (const row of nodes.values()) if (isRowCandidate(row, wantedLower)) candidates.push(row);
    return candidates;
}

function resolveCandidate(candidates, wanted) {
    const wantedLower = wanted.toLowerCase();
    const exact = candidates.find(r => r.path === wanted || r.path.toLowerCase() === wantedLower);
    if (exact) return { matched: exact };
    if (!wanted.includes('/')) {
        if (candidates.length === 1) return { matched: candidates[0] };
        return { ambiguous: candidates.map(r => r.path).sort() };
    }
    return { matched: null };
}

function resolveQueryTarget(nodes, file, isWritten) {
    const wanted = normalize(file);
    if (!wanted || !isWritten()) return { empty: true, wanted, candidates: [] };
    const candidates = findCandidates(nodes, wanted.toLowerCase());
    const { matched, ambiguous } = resolveCandidate(candidates, wanted);
    if (ambiguous) return { empty: true, wanted, candidates: ambiguous };
    if (!matched) return { empty: true, wanted, candidates: [] };
    return { empty: false, wanted, matched };
}

function extractExportNames(row) {
    const meta = parseJson(row.metadata_json, {});
    return [...new Set((meta.exports || []).filter(n => typeof n === 'string'))].sort();
}

function collectDirectImports(matched, edges, nodes) {
    const results = new Set();
    for (const edge of edges.values()) {
        const toNode = edge.from_id === matched.id && edge.relation === 'IMPORTS' ? nodes.get(edge.to_id) : null;
        if (isValidImportNode(toNode, matched.path)) results.add(toNode.path);
    }
    return [...results].sort();
}

function collectDirectImportedBy(matched, edges, nodes) {
    const results = new Set();
    for (const edge of edges.values()) {
        const fromNode = edge.to_id === matched.id && edge.relation === 'IMPORTS' ? nodes.get(edge.from_id) : null;
        if (isValidImportNode(fromNode, matched.path)) results.add(fromNode.path);
    }
    return [...results].sort();
}

const isDefNode = (r, symbol) => isProjectCodeFile(r) && r.kind !== 'test' && String(r.metadata_json ?? '').includes(symbol);
const docMatchesSymbol = (doc, symbol) => (String(doc.metadata_json || '') + String(doc.documentation || '')).includes(symbol);

function isDocNode(r, symbol) {
    if (r.scope !== PROJECT_SCOPE || r.type !== 'Document') return false;
    return docMatchesSymbol(r, symbol);
}

function collectCallerNodes(callerIds, nodes) {
    const callerNodes = [];
    for (const id of callerIds) if (nodes.has(id)) callerNodes.push(rowToNode(nodes.get(id)));
    return callerNodes;
}

function collectMatchedEdgesAndCallers(edges, targetIds) {
    const matchedEdges = [], callerIds = new Set();
    for (const edge of edges.values()) {
        if (targetIds.has(edge.to_id)) {
            matchedEdges.push(rowToEdge(edge));
            callerIds.add(edge.from_id);
        }
    }
    return { matchedEdges, callerIds };
}

function findProjectFiles(nodes) {
    const files = [];
    for (const row of nodes.values()) if (isProjectFile(row)) files.push(row.path);
    return files;
}

function resolveExists(projectFiles, wanted) {
    const exists = projectFiles.some(path => path.toLowerCase() === wanted.toLowerCase());
    if (exists) return { exists: true, similar: [] };
    const base = wanted.split('/').pop().toLowerCase();
    const similar = projectFiles.filter(path => path.split('/').pop().toLowerCase() === base).sort();
    return { exists: false, similar };
}

export function createMemoryDirectQueries(nodes, edges, isWritten) {
    return {
        async directDefinedIn(symbol) {
            if (!isWritten()) return [];
            const locations = [];
            for (const row of nodes.values()) {
                const loc = findDefinedLocations(row, symbol);
                if (loc) locations.push(loc);
            }
            return locations.sort((a, b) => a.path.localeCompare(b.path));
        },

        async directExports(file) {
            const res = resolveQueryTarget(nodes, file, isWritten);
            if (res.empty) return { file: res.wanted, found: false, candidates: res.candidates, names: [] };
            return { file: res.matched.path, found: true, candidates: [], names: extractExportNames(res.matched) };
        },

        async directExists(file) {
            const wanted = normalize(file);
            if (!wanted || !isWritten()) return { file: wanted, exists: false, similar: [] };
            const { exists, similar } = resolveExists(findProjectFiles(nodes), wanted);
            return { file: wanted, exists, similar };
        },

        async directImports(file) {
            const res = resolveQueryTarget(nodes, file, isWritten);
            if (res.empty) return { file: res.wanted, found: false, candidates: res.candidates, files: [] };
            return { file: res.matched.path, found: true, candidates: [], files: collectDirectImports(res.matched, edges, nodes) };
        },

        async directImportedBy(file) {
            const res = resolveQueryTarget(nodes, file, isWritten);
            if (res.empty) return { file: res.wanted, found: false, candidates: res.candidates, files: [] };
            return { file: res.matched.path, found: true, candidates: [], files: collectDirectImportedBy(res.matched, edges, nodes) };
        },

        async directFunctionViewGraph(symbol) {
            if (!isWritten()) return { nodes: [], edges: [] };
            const defNodes = [...nodes.values()].filter(r => isDefNode(r, symbol)).map(rowToNode);
            const defIds = new Set(defNodes.map(n => n.id));
            if (!defIds.size) return { nodes: [], edges: [] };

            const barrelNodes = [...nodes.values()].filter(r => isBarrelRow(r, defIds, edges)).map(rowToNode);
            const targetIds = new Set([...defIds, ...barrelNodes.map(n => n.id)]);
            const { matchedEdges, callerIds } = collectMatchedEdgesAndCallers(edges, targetIds);
            const callerNodes = collectCallerNodes(callerIds, nodes);
            const docNodes = [...nodes.values()].filter(r => isDocNode(r, symbol)).map(rowToNode);

            const allNodes = new Map();
            for (const n of [...defNodes, ...barrelNodes, ...callerNodes, ...docNodes]) allNodes.set(n.id, n);
            const allIds = new Set(allNodes.keys());
            return {
                nodes: Array.from(allNodes.values()),
                edges: matchedEdges.filter(e => allIds.has(e.from) && allIds.has(e.to))
            };
        }
    };
}
