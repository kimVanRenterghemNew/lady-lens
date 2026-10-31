/**
 * Cyclomatic complexity and function sizing from AST nodes (acorn / tree-sitter).
 * Measures branching decisions per declared function/method without descending into nested closures.
 */
const DECISION_TYPES = new Set([
    'IfStatement',
    'ForStatement',
    'ForInStatement',
    'ForOfStatement',
    'WhileStatement',
    'DoWhileStatement',
    'CatchClause',
    'ConditionalExpression'
]);

const LOGICAL_OPS = new Set(['&&', '||', '??']);

function countDecisions(functionBody) {
    let count = 0;
    const visit = (node) => {
        if (!node || typeof node !== 'object') return;
        if (node !== functionBody && /^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(node.type)) {
            return;
        }
        if (DECISION_TYPES.has(node.type)) {
            count++;
        } else if (node.type === 'LogicalExpression' && LOGICAL_OPS.has(node.operator)) {
            count++;
        } else if (node.type === 'SwitchCase' && node.test !== null) {
            count++;
        }
        for (const key of Object.keys(node)) {
            if (key === 'loc') continue;
            const child = node[key];
            if (Array.isArray(child)) child.forEach(visit);
            else if (child && typeof child.type === 'string') visit(child);
        }
    };
    visit(functionBody);
    return count;
}

export function computeFunctionMetrics(fnNode, name, options = {}) {
    const loc = fnNode.loc ? [fnNode.loc.start.line, fnNode.loc.end.line] : [1, 1];
    const lines = fnNode.loc ? fnNode.loc.end.line - fnNode.loc.start.line + 1 : 1;
    const params = Array.isArray(fnNode.params) ? fnNode.params.length : 0;
    const cc = 1 + countDecisions(fnNode.body || fnNode);

    const maxCc = Number(options.maxCc || process.env.LENS_MAX_CYCLOMATIC_COMPLEXITY || 15);
    const maxLines = Number(options.maxLines || process.env.LENS_MAX_FUNCTION_LINES || 60);
    const maxParams = Number(options.maxParams || process.env.LENS_MAX_FUNCTION_PARAMS || 5);

    const issues = [];
    if (cc > maxCc) issues.push('high-cyclomatic-complexity');
    if (lines > maxLines) issues.push('large-function');
    if (params > maxParams) issues.push('too-many-params');

    return {
        name: name || '<anonymous>',
        loc,
        lines,
        params,
        cyclomaticComplexity: cc,
        issues
    };
}

export function extractFunctionComplexities(ast, options = {}) {
    if (!ast || typeof ast !== 'object') return [];
    const functions = [];
    const visit = (node, ownerName = '') => {
        if (!node || typeof node !== 'object') return;
        let currentOwner = ownerName;

        if (node.type === 'FunctionDeclaration') {
            const name = node.id?.name || ownerName;
            functions.push(computeFunctionMetrics(node, name, options));
            currentOwner = name;
        } else if (node.type === 'MethodDefinition') {
            const name = node.key?.name || ownerName;
            if (node.value) functions.push(computeFunctionMetrics(node.value, name, options));
            currentOwner = name;
        } else if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier') {
            const name = node.id.name;
            if (node.init && /Function|Arrow/.test(node.init.type)) {
                functions.push(computeFunctionMetrics(node.init, name, options));
            }
            currentOwner = name;
        } else if (node.type === 'Property' && node.key?.type === 'Identifier') {
            const name = node.key.name;
            if (node.value && /Function|Arrow/.test(node.value.type)) {
                functions.push(computeFunctionMetrics(node.value, name, options));
            }
            currentOwner = name;
        }

        for (const key of Object.keys(node)) {
            if (key === 'loc') continue;
            const child = node[key];
            if (Array.isArray(child)) child.forEach(item => visit(item, currentOwner));
            else if (child && typeof child.type === 'string') visit(child, currentOwner);
        }
    };
    visit(ast, '');
    return functions;
}
