/**
 * Node search index builder for graph ranking.
 * @module core/graph/query/searchIndex
 */

import { words } from './rankTokens.js';

const SKIPPED_FIELDS = new Set(['id', 'type', 'createdAt', 'updatedAt', 'timestamp', 'timestampStatus', 'observedAt']);
const EXCLUDED_OTHER_FIELDS = new Set([
    'path', 'purpose', 'exports', 'symbols', 'keywords', 'title', 'name',
    'symbolRanges', 'functions', 'calls', 'reads'
]);

const NODE_SEARCH_CACHE = new WeakMap();

function extractOtherText(node) {
    return Object.entries(node)
        .filter(([key]) => !SKIPPED_FIELDS.has(key) && !EXCLUDED_OTHER_FIELDS.has(key))
        .map(([, v]) => (typeof v === 'string' ? v : (Array.isArray(v) ? v.filter(x => typeof x === 'string').join(' ') : '')))
        .join(' ')
        .toLowerCase();
}

function isDocNode(node) {
    if (node.type === 'Document' || node.type === 'Discussion') return true;
    return node.type === 'Decision' && node.kind === 'decision';
}

function extractIndexNames(rawPath, filePath) {
    const stemOnly = filePath.split('/').pop() || '';
    const stem = stemOnly.replace(/\.[^.]+$/, '').replace(/\.(test|spec)$/, '');
    const nameWords = (rawPath.split('/').pop() || '').slice(0, stem.length).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[\s._-]+/).filter(word => word.length >= 3);
    return { stemOnly, stem, stemClean: stem.replace(/[^a-z0-9]/g, ''), nameWords };
}

function extractIndexSymbols(node, exportTokens) {
    return {
        symbolTokens: new Set([...exportTokens, ...words(node.symbols)]),
        symbolsLower: [...(node.exports || []), ...(node.symbols || [])].map(item => String(item).toLowerCase())
    };
}

function buildIndexData(node, rawPath, filePath) {
    const segments = [...new Set([...filePath.split(/[/._-]+/), ...rawPath.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[\s/._-]+/)].filter(Boolean))];
    const { stemOnly, stem, stemClean, nameWords } = extractIndexNames(rawPath, filePath);
    const exportTokens = new Set([...words(node.exports), ...words(node.keywords)]);
    const { symbolTokens, symbolsLower } = extractIndexSymbols(node, exportTokens);
    const other = extractOtherText(node);

    return {
        rawPath, filePath, segments, stem, stemClean,
        symbolTokens, exportTokens, symbolsLower,
        title: `${node.title || ''} ${node.name || ''}`.toLowerCase(),
        purpose: String(node.purpose || '').toLowerCase(), purposeTokens: words(node.purpose), other, stemOnly, nameWords,
        isTest: node.kind === 'test' || node.type === 'Test', isBarrel: /^index\.[cm]?js$/.test(stemOnly),
        isDoc: isDocNode(node)
    };
}

export function getNodeSearchIndex(node) {
    const existing = NODE_SEARCH_CACHE.get(node);
    if (existing) return existing;
    const rawPath = String(node.path || '');
    const filePath = rawPath.toLowerCase();
    const index = buildIndexData(node, rawPath, filePath);
    NODE_SEARCH_CACHE.set(node, index);
    return index;
}
