/**
 * AST inspection of function parameter method-calls and property-accesses (parameter seams).
 * Used by functionView to inform test generation (contractPrompt) of needed mocks.
 * @module core/graph/query/parameterSeams
 */
import { parse } from 'acorn';

function forChildren(node, fn) {
    for (const key of Object.keys(node).filter(k => k !== 'loc')) {
        const items = Array.isArray(node[key]) ? node[key] : [node[key]];
        items.forEach(item => { if (item?.type) fn(item); });
    }
}

const stripTypeScriptTypes = (s) => s.replace(/:\s*[A-Za-z0-9_<>[\]|&,\s]+(?=[=,)])/g, '').replace(/:\s*[A-Za-z0-9_<>[\]|&,\s]+(?=\s*\{)/g, '');

const parseModule = (code) => parse(code, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true, locations: true });

function safeParse(source) {
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

function findFunction(ast, symbol, startLine) {
    let found = null;
    const visit = (node) => {
        if (!node || found) return;
        found = checkNode(node, symbol, startLine);
        if (!found) forChildren(node, visit);
    };
    visit(ast);
    return found;
}

const addIdentParam = (p, target) => { if (p && p.type === 'Identifier') target.set(p.name, []); };
const unwrapParam = (p) => (p?.type === 'AssignmentPattern' ? p.left : p);
const propValName = (v) => (v?.type === 'AssignmentPattern' ? v.left?.name : v?.name);
const propName = (p) => (p ? propValName(p.value) || p.key?.name : null);

function addObjectProps(param, target) {
    if (!param || param.type !== 'ObjectPattern') return;
    const props = param.properties || [];
    props.forEach(prop => {
        const name = propName(prop);
        if (name) target.set(name, []);
    });
}

function addParam(param, target) {
    const p = unwrapParam(param);
    addIdentParam(p, target);
    addObjectProps(p, target);
}

const isIdentMatch = (init, paramNames) => Boolean(init && init.type === 'Identifier' && paramNames.has(init.name));

function isParamDestructure(node, paramNames) {
    if (!node || node.type !== 'VariableDeclarator') return false;
    if (!node.id || node.id.type !== 'ObjectPattern') return false;
    return isIdentMatch(node.init, paramNames);
}

function addPropertyAlias(prop, rootName, aliases) {
    if (!prop || !prop.key) return;
    const keyName = prop.key.name;
    const valName = prop.value ? prop.value.name : keyName;
    if (valName) aliases.set(valName, { root: rootName, prop: keyName });
}

function recordDestructuredAlias(node, paramNames, aliases) {
    if (!isParamDestructure(node, paramNames)) return;
    const props = node.id.properties || [];
    props.forEach(prop => addPropertyAlias(prop, node.init.name, aliases));
}

function collectAliases(body, paramNames) {
    const aliases = new Map();
    const visit = (node) => {
        if (!node) return;
        recordDestructuredAlias(node, paramNames, aliases);
        forChildren(node, visit);
    };
    visit(body);
    return aliases;
}

const unwrapChain = (node) => (node?.type === 'ChainExpression' ? node.expression : node);

function stepMember(curr, parts) {
    if (curr.property?.name) parts.unshift(curr.property.name);
    return unwrapChain(curr.object);
}

function resolveMemberParts(expr) {
    const parts = [];
    let curr = unwrapChain(expr);
    while (curr && curr.type === 'MemberExpression') {
        curr = stepMember(curr, parts);
    }
    if (!curr || curr.type !== 'Identifier') return null;
    return { root: curr.name, parts };
}

function expandAlias(root, parts, aliases) {
    const alias = aliases.get(root);
    if (!alias) return { root, parts };
    return { root: alias.root, parts: [alias.prop, ...parts] };
}

function recordChain(target, info, isCall, aliases) {
    const { root, parts } = expandAlias(info.root, info.parts, aliases);
    const list = target.get(root);
    if (!list || !parts.length) return;
    const name = parts.join('.');
    list.push(isCall ? `${name}()` : name);
}

function inspectCall(node, target, aliases) {
    if (node.type !== 'CallExpression') return;
    const callee = unwrapChain(node.callee);
    if (callee?.type !== 'MemberExpression') return;
    const info = resolveMemberParts(callee);
    if (info) recordChain(target, info, true, aliases);
}

const isParentMember = (node, parent) => Boolean(parent?.type === 'MemberExpression' && parent.object === node);
const isCallCallee = (node, parent) => Boolean(parent && parent.type === 'CallExpression' && parent.callee === node);

function inspectMember(node, parent, target, aliases) {
    if (node.type !== 'MemberExpression') return;
    if (isParentMember(node, parent) || isCallCallee(node, parent)) return;
    const info = resolveMemberParts(node);
    if (info) recordChain(target, info, false, aliases);
}

function collectSeamsFromBody(body, target, aliases) {
    const visit = (node, parent) => {
        if (!node) return;
        inspectCall(node, target, aliases);
        inspectMember(node, parent, target, aliases);
        forChildren(node, (child) => visit(child, node));
    };
    visit(body, null);
}

const dedupeMap = (target) => Object.fromEntries(
    [...target.entries()].map(([k, v]) => [k, [...new Set(v)].sort()])
);

export function extractSeamsFromSource(source, symbol, startLine) {
    const ast = safeParse(source);
    const fn = ast ? findFunction(ast, symbol, startLine) : null;
    if (!fn) return {};
    const target = new Map();
    for (const param of fn.params || []) addParam(param, target);
    const aliases = collectAliases(fn.body, target);
    collectSeamsFromBody(fn.body, target, aliases);
    return dedupeMap(target);
}

function mergeSeams(target, source) {
    for (const [param, items] of Object.entries(source)) {
        target[param] = [...new Set([...(target[param] || []), ...items])].sort();
    }
}

export function parameterSeams(definitions, symbol, factsOf) {
    const result = {};
    for (const def of definitions || []) {
        const text = factsOf(def.path)?.text;
        if (text) mergeSeams(result, extractSeamsFromSource(text, symbol, def.startLine));
    }
    return result;
}
