/**
 * Graph Query Engine
 *
 * Query API for navigating the knowledge graph:
 * - 1-hop: find direct neighbors
 * - Multi-hop: traverse chains (feature → decision → module)
 * - Reverse: what depends on X?
 * - Filters: by type, edge type, weight threshold
 */

import { debug } from '../../observability/index.js';

/** Resolve a node's effective age signal (updatedAt > createdAt > legacy numeric timestamp). */
function nodeAgeMs(node) {
  const value = node.updatedAt ?? node.createdAt ?? node.timestamp;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Date.parse(value);
  return NaN;
}

/**
 * Exclude stale nodes from a result set as of a given moment. A node is "stale"
 * once `asOf - nodeAgeMs(node) > maxAgeMs`. Nodes with an explicit `timestampStatus: 'unknown'`
 * (or an unparseable age) are never treated as stale - they're reported separately and always
 * kept, since "we don't know" must not be silently conflated with "this is old".
 * @returns {{resultNodes: Set<string>, freshness: {excludedStaleCount: number, unknownTimestampCount: number}}}
 */
function applyFreshness(resultNodes, graph, startId, { asOf, maxAgeMs, includeStale = false } = {}) {
  const freshness = { excludedStaleCount: 0, unknownTimestampCount: 0 };
  if (typeof asOf !== 'number' || typeof maxAgeMs !== 'number') return { resultNodes, freshness };

  const kept = new Set();
  for (const id of resultNodes) {
    if (id === startId) { kept.add(id); continue; }
    const node = graph.getNode(id);
    if (!node) continue;

    const ageMs = nodeAgeMs(node);
    if (node.timestampStatus === 'unknown' || Number.isNaN(ageMs)) {
      freshness.unknownTimestampCount++;
      kept.add(id);
      continue;
    }

    if (asOf - ageMs > maxAgeMs) {
      freshness.excludedStaleCount++;
      if (includeStale) kept.add(id);
    } else {
      kept.add(id);
    }
  }
  return { resultNodes: kept, freshness };
}

/**
 * BFS from `startId` up to `depth` hops in one direction, adding reached nodes/edges directly
 * into the shared `resultNodes`/`resultEdges` accumulators (mutated in place) so multiple
 * directional traversals from the same start node can be combined into one result.
 * @param {string} direction - 'outgoing' (callees/forward) or 'incoming' (callers/backward)
 */
function bfsByDepth(graph, startId, depth, direction, minWeight, limit, resultNodes, resultEdges) {
  if (!Number.isInteger(depth) || depth <= 0) return;
  const getEdges = direction === 'incoming' ? (id) => graph.getIncoming(id) : (id) => graph.getOutgoing(id);
  const nextIdOf = direction === 'incoming' ? (edge) => edge.from : (edge) => edge.to;

  let frontier = new Set([startId]);
  const visited = new Set([startId]);

  for (let hop = 0; hop < depth; hop++) {
    const nextFrontier = new Set();

    for (const currentId of frontier) {
      if (resultNodes.size >= limit) break;

      const edges = getEdges(currentId).filter(e => e.weight >= minWeight);
      for (const edge of edges) {
        const nextId = nextIdOf(edge);
        if (visited.has(nextId)) continue;
        if (resultNodes.size >= limit) break;

        visited.add(nextId);
        nextFrontier.add(nextId);
        resultNodes.add(nextId);
        resultEdges.push(edge);
      }
    }

    frontier = nextFrontier;
    if (frontier.size === 0) break; // Dead end
  }
}

/**
 * Query the graph and return matching nodes/edges
 *
 * @param {Graph} graph - graphModel instance (or compatible query facade)
 * @param {object} opts - Query options:
 *   - node: starting node ID
 *   - outgoing: {type?: string} | true - follow outgoing edges
 *   - incoming: {type?: string} | true - follow incoming edges (reverse)
 *   - path: "type1 → type2 → ..." - multi-hop chain
 *   - maxDepth: follow ANY outgoing edge type up to N hops (edge-type-agnostic BFS, unlike `path`)
 *   - incomingDepth: follow ANY incoming edge type up to N hops (callers/backward)
 *   - outgoingDepth: follow ANY outgoing edge type up to N hops (callees/forward) - combine with
 *     `incomingDepth` for an asymmetric "N callers back, M callees forward" traversal
 *   - filter: {type?: string} - filter result nodes by type
 *   - limit: max results (default 10)
 *   - minWeight: min edge weight to follow (default 0)
 *   - asOf: epoch ms freshness is evaluated against (omit to skip freshness filtering)
 *   - maxAgeMs: max node age before it's considered stale (requires asOf)
 *   - includeStale: keep stale nodes anyway, still reporting them (default false)
 * @returns {object} {nodes: [], edges: [], freshness: {excludedStaleCount, unknownTimestampCount}}
 */
const EDGE_ORDER = ['IMPORTS', 'CALLS', 'TESTS', 'MENTIONS'];
const edgeRank = edge => { const index = EDGE_ORDER.indexOf(edge.type); return index < 0 ? EDGE_ORDER.length : index; };

export function query(graph, opts = {}) {
  const { node, outgoing, incoming, path, maxDepth, incomingDepth, outgoingDepth, filter, limit = 10, minWeight = 0, asOf, maxAgeMs, includeStale } = opts;

  if (!node) {
    throw new Error('query requires opts.node (starting node ID)');
  }

  const startNode = graph.getNode(node);
  if (!startNode) {
    debug(1, 'graph:query', `Node not found: ${node}`);
    return { nodes: [], edges: [], freshness: { excludedStaleCount: 0, unknownTimestampCount: 0 } };
  }

  let resultNodes = new Set([startNode.id]);
  let resultEdges = [];

  // Single hop: outgoing or incoming. Structural edges first (an IMPORTS edge was cut by ten CALLS edges), and the
  // neighbours that did not fit are counted, so a cut answer says so instead of looking complete.
  let total = 0;
  for (const [spec, direction] of [[outgoing, 'outgoing'], [incoming, 'incoming']]) {
    if (!spec) continue;
    const far = direction === 'outgoing' ? 'to' : 'from';
    const edges = (direction === 'outgoing' ? graph.getOutgoing(startNode.id) : graph.getIncoming(startNode.id))
      .filter(edge => edge.weight >= minWeight && (!spec.type || edge.type === spec.type) && graph.getNode(edge[far]))
      .sort((a, b) => edgeRank(a) - edgeRank(b));
    total += new Set(edges.map(edge => edge[far])).size;
    for (const edge of edges) {
      if (!resultNodes.has(edge[far]) && resultNodes.size >= limit) continue;
      resultNodes.add(edge[far]);
      resultEdges.push(edge);
    }
  }
  const reachedByHop = resultNodes.size - 1;

  // Multi-hop: traverse path
  if (path) {
    const steps = path.split('→').map(s => s.trim());
    let frontier = new Set([startNode.id]);
    let visited = new Set([startNode.id]);

    for (const step of steps) {
      const nextFrontier = new Set();

      for (const currentId of frontier) {
        if (resultNodes.size >= limit) break;

        const edges = graph.getOutgoing(currentId).filter(e => e.weight >= minWeight && e.type === step);

        for (const edge of edges) {
          if (visited.has(edge.to)) continue;
          if (resultNodes.size >= limit) break;

          visited.add(edge.to);
          nextFrontier.add(edge.to);
          resultNodes.add(edge.to);
          resultEdges.push(edge);
        }
      }

      frontier = nextFrontier;
      if (frontier.size === 0) break; // Dead end
    }
  }

  // Generic maxDepth BFS: unlike `path`, this follows ANY outgoing
  // edge type up to N hops - the edge-type-agnostic equivalent of a `query_code_graph`-style
  // `max_depth` field, for callers that don't know (or don't care about) specific edge types.
  bfsByDepth(graph, startNode.id, maxDepth, 'outgoing', minWeight, limit, resultNodes, resultEdges);

  // Asymmetric bidirectional depth: "this function, N callers back, M callees forward" - two
  // independent directional BFS passes from the same start node, combined into one result.
  bfsByDepth(graph, startNode.id, incomingDepth, 'incoming', minWeight, limit, resultNodes, resultEdges);
  bfsByDepth(graph, startNode.id, outgoingDepth, 'outgoing', minWeight, limit, resultNodes, resultEdges);

  // Apply type filter
  if (filter && filter.type) {
    const filtered = Array.from(resultNodes).filter(id => {
      const node = graph.getNode(id);
      return node && node.type === filter.type;
    });
    resultNodes = new Set(filtered);
  }

  // Freshness filtering: drop/flag stale nodes before the limit is enforced.
  const freshnessResult = applyFreshness(resultNodes, graph, startNode.id, { asOf, maxAgeMs, includeStale });
  resultNodes = freshnessResult.resultNodes;

  // Enforce limit
  const nodeArray = Array.from(resultNodes).slice(0, limit);

  // Build result
  const nodes = nodeArray.map(id => graph.getNode(id)).filter(Boolean);
  const edges = resultEdges.filter(e => resultNodes.has(e.from) && resultNodes.has(e.to));

  debug(2, 'graph:query',
    `Query from ${node}: ${nodes.length} nodes, ${edges.length} edges`);

  const hop = outgoing || incoming ? { total, truncated: total > reachedByHop } : {};
  return { nodes, edges, freshness: freshnessResult.freshness, ...hop };
}

export { buildContextFromGraph } from './graphContext.js';
export { validateGraph } from '../model/index.js';

/**
 * what a graph_query answer shows of a node. Ten matches must fit the tool budget (4,000 chars): one README
 * carried its whole text as `purpose` (4,077 chars) and a code file its symbol ranges (~1,800), so every answer with a
 * document came back with 0 nodes. The kind (code, test, doc, ...) stays; text is clipped; line ranges are in `symbols`.
 */
const ANSWER_FIELDS = ['id', 'type', 'kind', 'scope', 'path', 'name', 'title', 'purpose', 'exports', 'date', 'line', 'status', 'supersededBy'];
export const answerNode = (node) => {
    if (!node || typeof node !== 'object') return node;
    const small = Object.fromEntries(ANSWER_FIELDS.filter(field => node[field] !== undefined).map(field => [field, node[field]]));
    if (typeof small.purpose === 'string' && small.purpose.length > 160) small.purpose = `${small.purpose.slice(0, 160)}…`;
    if (Array.isArray(small.exports) && small.exports.length > 20) small.exports = [...small.exports.slice(0, 20), `(+${small.exports.length - 20} more)`];
    return small;
};
