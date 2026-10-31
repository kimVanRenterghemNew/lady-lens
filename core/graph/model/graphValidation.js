import { normalizeNodeId } from './graphIds.js';

const VALID_EDGE_CONFIDENCE = new Set(['EXTRACTED', 'INFERRED', 'AMBIGUOUS']);

/**
 * Validate graph consistency
 * @returns {object} {valid: boolean, errors: [], summary: object}
 */
export function validateGraph(graph) {
  const errors = [];

  // Check all edges reference valid nodes
  for (const edge of graph.edges) {
    if (!graph.getNode(edge.from)) {
      errors.push(`Edge from non-existent node: ${edge.from}`);
    }
    if (!graph.getNode(edge.to)) {
      errors.push(`Edge to non-existent node: ${edge.to}`);
    }

    // Check for self-loops
    if (edge.from === edge.to) {
      errors.push(`Self-loop detected: ${edge.from}`);
    }

    // catch malformed confidence that bypassed addEdge
    if (edge.confidence !== undefined && !VALID_EDGE_CONFIDENCE.has(edge.confidence)) {
      errors.push(`Edge ${edge.from}->${edge.to} (${edge.type}) has invalid confidence: ${edge.confidence}`);
    }
  }

  // one edge per (from, to, type), and the adjacency indexes mirror graph.edges exactly.
  const edgeKey = (edge) => `${edge.from}|${edge.to}|${edge.type}`;
  const seenEdges = new Set();
  for (const edge of graph.edges) {
    const key = edgeKey(edge);
    if (seenEdges.has(key)) errors.push(`Duplicate edge: ${key}`);
    seenEdges.add(key);
    if (graph.adjList && !(graph.adjList.get(edge.from) || []).includes(edge)) errors.push(`Edge missing from adjList: ${key}`);
    if (graph.revAdjList && !(graph.revAdjList.get(edge.to) || []).includes(edge)) errors.push(`Edge missing from revAdjList: ${key}`);
  }
  const indexSize = (index) => [...(index?.values() ?? [])].reduce((sum, list) => sum + list.length, 0);
  if (graph.adjList && indexSize(graph.adjList) !== graph.edges.length) errors.push(`adjList holds ${indexSize(graph.adjList)} edges, graph.edges ${graph.edges.length}`);
  if (graph.revAdjList && indexSize(graph.revAdjList) !== graph.edges.length) errors.push(`revAdjList holds ${indexSize(graph.revAdjList)} edges, graph.edges ${graph.edges.length}`);

  // Every node is listed under its own type, and its id is in canonical form (no ghost twins).
  for (const [id, node] of graph.nodes.entries()) {
    if (!(graph.nodesByType.get(node.type) || []).includes(id)) errors.push(`Node missing from nodesByType: ${id} (${node.type})`);
    let canonical = null;
    try { canonical = normalizeNodeId(id); } catch { /* reported below */ }
    if (canonical !== id) errors.push(`Node id not normalized: ${id}`);
  }

  // Check nodesByType is in sync
  for (const [type, ids] of graph.nodesByType.entries()) {
    for (const id of ids) {
      const node = graph.getNode(id);
      if (!node || node.type !== type) {
        errors.push(`Type mismatch in nodesByType: ${id} (${type})`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    summary: graph.summary()
  };
}
