/**
 * Freshness filtering for graph query nodes.
 * @module core/graph/query/queryFreshness
 */

function nodeAgeMs(node) {
  const value = node.updatedAt ?? node.createdAt ?? node.timestamp;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Date.parse(value);
  return NaN;
}

function assessNodeFreshness(node, id, asOf, maxAgeMs, includeStale, freshness, kept) {
  const ageMs = nodeAgeMs(node);
  if (node.timestampStatus === 'unknown' || Number.isNaN(ageMs)) {
    freshness.unknownTimestampCount++;
    kept.add(id);
    return;
  }
  if (asOf - ageMs > maxAgeMs) {
    freshness.excludedStaleCount++;
    if (includeStale) kept.add(id);
    return;
  }
  kept.add(id);
}

function filterFreshNode(id, startId, graph, asOf, maxAgeMs, includeStale, freshness, kept) {
  if (id === startId) {
    kept.add(id);
    return;
  }
  const node = graph.getNode(id);
  if (node) assessNodeFreshness(node, id, asOf, maxAgeMs, includeStale, freshness, kept);
}

/**
 * Exclude stale nodes from a result set as of a given moment.
 */
export function applyFreshness(resultNodes, graph, startId, { asOf, maxAgeMs, includeStale = false } = {}) {
  const freshness = { excludedStaleCount: 0, unknownTimestampCount: 0 };
  if (typeof asOf !== 'number' || typeof maxAgeMs !== 'number') return { resultNodes, freshness };

  const kept = new Set();
  resultNodes.forEach(id => filterFreshNode(id, startId, graph, asOf, maxAgeMs, includeStale, freshness, kept));
  return { resultNodes: kept, freshness };
}
