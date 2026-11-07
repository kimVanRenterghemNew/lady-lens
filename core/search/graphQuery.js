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
import { rankDocuments } from './docMentions.js';

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
    let startNode;
    if (node) {
        const asImportType = (spec) => (spec && typeof spec === 'object' && isImportEdgeType(spec.type) ? { ...spec, type: IMPORT_EDGE } : spec);
        const importQuery = [incoming, outgoing].some(spec => spec && typeof spec === 'object' && isImportEdgeType(spec.type));
        const chunkId = node.startsWith('chunk:') ? node : `chunk:${node}`;
        startNode = loaded.graph.getNode(node)
            ? node
            : (loaded.graph.getNode(chunkId) ? chunkId : (resolveCodeFile(loaded.graph, node).node?.id ?? node));
        // ids are stored in lower case and getNode ignores case: compare with the stored id, not with what was asked
        startNode = loaded.graph.getNode(startNode)?.id ?? startNode;
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
        const matches = args.kind === 'doc'
            ? rankDocuments(loaded.graph, text, directMatches, { readFile: readRepoFile, limit })
            : Array.from(relatedIds).map(id => loaded.graph.getNode(id)).filter(Boolean).slice(0, limit);
        result = { nodes: matches, edges: loaded.graph.edges.filter(edge => matches.some(match => match.id === edge.from || match.id === edge.to)) };
    }
    const provenance = { source, sessionId, totalNodes: loaded.graph.nodes.size, totalEdges: loaded.graph.edges.length, matchCount: result.nodes.length, freshness, scopes: loaded.scopes };
    const symbols = locateSymbols([...loaded.graph.nodes.values()], text ?? node);
    // node mode: the consequences and risks of the start node, as query mode gives them (only the start: its neighbours are the edges)
    const impactOf = node ? result.nodes.filter(match => match.id === startNode) : result.nodes;
    const impact = fileImpact(loaded.graph, impactOf.filter(match => match.type === 'CodeFile' && match.kind !== 'test').map(match => match.path), { readFile: readRepoFile, coverage: loadCoverage().coverage });
    const nodes = result.nodes.map(match => ({ ...answerNode(match), ...impact.get(match.path), ...(match.mentions ? { mentions: match.mentions } : {}), ...(match.lines ? { lines: match.lines } : {}) }));
    const hop = result.total === undefined ? {} : { total: result.total, truncated: result.truncated, ...(result.truncated ? { hint: `${result.total} neighbours, ${result.nodes.length - 1} shown: raise limit, or ask one edge type (incoming: { type: 'IMPORTS' })` } : {}) };
    return { available: true, sessionId, source, matchCount: result.nodes.length, nodes, edges: result.edges, ...hop, symbols, context, freshness, provenance };
}
