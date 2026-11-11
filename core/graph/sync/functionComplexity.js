import { detectFunctionSmells } from './functionSmells.js';

/**
 * Cyclomatic complexity and function sizing from AST nodes (acorn / tree-sitter).
 * Measures branching decisions per declared function/method without descending into nested closures, counted the way
 * ESLint's `complexity` rule counts them (also `?.`, default values and `||=`/`&&=`/`??=`), so health and lint agree.
 */
const DECISION_TYPES = new Set([
    'IfStatement', 'ForStatement', 'ForInStatement', 'ForOfStatement',
    'WhileStatement', 'DoWhileStatement', 'CatchClause', 'ConditionalExpression'
]);

const LOGICAL_OPS = new Set(['&&', '||', '??']);
const LOGICAL_ASSIGN = new Set(['&&=', '||=', '??=']);
const FUNCTION = /^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/;

// one decision per node of these kinds, as ESLint counts them; the rest of the tree is only walked
const DECIDES = {
    LogicalExpression: node => LOGICAL_OPS.has(node.operator),
    AssignmentExpression: node => LOGICAL_ASSIGN.has(node.operator),
    SwitchCase: node => node.test !== null,
    AssignmentPattern: () => true,
    MemberExpression: node => node.optional === true,
    CallExpression: node => node.optional === true
};
const decides = node => DECISION_TYPES.has(node.type) || Boolean(DECIDES[node.type]?.(node));
const childrenOf = node => Object.entries(node).filter(([key]) => key !== 'loc').flatMap(([, child]) => (Array.isArray(child) ? child : [child])).filter(child => child && typeof child.type === 'string');

/** Decisions in `root` (a function with its parameters, or a body), not in the functions nested in it. */
function countDecisions(root) {
    let count = 0;
    const visit = (node) => {
        if (node !== root && FUNCTION.test(node.type)) return;
        if (decides(node)) count++;
        childrenOf(node).forEach(visit);
    };
    visit(root);
    return count;
}

const optLimit = (val, envKey, fallback) => Number(val ?? process.env[envKey] ?? fallback);

function functionLimits(options) {
    return {
        normCc: optLimit(options.normCc, 'LENS_NORM_CYCLOMATIC_COMPLEXITY', 5),
        maxCc: optLimit(options.maxCc, 'LENS_MAX_CYCLOMATIC_COMPLEXITY', 15),
        maxLines: optLimit(options.maxLines, 'LENS_MAX_FUNCTION_LINES', 60),
        maxParams: optLimit(options.maxParams, 'LENS_MAX_FUNCTION_PARAMS', 5)
    };
}

function complexityIssue(cc, normCc, maxCc) {
    if (cc > maxCc) return 'high-cyclomatic-complexity';
    if (cc > normCc) return 'complexity-above-norm';
    return null;
}

function nodeLocationMetrics(fnNode) {
    if (fnNode.loc) {
        return {
            loc: [fnNode.loc.start.line, fnNode.loc.end.line],
            lines: fnNode.loc.end.line - fnNode.loc.start.line + 1
        };
    }
    return { loc: [1, 1], lines: 1 };
}

function collectFunctionIssues(cc, lines, params, limits) {
    const issues = [
        complexityIssue(cc, limits.normCc, limits.maxCc),
        lines > limits.maxLines ? 'large-function' : null,
        params > limits.maxParams ? 'too-many-params' : null
    ];
    return issues.filter(Boolean);
}

export function computeFunctionMetrics(fnNode, name, options) {
    const { loc, lines } = nodeLocationMetrics(fnNode);
    const params = Array.isArray(fnNode.params) ? fnNode.params.length : 0;
    const cc = 1 + countDecisions(fnNode);
    const limits = functionLimits(options || {});
    const smells = detectFunctionSmells(fnNode, cc);
    const issues = collectFunctionIssues(cc, lines, params, limits);

    return {
        name: name || '<anonymous>',
        loc,
        lines,
        params,
        cyclomaticComplexity: cc,
        issues,
        smells
    };
}

// a function that gets its name from where it stands; any other function is a callback of its owner
const NAMED_BY_PARENT = new Set(['FunctionDeclaration', 'MethodDefinition', 'VariableDeclarator', 'Property']);
const SCOPED_NODE_TYPES = new Set(['VariableDeclarator', 'Property', 'MethodDefinition']);

function isAnonymousCallback(node, parentType) {
    if (!FUNCTION.test(node.type)) return false;
    if (node.type === 'FunctionDeclaration') return false;
    return !NAMED_BY_PARENT.has(parentType);
}

function extractNodeName(node) {
    return node.id?.name || node.key?.name;
}

function nodeDeclaredName(node) {
    if (node.type === 'FunctionDeclaration') return node.id?.name;
    if (SCOPED_NODE_TYPES.has(node.type)) return extractNodeName(node);
    return null;
}

function resolveScopeOwner(node, currentOwner) {
    return nodeDeclaredName(node) || currentOwner;
}

function checkAndCollectCallback(node, owner, parentType, min, callbacks) {
    if (!isAnonymousCallback(node, parentType)) return;
    const label = `${owner || '<module>'} (callback)`;
    const metrics = computeFunctionMetrics(node, label);
    if (metrics.cyclomaticComplexity > min) {
        callbacks.push({
            name: metrics.name,
            loc: metrics.loc,
            lines: metrics.lines,
            cyclomaticComplexity: metrics.cyclomaticComplexity
        });
    }
}

/**
 * Callbacks (`.map(x => …)`, an inline handler) above `min`, which `extractFunctionComplexities` does not list:
 * `{ name: '<owner> (callback)', loc, lines, cyclomaticComplexity }`. Kept apart so diffs by function name stay as they are.
 */
export function extractCallbackComplexities(ast, opts) {
    if (!ast || typeof ast !== 'object') return [];
    const min = opts?.min ?? 5;
    const callbacks = [];
    const visit = (node, owner, parentType) => {
        checkAndCollectCallback(node, owner, parentType, min, callbacks);
        const next = resolveScopeOwner(node, owner);
        childrenOf(node).forEach(child => visit(child, next, node.type));
    };
    visit(ast, '', null);
    return callbacks;
}

const FUNCTION_EXTRACTORS = {
    FunctionDeclaration(node, ownerName, options) {
        const name = node.id?.name || ownerName;
        return { fn: computeFunctionMetrics(node, name, options), owner: name };
    },
    MethodDefinition(node, ownerName, options) {
        const name = node.key?.name || ownerName;
        const fn = node.value ? computeFunctionMetrics(node.value, name, options) : null;
        return { fn, owner: name };
    },
    VariableDeclarator(node, _owner, options) {
        if (node.id?.type !== 'Identifier') return null;
        const name = node.id.name;
        const fn = (node.init && /Function|Arrow/.test(node.init.type)) ? computeFunctionMetrics(node.init, name, options) : null;
        return { fn, owner: name };
    },
    Property(node, _owner, options) {
        if (node.key?.type !== 'Identifier') return null;
        const name = node.key.name;
        const fn = (node.value && /Function|Arrow/.test(node.value.type)) ? computeFunctionMetrics(node.value, name, options) : null;
        return { fn, owner: name };
    }
};

function stepExtractor(node, ownerName, opts, functions) {
    const res = FUNCTION_EXTRACTORS[node.type]?.(node, ownerName, opts);
    if (!res) return ownerName;
    if (res.fn) functions.push(res.fn);
    return res.owner || ownerName;
}

export function extractFunctionComplexities(ast, options) {
    if (!ast || typeof ast !== 'object') return [];
    const opts = options || {};
    const functions = [];
    const visit = (node, ownerName) => {
        if (!node || typeof node !== 'object') return;
        const nextOwner = stepExtractor(node, ownerName, opts, functions);
        childrenOf(node).forEach(child => visit(child, nextOwner));
    };
    visit(ast, '');
    return functions;
}
