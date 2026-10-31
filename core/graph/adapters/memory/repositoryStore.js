/**
 * Memory adapter of the graph repository: the same methods and the same stored row shape as the Ladybug
 * adapter (core/graph/adapters/ladybug/repositoryStore.js), kept in Maps. For tests and sandboxes; a host can inject it
 * as `graph.store`. test/ports/graphRepositoryStore.contract.test.js runs both adapters through the same scenario.
 */
import { PROJECT_SCOPE, parseJson, rowToNode, rowToStoredNode, rowToEdge } from '../../model/index.js';
// shortcut: the confidence vocabulary lives in the Ladybug module; move it to core/graph/model when a third adapter needs it.
import { normalizeConfidence } from '../ladybug/index.js';
import { createMemoryDirectQueries } from './directQueries.js';

const COLUMNS = ['kind', 'path', 'name', 'content_hash', 'documentation', 'metadata_json', 'ast_json', 'created_at', 'updated_at', 'observed_at'];

/** Entity -> stored row, as Ladybug's entityRow; a missing column is null, as Ladybug returns it. */
function toRow(entity) {
    if (!entity?.id || !entity.type) throw new Error('entity requires id and type');
    const row = {
        id: entity.id, type: entity.type, kind: entity.kind, scope: entity.scope || PROJECT_SCOPE, path: entity.path, name: entity.name,
        content_hash: entity.contentHash, documentation: entity.documentation,
        metadata_json: entity.metadata ? JSON.stringify(entity.metadata) : undefined,
        ast_json: entity.ast ? JSON.stringify(entity.ast) : undefined,
        created_at: entity.createdAt, updated_at: entity.updatedAt, observed_at: entity.observedAt
    };
    for (const column of COLUMNS) row[column] ??= null;
    return row;
}

export function createMemoryRepositoryStore() {
    const nodes = new Map(); // id -> row
    const edges = new Map(); // `${from}\u0000${to}\u0000${relation}` -> edge row
    let written = false;

    const upsert = (entities) => {
        for (const entity of entities) nodes.set(entity.id, toRow(entity));
        written = true;
        return entities.length;
    };
    const relate = (relations) => {
        for (const r of relations) {
            if (!nodes.has(r.from) || !nodes.has(r.to)) continue; // as Ladybug's MATCH: missing endpoints are skipped
            edges.set(`${r.from}\u0000${r.to}\u0000${r.relation}`, {
                from_id: r.from, to_id: r.to, relation: r.relation, confidence: normalizeConfidence(r.confidence),
                weight: Number(r.weight ?? 1), created_at: String(r.createdAt ?? ''), updated_at: String(r.updatedAt ?? r.createdAt ?? '')
            });
        }
        written = true;
    };
    const detachDelete = (predicate) => {
        let count = 0;
        for (const [id, row] of nodes) {
            if (!predicate(row)) continue;
            nodes.delete(id);
            count++;
            for (const [key, edge] of edges) if (edge.from_id === id || edge.to_id === id) edges.delete(key);
        }
        return count;
    };
    const scopeOf = (id) => nodes.get(id)?.scope;
    const deleteEdges = (predicate) => { for (const [key, edge] of edges) if (predicate(edge)) edges.delete(key); };

    return {
        databasePath: () => ':memory:',
        exists: () => written,

        async projectFiles(scope) {
            return new Map([...nodes.values()].filter(r => r.scope === scope && r.path)
                .map(r => [r.path, { id: r.id, type: r.type, kind: r.kind, hash: r.content_hash, metadata: parseJson(r.metadata_json, {}) }]));
        },

        async applyProjectChanges(scope, { upserts = [], removePaths = [], relations = [] } = {}) {
            if (removePaths.length) detachDelete(r => r.scope === scope && removePaths.includes(r.path));
            upsert(upserts.map(entity => ({ ...entity, scope })));
            deleteEdges(e => scopeOf(e.from_id) === scope && scopeOf(e.to_id) === scope);
            relate(relations);
            return {
                nodes: [...nodes.values()].filter(r => r.scope === scope).length,
                edges: [...edges.values()].filter(e => scopeOf(e.from_id) === scope).length
            };
        },

        async replaceScope(scope, entities = [], relations = []) {
            detachDelete(r => r.scope === scope);
            upsert(entities);
            relate(relations);
        },

        async deleteScopes(prefix) {
            if (!written) return 0;
            return detachDelete(r => String(r.scope ?? '').startsWith(prefix));
        },

        async loadGraph({ scopes = [], types, exclude } = {}) {
            if (!written) return { nodes: [], edges: [], exists: false };
            const excluded = (r) => Boolean(exclude?.types?.length) && r.scope === exclude.scope && exclude.types.includes(r.type);
            const rows = [...nodes.values()].filter(r => scopes.includes(r.scope) && (!types?.length || types.includes(r.type)) && !excluded(r));
            const ids = new Set(rows.map(r => r.id));
            const edgeRows = [...edges.values()].filter(e => scopes.includes(scopeOf(e.from_id)) && scopes.includes(scopeOf(e.to_id)));
            return { exists: true, nodes: rows.map(rowToNode), edges: edgeRows.filter(e => ids.has(e.from_id) && ids.has(e.to_id)).map(rowToEdge) };
        },

        async upsertNodes(scope, list = []) {
            if (!list.length) return 0;
            return upsert(list.map(node => ({ ...node, scope })));
        },

        async loadNodes({ kinds, scopePrefix, scopes, ids, types } = {}) {
            if (!written) return [];
            return [...nodes.values()].filter(r => (!kinds?.length || kinds.includes(r.kind))
                && (!scopes?.length || scopes.includes(r.scope))
                && (!scopePrefix || String(r.scope ?? '').startsWith(scopePrefix))
                && (!ids?.length || ids.includes(r.id))
                && (!types?.length || types.includes(r.type))).map(rowToStoredNode);
        },

        async relate(relations = [], { replaceFrom = [] } = {}) {
            if (replaceFrom.length) deleteEdges(e => replaceFrom.includes(e.from_id));
            relate(relations);
        },

        async stats() {
            if (!written) return { exists: false, scopes: {} };
            const scopes = {};
            for (const r of nodes.values()) scopes[r.scope || PROJECT_SCOPE] = (scopes[r.scope || PROJECT_SCOPE] ?? 0) + 1;
            return { exists: true, scopes };
        },

        ...createMemoryDirectQueries(nodes, edges, () => written)
    };
}
