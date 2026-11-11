/**
 * The folder view: explains a folder's parts, flow, entry, users, and health.
 */
import { barrelReach } from './impact.js';
import { codeHealth } from './codeHealth.js';
import {
    NON_POINTER_TYPES,
    isTest,
    dirOf,
    firstLines,
    reexportedPackage,
    normalizeFolderDir,
    resolvePartOf,
    isInternalFlowEdge,
    isDistinctPart,
    isExternalReachEdge,
    isExternalCallEdge,
    isRegisteredNode
} from './folderPredicates.js';
import { buildParts, buildEntry } from './folderParts.js';

export { reexportedPackage };
export { renderFolderView } from './folderViewRender.js';

const MAX_FLOW = 12, MAX_USERS = 6, MAX_CALLERS = 5;
const MAX_REGISTRATIONS = 4, MAX_EXCERPTS = 2;

function recordFlowEdge(arrows, edge, a, b) {
    const key = `${a}|${b}`;
    const arrow = arrows.get(key) || { from: a, to: b, imports: 0, calls: 0 };
    if (edge.type === 'IMPORTS') arrow.imports++;
    if (edge.type === 'CALLS') arrow.calls++;
    arrows.set(key, arrow);
}

function processInternalFlowEdge(edge, idToPath, byPath, prefix, partOf, arrows) {
    const from = idToPath.get(edge.from);
    const to = idToPath.get(edge.to);
    if (!isInternalFlowEdge(edge, from, to, prefix, isTest(byPath.get(from) || {}))) return;
    const a = partOf(from);
    const b = partOf(to);
    if (!isDistinctPart(a, b)) return;
    recordFlowEdge(arrows, edge, a, b);
}

function calculateInternalFlow(edges, idToPath, byPath, prefix, partOf) {
    const arrows = new Map();
    edges.forEach(edge => processInternalFlowEdge(edge, idToPath, byPath, prefix, partOf, arrows));
    return [...arrows.values()]
        .sort((x, y) => (y.imports + y.calls) - (x.imports + x.calls) || x.from.localeCompare(y.from))
        .slice(0, MAX_FLOW);
}

function recordUserOrTest(from, byPath, users, tests) {
    const node = byPath.get(from) || { path: from };
    if (isTest(node)) {
        tests.add(from);
        return;
    }
    users.add(from);
}

function processReachEdge(edge, idToPath, prefix, reach, byPath, users, tests) {
    const from = idToPath.get(edge.from);
    const to = idToPath.get(edge.to);
    if (isExternalReachEdge(edge, from, to, prefix, reach)) {
        recordUserOrTest(from, byPath, users, tests);
    }
}

function collectUsersAndTests(edges, idToPath, byPath, prefix, reach) {
    const users = new Set(), tests = new Set();
    edges.forEach(edge => processReachEdge(edge, idToPath, prefix, reach, byPath, users, tests));
    return { users, tests };
}

function resolveCallWeight(edge) {
    if (edge.strength) return edge.strength;
    return edge.weight || 1;
}

function processCallSiteEdge(edge, idToPath, byPath, prefix, callSites) {
    const from = idToPath.get(edge.from);
    const to = idToPath.get(edge.to);
    const fromNode = byPath.get(from) || { path: from };
    if (!isExternalCallEdge(edge, from, to, prefix, isTest(fromNode))) return;
    const prev = callSites.get(from) || 0;
    callSites.set(from, prev + resolveCallWeight(edge));
}

function collectCallSites(edges, idToPath, byPath, prefix) {
    const callSites = new Map();
    edges.forEach(edge => processCallSiteEdge(edge, idToPath, byPath, prefix, callSites));
    return callSites;
}

function recordPointer(pointersByTo, toPath, fromNode, edgeType) {
    const list = pointersByTo.get(toPath) || [];
    if (!pointersByTo.has(toPath)) pointersByTo.set(toPath, list);
    list.push({ node: fromNode.name || fromNode.id, type: fromNode.type, relation: edgeType });
}

function processPointerEdge(edge, graph, idToPath, pointersByTo) {
    const fromNode = graph.nodes.get(edge.from);
    const toPath = idToPath.get(edge.to);
    if (!fromNode || !toPath) return;
    if (NON_POINTER_TYPES.has(fromNode.type)) return;
    recordPointer(pointersByTo, toPath, fromNode, edge.type);
}

function collectPointersByTo(graph, idToPath) {
    const pointersByTo = new Map();
    graph.edges.forEach(edge => processPointerEdge(edge, graph, idToPath, pointersByTo));
    return pointersByTo;
}

function buildCallers(callSites, byPath, pointersByTo) {
    return [...callSites.entries()]
        .map(([path, calls]) => ({ path, calls, purpose: byPath.get(path)?.purpose || null, pointedBy: pointersByTo.get(path) || [] }))
        .sort((a, b) => Number(b.pointedBy.length > 0) - Number(a.pointedBy.length > 0) || b.calls - a.calls || a.path.localeCompare(b.path))
        .slice(0, MAX_CALLERS);
}

function buildUsedBy(graph, inside, idToPath, byPath, prefix, all) {
    const reach = barrelReach(graph, inside.map(node => node.path));
    const { users, tests } = collectUsersAndTests(graph.edges, idToPath, byPath, prefix, reach);
    const byFolder = new Map();
    for (const user of users) {
        const dir = dirOf(user);
        byFolder.set(dir, (byFolder.get(dir) || 0) + 1);
    }
    const folders = [...byFolder.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, MAX_USERS).map(([path, count]) => ({ folder: path, files: count }));
    const callSites = collectCallSites(graph.edges, idToPath, byPath, prefix);
    const pointersByTo = collectPointersByTo(graph, idToPath);
    const callers = buildCallers(callSites, byPath, pointersByTo);
    return { files: users.size, tests: all.some(isTest) ? tests.size : null, folders, callers };
}

function buildRegistrations(graph, dir, idToPath, readFile) {
    const base = dir.split('/').pop().toLowerCase();
    const registeredAs = [...graph.nodes.values()]
        .filter(node => isRegisteredNode(node, base))
        .map(node => ({
            name: node.name, type: node.type,
            description: node.purpose || node.documentation || null,
            at: graph.edges.filter(edge => edge.from === node.id).map(edge => ({ relation: edge.type, path: idToPath.get(edge.to) })).filter(item => item.path)
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, MAX_REGISTRATIONS);

    const paths = [...new Set(registeredAs.flatMap(item => item.at.map(at => at.path)))].slice(0, MAX_EXCERPTS);
    const registrationCode = paths.map(path => ({ path, code: firstLines(readFile(path)) })).filter(item => item.code);
    return { registeredAs, registrationCode };
}

function buildNotClean(graph, inside, readFile, testsKnown) {
    const health = codeHealth(graph, { readFile, only: inside.map(node => node.path) }).files;
    return {
        untested: testsKnown ? health.filter(file => file.issues.includes('untested')).map(file => file.path) : null,
        inCycles: health.filter(file => file.inCycle).map(file => file.path),
        boundary: health.filter(file => file.boundaryViolations.length).map(file => file.path)
    };
}

/**
 * @param {Object} graph - graph model (nodes Map, edges array)
 * @param {string} folder - repo-relative folder, e.g. "core/graph"
 * @param {{readFile?: (path: string) => string|null}} [deps]
 */
export function folderView(graph, folder, deps) {
    const readFile = deps?.readFile || (() => null);
    const dir = normalizeFolderDir(folder);
    const all = [...graph.nodes.values()].filter(node => node.type === 'CodeFile' && typeof node.path === 'string');
    const prefix = dir ? `${dir}/` : '';
    const inside = all.filter(node => node.path.startsWith(prefix) && !isTest(node));
    if (!inside.length) return { folder: dir, found: false };

    const byPath = new Map(all.map(node => [node.path, node]));
    const idToPath = new Map([...graph.nodes.values()].map(node => [node.id, node.path]));
    const partOf = (path) => resolvePartOf(path, prefix);

    const parts = buildParts(inside, graph.edges, idToPath, byPath, prefix, partOf);
    const flow = calculateInternalFlow(graph.edges, idToPath, byPath, prefix, partOf);
    const entry = buildEntry(byPath, prefix, readFile);
    const usedBy = buildUsedBy(graph, inside, idToPath, byPath, prefix, all);
    const notClean = buildNotClean(graph, inside, readFile, all.some(isTest));
    const { registeredAs, registrationCode } = buildRegistrations(graph, dir, idToPath, readFile);

    return { folder: dir, found: true, files: inside.length, entry, registeredAs, registrationCode, parts, flow, usedBy, notClean };
}
