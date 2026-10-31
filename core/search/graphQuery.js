import {
    buildContextFromGraph,
    query as queryGraph,
    isProjectGraphEnabled,
    resolveCodeFile,
    isImportEdgeType,
    locateSymbols,
    IMPORT_EDGE,
    rankGraphNodes,
    answerNode,
    fileImpact
} from '../graph/index.js';
import { loadGraphModel, freshnessFor, readRepoFile, loadCoverage } from './graphModelLoader.js';

const SESSION_ID = /^[a-zA-Z0-9._-]+$/;
const IMPORT_QUERY_LIMIT = 5000;

export async function graph_query(args = {}) {
    const { sessionId = 'default', node, query: text, outgoing, incoming, path: traversalPath, maxDepth, incomingDepth, outgoingDepth, filter, limit = 10, minWeight = 0 } = args;
    if ((node !== undefined && typeof node !== 'string') || (text !== undefined && typeof text !== 'string')) {
        return { error: 'node and query must be strings when provided' };
    }
    if (!node && !text) return { error: 'graph_query requires node or query' };
    if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) {
        return { error: 'sessionId must contain only letters, numbers, dots, dashes, or underscores' };
    }
    let loaded;
    try {
        loaded = await loadGraphModel({ sessionId, text, includeProject: args.projectGraph !== false && isProjectGraphEnabled(), includeDocs: args.includeDocs || args.kind === 'doc', history: args.history === true });
    } catch (error) {
        return { available: false, sessionId, source: 'ladybug', matchCount: 0, nodes: [], edges: [], error: `could not load graph: ${error.message}` };
    }
    const source = loaded.source;
    const freshness = freshnessFor(loaded.graph);
    if (loaded.missing) {
        return {
            available: true, sessionId, source, matchCount: 0, nodes: [], edges: [], context: '', freshness,
            provenance: { source, sessionId, totalNodes: 0, totalEdges: 0, matchCount: 0, freshness, scopes: loaded.scopes }
        };
    }
    let result;
    let context = '';
    if (node) {
        const asImportType = (spec) => (spec && typeof spec === 'object' && isImportEdgeType(spec.type) ? { ...spec, type: IMPORT_EDGE } : spec);
        const importQuery = [incoming, outgoing].some(spec => spec && typeof spec === 'object' && isImportEdgeType(spec.type));
        const chunkId = node.startsWith('chunk:') ? node : `chunk:${node}`;
        const startNode = loaded.graph.getNode(node)
            ? node
            : (loaded.graph.getNode(chunkId) ? chunkId : (resolveCodeFile(loaded.graph, node).node?.id ?? node));
        try {
            result = queryGraph(loaded.graph, {
                node: startNode, outgoing: asImportType(outgoing), incoming: asImportType(incoming), path: traversalPath, maxDepth, incomingDepth, outgoingDepth, filter,
                limit: importQuery ? Math.max(limit, IMPORT_QUERY_LIMIT) : limit, minWeight
            });
        } catch (error) {
            return { error: `invalid graph query: ${error.message}` };
        }
    } else {
        context = await buildContextFromGraph(loaded.graph, text, { limit });
        const directMatches = rankGraphNodes(loaded.graph, text, { limit, kind: args.kind }).map(e => e.node);
        const relatedIds = new Set(directMatches.map(match => match.id));
        for (const edge of args.kind === 'doc' ? [] : loaded.graph.edges) {
            if (String(edge.type).toLowerCase() === 'imports') continue;
            if (relatedIds.has(edge.from)) relatedIds.add(edge.to);
            if (relatedIds.has(edge.to)) relatedIds.add(edge.from);
        }
        const matches = Array.from(relatedIds).map(id => loaded.graph.getNode(id)).filter(Boolean).slice(0, limit);
        result = { nodes: matches, edges: loaded.graph.edges.filter(edge => matches.some(match => match.id === edge.from || match.id === edge.to)) };
    }
    const provenance = { source, sessionId, totalNodes: loaded.graph.nodes.size, totalEdges: loaded.graph.edges.length, matchCount: result.nodes.length, freshness, scopes: loaded.scopes };
    const symbols = locateSymbols([...loaded.graph.nodes.values()], text ?? node);
    const impact = node ? new Map() : fileImpact(loaded.graph, result.nodes.filter(match => match.type === 'CodeFile' && match.kind !== 'test').map(match => match.path), { readFile: readRepoFile, coverage: loadCoverage().coverage });
    const nodes = result.nodes.map(match => ({ ...answerNode(match), ...impact.get(match.path) }));
    return { available: true, sessionId, source, matchCount: result.nodes.length, nodes, edges: result.edges, symbols, context, freshness, provenance };
}
