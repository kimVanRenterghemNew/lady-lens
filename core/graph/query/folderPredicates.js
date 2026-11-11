/**
 * Predicates and excerpt helpers for folder view.
 */
const EXCERPT_LINES = 30;
const EXCERPT_CHARS = 1400;

export const NON_POINTER_TYPES = new Set(['CodeFile', 'Document']);
export const NON_REG_TYPES = new Set(['CodeFile', 'Document', 'Config', 'Decision']);

export const isTest = (node) => node.kind === 'test' || node.type === 'Test' || /(^|\/)test\//.test(String(node.path));
export const dirOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.');

export function firstLines(text) {
    if (text == null) return null;
    const lines = String(text).replace(/\r\n?/g, '\n').split('\n').filter((line, i, all) => line.trim() || all[i - 1]?.trim()).slice(0, EXCERPT_LINES);
    const code = lines.join('\n').trimEnd();
    return code.length > EXCERPT_CHARS ? `${code.slice(0, EXCERPT_CHARS)}\n// ...` : code;
}

export function reexportedPackage(source) {
    const specifiers = [...String(source ?? '').matchAll(/export\s*\*\s*from\s*['"]([^'"]+)['"]/g)].map(match => match[1]);
    return specifiers.find(specifier => !specifier.startsWith('.')) ?? null;
}

export function normalizeFolderDir(folder) {
    return String(folder || '').trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

export function resolvePartOf(path, prefix) {
    const rest = path.slice(prefix.length);
    return rest.includes('/') ? `${rest.split('/')[0]}/` : rest;
}

export function isUsageRelation(type) {
    return type === 'IMPORTS' || type === 'CALLS';
}

export function isReachRelation(type) {
    return type === 'IMPORTS' || type === 'TESTS';
}

export function hasEndpoints(from, to) {
    if (!from) return false;
    return Boolean(to);
}

export function isExternalUsageEdge(edge, from, to, prefix, partOf) {
    if (!hasEndpoints(from, to)) return false;
    if (!isUsageRelation(edge.type)) return false;
    if (!to.startsWith(prefix)) return false;
    if (!from.startsWith(prefix)) return true;
    return partOf(from) !== partOf(to);
}

export function isInternalFlowEdge(edge, from, to, prefix, isTestFrom) {
    if (!isUsageRelation(edge.type)) return false;
    if (!hasEndpoints(from, to)) return false;
    if (!from.startsWith(prefix)) return false;
    if (!to.startsWith(prefix)) return false;
    return !isTestFrom;
}

export function isDistinctPart(a, b) {
    if (a === b) return false;
    return a !== 'index.js' && b !== 'index.js';
}

export function isExternalReachEdge(edge, from, to, prefix, reach) {
    if (!isReachRelation(edge.type)) return false;
    if (!hasEndpoints(from, to)) return false;
    if (!reach.has(to)) return false;
    if (from.startsWith(prefix)) return false;
    return !reach.has(from);
}

export function isExternalCallEdge(edge, from, to, prefix, isTestFrom) {
    if (edge.type !== 'CALLS') return false;
    if (!hasEndpoints(from, to)) return false;
    if (!to.startsWith(prefix)) return false;
    if (from.startsWith(prefix)) return false;
    return !isTestFrom;
}

export function isRegisteredNode(node, base) {
    if (!base) return false;
    if (NON_REG_TYPES.has(node.type)) return false;
    const namePrefix = String(node.name || '').toLowerCase().split('.')[0];
    return namePrefix === base;
}
