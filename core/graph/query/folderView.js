/**
 * The folder view: one answer to "how does folder X work?", in the shape a good explanation has:
 * - parts: its sub-modules (a sub-folder with an index.js, or a loose file), each with its role (the header of its
 *   index.js, else of its most used file) and its key exports;
 * - flow: which part imports or calls which, inside the folder (the arrows of a diagram);
 * - entry: what the folder's own index.js exports, and the package it passes on when it only re-exports one;
 * - usedBy: who uses the folder from outside (through its barrels), grouped by folder, and how many tests reach it;
 * - notClean: health issues of its files (untested, import cycles, boundary violations).
 * Everything comes from the graph and the files; nothing is guessed. Pure apart from the injected readFile.
 */
import { barrelReach } from './impact.js';
import { codeHealth } from './codeHealth.js';

const MAX_EXPORTS = 8, MAX_FLOW = 12, MAX_USERS = 6, MAX_SPEAKERS = 3, MAX_CALLERS = 5;
const MAX_REGISTRATIONS = 4, MAX_EXCERPTS = 2, EXCERPT_LINES = 30, EXCERPT_CHARS = 1400;

/** The first lines of a file, without blank runs, clipped; null when it cannot be read. */
function firstLines(text) {
    if (text == null) return null;
    const lines = String(text).replace(/\r\n?/g, '\n').split('\n').filter((line, i, all) => line.trim() || all[i - 1]?.trim()).slice(0, EXCERPT_LINES);
    const code = lines.join('\n').trimEnd();
    return code.length > EXCERPT_CHARS ? `${code.slice(0, EXCERPT_CHARS)}\n// ...` : code;
}
const isTest = (node) => node.kind === 'test' || node.type === 'Test' || /(^|\/)test\//.test(String(node.path));
const dirOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.');

/** The package a barrel only passes on (`export * from 'lady-lens'`), or null. */
export function reexportedPackage(source) {
    const specifiers = [...String(source ?? '').matchAll(/export\s*\*\s*from\s*['"]([^'"]+)['"]/g)].map(match => match[1]);
    return specifiers.find(specifier => !specifier.startsWith('.')) ?? null;
}

/**
 * @param {Object} graph - graph model (nodes Map, edges array)
 * @param {string} folder - repo-relative folder, e.g. "core/graph"
 * @param {{readFile?: (path: string) => string|null}} [deps]
 */
export function folderView(graph, folder, { readFile = () => null } = {}) {
    const dir = String(folder ?? '').trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
    const all = [...graph.nodes.values()].filter(node => node.type === 'CodeFile' && typeof node.path === 'string');
    const prefix = dir ? `${dir}/` : ''; // the root ("") is a folder too: a package whose main is its root index.js
    const inside = all.filter(node => node.path.startsWith(prefix) && !isTest(node));
    if (!inside.length) return { folder: dir, found: false };
    const byPath = new Map(all.map(node => [node.path, node]));
    const idToPath = new Map([...graph.nodes.values()].map(node => [node.id, node.path]));
    const partOf = (path) => {
        const rest = path.slice(prefix.length);
        return rest.includes('/') ? `${rest.split('/')[0]}/` : rest;
    };

    // in-degree from outside each file's part: the most used file speaks for a part without a header of its own
    const usedCount = new Map();
    for (const edge of graph.edges) {
        const from = idToPath.get(edge.from), to = idToPath.get(edge.to);
        if (to && from && (edge.type === 'IMPORTS' || edge.type === 'CALLS') && to.startsWith(prefix) && (!from.startsWith(prefix) || partOf(from) !== partOf(to))) {
            usedCount.set(to, (usedCount.get(to) || 0) + 1);
        }
    }
    const groups = new Map();
    for (const node of inside) {
        const part = partOf(node.path);
        if (part === 'index.js') continue;
        (groups.get(part) ?? groups.set(part, []).get(part)).push(node);
    }
    const parts = [...groups.entries()].map(([part, nodes]) => {
        const index = part.endsWith('/') ? byPath.get(`${prefix}${part}index.js`) : nodes[0];
        const ranked = [...nodes].sort((a, b) => (usedCount.get(b.path) || 0) - (usedCount.get(a.path) || 0) || a.path.localeCompare(b.path));
        // without a header on its index.js, a part speaks through its most used files (one file says too little about a folder)
        const speakers = index?.purpose ? [index] : ranked.filter(node => node.purpose && !node.path.endsWith('/index.js')).slice(0, MAX_SPEAKERS);
        const exports = Array.isArray(index?.exports) && index.exports.length ? index.exports : ranked.flatMap(node => node.exports ?? []);
        return {
            part, files: nodes.length, lines: nodes.reduce((sum, node) => sum + (Number(node.lines) || 0), 0),
            roles: speakers.map(node => ({ file: node.path.slice(prefix.length + (part.endsWith('/') ? part.length : 0)), purpose: node.purpose })),
            exports: [...new Set(exports)].slice(0, MAX_EXPORTS), exportCount: new Set(exports).size
        };
    }).sort((a, b) => a.part.localeCompare(b.part));

    // the arrows: part -> part inside the folder, per relation type
    const arrows = new Map();
    for (const edge of graph.edges) {
        if (edge.type !== 'IMPORTS' && edge.type !== 'CALLS') continue;
        const from = idToPath.get(edge.from), to = idToPath.get(edge.to);
        if (!from || !to || !from.startsWith(prefix) || !to.startsWith(prefix) || isTest(byPath.get(from) ?? {})) continue;
        const a = partOf(from), b = partOf(to);
        if (a === b || a === 'index.js' || b === 'index.js') continue;
        const key = `${a}|${b}`;
        const arrow = arrows.get(key) ?? { from: a, to: b, imports: 0, calls: 0 };
        if (edge.type === 'IMPORTS') arrow.imports++; else arrow.calls++;
        arrows.set(key, arrow);
    }
    const flow = [...arrows.values()].sort((x, y) => (y.imports + y.calls) - (x.imports + x.calls) || x.from.localeCompare(y.from)).slice(0, MAX_FLOW);

    const entryNode = byPath.get(`${prefix}index.js`);
    const entry = entryNode ? {
        path: entryNode.path, exportCount: (entryNode.exports ?? []).length, exports: (entryNode.exports ?? []).slice(0, MAX_EXPORTS),
        purpose: entryNode.purpose ?? null, package: reexportedPackage(readFile(entryNode.path))
    } : null;

    // who uses the folder from outside: importers of any of its files or barrels above them
    const reach = barrelReach(graph, inside.map(node => node.path));
    const users = new Set(), tests = new Set();
    for (const edge of graph.edges) {
        if (edge.type !== 'IMPORTS' && edge.type !== 'TESTS') continue;
        const from = idToPath.get(edge.from), to = idToPath.get(edge.to);
        if (!from || !to || !reach.has(to) || from.startsWith(prefix) || reach.has(from)) continue;
        (isTest(byPath.get(from) ?? { path: from }) ? tests : users).add(from);
    }
    const byFolder = new Map();
    for (const user of users) byFolder.set(dirOf(user), (byFolder.get(dirOf(user)) || 0) + 1);
    // a graph without any test (e.g. an installed package) knows nothing about tests: say so instead of "untested"
    const testsKnown = all.some(isTest);
    // the files that really CALL into the folder (resolved through barrels), with what they are for and what points at them
    // (e.g. a composition type REGISTERED_IN that file): where the folder is wired in, not just who imports a barrel
    const callSites = new Map();
    for (const edge of graph.edges) {
        if (edge.type !== 'CALLS') continue;
        const from = idToPath.get(edge.from), to = idToPath.get(edge.to);
        if (!from || !to || !to.startsWith(prefix) || from.startsWith(prefix) || isTest(byPath.get(from) ?? { path: from })) continue;
        callSites.set(from, (callSites.get(from) || 0) + (edge.strength ?? edge.weight ?? 1));
    }
    const pointersByTo = new Map();
    for (const edge of graph.edges) {
        const fromNode = graph.nodes.get(edge.from), toPath = idToPath.get(edge.to);
        if (fromNode && !['CodeFile', 'Document'].includes(fromNode.type) && toPath) {
            (pointersByTo.get(toPath) ?? pointersByTo.set(toPath, []).get(toPath)).push({ node: fromNode.name ?? edge.from, type: fromNode.type, relation: edge.type });
        }
    }
    const callers = [...callSites.entries()].map(([path, calls]) => ({ path, calls, purpose: byPath.get(path)?.purpose ?? null, pointedBy: pointersByTo.get(path) || [] }))
        .sort((a, b) => Number(b.pointedBy.length > 0) - Number(a.pointedBy.length > 0) || b.calls - a.calls || a.path.localeCompare(b.path))
        .slice(0, MAX_CALLERS);
    const usedBy = {
        files: users.size, tests: testsKnown ? tests.size : null,
        folders: [...byFolder.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, MAX_USERS).map(([path, count]) => ({ folder: path, files: count })),
        callers
    };

    const health = codeHealth(graph, { readFile, only: inside.map(node => node.path) }).files;
    const notClean = {
        untested: testsKnown ? health.filter(file => file.issues.includes('untested')).map(file => file.path) : null,
        inCycles: health.filter(file => file.inCycle).map(file => file.path),
        boundary: health.filter(file => file.boundaryViolations.length).map(file => file.path)
    };
    // nodes that are not files but are named like the folder (e.g. a composition type "tools.research" for core/agents/tools),
    // with the file they point at: where things of this kind are registered, also when the folder itself is unused
    const base = dir.split('/').pop().toLowerCase();
    const registeredAs = [...graph.nodes.values()]
        .filter(node => !['CodeFile', 'Document', 'Config', 'Decision'].includes(node.type) && String(node.name ?? '').toLowerCase().split('.')[0] === base && base)
        .map(node => ({ name: node.name, type: node.type, description: node.purpose ?? node.documentation ?? null,
            at: graph.edges.filter(edge => edge.from === node.id).map(edge => ({ relation: edge.type, path: idToPath.get(edge.to) })).filter(item => item.path) }))
        .sort((a, b) => a.name.localeCompare(b.name)).slice(0, MAX_REGISTRATIONS);
    const registrationCode = [...new Set(registeredAs.flatMap(item => item.at.map(at => at.path)))].slice(0, MAX_EXCERPTS)
        .map(path => ({ path, code: firstLines(readFile(path)) })).filter(item => item.code);
    return { folder: dir, found: true, files: inside.length, entry, registeredAs, registrationCode, parts, flow, usedBy, notClean };
}

const list = (items, max = 5) => (items.length > max ? `${items.slice(0, max).join(', ')} (+${items.length - max})` : items.join(', '));

/** The view as a text block for a prompt, in the order of a good explanation; clipped to `maxChars` with a note. */
export function renderFolderView(view, { maxChars = 3500 } = {}) {
    if (!view?.found) return '';
    const lines = [`### ${view.folder}/ (${view.files} files, ${view.parts.length} parts)`];
    if (view.entry) {
        lines.push(`Entry: ${view.entry.path}${view.entry.purpose ? ` - ${view.entry.purpose}` : ''}${view.entry.exportCount ? `; exports ${view.entry.exportCount} names (${view.entry.exports.join(', ')})` : ''}`);
        if (view.entry.package) lines.push(`In this repository ${view.folder}/ is only this file: a port that passes on the package "${view.entry.package}" (export * from '${view.entry.package}'). The modules live in that package, not in ${view.folder}/ (shown below when available).`);
    }
    // live 2026-10-30: what was at the bottom (unused, where it is wired in) was read over; it goes first
    if (view.usedBy.files === 0 && !view.entry?.package) lines.push(`Nothing outside ${view.folder}/ uses it at runtime${view.usedBy.tests ? ' (only tests)' : ''}: it looks unused; new code does not go here unless something wires it in.`);
    for (const item of view.registeredAs ?? []) {
        lines.push(`Registered as ${item.type} "${item.name}"${item.at.length ? ` (${item.at.map(at => `${at.relation} ${at.path}`).join(', ')})` : ''}${item.description ? `: ${String(item.description).slice(0, 160)}` : ''}`);
    }
    for (const item of view.registrationCode ?? []) {
        lines.push(`How it is registered (the real start of ${item.path}; follow this pattern):`, '```js', item.code, '```');
    }
    if (view.parts.length) lines.push('', '| part | files | role | key exports |', '|---|---|---|---|');
    for (const part of view.parts) {
        const role = part.roles.length ? part.roles.map(item => `${item.file}: ${item.purpose.slice(0, part.roles.length > 1 ? 90 : 180)}`).join('; ') : '(no header)';
        lines.push(`| ${part.part} | ${part.files} | ${role.replace(/\|/g, '/')} | ${part.exports.join(', ')}${part.exportCount > part.exports.length ? ` (+${part.exportCount - part.exports.length})` : ''} |`);
    }
    if (view.flow.length) {
        lines.push('', 'Flow inside (part -> part it imports/calls):');
        for (const arrow of view.flow) lines.push(`- ${arrow.from} -> ${arrow.to} (${[arrow.imports && `${arrow.imports} imports`, arrow.calls && `${arrow.calls} calls`].filter(Boolean).join(', ')})`);
    }
    const tests = view.usedBy.tests === null ? 'no tests in this graph, so nothing is known about test reach' : `reached by ${view.usedBy.tests} test files`;
    lines.push('', `Used from outside by ${view.usedBy.files} files${view.usedBy.folders.length ? ` (${view.usedBy.folders.map(item => `${item.folder} ${item.files}`).join(', ')})` : ''}; ${tests}.`);
    if (view.usedBy.callers?.length) {
        lines.push('Called from outside by (where it is wired in):');
        for (const caller of view.usedBy.callers) {
            const pointed = caller.pointedBy.length ? `; ${caller.pointedBy.map(item => `${item.type} "${item.node}" ${item.relation}`).join(', ')}` : '';
            lines.push(`- ${caller.path} (${caller.calls} calls)${caller.purpose ? `: ${caller.purpose.slice(0, 200)}` : ''}${pointed}`);
        }
    }
    const issues = [
        view.notClean.untested?.length && `untested: ${list(view.notClean.untested)}`,
        view.notClean.inCycles.length && `in import cycles: ${list(view.notClean.inCycles)}`,
        view.notClean.boundary.length && `imports past a module's index.js: ${list(view.notClean.boundary)}`
    ].filter(Boolean);
    lines.push(issues.length ? `Not clean: ${issues.join('; ')}.` : `Not clean: nothing found (${view.notClean.untested ? 'tests reach every file, ' : ''}no cycles, no boundary violations).`);
    const text = lines.join('\n');
    return text.length > maxChars ? `${text.slice(0, maxChars)}\n... (clipped at ${maxChars} characters)` : text;
}
