/**
 * Ladybug adapter of the graph repository: talks to LadybugDB.
 * Each call opens and closes the database, so no process keeps a lock between commands.
 */
import fs from 'fs';
import { openLadybugGraph, upsertEntities, createRelations, resolveDatabasePath } from './ladybugGraphStore.js';
import { PROJECT_SCOPE, parseJson, rowToNode, rowToStoredNode, rowToEdge } from '../../model/index.js';
import { createDirectQueries } from './directQueries.js';

export { rowToNode };

const NODE_RETURN = 'n.id AS id, n.type AS type, n.kind AS kind, n.scope AS scope, n.path AS path, n.name AS name, '
    + 'n.documentation AS documentation, n.metadata_json AS metadata_json, n.created_at AS created_at, n.updated_at AS updated_at';

const DB_QUEUES = new Map();
const LOCK_ERROR = /could not set lock|lock on file|database is locked|Error: 33/i;

export async function openWithLockRetry(open, databasePath, { attempts = 12, delayMs = 250 } = {}) {
    for (let attempt = 1; ; attempt++) {
        try {
            return await open({ databasePath });
        } catch (error) {
            if (!LOCK_ERROR.test(String(error?.message ?? error))) throw error;
            if (attempt >= attempts) {
                const lockErr = new Error(`Database is vergrendeld door een ander proces (pad: ${databasePath}): ${error.message}. Tip: controleer met 'lens stop' of er een actieve daemon draait.`);
                lockErr.cause = error;
                lockErr.code = 'ELOCKED';
                throw lockErr;
            }
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }
}

/**
 * @param {{databasePath?: string, open?: Function}} [options] `databasePath` defaults to LENS_GRAPH_DB or `.memory/graph/project.lbdb`
 */
export function createLadybugRepositoryStore({ databasePath, open = openLadybugGraph } = {}) {
    const location = () => resolveDatabasePath(databasePath);

    async function withGraph(fn) {
        const db = location();
        // One open database per file at a time in this process (2026-10-05, Windows): two overlapping opens, or an open
        // right after a close, fail with "Could not set lock on file (Error: 33)". Operations on the same file queue up,
        // and an open that hits a lock still held (by a closing handle or another process) is retried briefly.
        const previous = DB_QUEUES.get(db) ?? Promise.resolve();
        let release;
        const turn = new Promise(resolve => { release = resolve; });
        const chained = previous.then(() => turn);
        DB_QUEUES.set(db, chained);
        await previous;
        try {
            const graph = await openWithLockRetry(open, db);
            try {
                return await fn(graph);
            } finally {
                await graph.close();
            }
        } finally {
            release();
            if (DB_QUEUES.get(db) === chained) DB_QUEUES.delete(db);
        }
    }

    return {
        databasePath: location,
        exists: () => fs.existsSync(location()),

        async projectFiles(scope) {
            if (!fs.existsSync(location())) return new Map();
            return withGraph(async graph => {
                const rows = await graph.query(
                    'MATCH (n:Entity) WHERE n.scope = $scope AND n.path <> \'\' RETURN n.id AS id, n.type AS type, n.kind AS kind, n.path AS path, n.content_hash AS hash, n.metadata_json AS metadata_json',
                    { scope }
                );
                return new Map(rows.map(row => [row.path, { id: row.id, type: row.type, kind: row.kind, hash: row.hash, metadata: parseJson(row.metadata_json, {}) }]));
            });
        },

        async applyProjectChanges(scope, { upserts = [], removePaths = [], relations = [] } = {}) {
            return withGraph(async graph => {
                if (removePaths.length) {
                    await graph.query('MATCH (n:Entity) WHERE n.scope = $scope AND n.path IN $paths DETACH DELETE n', { scope, paths: removePaths });
                }
                await upsertEntities(graph, upserts.map(entity => ({ ...entity, scope })));
                await graph.query('MATCH (a:Entity)-[e:RELATES]->(b:Entity) WHERE a.scope = $scope AND b.scope = $scope DELETE e', { scope });
                await createRelations(graph, relations);
                const [counts] = await graph.query(
                    'MATCH (n:Entity) WHERE n.scope = $scope RETURN count(n) AS nodes', { scope }
                );
                const [edges] = await graph.query(
                    'MATCH (a:Entity)-[e:RELATES]->(b:Entity) WHERE a.scope = $scope RETURN count(e) AS edges', { scope }
                );
                return { nodes: Number(counts.nodes), edges: Number(edges.edges) };
            });
        },

        /** `entities` and `relations` are already in Ladybug input shape (the repository maps the DTOs). */
        async replaceScope(scope, entities = [], relations = []) {
            return withGraph(async graph => {
                await graph.query('MATCH (n:Entity) WHERE n.scope = $scope DETACH DELETE n', { scope });
                await upsertEntities(graph, entities);
                await createRelations(graph, relations);
            });
        },

        /** Delete every scope that starts with `prefix` (e.g. `session:` for /clear-f). */
        async deleteScopes(prefix) {
            if (!fs.existsSync(location())) return 0;
            return withGraph(async graph => {
                const [row] = await graph.query('MATCH (n:Entity) WHERE starts_with(n.scope, $prefix) RETURN count(n) AS c', { prefix });
                await graph.query('MATCH (n:Entity) WHERE starts_with(n.scope, $prefix) DETACH DELETE n', { prefix });
                return Number(row.c);
            });
        },

        /**
         * Read scopes as a DTO graph. A missing database is an empty graph (nothing indexed yet),
         * never an error; a corrupt one throws.
         * `exclude: { scope, types }` leaves out the nodes of those types in that scope, and their edges, in the database
         * (a question without documents need not read the documents and their thousands of MENTIONS edges).
         * @param {{scopes: string[], types?: string[], exclude?: {scope: string, types: string[]}}} query
         */
        async loadGraph({ scopes, types, exclude } = {}) {
            if (!fs.existsSync(location())) return { nodes: [], edges: [], exists: false };
            return withGraph(async graph => {
                const typeFilter = types?.length ? ' AND n.type IN $types' : '';
                const excluding = Boolean(exclude?.types?.length);
                const notExcluded = (v) => (excluding ? ` AND NOT (${v}.scope = $exScope AND ${v}.type IN $exTypes)` : '');
                const exParams = excluding ? { exScope: exclude.scope, exTypes: exclude.types } : {};
                const params = { scopes, ...(types?.length ? { types } : {}), ...exParams };
                const rows = await graph.query(`MATCH (n:Entity) WHERE n.scope IN $scopes${typeFilter}${notExcluded('n')} RETURN ${NODE_RETURN}`, params);
                const ids = new Set(rows.map(row => row.id));
                const edgeRows = await graph.query(
                    `MATCH (a:Entity)-[e:RELATES]->(b:Entity) WHERE a.scope IN $scopes AND b.scope IN $scopes${notExcluded('a')}${notExcluded('b')} `
                    + 'RETURN a.id AS from_id, b.id AS to_id, e.relation AS relation, e.confidence AS confidence, e.weight AS weight, e.created_at AS created_at, e.updated_at AS updated_at',
                    { scopes, ...exParams }
                );
                return {
                    exists: true,
                    nodes: rows.map(rowToNode),
                    edges: edgeRows
                        .filter(row => ids.has(row.from_id) && ids.has(row.to_id))
                        .map(rowToEdge)
                };
            });
        },

        /** Insert-or-update nodes in one scope without touching the rest of it. */
        async upsertNodes(scope, nodes = []) {
            if (!nodes.length) return 0;
            return withGraph(graph => upsertEntities(graph, nodes.map(node => ({ ...node, scope }))));
        },

        /** Raw node rows by kind, optionally limited to scopes with a prefix, ids or types. */
        async loadNodes({ kinds, scopePrefix, scopes, ids, types } = {}) {
            if (!fs.existsSync(location())) return [];
            return withGraph(async graph => {
                const where = [];
                const params = {};
                if (kinds?.length) { where.push('n.kind IN $kinds'); params.kinds = kinds; }
                if (scopes?.length) { where.push('n.scope IN $scopes'); params.scopes = scopes; }
                if (scopePrefix) { where.push('starts_with(n.scope, $prefix)'); params.prefix = scopePrefix; }
                if (ids?.length) { where.push('n.id IN $ids'); params.ids = ids; }
                if (types?.length) { where.push('n.type IN $types'); params.types = types; }
                const rows = await graph.query(`MATCH (n:Entity)${where.length ? ` WHERE ${where.join(' AND ')}` : ''} RETURN ${NODE_RETURN}`, params);
                return rows.map(rowToStoredNode);
            });
        },

        /** Create relations between EXISTING nodes (missing endpoints are skipped). Replaces the outgoing edges of `replaceFrom` ids first. */
        async relate(relations = [], { replaceFrom = [] } = {}) {
            return withGraph(async graph => {
                if (replaceFrom.length) await graph.query('MATCH (a:Entity)-[e:RELATES]->(:Entity) WHERE a.id IN $ids DELETE e', { ids: replaceFrom });
                await createRelations(graph, relations);
            });
        },

        /** Node/edge counts per scope. */
        async stats() {
            if (!fs.existsSync(location())) return { exists: false, scopes: {} };
            return withGraph(async graph => {
                const rows = await graph.query('MATCH (n:Entity) RETURN n.scope AS scope, count(n) AS nodes');
                return { exists: true, scopes: Object.fromEntries(rows.map(row => [row.scope || PROJECT_SCOPE, Number(row.nodes)])) };
            });
        },

        ...createDirectQueries(withGraph, location, NODE_RETURN)
    };
}
