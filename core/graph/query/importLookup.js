/**
 * "Who imports X / what does X import": ONE implementation.
 *
 * Before, three routes gave three answers: `grep` on an import pattern (0 hits on a path), `graph_query` with
 * `incoming:{type:'import'}` (wrong edge-type spelling = empty, default limit 10 = silently cut) and the model's own
 * reading. The graph's IMPORTS edges are derived from the code (`deriveProjectRelations`), so they are the one fact;
 * everything that answers an import question goes through the functions below.
 *
 * Pure: takes a graph (`nodes` Map + `getIncoming`/`getOutgoing`), no I/O.
 * TODO(coverage): Current line coverage is 80.35% (< 85% target). Raise to >= 85%.
 * @module core/graph/importLookup
 */

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

function neighbours(graph, ref, direction) {
    const resolved = resolveCodeFile(graph, ref);
    if (!resolved.node) return { file: normalizeRef(ref), found: false, candidates: resolved.candidates ?? [], files: [] };
    const edges = direction === 'incoming' ? graph.getIncoming(resolved.node.id) : graph.getOutgoing(resolved.node.id);
    const files = new Set();
    for (const edge of edges) {
        if (!isImportEdgeType(edge.type)) continue;
        const other = graph.getNode(direction === 'incoming' ? edge.from : edge.to);
        if (other?.type === 'CodeFile' && other.path !== resolved.node.path) files.add(other.path);
    }
    return { file: resolved.node.path, found: true, candidates: [], files: [...files].sort() };
}

/** Files that import `ref` (sorted, once each, complete). A test importing it is a TESTS relation, not an import. */
export const importersOf = (graph, ref) => neighbours(graph, ref, 'incoming');

/** Files `ref` imports (sorted, once each, complete). */
export const importsOf = (graph, ref) => neighbours(graph, ref, 'outgoing');

/** Does this repo path look like something an import question names (`core/a/b.js`)? */
export const looksLikeRepoPath = (text) => /[\w.-]+\/[\w./-]*\.(?:m?js|cjs|ts|tsx|jsx|json)\b/.test(String(text ?? ''));

const PATH_TOKEN = /[`'"]?((?:\.{0,2}\/)?[\w.-]+(?:\/[\w.-]+)*\.(?:m?js|cjs|tsx?|jsx))[`'"]?/;

/**
 * Is this prompt a question about who imports a file / what a file imports? Deterministic, so the answer can come from the
 * graph before the model is asked (single source, see `importersOf`/`importsOf`).
 * @param {string} text
 * @returns {{relation: 'imports'|'importedBy'|'exports'|'exists', file: string} | null}
 */
export function recognizeImportQuestion(text) {
    const prompt = String(text ?? '');
    const match = prompt.match(PATH_TOKEN);
    const isQuestion = /\?|^\s*(?:geef|list|which|welke|wat|staat|is|does|bestaat|what)\b/i.test(prompt);
    if (!match || !isQuestion) return null;
    const file = match[1].replace(/^\.\//, '');
    // Facts that are not import relations but live in the same graph (research run 2026-10-08): exports of a file, does a file exist.
    if (/\bnames?\s+(?:can|kan)\s+(?:i|ik)\s+import(?:eren)?\s+(?:from|uit)\b|\bnamen\s+kan\s+ik\s+importeren\b/i.test(prompt)) return { relation: 'exports', file };
    if (!/import|ge[iï]mporteerd/i.test(prompt)) {
        if (/\bexport(?:eert|eren|s|ed)?\b/i.test(prompt)) return { relation: 'exports', file };
        if (/\b(?:staat er|is er|is there|bestaat|exists?|can i open|kan ik)\b|\b(?:yes or no|ja of nee)\b/i.test(prompt)) return { relation: 'exists', file };
    }
    if (!/import|ge[iï]mporteerd|hangt|depend|gebruikt|uses/i.test(prompt)) return null;
    const before = prompt.slice(0, match.index);
    const after = prompt.slice(match.index + match[0].length);
    const verbBefore = /\bimporteren\b|\bimport(?:s)?\b|\bgebruikt\b|\buses\b|\bwie importeert\b/i.test(before);
    // X is the subject: "does X import", "X depends on", "importeert X", "imports of X", "van welke modules hangt X af"
    const subject = /\b(?:does|do)\s+$/i.test(before.trimEnd() + ' ') && /^\W*\s*(?:\w+\s+)?import\b/i.test(after)
        || /\bimports?\b/i.test(after.split(/[.?!]/)[0]) && /\b(?:does|do)\b/i.test(before)
        || /\bdepends?\s+on\b|\bhangt\b.*\baf\b/i.test(before + ' ' + after)
        || /\b(?:internal\s+)?imports?\s+(?:of|from)\s*$/i.test(before.trimEnd())
        || /\b(?:interne\s+)?imports\s+van\s*$/i.test(before.trimEnd())
        || /\bimporteert\b/i.test(before) && !/\bwie\s+importeert\b/i.test(before);
    if (subject) return { relation: 'imports', file };
    if (verbBefore || /\b(?:imported|ge[iï]mporteerd)\b/i.test(after)) return { relation: 'importedBy', file };
    return null;
}

const STOP_WORDS = new Set(['which', 'where', 'what', 'file', 'files', 'module', 'modules', 'defines', 'defined', 'implemented', 'contains', 'exports', 'function', 'answer', 'repository', 'relative', 'root', 'welk', 'welke', 'waar', 'bestand', 'wordt', 'gedefinieerd', 'staat', 'functie', 'exporteert', 'antwoord', 'zoek', 'waarin', 'zoek', 'need', 'path', 'relatief', 'repository-root', 'repository-relative', 'there', 'implement', 'met', 'het', 'pad', 'aan', 'een', 'van', 'naar', 'with', 'the', 'relative', 'answer']);
const LOCATION_INTENT = /\b(?:gedefinieerd|defined?|defines|implemented|ge[iï]mplementeerd|waarin|contains|bevat|zit|staat|exporteert|exports?)\b/i;
const WHICH_FILE = /\b(?:welk(?:e)?|which|waar|where|in\s+welk|bestand|file|module)\b/i;

/**
 * Is this prompt "where is the symbol X defined"? Deterministic (like `recognizeImportQuestion`), so the graph can answer it.
 * A question that names a file path is an import/exports/exists question, not this one. The candidates are every identifier-like word
 * that is not a question word (backticked ones first); the graph decides which of them is a real symbol (`definedIn`).
 * @returns {{relation: 'definedIn', symbols: string[]} | null}
 */
export function recognizeSymbolQuestion(text) {
    const prompt = String(text ?? '');
    if (!prompt.trim() || looksLikeRepoPath(prompt) || PATH_TOKEN.test(prompt)) return null;
    const isQuestion = /\?|^\s*(?:waar|welk|welke|which|where|in welk)\b/i.test(prompt);
    if (!isQuestion || !LOCATION_INTENT.test(prompt) || !WHICH_FILE.test(prompt)) return null;
    const ticked = [...prompt.matchAll(/`([A-Za-z_$][\w$]*)`/g)].map(match => match[1]);
    const words = (prompt.match(/[A-Za-z_$][\w$]*/g) ?? []).filter(word => word.length >= 3 && !STOP_WORDS.has(word.toLowerCase()));
    const named = prompt.match(/\b(?:functie|function|methode|method|class|klasse|constante|const)\s+`?([A-Za-z_$][\w$]*)/i)?.[1];
    // `camelCase`, `PascalCase`, `snake_case`, `name2` are identifiers; plain words are only candidates when nothing looks like one.
    const identifiers = words.filter(word => /[a-z][A-Z]|_|\d/.test(word));
    const symbols = [...new Set(ticked.length ? ticked : (named ? [named] : (identifiers.length ? identifiers : words)))];
    return symbols.length ? { relation: 'definedIn', symbols } : null;
}

/**
 * Where is `symbol` declared/exported? Whole name, case-sensitive; tests are not where a symbol lives.
 * @returns {{symbol: string, found: boolean, locations: Array<{path: string, startLine?: number, endLine?: number}>}}
 */
export function definedIn(graph, symbol) {
    const locations = [];
    const files = graph.getNodesByType ? graph.getNodesByType('CodeFile') : codeFiles(graph);
    for (const node of files) {
        if (node.kind === 'test' || typeof node.path !== 'string') continue;
        const range = (node.symbolRanges ?? node.metadata?.symbolRanges)?.[symbol];
        const isRange = Array.isArray(range), exp = node.exports ?? node.metadata?.exports;
        if (!isRange && (!Array.isArray(exp) || !exp.includes(symbol))) continue;
        locations.push(isRange ? { path: node.path, startLine: range[0], endLine: range[1] } : { path: node.path });
    }
    locations.sort((a, b) => a.path.localeCompare(b.path));
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

const names = (node) => [...new Set((node?.exports ?? node?.metadata?.exports ?? []).filter(name => typeof name === 'string'))].sort();

/**
 * What the coder may rely on: per file in scope its exports and what each imported module exports.
 * Files that are not in the graph yet (new files) are left out. Bounded per file; the counts of what was left out are returned.
 * @returns {Array<{file: string, exports: string[], imports: Array<{file: string, exports: string[], moreExports: number}>, moreImports: number}>}
 */
export function scopeInterfaces(graph, files, { maxImports = 8, maxNames = 15 } = {}) {
    const result = [];
    for (const ref of files) {
        const resolved = resolveCodeFile(graph, ref);
        if (!resolved.node) continue;
        const imported = importsOf(graph, resolved.node.path).files;
        const shown = imported.slice(0, maxImports).map(file => {
            const all = names(resolveCodeFile(graph, file).node);
            return { file, exports: all.slice(0, maxNames), moreExports: Math.max(0, all.length - maxNames) };
        });
        result.push({ file: resolved.node.path, exports: names(resolved.node), imports: shown, moreImports: Math.max(0, imported.length - shown.length) });
    }
    return result;
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

/**
 * Symbol -> where it lives: the identifiers named in `text` that a source file declares, with path and
 * 1-based line range, so the coder reads only those lines. Whole identifiers, case-sensitive; tests are not "where it lives".
 * @returns {Array<{name: string, path: string, startLine: number, endLine: number}>}
 */
export function locateSymbols(nodes, text, { limit = 8 } = {}) {
    const rawMatches = String(text ?? '').match(/[A-Za-z_$][\w$]*/g);
    if (!rawMatches || !rawMatches.length) return [];
    const wanted = [...new Set(rawMatches)];
    const found = [];
    for (const node of nodes) {
        if (node.type !== 'CodeFile' || node.kind === 'test' || !node.path) continue;
        const ranges = node.symbolRanges ?? node.metadata?.symbolRanges;
        if (!ranges) continue;
        for (const name of wanted) {
            const range = ranges[name];
            if (Array.isArray(range)) found.push({ name, path: node.path, startLine: range[0], endLine: range[1] });
        }
    }
    return found.sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path)).slice(0, limit);
}
