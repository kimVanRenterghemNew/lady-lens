/**
 * the function view. One answer to "what does X do and what are its tests": where X is defined (lines),
 * what its file is for, who uses it, which tests use it, which documents name it. Targeted: only files that reach the
 * definition through the import graph AND name X; nothing else of the file.
 *
 * Tests and callers import a module through its index.js, so "reaches" follows barrels: the definition file plus every
 * index.js that (transitively) imports one of those. Callers and callees are parsed call sites (acorn, resolved through
 * barrels like the CALLS relations of the sync); a file that only names X without calling it (a callback, a mock) is
 * listed with `reference: true`, and a file that does not parse falls back to the lines that name X.
 */
import { definedIn } from './importLookup.js';
import { barrelReach } from './impact.js';
import { analyzeSource, analyzeSourceForLanguage } from '../sync/index.js';
import { resolveCallee } from '../model/index.js';

const isTestNode = (node) => node.kind === 'test' || node.type === 'Test' || /(^|\/)test\//.test(String(node.path));
const isBarrel = (path) => /(^|\/)index\.[cm]?js$/.test(path);
const MAX_LINES = 5;

/** 1-based line numbers where `symbol` occurs as a whole word. */
function linesWith(text, symbol) {
    const word = new RegExp(`(^|[^\\w$])${symbol.replace(/[$]/g, '\\$')}(?![\\w$])`);
    return String(text).split('\n').flatMap((line, index) => (word.test(line) ? [index + 1] : []));
}

/** Titles of it()/test() cases whose block (up to the next case) names the symbol; test titles describe behaviour, not names. */
function testNames(text, symbol) {
    const cases = [...String(text).matchAll(/\b(?:it|test)\(\s*(['"`])((?:(?!\1).)*)\1/g)];
    return cases.filter((match, i) => linesWith(String(text).slice(match.index, cases[i + 1]?.index), symbol).length).map(match => match[2]);
}

/** Parsed call sites named `symbol` in files that do not reach the definition: another function with that name, or unbound. */
function callsElsewhere(graph, symbol, reaching, idToPath) {
    let count = 0;
    for (const node of graph.nodes.values()) {
        const path = node.path ?? idToPath.get(node.id);
        if (Array.isArray(node.calls) && !reaching.has(path)) count += node.calls.filter(call => call[1] === symbol).length;
    }
    return count;
}

/** Bound call sites against places that only name X; no bound caller while names exist is not proof that nobody calls X. */
function bindingCounts(resolved, unresolved) {
    return { resolved, unresolved, ...(resolved === 0 && unresolved > 0 ? { note: `niet bewezen leeg: ${unresolved} plaats(en) noemen de naam zonder gebonden aanroep (dynamisch, of een andere functie met die naam)` } : {}) };
}

/** For a class: the functions inside its lines (`children`) and the classes that extend it (`inheritors`); nothing for a function. */
function classShape(definitions, symbol, paths, factsOf) {
    const children = definitions.filter(location => Number.isInteger(location.startLine)).flatMap(({ path, startLine, endLine }) => {
        const file = factsOf(path);
        const functions = file == null ? [] : (Array.isArray(file.functions) ? file.functions : analyzeFile(file.text, path).functions || []);
        // acorn gives `loc`, the other language parsers `startLine`/`endLine`
        const lines = fn => fn.loc || [fn.startLine, fn.endLine];
        return functions.filter(fn => fn.name !== symbol && lines(fn)[0] > startLine && lines(fn)[1] <= endLine).map(fn => ({ name: fn.name, path, line: lines(fn)[0] }));
    });
    // JS/TS/Java `extends X`, C# `: X`, Python `(X)`
    const extendsX = new RegExp(String.raw`\bclass\s+([\w$]+)[^{\n]*?(?:extends|:|\()\s*(?:[\w$]+\.)*` + symbol.replace(/[$]/g, '\\$') + String.raw`(?![\w$])`, 'g');
    const inheritors = paths.flatMap(path => {
        const text = factsOf(path)?.text ?? '';
        return [...text.matchAll(extendsX)].filter(match => match[1] !== symbol).map(match => ({ name: match[1], path, line: text.slice(0, match.index).split('\n').length }));
    });
    return { ...(children.length ? { children } : {}), ...(inheritors.length ? { inheritors } : {}) };
}

const analyzeFile = (text, path) => (/\.[cm]?jsx?$/i.test(path) ?analyzeSource(text) : analyzeSourceForLanguage(text, path));

/**
 * @param {Object} graph - graph model (nodes Map, edges array)
 * @param {string} symbol
 * @param {{readFile: (path: string) => string|null, maxSites?: number}} deps - repo-relative read (null when unreadable);
 *   `maxSites`: lines per caller, test and story (default 5, at most 200)
 */
const makeEntry = (path, sites, named, max, functions, parseError) => (sites.length
    ? { path, lines: [...new Set(sites.map(call => call[2]))].slice(0, max), ...(functions.length ? { functions } : {}) }
    : { path, lines: named.slice(0, max), ...(parseError ? {} : { reference: true }) });

function getSymbolLines(byPath, target, name) {
    const node = byPath.get(target);
    return node && node.symbolRanges ? node.symbolRanges[name] || null : null;
}

function recordCallee(path, call, symbol, targetOf, byPath, callees) {
    if (call[0] !== symbol) return;
    const target = targetOf(path, call);
    const key = `${call[1]} ${target}`;
    if (!callees.has(key)) {
        callees.set(key, { name: call[1], path: target, lines: getSymbolLines(byPath, target, call[1]), at: [] });
    }
    callees.get(key).at.push(call[2]);
}

function dispatchCallerEntry(isTest, entry, fileText, symbol, tests, callers) {
    if (isTest) {
        tests.push({ ...entry, names: testNames(fileText, symbol) });
        return;
    }
    callers.push(entry);
}

export function functionView(graph, symbol, { readFile, maxSites = MAX_LINES }) {
    const max = Math.max(1, Math.min(Number(maxSites) || MAX_LINES, 200));
    const empty = { symbol, found: false, definitions: [], calls: [], callers: [], tests: [], stories: [] };
    const located = definedIn(graph, symbol).locations;
    const ranged = located.filter(location => Number.isInteger(location.startLine));
    const definitions = (ranged.length ? ranged : located.filter(location => !isBarrel(location.path)));
    if (!definitions.length) return empty;
    const byPath = new Map([...graph.nodes.values()].filter(node => typeof node.path === 'string').map(node => [node.path, node]));
    const idToPath = new Map([...graph.nodes.values()].map(node => [node.id, node.path]));

    const reach = barrelReach(graph, definitions.map(location => location.path));
    const users = new Set();
    for (const edge of graph.edges) {
        const from = idToPath.get(edge.from), to = idToPath.get(edge.to);
        if (from && to && reach.has(to) && !reach.has(from)) users.add(from);
    }

    const facts = new Map();
    const factsOf = (path) => {
        if (!facts.has(path)) {
            const node = byPath.get(path);
            const text = readFile(path);
            if (node && Array.isArray(node.calls)) {
                facts.set(path, text == null ? null : {
                    text,
                    calls: node.calls,
                    symbolRanges: node.symbolRanges || {},
                    ...(Array.isArray(node.functions) ? { functions: node.functions } : {}),
                    parseError: node.parseError || null
                });
            } else {
                const analyzed = text == null ? null : (/\.[cm]?jsx?$/i.test(path) ? analyzeSource(text) : analyzeSourceForLanguage(text, path));
                facts.set(path, text == null ? null : { text, ...analyzed });
            }
        }
        return facts.get(path);
    };
    const lookup = {
        has: (path) => byPath.has(path),
        declares: (path, name) => Boolean(byPath.get(path)?.symbolRanges?.[name]),
        reexports: (path) => graph.edges.filter(edge => idToPath.get(edge.from) === path && edge.type === 'IMPORTS').map(edge => idToPath.get(edge.to)).filter(Boolean)
    };
    const defPaths = definitions.map(location => location.path);
    const targetOf = (from, [, name, , specifier]) => (specifier ? resolveCallee({ from, name, specifier }, lookup) : from);

    // What X calls: the call sites inside X's own body, each resolved to the file that defines the callee.
    const callees = new Map();
    for (const path of defPaths) {
        for (const call of factsOf(path)?.calls ?? []) {
            recordCallee(path, call, symbol, targetOf, byPath, callees);
        }
    }

    const callers = [], tests = [];
    let resolved = 0, unresolved = 0;
    for (const path of [...new Set([...defPaths, ...users])].sort()) {
        const file = factsOf(path);
        if (file == null) continue;
        const sites = file.parseError ? [] : file.calls.filter(call => call[1] === symbol && defPaths.includes(targetOf(path, call)) && call[0] !== symbol);
        const sourceLines = file.text.split('\n');
        const named = linesWith(file.text, symbol).filter(line => !/^\s*import\b/.test(sourceLines[line - 1]));
        const isTest = isTestNode(byPath.get(path) ?? { path });
        resolved += sites.length;
        const isSelf = !sites.length && (defPaths.includes(path) || !named.length || file.symbolRanges?.[symbol]);
        if (!isSelf) {
            const functions = [...new Set(sites.map(call => call[0]).filter(Boolean))];
            const entry = makeEntry(path, sites, named, max, functions, file.parseError);
            unresolved += !sites.length ? named.length : 0;
            dispatchCallerEntry(isTest, entry, file.text, symbol, tests, callers);
        }
    }
    // Only the documents that MENTION a definition file are read; a graph synced before MENTIONS existed has none, then all are.
    const mentions = graph.edges.filter(edge => edge.type === 'MENTIONS');
    const mentioning = new Set(mentions.filter(edge => defPaths.includes(idToPath.get(edge.to))).map(edge => idToPath.get(edge.from)));
    const stories = [...graph.nodes.values()]
        .filter(node => node.type === 'Document' && typeof node.path === 'string' && (!mentions.length || mentioning.has(node.path)))
        .map(node => ({ path: node.path, text: readFile(node.path) }))
        .filter(doc => doc.text != null && (linesWith(doc.text, symbol).length || defPaths.some(path => doc.text.includes(path))))
        .map(doc => ({ path: doc.path, lines: linesWith(doc.text, symbol).slice(0, max) }))
        .sort((a, b) => a.path.localeCompare(b.path));

    const discussions = [...graph.nodes.values()]
        .filter(node => node.type === 'Discussion' && graph.edges.some(edge =>
            (edge.from === node.id && (defPaths.includes(idToPath.get(edge.to)) || edge.to.includes(symbol))) ||
            (edge.to === node.id && (defPaths.includes(idToPath.get(edge.from)) || edge.from.includes(symbol)))
        ))
        .map(disc => ({ id: disc.id, title: disc.title || disc.name || disc.id, date: disc.date }));

    return {
        symbol, found: true,
        definitions: definitions.map(location => ({ ...location, purpose: byPath.get(location.path)?.purpose ?? null })),
        calls: [...callees.values()].map(({ at, ...callee }) => ({ ...callee, at: at.slice(0, max) })),
        callers, tests, stories,
        ...bindingCounts(resolved, unresolved + callsElsewhere(graph, symbol, new Set([...defPaths, ...users]), idToPath)),
        ...classShape(definitions, symbol, [...new Set([...defPaths, ...users])], factsOf),
        ...(discussions.length ? { discussions } : {})
    };
}
