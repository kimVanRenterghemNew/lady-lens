import { adviceFor, childrenOf } from './designSmellAdvice.js';

const BLOCK_TYPES = new Set(['IfStatement', 'ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement', 'SwitchStatement', 'CatchClause']);
const LOOP_TYPES = new Set(['ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement']);
const isLiteral = node => Boolean(node && node.type === 'Literal');
const isKey = node => Boolean(node && (node.type === 'Identifier' || node.type === 'MemberExpression'));
const keyName = node => node.name || (node.object && node.property ? `${node.object.name}.${node.property.name}` : null);
const startLineOf = node => (node && node.loc ? node.loc.start.line : 1);

function compareKey(left, right) {
    if (isLiteral(right) && isKey(left)) return keyName(left);
    if (isLiteral(left) && isKey(right)) return keyName(right);
    return null;
}

export function collectFunctionNodes(root) {
    const nodes = [];
    const visit = (node) => {
        nodes.push(node);
        const children = childrenOf(node).filter(c => !/Function|Arrow/.test(c.type));
        children.forEach(visit);
    };
    childrenOf(root).filter(c => !/Function|Arrow/.test(c.type)).forEach(visit);
    return nodes;
}

function recordKey(counts, key) {
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
}

function checkIfDispatch(node, counts) {
    if (node.type !== 'IfStatement') return;
    if (!node.test || node.test.type !== 'BinaryExpression') return;
    recordKey(counts, compareKey(node.test.left, node.test.right));
}

function checkSwitchDispatch(node, counts) {
    if (node.type !== 'SwitchStatement') return;
    if (!isKey(node.discriminant)) return;
    const cases = (node.cases || []).filter(c => c.test !== null).length;
    if (cases >= 3) recordKey(counts, keyName(node.discriminant));
}

function countDispatchKeys(nodes) {
    const counts = new Map();
    nodes.forEach(node => {
        checkIfDispatch(node, counts);
        checkSwitchDispatch(node, counts);
    });
    return counts;
}

function detectDispatchChain(fnNode, nodes) {
    const counts = countDispatchKeys(nodes);
    const hasChain = [...counts.values()].some(count => count >= 3);
    return hasChain ? { issue: 'dispatch-chain', line: startLineOf(fnNode), advice: adviceFor('dispatch-chain') } : null;
}

function isFallbackNode(node) {
    if (node.type === 'LogicalExpression') return node.operator === '||' || node.operator === '??';
    if (node.type === 'MemberExpression' || node.type === 'CallExpression') return node.optional === true;
    return node.type === 'AssignmentPattern';
}

function isHeavyRatio(total, cc) {
    if (total < 3) return false;
    if (cc <= 0) return false;
    return (total / cc) >= 0.4;
}

function detectFallbackHeavy(fnNode, nodes, cc) {
    const params = Array.isArray(fnNode.params) ? fnNode.params : [];
    const total = [...params, ...nodes].filter(isFallbackNode).length;
    if (!isHeavyRatio(total, cc)) return null;
    return { issue: 'fallback-heavy', line: startLineOf(fnNode), advice: adviceFor('fallback-heavy') };
}

function findDeepLine(node, depth) {
    const next = BLOCK_TYPES.has(node.type) ? depth + 1 : depth;
    if (next > 2) return startLineOf(node);
    const sub = childrenOf(node).filter(c => !/Function|Arrow/.test(c.type));
    for (const child of sub) {
        const line = findDeepLine(child, next);
        if (line) return line;
    }
    return null;
}

function detectDeepNesting(fnNode) {
    const line = findDeepLine(fnNode, 0);
    return line ? { issue: 'deep-nesting', line, advice: adviceFor('deep-nesting') } : null;
}

function loopIfCount(loopNode) {
    return collectFunctionNodes(loopNode).filter(n => n.type === 'IfStatement').length;
}

function detectLoopBranching(nodes) {
    const bad = nodes.find(n => LOOP_TYPES.has(n.type) && loopIfCount(n) >= 2);
    return bad ? { issue: 'loop-branching', line: startLineOf(bad), advice: adviceFor('loop-branching') } : null;
}

function countLogic(node) {
    if (!node || node.type !== 'LogicalExpression') return 0;
    const isOp = node.operator === '&&' || node.operator === '||';
    return (isOp ? 1 : 0) + countLogic(node.left) + countLogic(node.right);
}

function detectLongCondition(nodes) {
    const tests = nodes.map(n => n.test).filter(Boolean);
    const bad = tests.find(t => countLogic(t) >= 3);
    return bad ? { issue: 'long-condition', line: startLineOf(bad), advice: adviceFor('long-condition') } : null;
}

function isBoolName(name) {
    return /^(is|has|should|with|wants|can)[A-Z]|^flag|^dryRun|^force$/.test(name);
}

function isAssignBool(p) {
    if (!p || p.type !== 'AssignmentPattern') return false;
    const r = p.right;
    return Boolean(r && r.type === 'Literal' && typeof r.value === 'boolean');
}

function assignBoolName(p) {
    return isAssignBool(p) && p.left ? p.left.name : null;
}

function paramBoolName(p) {
    if (!p) return null;
    if (p.type === 'Identifier') return isBoolName(p.name) ? p.name : null;
    return assignBoolName(p);
}

function isNotIdentifier(test) {
    const isUnaryNot = Boolean(test && test.type === 'UnaryExpression' && test.operator === '!');
    return isUnaryNot && test.argument ? test.argument.name : null;
}

function testBoolName(test) {
    if (!test) return null;
    if (test.type === 'Identifier') return test.name;
    return isNotIdentifier(test);
}

function detectFlagParameter(fnNode, nodes) {
    const params = Array.isArray(fnNode.params) ? fnNode.params : [];
    const bools = new Set(params.map(paramBoolName).filter(Boolean));
    if (bools.size === 0) return null;
    const ifs = nodes.filter(n => n.type === 'IfStatement');
    const bad = ifs.find(n => bools.has(testBoolName(n.test)));
    return bad ? { issue: 'flag-parameter', line: startLineOf(bad), advice: adviceFor('flag-parameter') } : null;
}

export function detectFunctionSmells(fnNode, cc) {
    if (!fnNode || !fnNode.loc) return [];
    const nodes = collectFunctionNodes(fnNode);
    return [
        detectDispatchChain(fnNode, nodes),
        detectFallbackHeavy(fnNode, nodes, cc),
        detectDeepNesting(fnNode),
        detectLoopBranching(nodes),
        detectLongCondition(nodes),
        detectFlagParameter(fnNode, nodes)
    ].filter(Boolean);
}
