/**
 * Graph repository: the port through which the rest of the app reads and writes THE graph.
 * Callers get plain DTOs (`{nodes, edges}` with `from`/`to`/`type`), never storage rows.
 *
 * Scopes: `project` (code files and documents, written by GraphSync) and `session:<id>`
 * (governance nodes of one session, written when a /govern run is materialized).
 *
 * the storage behind the port is an adapter that a host injects (default Ladybug,
 * core/graph/adapters/ladybug/repositoryStore.js). The repository keeps the domain part: scopes, validation and the
 * mapping of DTOs to stored entities.
 *
 * @module core/graph/graphRepository
 */
import { createLadybugRepositoryStore, normalizeConfidence } from '../adapters/ladybug/index.js';
import { PROJECT_SCOPE } from '../model/index.js';

export { PROJECT_SCOPE };
export const sessionScope = (sessionId) => `session:${sessionId}`;

let storeFactory = createLadybugRepositoryStore; // a host may set it at startup

/** A host hands the repository its storage adapter factory; a test swaps it the same way. */
export function configureGraphStore(factory = createLadybugRepositoryStore) {
    storeFactory = factory;
}

/** Validate everything BEFORE the first write, so a bad edge never leaves a half-replaced scope behind. */
function assertValidRelations(relations) {
    for (const relation of relations) {
        if (!relation.from || !relation.to || !(relation.relation || relation.type)) throw new Error('relation requires from, to and relation');
        normalizeConfidence(relation.confidence);
    }
}

/**
 * @param {{databasePath?: string, open?: Function, store?: object}} [options] `store` overrides the injected adapter;
 *   `databasePath`/`open` go to the adapter (Ladybug: defaults to LENS_GRAPH_DB or `.memory/graph/project.lbdb`)
 */
export function createGraphRepository({ databasePath, open, store } = {}) {
    const backend = store ?? storeFactory({ databasePath, ...(open ? { open } : {}) });

    return {
        databasePath: () => backend.databasePath(),
        exists: () => backend.exists(),

        /** path -> {id, type, kind, hash, metadata} for every project entity (the input for incremental sync). */
        projectFiles: () => backend.projectFiles(PROJECT_SCOPE),

        /**
         * Apply one incremental project sync in a single open: remove deleted files, upsert changed
         * ones, then replace ALL project relations (they are derived from metadata, cheap to rebuild).
         */
        async applyProjectChanges({ upserts = [], removePaths = [], relations = [] } = {}) {
            assertValidRelations(relations);
            return backend.applyProjectChanges(PROJECT_SCOPE, { upserts, removePaths, relations });
        },

        /** Replace everything in one scope (e.g. a session's governance graph) with `nodes`/`edges` DTOs. */
        async replaceScope(scope, { nodes = [], edges = [] } = {}) {
            assertValidRelations(edges);
            const entities = nodes.map(node => {
                const { id, type, kind, path, name, title, createdAt, updatedAt, observedAt, ...rest } = node;
                return {
                    id, type, kind, path, name: name || title, scope,
                    metadata: { ...(title ? { title } : {}), ...rest },
                    createdAt: createdAt ? new Date(createdAt).toISOString() : undefined,
                    updatedAt: updatedAt ? new Date(updatedAt).toISOString() : undefined,
                    observedAt: observedAt ? new Date(observedAt).toISOString() : undefined
                };
            });
            const relations = edges.map(edge => ({ from: edge.from, to: edge.to, relation: edge.type, confidence: edge.confidence, weight: edge.weight, createdAt: edge.createdAt, updatedAt: edge.updatedAt }));
            await backend.replaceScope(scope, entities, relations);
            return { nodes: nodes.length, edges: edges.length };
        },

        /** Delete every scope that starts with `prefix` (e.g. `session:` for /clear-f). */
        deleteScopes: (prefix) => backend.deleteScopes(prefix),

        /**
         * Read scopes as a DTO graph. A missing database is an empty graph (nothing indexed yet),
         * never an error; a corrupt one throws.
         * @param {{scopes: string[], types?: string[]}} query
         */
        loadGraph: (query = {}) => backend.loadGraph(query),

        /**
         * Insert-or-update nodes in one scope without touching the rest of it (knowledge writes one node at a time,
         * Story 17.7.10). `documentation` holds the body, everything else in `metadata`.
         */
        async upsertNodes(scope, nodes = []) {
            if (!nodes.length) return 0;
            return backend.upsertNodes(scope, nodes);
        },

        /**
         * Raw node rows (with documentation and full metadata, unlike loadGraph's DTOs) by kind, optionally limited
         * to scopes with a prefix, ids or types. A missing database is an empty list.
         */
        loadNodes: (filter = {}) => backend.loadNodes(filter),

        /** Create relations between EXISTING nodes (missing endpoints are skipped). Replaces the outgoing edges of `replaceFrom` ids first. */
        async relate(edges = [], { replaceFrom = [] } = {}) {
            assertValidRelations(edges);
            await backend.relate(edges.map(edge => ({ from: edge.from, to: edge.to, relation: edge.type ?? edge.relation, confidence: edge.confidence, weight: edge.weight })), { replaceFrom });
            return edges.length;
        },

        /** Node/edge counts per scope. */
        stats: () => backend.stats(),

        directDefinedIn: (symbol) => backend.directDefinedIn(symbol),
        directExports: (file) => backend.directExports(file),
        directExists: (file) => backend.directExists(file),
        directImports: (file) => backend.directImports(file),
        directImportedBy: (file) => backend.directImportedBy(file),
        directFunctionViewGraph: (symbol) => backend.directFunctionViewGraph(symbol)
    };
}
