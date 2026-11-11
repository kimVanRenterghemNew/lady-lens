/**
 * Source facts for the code graph: exports, declared names, slash commands, relative imports,
 * calls to declared/imported functions, purpose, and file smells.
 * @module core/graph/codeFacts
 */
import { parse } from 'acorn';
import { extractFunctionComplexities, extractCallbackComplexities } from './functionComplexity.js';
import { detectFileSmells } from './fileSmells.js';

const MAX_PURPOSE_CHARS = 240;
const MAX_DEEP_SYMBOLS = 120;
const NOISY_NAMES = new Set(['result', 'results', 'error', 'value', 'values', 'index', 'items', 'input', 'output', 'options', 'args', 'data', 'text', 'path', 'file', 'files', 'line', 'lines', 'node', 'nodes', 'edge', 'edges', 'name', 'type', 'key', 'keys', 'content', 'response', 'request', 'match', 'matches', 'count', 'total', 'state', 'config', 'context', 'handler']);

export const TEST_FILE = /\.(test|spec|ablation)\.[cm]?js$|(^|\/)test\/|\.(?:Unit)?Tests\b/i;

/** Where scripts live unless a repository says more (`project.script_paths` in its settings). */
export const DEFAULT_SCRIPT_PATHS = ['scripts/**', 'bin/**', '**.config.*'];   // x.config.js: run by its tool, not imported

/** `dir/**` and `dir/*.mjs` style patterns, repo-relative, forward slashes. */
const globRegex = (pattern) => new RegExp(`^${String(pattern).split('**').map(part => part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')).join('.*')}$`);

/** `test`, `script` or `source`: tests only compare with / boost for test questions; scripts are run, not imported. */
export const fileKindOf = (relativePath, { scriptPaths = DEFAULT_SCRIPT_PATHS } = {}) => (
    TEST_FILE.test(relativePath) ? 'test' : scriptPaths.some(pattern => globRegex(pattern).test(relativePath)) ? 'script' : 'source'
);

/** Config files the code names in a string (`'configs/models.yaml'`, `"package.json"`): their file names, once each. */
export const configFilesNamed = (source) => [...new Set([...String(source).matchAll(/['"`]([^'"`\s]*?([\w.-]+\.(?:ya?ml|json)))['"`]/g)].map(m => m[2]))].sort();

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
    return declaration.type === 'VariableDeclaration' ? declaration.declarations.flatMap(item => (item.id?.type === 'Identifier' ? [item.id.name] : [])) : [];
}

function isFunctionMember(node) {
    if (node.computed || node.key?.type !== 'Identifier' || node.key.name === 'constructor') return false;
    return node.type === 'MethodDefinition' || (node.type === 'Property' && (node.method === true || ['FunctionExpression', 'ArrowFunctionExpression'].includes(node.value?.type)));
}

const MAX_SYMBOL_RANGES = 200;

function forChildren(node, fn) {
    for (const key of Object.keys(node).filter(k => k !== 'loc')) {
        const items = Array.isArray(node[key]) ? node[key] : [node[key]];
        items.forEach(item => { if (item?.type) fn(item); });
    }
}

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
        if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier') put(node.id.name, node);
        if (isFunctionMember(node)) put(node.key.name, node);
        forChildren(node, visit);
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
        if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier') names.add(node.id.name);
        if (isFunctionMember(node)) names.add(node.key.name);
        forChildren(node, visit);
    };
    visit(ast);
    return [...names].filter(name => name.length >= 4 && !NOISY_NAMES.has(name.toLowerCase()));
}

const MAX_CALLS = 500;

const IMPORT_SPECIFIERS = {
    ImportSpecifier: (spec, specifier) => ({ name: spec.imported.name ?? spec.imported.value, specifier }),
    ImportDefaultSpecifier: (_spec, specifier) => ({ name: 'default', specifier }),
    ImportNamespaceSpecifier: (_spec, specifier) => ({ namespace: true, specifier })
};

/** Local name -> what it imports from a relative module: `{ name, specifier }`, or `{ namespace: true, specifier }` for `* as ns`. */
function relativeImportNames(ast) {
    const names = new Map();
    const importDecls = ast.body.filter(n => n.type === 'ImportDeclaration' && String(n.source.value).startsWith('.'));
    for (const node of importDecls) {
        const specifier = node.source.value;
        node.specifiers.forEach(spec => {
            const entry = IMPORT_SPECIFIERS[spec.type]?.(spec, specifier);
            if (entry) names.set(spec.local.name, entry);
        });
    }
    return names;
}

const CALLEE_RESOLVERS = {
    Identifier: (c, imported, declared) => {
        const via = imported.get(c.name);
        if (via && !via.namespace) return { name: via.name, specifier: via.specifier };
        return (!via && declared.has(c.name)) ? { name: c.name } : null;
    },
    MemberExpression: (c, imported) => {
        if (c.computed || c.object.type !== 'Identifier') return null;
        const obj = imported.get(c.object.name);
        return obj?.namespace ? { name: c.property.name, specifier: obj.specifier } : null;
    }
};

const resolveCallTarget = (callee, imported, declared) => CALLEE_RESOLVERS[callee.type]?.(callee, imported, declared) || null;

/**
 * Every call to a function this file declares or imports from a relative module: `[caller, callee, line, specifier?]`.
 */
function collectCalls(ast, declared) {
    const imported = relativeImportNames(ast);
    const calls = [], seen = new Set();
    const add = (entry) => {
        const key = entry.join('|');
        if (!seen.has(key) && calls.length < MAX_CALLS) { seen.add(key); calls.push(entry); }
    };
    const visit = (node, owner) => {
        if (!node || typeof node.type !== 'string' || calls.length >= MAX_CALLS) return;
        let inner = owner;
        if (node.type === 'FunctionDeclaration' && declared.has(node.id?.name)) inner = node.id.name;
        if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier' && declared.has(node.id.name) && /Function|Arrow/.test(node.init?.type || '')) inner = node.id.name;
        if (isFunctionMember(node) && declared.has(node.key.name)) inner = node.key.name;
        if (node.type === 'CallExpression' || node.type === 'NewExpression') {
            const target = resolveCallTarget(node.callee, imported, declared);
            if (target) add(target.specifier ? [owner, target.name, node.loc.start.line, target.specifier] : [owner, target.name, node.loc.start.line]);
        }
        forChildren(node, item => visit(item, inner));
    };
    visit(ast, '');
    return calls;
}

const collectCommandKeywords = (source) => [...new Set([...source.matchAll(/['"`](\/[a-z][a-z-]{2,20})['"`]/g)].map(m => m[1]))].slice(0, 40);

const BODY_NODE_HANDLERS = {
    ImportDeclaration: (node, res) => res.imports.push(node.source.value),
    ExportAllDeclaration: (node, res) => res.imports.push(node.source.value),
    ExportDefaultDeclaration: (_node, res) => res.exports.push('default'),
    ExportNamedDeclaration: (node, res) => {
        if (node.source) res.imports.push(node.source.value);
        const names = [...declaredNames(node.declaration), ...node.specifiers.map(spec => spec.exported.name || spec.exported.value)];
        res.exports.push(...names);
        res.symbols.push(...names);
    },
    FunctionDeclaration: (node, res) => res.symbols.push(...declaredNames(node)),
    ClassDeclaration: (node, res) => res.symbols.push(...declaredNames(node)),
    VariableDeclaration: (node, res) => res.symbols.push(...declaredNames(node))
};

/** Parse one source file into the facts the graph needs. Never throws: a parse error becomes `parseError`. */
export function analyzeSource(source, relativePath) {
    const result = { purpose: extractPurpose(source), exports: [], symbols: [], keywords: collectCommandKeywords(source), imports: [], symbolRanges: {}, calls: [], functions: [], fileSmells: [], parseError: null };
    let ast;
    try {
        ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true, locations: true });
    } catch (error) {
        result.parseError = error.message.slice(0, 120);
        for (const match of source.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) result.imports.push(match[1]);
        return result;
    }

    for (const node of ast.body) {
        BODY_NODE_HANDLERS[node.type]?.(node, result);
    }
    for (const match of source.matchAll(/import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) result.imports.push(match[1]);
    result.exports = [...new Set(result.exports)];
    result.symbols = [...new Set([...result.symbols, ...collectDeclaredNames(ast)])];
    result.imports = [...new Set(result.imports)].filter(specifier => specifier.startsWith('.'));
    result.symbolRanges = Object.fromEntries(Object.entries(collectSymbolRanges(ast)).filter(([name]) => result.symbols.includes(name)));
    result.calls = collectCalls(ast, new Set(Object.keys(result.symbolRanges)));
    [result.functions, result.callbacks] = [extractFunctionComplexities(ast), extractCallbackComplexities(ast)];
    result.fileSmells = detectFileSmells(ast, relativePath, { exportsCount: result.exports.length, importsCount: result.imports.length });
    return result;
}
