/**
 * the function view: where X is defined, what its file is for, who uses it, which tests use it,
 * which documents name it. Only files that reach the definition through the import graph AND name X.
 */
import { definedIn } from './importLookup.js';
import { barrelReach } from './impact.js';
import { analyzeSource, analyzeSourceForLanguage } from '../sync/index.js';
import { resolveCallee } from '../model/index.js';
import { docCommentAt } from './docComment.js';
import { classShape } from './classShape.js';
import { parameterSeams } from './parameterSeams.js';

const isTestNode = (node) => node.kind === 'test' || node.type === 'Test' || /(^|\/)test\//.test(String(node.path));
const isBarrel = (path) => /(^|\/)index\.[cm]?js$/.test(path);
const MAX_LINES = 5;

function linesWith(text, symbol) {
    const word = new RegExp(`(^|[^\\w$])${symbol.replace(/[$]/g, '\\$')}(?![\\w$])`);
    return String(text).split('\n').flatMap((line, index) => (word.test(line) ? [index + 1] : []));
}

function testNames(text, symbol) {
    const cases = [...String(text).matchAll(/\b(?:it|test)\(\s*(['"`])((?:(?!\1).)*)\1/g)];
    return cases.filter((match, i) => linesWith(String(text).slice(match.index, cases[i + 1]?.index), symbol).length).map(match => match[2]);
}

function callsElsewhere(graph, symbol, reaching, idToPath) {
    let count = 0;
    for (const node of graph.nodes.values()) {
        const path = node.path ?? idToPath.get(node.id);
        if (Array.isArray(node.calls) && !reaching.has(path)) count += node.calls.filter(call => call[1] === symbol).length;
    }
    return count;
}

const bindingCounts = (resolved, unresolved) => ({
    resolved, unresolved, ...(resolved === 0 && unresolved > 0 ? { note: `niet bewezen leeg: ${unresolved} plaats(en) noemen de naam zonder gebonden aanroep (dynamisch, of een andere functie met die naam)` } : {})
});

const analyzeFile = (text, path) => (/\.[cm]?jsx?$/i.test(path) ? analyzeSource(text) : analyzeSourceForLanguage(text, path));

const makeEntry = (path, sites, named, max, functions, parseError) => (sites.length
    ? { path, lines: [...new Set(sites.map(call => call[2]))].slice(0, max), ...(functions.length ? { functions } : {}) }
    : { path, lines: named.slice(0, max), ...(parseError ? {} : { reference: true }) });

function getSymbolLines(node, name) {
    const ranges = node?.symbolRanges;
    return ranges ? ranges[name] || null : null;
}

function recordCallee(path, call, symbol, targetOf, byPath, callees) {
    if (call[0] !== symbol) return;
    const target = targetOf(path, call), key = `${call[1]} ${target}`;
    if (!callees.has(key)) callees.set(key, { name: call[1], path: target, lines: getSymbolLines(byPath.get(target), call[1]), at: [] });
    callees.get(key).at.push(call[2]);
}

const provenCallersFirst = (callers) => [...callers].sort((a, b) => Number(Boolean(a.reference)) - Number(Boolean(b.reference)));

function callMatches(call, symbol, defPaths, targetOf, path) {
    if (call[1] !== symbol || call[0] === symbol) return false;
    return defPaths.includes(targetOf(path, call));
}

function matchingSites(file, symbol, defPaths, targetOf, path) {
    if (!file || file.parseError) return [];
    return file.calls.filter(call => callMatches(call, symbol, defPaths, targetOf, path));
}

function namedLines(text, symbol) {
    if (!text) return [];
    const sourceLines = text.split('\n');
    return linesWith(text, symbol).filter(line => !/^\s*import\b/.test(sourceLines[line - 1]));
}

function isIgnored(sites, named, defPaths, path, file, symbol) {
    if (sites.length > 0) return false;
    if (!named.length || defPaths.includes(path)) return true;
    return Boolean(file.symbolRanges?.[symbol]);
}

function handleProvenCaller(path, sites, max, callers) {
    const functions = [...new Set(sites.map(call => call[0]).filter(Boolean))];
    callers.push(makeEntry(path, sites, [], max, functions, false));
    return { resolved: sites.length, unresolved: 0 };
}

function recordCallerOrTest(isTest, entry, text, symbol, tests, callers) {
    if (isTest) tests.push({ ...entry, names: testNames(text, symbol) });
    else callers.push(entry);
}

function handleUnprovenOrTest(opts, sites, isTest) {
    const { path, file, defPaths, symbol, max, callers, tests } = opts;
    const text = file.text;
    if (text == null) return { resolved: sites.length, unresolved: 0 };
    const named = namedLines(text, symbol);
    if (isIgnored(sites, named, defPaths, path, file, symbol)) return { resolved: sites.length, unresolved: 0 };
    const functions = [...new Set(sites.map(call => call[0]).filter(Boolean))];
    recordCallerOrTest(isTest, makeEntry(path, sites, named, max, functions, file.parseError), text, symbol, tests, callers);
    return { resolved: sites.length, unresolved: isTest ? 0 : named.length };
}

function processCaller(opts) {
    const { path, file, defPaths, symbol, targetOf, byPath, max, callers } = opts;
    const sites = matchingSites(file, symbol, defPaths, targetOf, path);
    const isTest = isTestNode(byPath.get(path) ?? { path });
    if (sites.length && !isTest) return handleProvenCaller(path, sites, max, callers);
    if (!file) return { resolved: 0, unresolved: 0 };
    return handleUnprovenOrTest(opts, sites, isTest);
}

function cachedReader(readFile, path) {
    let cached;
    return () => (cached ??= (readFile ? readFile(path) : null));
}

const buildNodeFacts = (node, path, readFile, getText = cachedReader(readFile, path)) => ({
    get text() { return getText(); },
    calls: node.calls, symbolRanges: node.symbolRanges || {},
    ...(Array.isArray(node.functions) ? { functions: node.functions } : {}), parseError: node.parseError || null
});

function buildParsedFacts(path, readFile) {
    const text = readFile ? readFile(path) : null;
    return text == null ? null : { text, ...analyzeFile(text, path) };
}

function edgeMatches(edge, nodeId, defPaths, idToPath, symbol) {
    const match = (id, path) => defPaths.includes(path) || id.includes(symbol);
    if (edge.from === nodeId) return match(edge.to, idToPath.get(edge.to));
    return edge.to === nodeId && match(edge.from, idToPath.get(edge.from));
}

export function functionView(graph, symbol, { readFile, maxSites = MAX_LINES }) {
    const max = Math.max(1, Math.min(Number(maxSites) || MAX_LINES, 200));
    const located = definedIn(graph, symbol).locations;
    const ranged = located.filter(l => Number.isInteger(l.startLine));
    const definitions = ranged.length ? ranged : located.filter(l => !isBarrel(l.path));
    if (!definitions.length) return { symbol, found: false, definitions: [], calls: [], callers: [], tests: [], stories: [] };
    const byPath = new Map([...graph.nodes.values()].filter(node => typeof node.path === 'string').map(node => [node.path, node]));
    const idToPath = new Map([...graph.nodes.values()].map(node => [node.id, node.path]));

    const defPaths = definitions.map(l => l.path);
    const reach = barrelReach(graph, defPaths);
    const users = new Set(graph.edges.map(e => [idToPath.get(e.from), idToPath.get(e.to)]).filter(([f, t]) => f && t && reach.has(t) && !reach.has(f)).map(([f]) => f));

    const facts = new Map();
    const factsOf = (path) => {
        if (!facts.has(path)) {
            const node = byPath.get(path);
            facts.set(path, Array.isArray(node?.calls) ? buildNodeFacts(node, path, readFile) : buildParsedFacts(path, readFile));
        }
        return facts.get(path);
    };
    const lookup = {
        has: (path) => byPath.has(path),
        declares: (path, name) => Boolean(byPath.get(path)?.symbolRanges?.[name]),
        reexports: (path) => graph.edges.filter(edge => idToPath.get(edge.from) === path && edge.type === 'IMPORTS').map(edge => idToPath.get(edge.to)).filter(Boolean)
    };
    const targetOf = (from, [, name, , specifier]) => (specifier ? resolveCallee({ from, name, specifier }, lookup) : from);

    const callees = new Map();
    for (const path of defPaths) {
        for (const call of factsOf(path)?.calls ?? []) recordCallee(path, call, symbol, targetOf, byPath, callees);
    }

    const callers = [], tests = [];
    let resolved = 0, unresolved = 0;
    for (const path of [...new Set([...defPaths, ...users])].sort()) {
        const counts = processCaller({ path, file: factsOf(path), defPaths, symbol, targetOf, byPath, max, callers, tests });
        resolved += counts.resolved;
        unresolved += counts.unresolved;
    }
    const mentions = graph.edges.filter(edge => edge.type === 'MENTIONS');
    const mentioning = new Set(mentions.filter(edge => defPaths.includes(idToPath.get(edge.to))).map(edge => idToPath.get(edge.from)));
    const stories = [...graph.nodes.values()]
        .filter(n => n.type === 'Document' && typeof n.path === 'string' && (!mentions.length || mentioning.has(n.path)))
        .map(n => ({ path: n.path, text: readFile ? readFile(n.path) : null }))
        .filter(d => d.text != null && (linesWith(d.text, symbol).length || defPaths.some(p => d.text.includes(p))))
        .map(d => ({ path: d.path, lines: linesWith(d.text, symbol).slice(0, max) }))
        .sort((a, b) => a.path.localeCompare(b.path));

    const discussions = [...graph.nodes.values()]
        .filter(n => n.type === 'Discussion' && graph.edges.some(edge => edgeMatches(edge, n.id, defPaths, idToPath, symbol)))
        .map(d => ({ id: d.id, title: d.title || d.name || d.id, date: d.date }));

    return {
        symbol, found: true,
        definitions: definitions.map(l => ({ ...l, purpose: docCommentAt(factsOf(l.path)?.text, l.startLine), filePurpose: byPath.get(l.path)?.purpose ?? null })),
        calls: [...callees.values()].map(({ at, ...callee }) => ({ ...callee, at: at.slice(0, max) })),
        callers: provenCallersFirst(callers), tests, stories,
        ...bindingCounts(resolved, unresolved + callsElsewhere(graph, symbol, new Set([...defPaths, ...users]), idToPath)),
        ...classShape(definitions, symbol, [...new Set([...defPaths, ...users])], factsOf),
        parameterSeams: parameterSeams(definitions, symbol, factsOf),
        ...(discussions.length ? { discussions } : {})
    };
}
