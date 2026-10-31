import { debug } from '../../observability/index.js';
import { normalizeNodeId } from './graphIds.js';

// Edge confidence contract: same enum convention as core/graph/ladybugGraphStore.js.
const VALID_EDGE_CONFIDENCE = new Set(['EXTRACTED', 'INFERRED', 'AMBIGUOUS']);

// Read-path lookup helper: an invalid/empty ID means "not found", not a thrown error.
function tryNormalizeNodeId(id) {
    try {
        return normalizeNodeId(id);
    } catch {
        return null;
    }
}

function normalizeConfidence(confidence) {
    if (confidence === undefined || confidence === null) return 'AMBIGUOUS';
    if (!VALID_EDGE_CONFIDENCE.has(confidence)) {
        throw new Error(`addEdge: invalid confidence "${confidence}" (expected one of ${[...VALID_EDGE_CONFIDENCE].join(', ')})`);
    }
    return confidence;
}

/**
 * Create a lightweight in-memory graph model for query and semantic operations.
 * Persistence belongs to core/ladybugGraphStore.js.
 */
export function createGraph(sessionId = 'default') {
    const graph = {
        version: '1.0',
        sessionId,
        createdAt: Date.now(),
        nodes: new Map(),
        edges: [],
        nodesByType: new Map(),
        nodesByPath: new Map(),
        nodesByLowerPath: new Map(),
        nodesByBase: new Map(),
        adjList: new Map(),
        revAdjList: new Map()
    };

    graph.addNode = (id, type, data = {}) => addNode(graph, id, type, data);
    graph.addEdge = (fromId, toId, type, weightOrOptions = 1) => addEdge(graph, fromId, toId, type, weightOrOptions);
    graph.getNode = (id) => {
        const normalized = tryNormalizeNodeId(id);
        return normalized ? graph.nodes.get(normalized) || null : null;
    };
    graph.getNodeByPath = (filePath) => {
        const p = String(filePath ?? '').trim();
        if (!p) return null;
        const id = graph.nodesByPath.get(p) ?? graph.nodesByLowerPath.get(p.toLowerCase());
        return id ? graph.getNode(id) : null;
    };
    graph.lookupCodeFile = (wanted) => {
        const exact = graph.getNodeByPath(wanted);
        if (exact && exact.type === 'CodeFile') return { node: exact };
        if (!wanted.includes('/')) {
            const same = (graph.nodesByBase.get(wanted.toLowerCase()) || [])
                .map(id => graph.getNode(id))
                .filter(n => n?.type === 'CodeFile');
            if (same.length === 1) return { node: same[0] };
            if (same.length > 1) return { candidates: same.map(n => n.path).sort() };
        }
        return {};
    };
    graph.lookupFile = (wanted) => {
        const exact = graph.getNodeByPath(wanted);
        const base = wanted.split('/').pop().toLowerCase();
        if (exact && (exact.type === 'CodeFile' || exact.type === 'Document')) {
            return { file: wanted, exists: true, similar: [] };
        }
        const similar = (graph.nodesByBase.get(base) || [])
            .map(id => graph.getNode(id))
            .filter(n => (n?.type === 'CodeFile' || n?.type === 'Document') && typeof n.path === 'string')
            .map(n => n.path)
            .sort();
        return { file: wanted, exists: false, similar };
    };
    graph.getNodesByType = (type) => (graph.nodesByType.get(type) || [])
        .map(id => graph.nodes.get(id)).filter(Boolean);
    graph.getOutgoing = (id) => {
        const normalized = tryNormalizeNodeId(id);
        return normalized ? (graph.adjList.get(normalized) || []) : [];
    };
    graph.getIncoming = (id) => {
        const normalized = tryNormalizeNodeId(id);
        return normalized ? (graph.revAdjList.get(normalized) || []) : [];
    };
    graph.toJSON = () => ({
        version: graph.version,
        session_id: graph.sessionId,
        created_at: graph.createdAt,
        nodes: Array.from(graph.nodes.values()),
        edges: graph.edges
    });
    graph.summary = () => ({
        nodes: graph.nodes.size,
        edges: graph.edges.length,
        byType: Object.fromEntries(
            Array.from(graph.nodesByType.entries()).map(([type, ids]) => [type, ids.length])
        )
    });

    return graph;
}

/** Fields that describe a node's own lifecycle, excluded from the "did the content change?" comparison. */
const NODE_LIFECYCLE_FIELDS = ['createdAt', 'updatedAt', 'timestamp', 'timestampStatus'];

export function addNode(graph, id, type, data = {}) {
    if (!id || !type) throw new Error(`addNode requires id and type. Got: id="${id}", type="${type}"`);
    const normalizedId = normalizeNodeId(id);
    const existing = graph.nodes.get(normalizedId);
    const now = Date.now();

    const contentEntries = Object.entries(data).filter(([key]) => !NODE_LIFECYCLE_FIELDS.includes(key));
    const content = Object.fromEntries(contentEntries);
    const existingContent = existing
        ? Object.fromEntries(Object.entries(existing).filter(([key]) => !NODE_LIFECYCLE_FIELDS.includes(key) && key !== 'id' && key !== 'type'))
        : null;
    const changed = !existing || JSON.stringify(existingContent) !== JSON.stringify(content);

    const createdAt = existing?.createdAt ?? data.createdAt ?? now;
    const updatedAt = changed ? (data.updatedAt ?? now) : (existing?.updatedAt ?? createdAt);
    const hasTimestampInfo = Boolean(data.createdAt || data.updatedAt || data.observedAt || data.timestamp || existing?.timestampStatus === 'known');
    const timestampStatus = hasTimestampInfo ? 'known' : 'unknown';

    const node = {
        id: normalizedId,
        type,
        ...content,
        createdAt,
        updatedAt,
        timestampStatus,
        timestamp: data.timestamp || existing?.timestamp || now
    };
    // a retype (same id, other type) must not leave the id behind under the old type.
    if (existing && existing.type !== type) {
        const previous = graph.nodesByType.get(existing.type) ?? [];
        const index = previous.indexOf(normalizedId);
        if (index >= 0) previous.splice(index, 1);
        if (!previous.length) graph.nodesByType.delete(existing.type);
    }
    graph.nodes.set(normalizedId, node);
    if (typeof data.path === 'string' && data.path) {
        graph.nodesByPath?.set(data.path, normalizedId);
        graph.nodesByLowerPath?.set(data.path.toLowerCase(), normalizedId);
        const base = data.path.split('/').pop().toLowerCase();
        if (graph.nodesByBase) {
            if (!graph.nodesByBase.has(base)) graph.nodesByBase.set(base, []);
            const list = graph.nodesByBase.get(base);
            if (!list.includes(normalizedId)) list.push(normalizedId);
        }
    }
    if (!graph.nodesByType.has(type)) graph.nodesByType.set(type, []);
    // a node is already listed only when it existed with this type; `includes` on every add was quadratic (25,000 nodes).
    if (!existing || existing.type !== type) graph.nodesByType.get(type).push(normalizedId);
    // one line per node flooded the log (518 lines per /plan). The first 10 per graph, then one notice.
    graph.loggedNodeAdds = (graph.loggedNodeAdds ?? 0) + 1;
    if (graph.loggedNodeAdds <= 10) debug(2, 'graph:node', `Added ${type} node: ${normalizedId}`);
    else if (graph.loggedNodeAdds === 11) debug(2, 'graph:node', 'further node additions are not logged one by one');
    return node;
}

export function addEdge(graph, fromId, toId, type, weightOrOptions = 1) {
    if (!fromId || !toId || !type) throw new Error(`addEdge requires fromId, toId, type`);
    const normalizedFrom = normalizeNodeId(fromId);
    const normalizedTo = normalizeNodeId(toId);
    if (!graph.nodes.has(normalizedFrom)) throw new Error(`addEdge: source node not found: ${normalizedFrom}`);
    if (!graph.nodes.has(normalizedTo)) throw new Error(`addEdge: target node not found: ${normalizedTo}`);
    if (normalizedFrom === normalizedTo) return null;

    const options = typeof weightOrOptions === 'number' ? { weight: weightOrOptions } : (weightOrOptions || {});
    const clampedWeight = Math.max(0, Math.min(1, options.weight ?? 1));
    const confidence = normalizeConfidence(options.confidence);
    const now = Date.now();

    // look only at this node's own edges; scanning graph.edges made loading 64,000 edges take 29 s.
    const candidates = graph.adjList ? (graph.adjList.get(normalizedFrom) ?? []) : graph.edges;
    const existing = candidates.find(edge => edge.from === normalizedFrom && edge.to === normalizedTo && edge.type === type);
    if (existing) {
        if (clampedWeight > existing.weight) existing.weight = clampedWeight;
        if (options.confidence !== undefined) existing.confidence = normalizeConfidence(options.confidence);
        if (options.observedAt) existing.observedAt = options.observedAt;
        existing.updatedAt = now;
        return existing;
    }

    const createdAt = options.createdAt ?? now;
    const edge = {
        from: normalizedFrom,
        to: normalizedTo,
        type,
        weight: clampedWeight,
        confidence,
        createdAt,
        updatedAt: options.updatedAt ?? createdAt,
        ...(options.observedAt ? { observedAt: options.observedAt } : {}),
        // the unclamped weight of a counted relation (call sites, shared commits); `weight` is clamped for ranking
        ...(options.strength > 1 ? { strength: options.strength } : {})
    };
    graph.edges.push(edge);
    if (!graph.adjList.has(normalizedFrom)) graph.adjList.set(normalizedFrom, []);
    if (!graph.revAdjList.has(normalizedTo)) graph.revAdjList.set(normalizedTo, []);
    graph.adjList.get(normalizedFrom).push(edge);
    graph.revAdjList.get(normalizedTo).push(edge);
    return edge;
}
