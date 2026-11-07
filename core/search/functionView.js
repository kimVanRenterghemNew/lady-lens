// TODO(coverage): Current line coverage is 0% (< 85% target). Raise to >= 85%.
import { createGraph, functionView, createGraphRepository } from '../graph/index.js';
import { refreshProjectGraph, readRepoFile } from './graphModelLoader.js';

/** functionView of one symbol on the small subgraph Ladybug returns for it; null when the graph does not know the symbol. */
export async function viewOf(repository, symbol, { maxSites, readFile = readRepoFile } = {}) {
    const sub = await repository.directFunctionViewGraph(symbol);
    if (!sub.nodes.length) return null;
    const graph = createGraph('functionView');
    for (const { id, type, ...data } of sub.nodes) graph.addNode(id, type, data);
    for (const edge of sub.edges) graph.addEdge(edge.from, edge.to, edge.type, { weight: edge.weight ?? 1, strength: edge.weight });
    return functionView(graph, symbol, { readFile, maxSites });
}

export async function functionViewTool(args, { refresh = refreshProjectGraph } = {}) {
    const { symbol, maxSites } = args ?? {};
    if (typeof symbol !== 'string' || !symbol.trim()) {
        return { error: 'symbol is required (an identifier, e.g. "applyAnswers")' };
    }
    const freshness = await refresh();
    const view = await viewOf(createGraphRepository(), symbol.trim(), { maxSites });
    if (!view) {
        return {
            relation: 'functionView',
            symbol: symbol.trim(),
            found: false,
            definitions: [],
            calls: [],
            callers: [],
            tests: [],
            stories: [],
            source: 'ladybug',
            freshness
        };
    }
    return { relation: 'functionView', ...view, source: 'ladybug', freshness };
}
