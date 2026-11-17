/**
 * Helpers for parameter seam extraction: AST traversal, local functions, aliases, and JSDoc params.
 * @module core/graph/query/seamHelpers
 */
import { parse } from 'acorn';

export function forChildren(node, fn) {
    for (const key of Object.keys(node).filter(k => k !== 'loc')) {
        const items = Array.isArray(node[key]) ? node[key] : [node[key]];
        items.forEach(item => { if (item?.type) fn(item); });
    }
}

const stripTypeScriptTypes = (s) => s.replace(/:\s*[A-Za-z0-9_<>[\]|&,\s]+(?=[=,)])/g, '').replace(/:\s*[A-Za-z0-9_<>[\]|&,\s]+(?=\s*\{)/g, '');
const parseModule = (code) => parse(code, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true, locations: true });

export function safeParse(source) {
    if (!source || typeof source !== 'string') return null;
    try {
        return parseModule(source);
    } catch {
        try { return parseModule(stripTypeScriptTypes(source)); } catch { return null; }
    }
}

const FN_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const isFn = (node) => (node ? FN_TYPES.has(node.type) : false);

const UNWRAPPERS = {
    FunctionDeclaration: (node, symbol) => (node.id?.name === symbol ? node : null),
    FunctionExpression: (node, symbol) => (node.id?.name === symbol ? node : null),
    VariableDeclarator: (node, symbol) => (node.id?.name === symbol && isFn(node.init) ? node.init : null),
    MethodDefinition: (node, symbol) => (node.key?.name === symbol && isFn(node.value) ? node.value : null),
    Property: (node, symbol) => (node.key?.name === symbol && isFn(node.value) ? node.value : null)
};

const unwrapFunction = (node, symbol) => UNWRAPPERS[node?.type]?.(node, symbol) ?? null;

function matchesLine(node, line) {
    if (!line || !node?.loc) return false;
    return isFn(node) && node.loc.start.line === line;
}

const checkNode = (node, symbol, startLine) => unwrapFunction(node, symbol) || (matchesLine(node, startLine) ? node : null);

export function findFunction(ast, symbol, startLine) {
    let found = null;
    const visit = (node) => {
        if (!node || found) return;
        found = checkNode(node, symbol, startLine);
        if (!found) forChildren(node, visit);
    };
    visit(ast);
    return found;
}

function extractFunctionDecl(node) {
    if (node?.type === 'FunctionDeclaration') return node;
    if (node?.type === 'ExportNamedDeclaration') return node.declaration;
    return null;
}

function registerFunction(node, fns) {
    const fn = extractFunctionDecl(node);
    const name = fn?.id?.name;
    if (name) fns.set(name, fn);
}

export function collectLocalFunctions(ast) {
    const fns = new Map();
    for (const node of ast?.body || []) registerFunction(node, fns);
    return fns;
}

export function inspectAliasDirectCall(callee, target, aliases) {
    if (callee?.type !== 'Identifier') return;
    const alias = aliases.get(callee.name);
    if (!alias) return;
    const list = target.get(alias.root);
    if (list) list.push(`${alias.prop}()`);
}

const DOC_PARAM_RE = /@param\s*\{[^}]*\}\s*(\w+)[^\r\n(]*\(([^)\r\n]+)\)/g;

function addMissingProp(list, prop) {
    const clean = prop.trim();
    if (!clean) return;
    const hasProp = list.some(item => item === clean || item.startsWith(`${clean}.`) || item.startsWith(`${clean}()`));
    if (!hasProp) list.push(clean);
}

export function enrichFromDocParams(source, target) {
    if (!source) return;
    for (const match of source.matchAll(DOC_PARAM_RE)) {
        const param = match[1];
        const list = target.get(param);
        if (list) {
            match[2].split(',').forEach(prop => addMissingProp(list, prop));
        }
    }
}

function hasMatchingParam(helper, target) {
    const params = (helper?.params || []).map(p => p.name || p.left?.name).filter(Boolean);
    return params.some(p => target.has(p));
}

export function collectHelperSeams(localFns, target, collectBodySeams) {
    for (const [, helper] of localFns || []) {
        if (hasMatchingParam(helper, target)) {
            collectBodySeams(helper.body, target);
        }
    }
}
