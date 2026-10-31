// TODO(coverage): Current line coverage is 0% (< 85% target). Raise to >= 85%.
import { createGraph, functionView, createGraphRepository } from '../graph/index.js';
import { refreshProjectGraph, readRepoFile } from './graphModelLoader.js';

export async function functionViewTool(args, { refresh = refreshProjectGraph } = {}) {
    const { symbol } = args ?? {};
    if (typeof symbol !== 'string' || !symbol.trim()) {
        return { error: 'symbol is required (an identifier, e.g. "applyAnswers")' };
    }
    const freshness = await refresh();
    const repository = createGraphRepository();
    const sub = await repository.directFunctionViewGraph(symbol.trim());
    if (!sub.nodes.length) {
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
    const graph = createGraph('functionView');
    for (const { id, type, ...data } of sub.nodes) graph.addNode(id, type, data);
    for (const edge of sub.edges) graph.addEdge(edge.from, edge.to, edge.type, { weight: edge.weight ?? 1, strength: edge.weight });
    return {
        relation: 'functionView',
        ...functionView(graph, symbol.trim(), { readFile: readRepoFile }),
        source: 'ladybug',
        freshness
    };
}
