import { debug } from '../../observability/index.js';
import { normalizeNodeId } from './graphIds.js';
import { addEdge } from './graphEdges.js';
import { lookupCodeFile, lookupFile } from './graphLookup.js';

export { addEdge } from './graphEdges.js';
export { lookupCodeFile, lookupFile } from './graphLookup.js';

const NODE_LIFECYCLE_FIELDS = ['createdAt', 'updatedAt', 'timestamp', 'timestampStatus'];
const TIMESTAMP_PROPS = ['createdAt', 'updatedAt', 'observedAt', 'timestamp'];
const isContentKey = ([key]) => !NODE_LIFECYCLE_FIELDS.includes(key);

// Read-path lookup helper: an invalid/empty ID means "not found", not a thrown error.
function tryNormalizeNodeId(id) {
    try {
        return normalizeNodeId(id);
    } catch {
        return null;
    }
}

/**
 * Create a lightweight in-memory graph model for query and semantic operations.
 * Persistence belongs to core/ladybugGraphStore.js.
 */
export function createGraph(sessionId = 'default') {
    const graph = {
        version: '1.0', sessionId, createdAt: Date.now(),
        nodes: new Map(), edges: [],
        nodesByType: new Map(), nodesByPath: new Map(),
        nodesByLowerPath: new Map(), nodesByBase: new Map(),
        adjList: new Map(), revAdjList: new Map()
    };

    graph.addNode = (id, type, data) => addNode(graph, id, type, data);
    graph.addEdge = (fromId, toId, type, opts) => addEdge(graph, fromId, toId, type, opts);
    graph.getNode = id => {
        const normalized = tryNormalizeNodeId(id);
        return normalized ? graph.nodes.get(normalized) || null : null;
    };
    graph.getNodeByPath = filePath => {
        const p = String(filePath ?? '').trim();
        const id = p ? (graph.nodesByPath.get(p) ?? graph.nodesByLowerPath.get(p.toLowerCase())) : null;
        return id ? graph.getNode(id) : null;
    };
    graph.lookupCodeFile = wanted => lookupCodeFile(graph, wanted);
    graph.lookupFile = wanted => lookupFile(graph, wanted);
    graph.getNodesByType = type => (graph.nodesByType.get(type) || []).map(id => graph.nodes.get(id)).filter(Boolean);
    graph.getOutgoing = id => {
        const normalized = tryNormalizeNodeId(id);
        return normalized ? (graph.adjList.get(normalized) || []) : [];
    };
    graph.getIncoming = id => {
        const normalized = tryNormalizeNodeId(id);
        return normalized ? (graph.revAdjList.get(normalized) || []) : [];
    };
    graph.toJSON = () => ({
        version: graph.version, session_id: graph.sessionId, created_at: graph.createdAt,
        nodes: Array.from(graph.nodes.values()), edges: graph.edges
    });
    graph.summary = () => ({
        nodes: graph.nodes.size, edges: graph.edges.length,
        byType: Object.fromEntries(Array.from(graph.nodesByType.entries()).map(([type, ids]) => [type, ids.length]))
    });

    return graph;
}

function indexNodeByBase(graph, base, id) {
    if (!graph.nodesByBase) return;
    if (!graph.nodesByBase.has(base)) graph.nodesByBase.set(base, []);
    const list = graph.nodesByBase.get(base);
    if (!list.includes(id)) list.push(id);
}

function hasTimestamp(data, existing) {
    if (existing?.timestampStatus === 'known') return true;
    return TIMESTAMP_PROPS.some(p => Boolean(data[p]));
}

function resolveCreatedAt(existing, data, now) {
    if (existing && existing.createdAt) return existing.createdAt;
    return data.createdAt || now;
}

function resolveUpdatedAt(existing, data, changed, createdAt, now) {
    if (changed) return data.updatedAt || now;
    if (existing && existing.updatedAt) return existing.updatedAt;
    return createdAt;
}

function resolveTimestamp(existing, data, now) {
    if (data.timestamp) return data.timestamp;
    return (existing && existing.timestamp) || now;
}

function resolveTimestamps(existing, data, changed, now) {
    const createdAt = resolveCreatedAt(existing, data, now);
    const updatedAt = resolveUpdatedAt(existing, data, changed, createdAt, now);
    return {
        createdAt, updatedAt,
        timestampStatus: hasTimestamp(data, existing) ? 'known' : 'unknown',
        timestamp: resolveTimestamp(existing, data, now)
    };
}

function filterContent(obj) {
    if (!obj) return null;
    const entries = Object.entries(obj).filter(isContentKey);
    return Object.fromEntries(entries.filter(([k]) => k !== 'id' && k !== 'type'));
}

function hasContentChanged(existing, content) {
    if (!existing) return true;
    const existingContent = filterContent(existing);
    return JSON.stringify(existingContent) !== JSON.stringify(content);
}

function cleanOldTypeIndex(graph, existingType, id) {
    const previous = graph.nodesByType.get(existingType);
    if (!previous) return;
    const index = previous.indexOf(id);
    if (index >= 0) previous.splice(index, 1);
    if (!previous.length) graph.nodesByType.delete(existingType);
}

function ensureTypeBucket(graph, type) {
    let bucket = graph.nodesByType.get(type);
    if (!bucket) {
        bucket = [];
        graph.nodesByType.set(type, bucket);
    }
    return bucket;
}

function updateTypeIndex(graph, type, id, existing) {
    const isRetype = Boolean(existing && existing.type !== type);
    if (isRetype) cleanOldTypeIndex(graph, existing.type, id);
    const bucket = ensureTypeBucket(graph, type);
    if (!existing || isRetype) bucket.push(id);
}

function updatePathIndexes(graph, dataPath, id) {
    if (typeof dataPath !== 'string' || !dataPath) return;
    graph.nodesByPath?.set(dataPath, id);
    graph.nodesByLowerPath?.set(dataPath.toLowerCase(), id);
    const base = dataPath.split('/').pop().toLowerCase();
    indexNodeByBase(graph, base, id);
}

function logNodeAdd(graph, type, id) {
    const count = (graph.loggedNodeAdds || 0) + 1;
    graph.loggedNodeAdds = count;
    if (count <= 10) debug(2, 'graph:node', `Added ${type} node: ${id}`);
    if (count === 11) debug(2, 'graph:node', 'further node additions are not logged one by one');
}

export function addNode(graph, id, type, data) {
    if (!id || !type) throw new Error(`addNode requires id and type. Got: id="${id}", type="${type}"`);
    const normalizedId = normalizeNodeId(id);
    const existing = graph.nodes.get(normalizedId);
    const now = Date.now();
    const payload = data || {};

    const content = Object.fromEntries(Object.entries(payload).filter(isContentKey));
    const changed = hasContentChanged(existing, content);
    const timestamps = resolveTimestamps(existing, payload, changed, now);

    const node = { id: normalizedId, type, ...content, ...timestamps };
    graph.nodes.set(normalizedId, node);
    updateTypeIndex(graph, type, normalizedId, existing);
    updatePathIndexes(graph, payload.path, normalizedId);
    logNodeAdd(graph, type, normalizedId);
    return node;
}
