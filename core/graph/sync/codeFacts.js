/**
 * Source facts for the code graph: exports, declared names at any depth,
 * slash commands, relative imports, calls to declared or imported functions and a one-paragraph purpose. One parser for every producer,
 * so the indexer and the eval can never disagree about what a file "contains".
 *
 * @module core/graph/codeFacts
 */
import { parse } from 'acorn';
import { extractFunctionComplexities } from './functionComplexity.js';

const MAX_PURPOSE_CHARS = 240;
const MAX_DEEP_SYMBOLS = 120;
const NOISY_NAMES = new Set(['result', 'results', 'error', 'value', 'values', 'index', 'items', 'input', 'output', 'options', 'args', 'data', 'text', 'path', 'file', 'files', 'line', 'lines', 'node', 'nodes', 'edge', 'edges', 'name', 'type', 'key', 'keys', 'content', 'response', 'request', 'match', 'matches', 'count', 'total', 'state', 'config', 'context', 'handler']);

export const TEST_FILE = /\.(test|spec|ablation)\.[cm]?js$|(^|\/)test\/|\.(?:Unit)?Tests\b/i;

/** Where scripts live unless a repository says more (`project.script_paths` in its settings). */
export const DEFAULT_SCRIPT_PATHS = ['scripts/**', 'bin/**'];

/** `dir/**` and `dir/*.mjs` style patterns, repo-relative, forward slashes. */
const globRegex = (pattern) => new RegExp(`^${String(pattern).split('**').map(part => part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')).join('.*')}$`);

/** `test`, `script` or `source`: tests only compare with / boost for test questions; scripts are run, not imported. */
export function fileKindOf(relativePath, { scriptPaths = DEFAULT_SCRIPT_PATHS } = {}) {
    if (TEST_FILE.test(relativePath)) return 'test';
    if (scriptPaths.some(pattern => globRegex(pattern).test(relativePath))) return 'script';
    return 'source';
}

/** Config files the code names in a string (`'configs/models.yaml'`, `"package.json"`): their file names, once each. */
export function configFilesNamed(source) {
    const names = new Set();
    for (const match of String(source).matchAll(/['"`]([^'"`\s]*?([\w.-]+\.(?:ya?ml|json)))['"`]/g)) names.add(match[2]);
    return [...names].sort();
}

export function extractPurpose(raw) {
    // `.` does not match `\r`: with CRLF line endings a `//` header was never seen
    const source = String(raw).replace(/\r\n?/g, '\n');
    // the header at the top wins (a `//` header over a function's doc comment further down); else the first doc comment
    const top = source.replace(/^#!.*\n/, '').replace(/^\s+/, '');
    const lineHeader = top.match(/^(?:\/\/.*(?:\n|$))+/)?.[0];
    const doc = lineHeader ? null : source.match(/\/\*\*([\s\S]*?)\*\//);
    const text = doc
        ? doc[1].split('\n').map(line => line.replace(/^\s*\* ?/, '').trim())
        : (lineHeader || source.match(/^(?:\/\/.*\n)+/)?.[0] || '').split('\n').map(line => line.replace(/^\/\/\s?/, '').trim());
    const firstParagraph = text.join('\n').trim().split(/\n\s*\n/)[0] || '';
    return firstParagraph.replace(/\s+/g, ' ').slice(0, MAX_PURPOSE_CHARS);
}

function declaredNames(declaration) {
    if (!declaration) return [];
    if (declaration.id?.name) return [declaration.id.name];
    if (declaration.type === 'VariableDeclaration') return declaration.declarations.flatMap(item => (item.id?.type === 'Identifier' ? [item.id.name] : []));
    return [];
}

/**
 * A method (`async recoverInterrupted() {}` in a class or object literal) or a property holding a function
 * (`retryRound: () => 1`). The public API of a factory such as createWorkQueue() is exactly these members; plain data
 * properties and `constructor` are not behaviour names.
 */
function isFunctionMember(node) {
    if (node.computed || node.key?.type !== 'Identifier' || node.key.name === 'constructor') return false;
    if (node.type === 'MethodDefinition') return true;
    if (node.type !== 'Property') return false;
    return node.method === true || ['FunctionExpression', 'ArrowFunctionExpression'].includes(node.value?.type);
}

const MAX_SYMBOL_RANGES = 200;

/** 1-based [startLine, endLine] of every declared name (first declaration wins), for `graph_query`'s symbol -> lines answer. */
function collectSymbolRanges(ast) {
    const ranges = {};
    const put = (name, node) => {
        if (!name || ranges[name] || Object.keys(ranges).length >= MAX_SYMBOL_RANGES || !node.loc) return;
        ranges[name] = [node.loc.start.line, node.loc.end.line];
    };
    const visit = (node, owner = node) => {
        if (!node || typeof node.type !== 'string') return;
        if ((node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') && node.id?.name) put(node.id.name, owner === node ? node : owner);
        else if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier') put(node.id.name, node.init ? node : node);
        else if (isFunctionMember(node)) put(node.key.name, node);
        for (const key of Object.keys(node)) {
            if (key === 'loc') continue;
            const child = node[key];
            if (Array.isArray(child)) child.forEach(item => visit(item));
            else if (child && typeof child.type === 'string') visit(child);
        }
    };
    visit(ast);
    return ranges;
}

/** Declared names at ANY depth (an entry point may keep `commandHandlers` inside a function), noise filtered and capped. */
function collectDeclaredNames(ast) {
    const names = new Set();
    const visit = (node) => {
        if (!node || typeof node.type !== 'string' || names.size >= MAX_DEEP_SYMBOLS) return;
        if ((node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') && node.id?.name) names.add(node.id.name);
        else if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier') names.add(node.id.name);
        else if (isFunctionMember(node)) names.add(node.key.name);
        for (const key of Object.keys(node)) {
            const child = node[key];
            if (Array.isArray(child)) child.forEach(visit);
            else if (child && typeof child.type === 'string') visit(child);
        }
    };
    visit(ast);
    return [...names].filter(name => name.length >= 4 && !NOISY_NAMES.has(name.toLowerCase()));
}

const MAX_CALLS = 500;

/** Local name -> what it imports from a relative module: `{ name, specifier }`, or `{ namespace: true, specifier }` for `* as ns`. */
function relativeImportNames(ast) {
    const names = new Map();
    for (const node of ast.body) {
        if (node.type !== 'ImportDeclaration' || !String(node.source.value).startsWith('.')) continue;
        const specifier = node.source.value;
        for (const spec of node.specifiers) {
            if (spec.type === 'ImportSpecifier') names.set(spec.local.name, { name: spec.imported.name ?? spec.imported.value, specifier });
            else if (spec.type === 'ImportDefaultSpecifier') names.set(spec.local.name, { name: 'default', specifier });
            else if (spec.type === 'ImportNamespaceSpecifier') names.set(spec.local.name, { namespace: true, specifier });
        }
    }
    return names;
}

/**
 * Every call to a function this file declares or imports from a relative module: `[caller, callee, line, specifier?]`.
 * `caller` is the innermost function around the call that the graph knows (has a symbol range; '' at module level); `callee` is the name as declared in
 * its own module (an alias is undone); `specifier` is absent for a function of this file. Method calls on objects are
 * left out: without types they cannot be resolved.
 */
function collectCalls(ast, declared) {
    const imported = relativeImportNames(ast);
    const calls = [];
    const seen = new Set();
    const add = (entry) => {
        const key = entry.join('|');
        if (!seen.has(key) && calls.length < MAX_CALLS) { seen.add(key); calls.push(entry); }
    };
    const visit = (node, owner) => {
        if (!node || typeof node.type !== 'string' || calls.length >= MAX_CALLS) return;
        let inner = owner;
        // Only names the graph knows own calls; a call inside a short local closure belongs to the function around it.
        if (node.type === 'FunctionDeclaration' && declared.has(node.id?.name)) inner = node.id.name;
        else if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier' && declared.has(node.id.name) && /Function|Arrow/.test(node.init?.type || '')) inner = node.id.name;
        else if (isFunctionMember(node) && declared.has(node.key.name)) inner = node.key.name;
        if (node.type === 'CallExpression' || node.type === 'NewExpression') {
            const callee = node.callee;
            const line = node.loc.start.line;
            if (callee.type === 'Identifier') {
                const via = imported.get(callee.name);
                if (via && !via.namespace) add([owner, via.name, line, via.specifier]);
                else if (!via && declared.has(callee.name)) add([owner, callee.name, line]);
            } else if (callee.type === 'MemberExpression' && !callee.computed && callee.object.type === 'Identifier' && imported.get(callee.object.name)?.namespace) {
                add([owner, callee.property.name, line, imported.get(callee.object.name).specifier]);
            }
        }
        for (const key of Object.keys(node)) {
            if (key === 'loc') continue;
            const child = node[key];
            if (Array.isArray(child)) child.forEach(item => visit(item, inner));
            else if (child && typeof child.type === 'string') visit(child, inner);
        }
    };
    visit(ast, '');
    return calls;
}

/** Slash commands / CLI flags a file defines, e.g. `'/status'`, so "add a status command" finds the dispatcher. */
function collectCommandKeywords(source) {
    const found = new Set();
    for (const match of source.matchAll(/['"`](\/[a-z][a-z-]{2,20})['"`]/g)) found.add(match[1]);
    return [...found].slice(0, 40);
}

/** Parse one source file into the facts the graph needs. Never throws: a parse error becomes `parseError`. */
export function analyzeSource(source) {
    const result = { purpose: extractPurpose(source), exports: [], symbols: [], keywords: collectCommandKeywords(source), imports: [], symbolRanges: {}, calls: [], functions: [], parseError: null };
    let ast;
    try {
        ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true, locations: true });
    } catch (error) {
        result.parseError = error.message.slice(0, 120);
        for (const match of source.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) result.imports.push(match[1]);
        return result;
    }

    for (const node of ast.body) {
        if (node.type === 'ImportDeclaration' || node.type === 'ExportAllDeclaration') result.imports.push(node.source.value);
        else if (node.type === 'ExportNamedDeclaration') {
            if (node.source) result.imports.push(node.source.value);
            const names = [...declaredNames(node.declaration), ...node.specifiers.map(spec => spec.exported.name || spec.exported.value)];
            result.exports.push(...names);
            result.symbols.push(...names);
        } else if (node.type === 'ExportDefaultDeclaration') {
            result.exports.push('default');
        } else if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration' || node.type === 'VariableDeclaration') {
            result.symbols.push(...declaredNames(node));
        }
    }
    for (const match of source.matchAll(/import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) result.imports.push(match[1]);

    result.exports = [...new Set(result.exports)];
    result.symbols = [...new Set([...result.symbols, ...collectDeclaredNames(ast)])];
    result.imports = [...new Set(result.imports)].filter(specifier => specifier.startsWith('.'));
    const ranges = collectSymbolRanges(ast);
    result.symbolRanges = Object.fromEntries(Object.entries(ranges).filter(([name]) => result.symbols.includes(name)));
    result.calls = collectCalls(ast, new Set(Object.keys(result.symbolRanges)));
    result.functions = extractFunctionComplexities(ast);
    return result;
}
