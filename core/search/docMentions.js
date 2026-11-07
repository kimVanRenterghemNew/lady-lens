/**
 * Documentation search that says WHY a document is a hit. Asked "which documents name core/handlers/router.js", a host got
 * documents that only shared words with it, and then read every document itself. For a query that is a code file,
 * the documents that name its path come first (`mentions: 'path'`), then those linked by a MENTIONS edge through one of
 * its names (`mentions: 'name'`), then the word matches. Every document hit gets the lines that name the file or the query.
 */
import { resolveCodeFile } from '../graph/index.js';

const MAX_LINES = 5;

function linesWith(text, needles) {
    const lower = needles.map(needle => needle.toLowerCase()).filter(Boolean);
    return String(text).split('\n').flatMap((line, index) => (lower.some(needle => line.toLowerCase().includes(needle)) ? [index + 1] : [])).slice(0, MAX_LINES);
}

/**
 * @param {object} graph - loaded graph (with documents)
 * @param {string} text - the query
 * @param {object[]} ranked - document nodes from the word ranking, best first
 * @param {{readFile: (path: string) => string|null, limit: number}} deps
 * @returns {object[]} document nodes with `mentions` and `lines`, best first
 */
export function rankDocuments(graph, text, ranked, { readFile, limit }) {
    const file = resolveCodeFile(graph, text.trim()).node;
    const linked = file ? graph.edges.filter(edge => edge.type === 'MENTIONS' && edge.to === file.id).map(edge => graph.getNode(edge.from)).filter(node => node?.type === 'Document') : [];
    const needles = file ? [file.path] : [text.trim()];
    const seen = new Set();
    const entries = [];
    for (const node of [...linked, ...ranked]) {
        if (!node?.path || seen.has(node.id)) continue;
        seen.add(node.id);
        const body = readFile(node.path) ?? '';
        const lines = linesWith(body, needles);
        const mentions = file ? (lines.length ? 'path' : (linked.includes(node) ? 'name' : null)) : null;
        entries.push({ node, lines, mentions, order: entries.length });
    }
    const weight = entry => (entry.mentions === 'path' ? 0 : entry.mentions === 'name' ? 1 : 2);
    return entries.sort((a, b) => weight(a) - weight(b) || a.order - b.order).slice(0, limit)
        .map(({ node, lines, mentions }) => ({ ...node, ...(mentions ? { mentions } : {}), ...(lines.length ? { lines } : {}) }));
}
