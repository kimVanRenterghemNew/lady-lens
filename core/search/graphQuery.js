import {
    buildContextFromGraph,
    query as queryGraph,
    isProjectGraphEnabled,
    resolveCodeFile,
    isImportEdgeType,
    locateSymbols,
    IMPORT_EDGE,
    rankGraphNodes,
    nodeMatchesKind,
    answerNode,
    fileImpact
} from '../graph/index.js';
import { loadGraphModel, freshnessFor, readRepoFile, loadCoverage } from './graphModelLoader.js';
import { rankDocuments } from './docMentions.js';
import { validateQueryArgs, normalizeQueryArgs } from './graphQueryArgs.js';

const IMPORT_QUERY_LIMIT = 5000;

function connectEdge(edge, relatedIds) {
    if (String(edge.type).toLowerCase() === 'imports') return;
    if (relatedIds.has(edge.from)) relatedIds.add(edge.to);
    if (relatedIds.has(edge.to)) relatedIds.add(edge.from);
}

function expandRelatedEdges(edges, relatedIds) {
    edges.forEach(edge => connectEdge(edge, relatedIds));
}

function resolveChunkId(node) {
    return node.startsWith('chunk:') ? node : `chunk:${node}`;
}

function findNodeInGraph(graph, node) {
    const direct = graph.getNode(node);
    if (direct) return direct.id;
    const chunk = graph.getNode(resolveChunkId(node));
    if (chunk) return chunk.id;
    const resolved = resolveCodeFile(graph, node).node;
    if (resolved) return resolved.id;
    return node;
}

function resolveStartNode(graph, node) {
    const candidate = findNodeInGraph(graph, node);
    const stored = graph.getNode(candidate);
    return stored ? stored.id : candidate;
}

function isImportSpec(spec) {
    if (!spec || typeof spec !== 'object') return false;
    return isImportEdgeType(spec.type);
}

function asImportType(spec) {
    if (isImportSpec(spec)) return { ...spec, type: IMPORT_EDGE };
    return spec;
}

function isImportQuery(incoming, outgoing) {
    return isImportSpec(incoming) || isImportSpec(outgoing);
}

function executeNodeQuery(graph, args, startNode) {
    const { incoming, outgoing, path: traversalPath, maxDepth, incomingDepth, outgoingDepth, filter, limit = 10, minWeight = 0 } = args;
    const effectiveLimit = isImportQuery(incoming, outgoing) ? Math.max(limit, IMPORT_QUERY_LIMIT) : limit;
    return queryGraph(graph, {
        node: startNode, outgoing: asImportType(outgoing), incoming: asImportType(incoming),
        path: traversalPath, maxDepth, incomingDepth, outgoingDepth, filter,
        limit: effectiveLimit, minWeight
    });
}

function executeDocTextQuery(graph, text, directMatches, limit) {
    const matches = rankDocuments(graph, text, directMatches, { readFile: readRepoFile, limit });
    const edges = graph.edges.filter(edge => matches.some(match => match.id === edge.from || match.id === edge.to));
    return { nodes: matches, edges };
}

function executeGeneralTextQuery(graph, directMatches, limit, kind) {
    const relatedIds = new Set(directMatches.map(match => match.id));
    expandRelatedEdges(graph.edges, relatedIds);
    // the related neighbours (a doc next to a code file) obey the kind filter too
    const matches = Array.from(relatedIds).map(id => graph.getNode(id)).filter(node => node && nodeMatchesKind(node, kind)).slice(0, limit);
    const edges = graph.edges.filter(edge => matches.some(match => match.id === edge.from || match.id === edge.to));
    return { nodes: matches, edges };
}

async function executeTextQuery(graph, text, args) {
    const limit = args.limit || 10;
    const context = await buildContextFromGraph(graph, text, { limit });
    const directMatches = rankGraphNodes(graph, text, { limit, kind: args.kind }).map(e => e.node);
    const result = args.kind === 'doc'
        ? executeDocTextQuery(graph, text, directMatches, limit)
        : executeGeneralTextQuery(graph, directMatches, limit, args.kind);
    return { context, result };
}

function buildImpactMap(graph, nodes, isNodeMode, startNode) {
    const candidates = isNodeMode ? nodes.filter(match => match.id === startNode) : nodes;
    const codeFiles = candidates.filter(match => match.type === 'CodeFile' && match.kind !== 'test').map(match => match.path);
    return fileImpact(graph, codeFiles, { readFile: readRepoFile, coverage: loadCoverage().coverage });
}

function decorateMatch(match, impact) {
    return {
        ...answerNode(match),
        ...impact.get(match.path),
        ...(match.mentions ? { mentions: match.mentions } : {}),
        ...(match.lines ? { lines: match.lines } : {})
    };
}

function buildHopInfo(result) {
    if (result.total === undefined) return {};
    const hint = result.truncated ? `${result.total} neighbours, ${result.nodes.length - 1} shown: raise limit, or ask one edge type (incoming: { type: 'IMPORTS' })` : undefined;
    return {
        total: result.total,
        truncated: result.truncated,
        ...(hint ? { hint } : {})
    };
}

function buildMissingResponse(loaded, sessionId) {
    const freshness = freshnessFor(loaded.graph);
    return {
        available: true, sessionId, source: loaded.source, matchCount: 0, nodes: [], edges: [], context: '', freshness,
        provenance: { source: loaded.source, sessionId, totalNodes: 0, totalEdges: 0, matchCount: 0, freshness, scopes: loaded.scopes }
    };
}

function shouldIncludeProject(projectGraph) {
    if (projectGraph === false) return false;
    return isProjectGraphEnabled();
}

function loadModel(args, sessionId) {
    return loadGraphModel({
        sessionId, text: args.query,
        includeProject: shouldIncludeProject(args.projectGraph),
        includeDocs: args.includeDocs || args.kind === 'doc',
        history: args.history === true
    });
}

async function tryLoadModel(args, sessionId) {
    try {
        return await loadModel(args, sessionId);
    } catch (error) {
        return { error: `could not load graph: ${error.message}` };
    }
}

function buildQueryResponse(loaded, args, sessionId, queryResult, startNode) {
    const { graph, source } = loaded;
    const { result, context } = queryResult;
    const freshness = freshnessFor(graph);
    const provenance = { source, sessionId, totalNodes: graph.nodes.size, totalEdges: graph.edges.length, matchCount: result.nodes.length, freshness, scopes: loaded.scopes };
    const symbols = locateSymbols([...graph.nodes.values()], args.query ?? args.node);
    const impact = buildImpactMap(graph, result.nodes, Boolean(args.node), startNode);
    const nodes = result.nodes.map(match => decorateMatch(match, impact));
    const hop = buildHopInfo(result);
    return { available: true, sessionId, source, matchCount: result.nodes.length, nodes, edges: result.edges, ...hop, symbols, context, freshness, provenance };
}

async function runQueryWorkflow(loaded, args, sessionId) {
    const { graph } = loaded;
    let queryResult;
    let startNode;
    if (args.node) {
        startNode = resolveStartNode(graph, args.node);
        try {
            queryResult = { context: '', result: executeNodeQuery(graph, args, startNode) };
        } catch (error) {
            return { error: `invalid graph query: ${error.message}` };
        }
    } else {
        queryResult = await executeTextQuery(graph, args.query, args);
    }
    return buildQueryResponse(loaded, args, sessionId, queryResult, startNode);
}

export async function graph_query(rawArgs) {
    const { args, sessionId } = normalizeQueryArgs(rawArgs);
    const validationError = validateQueryArgs(args, sessionId);
    if (validationError) return { error: validationError };

    const loaded = await tryLoadModel(args, sessionId);
    if (loaded.error) {
        return { available: false, sessionId, source: 'ladybug', matchCount: 0, nodes: [], edges: [], error: loaded.error };
    }
    if (loaded.missing) return buildMissingResponse(loaded, sessionId);

    return runQueryWorkflow(loaded, args, sessionId);
}
