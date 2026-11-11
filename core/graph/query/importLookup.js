/**
 * "Who imports X / what does X import": ONE implementation.
 *
 * Before, three routes gave three answers: `grep` on an import pattern (0 hits on a path), `graph_query` with
 * `incoming:{type:'import'}` (wrong edge-type spelling = empty, default limit 10 = silently cut) and the model's own
 * reading. The graph's IMPORTS edges are derived from the code (`deriveProjectRelations`), so they are the one fact;
 * everything that answers an import question goes through the functions below.
 *
 * Pure: takes a graph (`nodes` Map + `getIncoming`/`getOutgoing`), no I/O.
 * @module core/graph/importLookup
 */

export { looksLikeRepoPath, recognizeImportQuestion, recognizeSymbolQuestion } from './questionIntent.js';

export const IMPORT_EDGE = 'IMPORTS';

/** `import`, `imports`, `IMPORTS`, `Import` all mean the one edge type. */
export const isImportEdgeType = (type) => /^imports?$/i.test(String(type ?? '').trim());

const normalizeRef = (ref) => String(ref ?? '').trim().replace(/\\/g, '/').replace(/^file:/i, '').replace(/^\.\//, '');

const codeFiles = (graph) => [...graph.nodes.values()].filter(node => node.type === 'CodeFile' && typeof node.path === 'string');

/**
 * A file reference (`core/a.js`, `./core/a.js`, `file:core/a.js`, `CORE\A.js`, or a unique basename) -> its CodeFile node.
 * @returns {{node: object}|{candidates: string[]}|{}} `{}` = not in the graph; `candidates` = the basename is ambiguous.
 */
export function resolveCodeFile(graph, ref) {
    const wanted = normalizeRef(ref);
    if (!wanted) return {};
    if (typeof graph.lookupCodeFile === 'function') return graph.lookupCodeFile(wanted);
    const files = codeFiles(graph);
    const exact = files.find(node => node.path === wanted) ?? files.find(node => node.path.toLowerCase() === wanted.toLowerCase());
    if (exact) return { node: exact };
    if (!wanted.includes('/')) {
        const same = files.filter(node => node.path.split('/').pop().toLowerCase() === wanted.toLowerCase());
        if (same.length === 1) return { node: same[0] };
        if (same.length > 1) return { candidates: same.map(node => node.path).sort() };
    }
    return {};
}

const targetNodeId = (edge, direction) => (direction === 'incoming' ? edge.from : edge.to);

function collectNeighbour(graph, edge, direction, nodePath, files) {
    if (!isImportEdgeType(edge.type)) return;
    const other = graph.getNode(targetNodeId(edge, direction));
    if (other?.type === 'CodeFile' && other.path !== nodePath) files.add(other.path);
}

function neighbours(graph, ref, direction) {
    const resolved = resolveCodeFile(graph, ref);
    if (!resolved.node) return { file: normalizeRef(ref), found: false, candidates: resolved.candidates ?? [], files: [] };
    const edges = direction === 'incoming' ? graph.getIncoming(resolved.node.id) : graph.getOutgoing(resolved.node.id);
    const files = new Set();
    for (const edge of edges) {
        collectNeighbour(graph, edge, direction, resolved.node.path, files);
    }
    return { file: resolved.node.path, found: true, candidates: [], files: [...files].sort() };
}

/** Files that import `ref` (sorted, once each, complete). A test importing it is a TESTS relation, not an import. */
export const importersOf = (graph, ref) => neighbours(graph, ref, 'incoming');

/** Files `ref` imports (sorted, once each, complete). */
export const importsOf = (graph, ref) => neighbours(graph, ref, 'outgoing');

function rangeLocation(node, symbol) {
    const ranges = node.symbolRanges || node.metadata?.symbolRanges;
    const range = ranges?.[symbol];
    if (Array.isArray(range)) return { path: node.path, startLine: range[0], endLine: range[1] };
    return null;
}

function exportLocation(node, symbol) {
    const exp = node.exports || node.metadata?.exports;
    if (Array.isArray(exp) && exp.includes(symbol)) return { path: node.path };
    return null;
}

function findSymbolLocation(node, symbol) {
    if (node.kind === 'test' || typeof node.path !== 'string') return null;
    return rangeLocation(node, symbol) || exportLocation(node, symbol);
}

/**
 * Where is `symbol` declared/exported? Whole name, case-sensitive; tests are not where a symbol lives.
 * @returns {{symbol: string, found: boolean, locations: Array<{path: string, startLine?: number, endLine?: number}>}}
 */
export function definedIn(graph, symbol) {
    const files = graph.getNodesByType ? graph.getNodesByType('CodeFile') : codeFiles(graph);
    const locations = files
        .map(node => findSymbolLocation(node, symbol))
        .filter(Boolean)
        .sort((a, b) => a.path.localeCompare(b.path));
    return { symbol, found: locations.length > 0, locations };
}

/** The exported names of a file (sorted, once each, strings only). */
export function exportsOf(graph, ref) {
    const resolved = resolveCodeFile(graph, ref);
    if (!resolved.node) return { file: normalizeRef(ref), found: false, candidates: resolved.candidates ?? [], names: [] };
    return { file: resolved.node.path, found: true, candidates: [], names: names(resolved.node) };
}

/** Does a file exist in the project graph, and if not: where does a file with that name exist (the usual mistake is the folder). */
export function fileLookup(graph, ref) {
    const wanted = normalizeRef(ref);
    if (typeof graph.lookupFile === 'function') return graph.lookupFile(wanted);
    const files = [...graph.nodes.values()].filter(node => (node.type === 'CodeFile' || node.type === 'Document') && typeof node.path === 'string').map(node => node.path);
    const exists = files.some(path => path.toLowerCase() === wanted.toLowerCase());
    const base = wanted.split('/').pop().toLowerCase();
    const similar = exists ? [] : files.filter(path => path.split('/').pop().toLowerCase() === base).sort();
    return { file: wanted, exists, similar };
}

const names = (node) => [...new Set((node?.exports || node?.metadata?.exports || []).filter(name => typeof name === 'string'))].sort();

function buildInterfaceEntry(graph, ref, maxImports, maxNames) {
    const resolved = resolveCodeFile(graph, ref);
    if (!resolved.node) return null;
    const imported = importsOf(graph, resolved.node.path).files;
    const shown = imported.slice(0, maxImports).map(file => {
        const all = names(resolveCodeFile(graph, file).node);
        return { file, exports: all.slice(0, maxNames), moreExports: Math.max(0, all.length - maxNames) };
    });
    return {
        file: resolved.node.path,
        exports: names(resolved.node),
        imports: shown,
        moreImports: Math.max(0, imported.length - shown.length)
    };
}

/**
 * What the coder may rely on: per file in scope its exports and what each imported module exports.
 * Files that are not in the graph yet (new files) are left out. Bounded per file; the counts of what was left out are returned.
 * @returns {Array<{file: string, exports: string[], imports: Array<{file: string, exports: string[], moreExports: number}>, moreImports: number}>}
 */
export function scopeInterfaces(graph, files, { maxImports = 8, maxNames = 15 } = {}) {
    return files
        .map(ref => buildInterfaceEntry(graph, ref, maxImports, maxNames))
        .filter(Boolean);
}

/** Plain text for a prompt, whole lines only (never cut mid-line, no "..." markers). */
export function renderScopeInterfaces(entries, { maxChars = 3000 } = {}) {
    if (!entries.length) return '';
    const lines = [];
    for (const entry of entries) {
        lines.push(`${entry.file} exports: ${entry.exports.length ? entry.exports.join(', ') : '(nothing named)'}`);
        for (const item of entry.imports) lines.push(`  imports ${item.file}, which exports: ${item.exports.length ? item.exports.join(', ') : '(nothing named)'}${item.moreExports ? ` (+${item.moreExports} more)` : ''}`);
        if (entry.moreImports) lines.push(`  (+${entry.moreImports} more imported modules)`);
    }
    const kept = [];
    let used = 0;
    for (const line of lines) {
        if (used + line.length + 1 > maxChars && kept.length) break;
        kept.push(line);
        used += line.length + 1;
    }
    return `${kept.join('\n')}\nOnly these names exist; do not call a name that is not listed. If you need another one, find it with graph_query first.`;
}

const isSearchableCodeNode = (node) => node.type === 'CodeFile' && node.kind !== 'test' && Boolean(node.path);

function locateSymbolsInNode(node, wanted) {
    if (!isSearchableCodeNode(node)) return [];
    const ranges = node.symbolRanges || node.metadata?.symbolRanges;
    if (!ranges) return [];
    return wanted.filter(name => Array.isArray(ranges[name])).map(name => ({ name, path: node.path, startLine: ranges[name][0], endLine: ranges[name][1] }));
}

/**
 * Symbol -> where it lives: the identifiers named in `text` that a source file declares, with path and
 * 1-based line range, so the coder reads only those lines. Whole identifiers, case-sensitive; tests are not "where it lives".
 * @returns {Array<{name: string, path: string, startLine: number, endLine: number}>}
 */
export function locateSymbols(nodes, text, { limit = 8 } = {}) {
    const rawMatches = String(text ?? '').match(/[A-Za-z_$][\w$]*/g);
    if (!rawMatches || !rawMatches.length) return [];
    const wanted = [...new Set(rawMatches)];
    const found = nodes.flatMap(node => locateSymbolsInNode(node, wanted));
    return found.sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path)).slice(0, limit);
}
