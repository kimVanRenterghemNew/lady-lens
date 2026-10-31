/**
 * Architecture & NDepend-style metrics for code health.
 * - Coupling: Afferent Coupling (Ca), Efferent Coupling (Ce), Instability (I = Ce / (Ca + Ce))
 * - Centrality: PageRank over directed dependency edges (IMPORTS, CALLS)
 * - Top Central Nodes: Structural core of the project (highest centrality & Ca)
 * - Zone of Pain: Highly stable/foundational nodes (I < 0.3) with complex functions or missing tests
 */

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
            let incomingSum = 0;
            const ins = inEdges.get(p);
            if (ins) {
                for (const from of ins) {
                    incomingSum += ranks.get(from) / (outDegrees.get(from) || 1);
                }
            }
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

    for (const edge of graph.edges) {
        if (edge.type !== 'IMPORTS' && edge.type !== 'CALLS') continue;
        const from = nodesById.get(edge.from)?.path;
        const to = nodesById.get(edge.to)?.path;
        if (!from || !to || from === to || !allPathSet.has(from) || !allPathSet.has(to)) continue;
        outDep.get(from).add(to);
        inDep.get(to).add(from);
    }

    const centrality = options.skipCentrality ? new Map() : computePageRank(allPaths, outDep, inDep);
    const allComplexFunctions = [];
    const maxInstabilityForPain = Number(options.zoneOfPainInstability || process.env.LENS_ZONE_OF_PAIN_INSTABILITY || 0.3);

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

        const node = nodesByPath.get(entry.path) || nodesByPath.get(entry.path.toLowerCase()) || {};
        const functions = Array.isArray(node.functions) ? node.functions : [];
        const fileComplexFns = functions
            .filter(fn => Array.isArray(fn.issues) && fn.issues.length > 0)
            .map(fn => ({ ...fn, file: entry.path }));

        entry.complexFunctions = fileComplexFns;
        allComplexFunctions.push(...fileComplexFns);

        const isInZoneOfPain = instability < maxInstabilityForPain && ca > 0 &&
            (fileComplexFns.length > 0 || !entry.tested || (entry.untestedExports && entry.untestedExports.length > 0));

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
