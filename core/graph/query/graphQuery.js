/**
 * Graph Query Engine: query API for navigating 1-hop, multi-hop, reverse, filters and freshness.
 */
import { debug } from '../../observability/index.js';
import { applyFreshness } from './queryFreshness.js';

function expandFrontierNode(currentId, getEdges, nextIdOf, minWeight, limit, visited, nextFrontier, resultNodes, resultEdges) {
  if (resultNodes.size >= limit) return;
  const edges = getEdges(currentId).filter(e => e.weight >= minWeight);
  for (const edge of edges) {
    const nextId = nextIdOf(edge);
    if (!visited.has(nextId) && resultNodes.size < limit) {
      visited.add(nextId);
      nextFrontier.add(nextId);
      resultNodes.add(nextId);
      resultEdges.push(edge);
    }
  }
}

const depthEdgeGetter = (graph, direction) => (direction === 'incoming' ? (id) => graph.getIncoming(id) : (id) => graph.getOutgoing(id));
const depthNextIdGetter = (direction) => (direction === 'incoming' ? (edge) => edge.from : (edge) => edge.to);

function stepBfsFrontier(frontier, getEdges, nextIdOf, minWeight, limit, visited, resultNodes, resultEdges) {
  const nextFrontier = new Set();
  for (const currentId of frontier) {
    expandFrontierNode(currentId, getEdges, nextIdOf, minWeight, limit, visited, nextFrontier, resultNodes, resultEdges);
  }
  return nextFrontier;
}

function bfsByDepth(graph, startId, depth, direction, minWeight, limit, resultNodes, resultEdges) {
  if (!Number.isInteger(depth) || depth <= 0) return;
  const getEdges = depthEdgeGetter(graph, direction);
  const nextIdOf = depthNextIdGetter(direction);

  let frontier = new Set([startId]);
  const visited = new Set([startId]);

  for (let hop = 0; hop < depth && frontier.size > 0; hop++) {
    frontier = stepBfsFrontier(frontier, getEdges, nextIdOf, minWeight, limit, visited, resultNodes, resultEdges);
  }
}

const EDGE_ORDER = ['IMPORTS', 'CALLS', 'TESTS', 'MENTIONS'];
const edgeRank = edge => { const index = EDGE_ORDER.indexOf(edge.type); return index < 0 ? EDGE_ORDER.length : index; };

function traverseSingleHop(spec, direction, graph, startId, minWeight, limit, resultNodes, resultEdges) {
  if (!spec) return 0;
  const far = direction === 'outgoing' ? 'to' : 'from';
  const getEdges = direction === 'outgoing' ? graph.getOutgoing : graph.getIncoming;
  const edges = getEdges(startId)
    .filter(edge => edge.weight >= minWeight && (!spec.type || edge.type === spec.type) && graph.getNode(edge[far]))
    .sort((a, b) => edgeRank(a) - edgeRank(b));
  edges.forEach(edge => {
    if (resultNodes.has(edge[far]) || resultNodes.size < limit) {
      resultNodes.add(edge[far]);
      resultEdges.push(edge);
    }
  });
  return new Set(edges.map(edge => edge[far])).size;
}

function stepPathFrontier(currentId, step, graph, minWeight, limit, visited, nextFrontier, resultNodes, resultEdges) {
  if (resultNodes.size >= limit) return;
  const edges = graph.getOutgoing(currentId).filter(e => e.weight >= minWeight && e.type === step);
  for (const edge of edges) {
    if (!visited.has(edge.to) && resultNodes.size < limit) {
      visited.add(edge.to);
      nextFrontier.add(edge.to);
      resultNodes.add(edge.to);
      resultEdges.push(edge);
    }
  }
}

function traversePath(graph, startId, path, minWeight, limit, resultNodes, resultEdges) {
  const steps = path.split('→').map(s => s.trim());
  let frontier = new Set([startId]);
  const visited = new Set([startId]);

  for (const step of steps) {
    if (frontier.size === 0) break;
    const nextFrontier = new Set();
    for (const currentId of frontier) {
      stepPathFrontier(currentId, step, graph, minWeight, limit, visited, nextFrontier, resultNodes, resultEdges);
    }
    frontier = nextFrontier;
  }
}

function filterNodesByType(resultNodes, graph, filterType) {
  if (!filterType) return resultNodes;
  return new Set(Array.from(resultNodes).filter(id => {
    const n = graph.getNode(id);
    return n && n.type === filterType;
  }));
}

function executeTraversals(graph, startId, opts, limit, minWeight, resultNodes, resultEdges) {
  const { outgoing, incoming, path, maxDepth, incomingDepth, outgoingDepth } = opts;
  const total = [[outgoing, 'outgoing'], [incoming, 'incoming']]
    .reduce((sum, [spec, dir]) => sum + traverseSingleHop(spec, dir, graph, startId, minWeight, limit, resultNodes, resultEdges), 0);
  if (path) traversePath(graph, startId, path, minWeight, limit, resultNodes, resultEdges);
  bfsByDepth(graph, startId, maxDepth, 'outgoing', minWeight, limit, resultNodes, resultEdges);
  bfsByDepth(graph, startId, incomingDepth, 'incoming', minWeight, limit, resultNodes, resultEdges);
  bfsByDepth(graph, startId, outgoingDepth, 'outgoing', minWeight, limit, resultNodes, resultEdges);
  return total;
}

const DEFAULT_QUERY_OPTS = Object.freeze({ limit: 10, minWeight: 0 });

function queryHopInfo(opts, total, reachedByHop) {
  if (opts.outgoing || opts.incoming) {
    return { total, truncated: total > reachedByHop };
  }
  return {};
}

function resolveQueryNodes(resultNodes, graph, limit) {
  return Array.from(resultNodes)
    .slice(0, limit)
    .map(id => graph.getNode(id))
    .filter(Boolean);
}

export function query(graph, rawOpts) {
  const opts = Object.assign({}, DEFAULT_QUERY_OPTS, rawOpts);
  if (!opts.node) {
    throw new Error('query requires opts.node (starting node ID)');
  }

  const startNode = graph.getNode(opts.node);
  if (!startNode) {
    debug(1, 'graph:query', `Node not found: ${opts.node}`);
    return { nodes: [], edges: [], freshness: { excludedStaleCount: 0, unknownTimestampCount: 0 } };
  }

  let resultNodes = new Set([startNode.id]);
  const resultEdges = [];

  const total = executeTraversals(graph, startNode.id, opts, opts.limit, opts.minWeight, resultNodes, resultEdges);
  const reachedByHop = resultNodes.size - 1;

  resultNodes = filterNodesByType(resultNodes, graph, opts.filter?.type);

  const freshnessResult = applyFreshness(resultNodes, graph, startNode.id, opts);
  resultNodes = freshnessResult.resultNodes;

  const nodes = resolveQueryNodes(resultNodes, graph, opts.limit);
  const edges = resultEdges.filter(e => resultNodes.has(e.from) && resultNodes.has(e.to));

  debug(2, 'graph:query', `Query from ${opts.node}: ${nodes.length} nodes, ${edges.length} edges`);

  return { nodes, edges, freshness: freshnessResult.freshness, ...queryHopInfo(opts, total, reachedByHop) };
}

export { buildContextFromGraph } from './graphContext.js';
export { validateGraph } from '../model/index.js';
export { answerNode, QUERY_NODE_PROPERTIES } from './answerNode.js';
