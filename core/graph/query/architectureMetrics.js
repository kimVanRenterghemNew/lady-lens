/**
 * Architecture & NDepend-style metrics for code health.
 * - Coupling: Afferent Coupling (Ca), Efferent Coupling (Ce), Instability (I = Ce / (Ca + Ce))
 * - Centrality: PageRank over directed dependency edges (IMPORTS, CALLS)
 * - Top Central Nodes: Structural core of the project (highest centrality & Ca)
 * - Zone of Pain: Highly stable/foundational nodes (I < 0.3) with complex functions or missing tests
 */
import { isBarrelPath } from '../model/index.js';

function computeIncomingSum(ins, ranks, outDegrees) {
    if (!ins) return 0;
    let sum = 0;
    for (const from of ins) sum += ranks.get(from) / (outDegrees.get(from) || 1);
    return sum;
}

function computePageRank(paths, outEdges, inEdges, iterations = 15, damping = 0.85) {
    const n = paths.length;
    if (n === 0) return new Map();
    let ranks = new Map(paths.map(p => [p, 1 / n]));

    const sinkPaths = paths.filter(p => (outEdges.get(p)?.size || 0) === 0);
    const outDegrees = new Map(paths.map(p => [p, outEdges.get(p)?.size || 1]));

    for (let iter = 0; iter < iterations; iter++) {
        const nextRanks = new Map();
        let sinkRankSum = 0;
        for (const p of sinkPaths) {
            sinkRankSum += ranks.get(p);
        }

        const baseRank = (1 - damping) / n + damping * (sinkRankSum / n);
        for (const p of paths) {
            const incomingSum = computeIncomingSum(inEdges.get(p), ranks, outDegrees);
            nextRanks.set(p, baseRank + damping * incomingSum);
        }
        ranks = nextRanks;
    }

    let maxRank = 0;
    for (const r of ranks.values()) if (r > maxRank) maxRank = r;
    const normalized = new Map();
    for (const [p, r] of ranks) {
        normalized.set(p, maxRank > 0 ? Number((r / maxRank).toFixed(4)) : 0);
    }
    return normalized;
}

const HEAVY_ISSUES = new Set(['high-cyclomatic-complexity', 'large-function', 'too-many-params']);

function isHeavyFunction(fn, maxCc) {
    if (fn.cyclomaticComplexity > maxCc) return true;
    if (!Array.isArray(fn.issues)) return false;
    return fn.issues.some(i => HEAVY_ISSUES.has(i));
}

function isArchEdge(type) {
    return type === 'IMPORTS' || type === 'CALLS';
}

function isValidEndpoint(from, to, allPathSet) {
    if (!from || !to || from === to) return false;
    return allPathSet.has(from) && allPathSet.has(to);
}

function recordArchEdge(edge, nodesById, allPathSet, outDep, inDep) {
    if (!isArchEdge(edge.type)) return;
    const from = nodesById.get(edge.from)?.path;
    const to = nodesById.get(edge.to)?.path;
    if (isValidEndpoint(from, to, allPathSet)) {
        outDep.get(from).add(to);
        inDep.get(to).add(from);
    }
}

function nodeForPath(nodesByPath, path) {
    return nodesByPath.get(path) || nodesByPath.get(path.toLowerCase()) || {};
}

function complexFunctionsForNode(node, path) {
    const raw = Array.isArray(node.functions) ? node.functions : (node.metadata?.functions || []);
    return raw
        .filter(fn => (Array.isArray(fn.issues) && fn.issues.length) || (Array.isArray(fn.smells) && fn.smells.length))
        .map(fn => ({ ...fn, file: path }));
}

function smellsForNode(node) {
    return Array.isArray(node.fileSmells) ? node.fileSmells : (node.metadata?.fileSmells || []);
}

const maxCcOf = options => Number(options.maxCc ?? (process.env.LENS_MAX_CYCLOMATIC_COMPLEXITY || 15));

export function calculateArchitectureMetrics(graph, fileEntries, options = {}) {
    const allCodeNodes = [...graph.nodes.values()].filter(node => node.type === 'CodeFile' && typeof node.path === 'string');
    const nodesById = graph.nodes;
    const nodesByPath = new Map();
    for (const node of graph.nodes.values()) {
        if (node.path) {
            nodesByPath.set(node.path, node);
            nodesByPath.set(node.path.toLowerCase(), node);
        }
    }
    const allPaths = allCodeNodes.map(n => n.path);
    const allPathSet = new Set(allPaths);

    const outDep = new Map(allPaths.map(p => [p, new Set()]));
    const inDep = new Map(allPaths.map(p => [p, new Set()]));

    graph.edges.forEach(edge => recordArchEdge(edge, nodesById, allPathSet, outDep, inDep));

    const centrality = options.skipCentrality ? new Map() : computePageRank(allPaths, outDep, inDep);
    const allComplexFunctions = [];
    const maxInstabilityForPain = Number(options.zoneOfPainInstability ?? (process.env.LENS_ZONE_OF_PAIN_INSTABILITY || 0.3));
    const maxCc = maxCcOf(options);

    for (const entry of fileEntries) {
        const ca = inDep.get(entry.path)?.size || 0;
        const ce = outDep.get(entry.path)?.size || 0;
        const total = ca + ce;
        const instability = total > 0 ? Number((ce / total).toFixed(3)) : 0.0;
        const score = centrality.get(entry.path) || 0.0;

        entry.afferentCoupling = ca;
        entry.efferentCoupling = ce;
        entry.instability = instability;
        entry.centralityScore = score;

        const node = nodeForPath(nodesByPath, entry.path);
        const fileComplexFns = complexFunctionsForNode(node, entry.path);
        entry.fileSmells = smellsForNode(node);
        entry.complexFunctions = fileComplexFns;
        allComplexFunctions.push(...fileComplexFns);

        // stable and depended on, and hard to change: heavy complex (CC > 15, large function, etc., but not norm CC 6-15) or not covered by tests. A barrel holds no code to change.
        const hasHeavyFunction = fileComplexFns.some(fn => isHeavyFunction(fn, maxCc));
        const isInZoneOfPain = instability < maxInstabilityForPain && ca > 0 && !isBarrelPath(entry.path) &&
            (hasHeavyFunction || !entry.tested || entry.issues.includes('untested-exports') || entry.issues.includes('low-coverage'));

        if (isInZoneOfPain && !entry.issues.includes('zone-of-pain')) {
            entry.issues.push('zone-of-pain');
        }
    }

    allComplexFunctions.sort((a, b) => b.cyclomaticComplexity - a.cyclomaticComplexity || b.lines - a.lines);

    const topCentralNodes = [...fileEntries]
        .sort((a, b) => b.centralityScore - a.centralityScore || b.afferentCoupling - a.afferentCoupling || b.lines - a.lines)
        .slice(0, 5)
        .map(({ path, centralityScore, afferentCoupling, efferentCoupling, instability, lines }) => ({
            path, centralityScore, afferentCoupling, efferentCoupling, instability, lines
        }));

    const zoneOfPain = fileEntries
        .filter(e => e.issues.includes('zone-of-pain'))
        .sort((a, b) => b.centralityScore - a.centralityScore || b.afferentCoupling - a.afferentCoupling)
        .map(({ path, centralityScore, afferentCoupling, efferentCoupling, instability, lines, complexFunctions: fns }) => ({
            path, centralityScore, afferentCoupling, efferentCoupling, instability, lines, complexFunctionCount: fns.length
        }));

    return {
        topCentralNodes,
        zoneOfPain,
        complexFunctions: allComplexFunctions
    };
}
