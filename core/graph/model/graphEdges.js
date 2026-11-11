import { normalizeNodeId } from './graphIds.js';

const VALID_EDGE_CONFIDENCE = new Set(['EXTRACTED', 'INFERRED', 'AMBIGUOUS']);

export function normalizeConfidence(confidence) {
    if (confidence === undefined || confidence === null) return 'AMBIGUOUS';
    if (!VALID_EDGE_CONFIDENCE.has(confidence)) {
        throw new Error(`addEdge: invalid confidence "${confidence}" (expected one of ${[...VALID_EDGE_CONFIDENCE].join(', ')})`);
    }
    return confidence;
}

function parseEdgeOptions(weightOrOptions) {
    if (typeof weightOrOptions === 'number') return { weight: weightOrOptions };
    return weightOrOptions || { weight: 1 };
}

function updateExistingEdge(existing, clampedWeight, options, now) {
    if (clampedWeight > existing.weight) existing.weight = clampedWeight;
    if (options.confidence !== undefined) existing.confidence = normalizeConfidence(options.confidence);
    if (options.observedAt) existing.observedAt = options.observedAt;
    existing.updatedAt = now;
    return existing;
}

function indexAdjacency(graph, from, to, edge) {
    if (!graph.adjList.has(from)) graph.adjList.set(from, []);
    if (!graph.revAdjList.has(to)) graph.revAdjList.set(to, []);
    graph.adjList.get(from).push(edge);
    graph.revAdjList.get(to).push(edge);
}

function findExistingEdge(graph, from, to, type) {
    const candidates = graph.adjList ? (graph.adjList.get(from) ?? []) : graph.edges;
    return candidates.find(e => e.from === from && e.to === to && e.type === type);
}

function createNewEdge(from, to, type, clampedWeight, confidence, options, now) {
    const createdAt = options.createdAt ?? now;
    return {
        from, to, type, weight: clampedWeight, confidence, createdAt,
        updatedAt: options.updatedAt ?? createdAt,
        ...(options.observedAt ? { observedAt: options.observedAt } : {}),
        ...(options.strength > 1 ? { strength: options.strength } : {})
    };
}

function ensureEndpoint(graph, id, label) {
    if (!id) throw new Error('addEdge requires fromId, toId, type');
    const normalized = normalizeNodeId(id);
    if (!graph.nodes.has(normalized)) throw new Error(`addEdge: ${label} node not found: ${normalized}`);
    return normalized;
}

function validateEndpoints(graph, fromId, toId, type) {
    if (!type) throw new Error('addEdge requires fromId, toId, type');
    const from = ensureEndpoint(graph, fromId, 'source');
    const to = ensureEndpoint(graph, toId, 'target');
    return { from, to };
}

export function addEdge(graph, fromId, toId, type, weightOrOptions) {
    const { from, to } = validateEndpoints(graph, fromId, toId, type);
    if (from === to) return null;

    const options = parseEdgeOptions(weightOrOptions);
    const clampedWeight = Math.max(0, Math.min(1, options.weight ?? 1));
    const now = Date.now();

    const existing = findExistingEdge(graph, from, to, type);
    if (existing) return updateExistingEdge(existing, clampedWeight, options, now);

    const edge = createNewEdge(from, to, type, clampedWeight, normalizeConfidence(options.confidence), options, now);
    graph.edges.push(edge);
    indexAdjacency(graph, from, to, edge);
    return edge;
}
