import { adviceFor, childrenOf } from './designSmellAdvice.js';

const ADAPTER_PATH = /(^|[/\\])(git|adapters|mcp|scripts|bin|test)[/\\]/i;
const WRITE_FS = new Set(['writeFileSync', 'writeFile', 'appendFileSync', 'appendFile', 'createWriteStream', 'rmSync', 'unlinkSync']);
const isCompare = op => op === '===' || op === '==' || op === '!==' || op === '!=';
const isBarrel = p => /(^|[/\\])index\.[cm]?js$/i.test(p);
const startLineOf = node => (node && node.loc ? node.loc.start.line : 1);

function collectAllNodes(root) {
    const nodes = [];
    const visit = (node) => {
        nodes.push(node);
        childrenOf(node).forEach(visit);
    };
    visit(root);
    return nodes;
}

function isStringLit(node) {
    return Boolean(node && node.type === 'Literal' && typeof node.value === 'string' && node.value.length >= 3);
}

function literalFromCompare(node) {
    if (node.type !== 'BinaryExpression' || !isCompare(node.operator)) return null;
    const lit = isStringLit(node.left) ? node.left : node.right;
    if (!isStringLit(lit)) return null;
    return { value: lit.value, line: startLineOf(lit) };
}

function detectRepeatedLiterals(nodes) {
    const counts = new Map();
    const lits = nodes.map(literalFromCompare).filter(Boolean);
    lits.forEach(({ value, line }) => {
        const prev = counts.get(value) || { count: 0, line };
        counts.set(value, { count: prev.count + 1, line: prev.line });
    });
    const repeated = [...counts.values()].find(v => v.count >= 3);
    return repeated ? { issue: 'repeated-literal', line: repeated.line, advice: adviceFor('repeated-literal') } : null;
}

function collectTopLevelLets(ast) {
    const body = Array.isArray(ast.body) ? ast.body : [];
    const letDecls = body.filter(n => n.type === 'VariableDeclaration' && n.kind === 'let');
    const idents = letDecls.flatMap(d => d.declarations || []).map(dec => (dec.id ? dec.id.name : null)).filter(Boolean);
    return new Set(idents);
}

function isEnvProperty(prop) {
    return Boolean(prop && prop.name === 'env');
}

function isProcessNode(node) {
    return Boolean(node && node.type === 'MemberExpression' && node.object && node.object.name === 'process');
}

function isEnvMutation(node) {
    if (!node || node.type !== 'MemberExpression') return false;
    return isProcessNode(node.object) && isEnvProperty(node.object.property);
}

function isAssignMutation(node, letNames) {
    const isLet = Boolean(node.left && node.left.type === 'Identifier' && letNames.has(node.left.name));
    return isLet || isEnvMutation(node.left);
}

function isStateMutation(node, letNames) {
    if (node.type === 'AssignmentExpression') return isAssignMutation(node, letNames);
    return Boolean(node.type === 'UpdateExpression' && node.argument && letNames.has(node.argument.name));
}

function findMutableStateLine(ast, letNames) {
    let badLine = null;
    const visit = (node, insideFn) => {
        const inFn = insideFn || /Function|Arrow/.test(node.type);
        if (inFn && isStateMutation(node, letNames) && !badLine) {
            badLine = startLineOf(node);
        }
        childrenOf(node).forEach(child => visit(child, inFn));
    };
    visit(ast, false);
    return badLine;
}

function detectGlobalMutableState(ast) {
    const letNames = collectTopLevelLets(ast);
    const line = findMutableStateLine(ast, letNames);
    return line ? { issue: 'global-mutable-state', line, advice: adviceFor('global-mutable-state') } : null;
}

function isChildProcessSource(src) {
    return src === 'child_process' || src === 'node:child_process';
}

function isFsWriteImport(node, src) {
    const isFs = src === 'fs' || src === 'node:fs';
    const specs = Array.isArray(node.specifiers) ? node.specifiers : [];
    return isFs && specs.some(s => WRITE_FS.has(s.imported ? s.imported.name : (s.local ? s.local.name : '')));
}

function isDirectIoImport(node) {
    if (node.type !== 'ImportDeclaration') return false;
    const src = node.source && typeof node.source.value === 'string' ? node.source.value : '';
    return isChildProcessSource(src) || isFsWriteImport(node, src);
}

function detectDirectIo(ast, filePath) {
    if (ADAPTER_PATH.test(filePath) || /\.(test|spec)\.[cm]?js$/i.test(filePath)) return null;
    const body = Array.isArray(ast.body) ? ast.body : [];
    const first = body.find(isDirectIoImport);
    return first ? { issue: 'direct-io', line: startLineOf(first), advice: adviceFor('direct-io') } : null;
}

function detectGodModule(exportsCount, importsCount, filePath) {
    if (isBarrel(filePath)) return null;
    const isGod = exportsCount > 15 || importsCount > 20;
    return isGod ? { issue: 'god-module', line: 1, advice: adviceFor('god-module') } : null;
}

function getOptions(options) {
    return {
        exportsCount: options ? options.exportsCount || 0 : 0,
        importsCount: options ? options.importsCount || 0 : 0
    };
}

export function detectFileSmells(ast, filePath, options) {
    if (!ast) return [];
    const { exportsCount, importsCount } = getOptions(options);
    const nodes = collectAllNodes(ast);
    const smells = [
        detectRepeatedLiterals(nodes),
        detectGlobalMutableState(ast),
        detectDirectIo(ast, filePath || ''),
        detectGodModule(exportsCount, importsCount, filePath || '')
    ];
    return smells.filter(Boolean);
}
