/**
 * Stored entity row <-> DTO. Every graph storage adapter keeps entities in this row shape (the Ladybug
 * columns: id, type, kind, scope, path, name, content_hash, documentation, metadata_json, created_at, updated_at, ...),
 * so the DTOs the repository hands out are the same whichever adapter the IoC chose. Moved unchanged from the repository.
 */
import { PROJECT_SCOPE } from './graphIds.js';

const DTO_RESERVED = new Set(['id', 'type', 'kind', 'scope', 'path', 'name']);

export function parseJson(text, fallback) {
    if (!text) return fallback;
    try { return JSON.parse(text); } catch { return fallback; }
}

export function toMillis(value) {
    if (!value) return undefined;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

/** Ladybug row -> node DTO in the shape graphModel/graph_query expect. */
export function rowToNode(row) {
    const metadata = parseJson(row.metadata_json, {});
    const { imports: _imports, links: _links, calls: _calls, mentions: _mentions, ...visible } = metadata;
    const node = {
        id: row.id,
        type: row.type,
        ...(row.kind ? { kind: row.kind } : {}),
        scope: row.scope || PROJECT_SCOPE,
        ...(row.path ? { path: row.path } : {}),
        ...(row.name ? { name: row.name } : {}),
        ...(row.documentation ? { purpose: row.documentation } : {}),
        ...Object.fromEntries(Object.entries(visible).filter(([key]) => !DTO_RESERVED.has(key)))
    };
    if (Array.isArray(metadata.calls)) node.calls = metadata.calls;
    if (row.type === 'Document' && row.name) node.title = row.name;
    const createdAt = toMillis(row.created_at);
    const updatedAt = toMillis(row.updated_at);
    if (createdAt !== undefined) node.createdAt = createdAt;
    if (updatedAt !== undefined) node.updatedAt = updatedAt;
    return node;
}

/** Stored row -> raw node (loadNodes: documentation and full metadata). */
export function rowToStoredNode(row) {
    return {
        id: row.id, type: row.type, kind: row.kind || '', scope: row.scope || PROJECT_SCOPE, path: row.path || '', name: row.name || '',
        documentation: row.documentation || '', metadata: parseJson(row.metadata_json, {}),
        createdAt: row.created_at || undefined, updatedAt: row.updated_at || undefined
    };
}

/** Stored relation row -> edge DTO (loadGraph). */
export function rowToEdge(row) {
    return {
        from: row.from_id, to: row.to_id, type: row.relation, confidence: row.confidence,
        weight: Number(row.weight ?? 1), createdAt: toMillis(row.created_at), updatedAt: toMillis(row.updated_at)
    };
}
