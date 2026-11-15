import { normalizeConfidence } from './ladybugGraphStore.js';
import { writeInBatches } from './writeBatches.js';

/** Removes the nodes of `removePaths` with their relations (DETACH DELETE). */
export async function clearProjectPaths(graph, scope, removePaths, batchSize) {
    for (let i = 0; i < removePaths.length; i += batchSize) {
        const batch = removePaths.slice(i, i + batchSize);
        await graph.query('MATCH (n:Entity) WHERE n.scope = $scope AND n.path IN $paths DETACH DELETE n', { scope, paths: batch });
    }
}

const relationKey = (from, to, relation) => `${from}\u0000${to}\u0000${relation}`;
const sameValues = (stored, wanted) => stored.confidence === normalizeConfidence(wanted.confidence) && Number(stored.weight) === Number(wanted.weight ?? 1);

/**
 * What a sync must write: every project relation is derived again, but after a small change nearly all stay the same
 * (one changed package.json rewrote all 1699 relations, 1.3 s, trace 2026-11-15). `changed` are new or with another
 * confidence or weight, `stale` are stored but no longer derived. An unchanged relation keeps its times.
 */
export async function relationDelta(graph, scope, relations) {
    const rows = await graph.query('MATCH (a:Entity)-[e:RELATES]->(b:Entity) WHERE a.scope = $scope AND b.scope = $scope '
        + 'RETURN a.id AS from_id, b.id AS to_id, e.relation AS relation, e.confidence AS confidence, e.weight AS weight', { scope });
    const stored = new Map(rows.map(row => [relationKey(row.from_id, row.to_id, row.relation), row]));
    const wanted = new Map(relations.map(relation => [relationKey(relation.from, relation.to, relation.relation), relation]));
    const changed = [...wanted].filter(([key, relation]) => !stored.has(key) || !sameValues(stored.get(key), relation)).map(([, relation]) => relation);
    const stale = [...stored].filter(([key]) => !wanted.has(key)).map(([, row]) => ({ from: row.from_id, to: row.to_id, relation: row.relation }));
    return { changed, stale };
}

export function deleteRelations(graph, relations, batchSize) {
    return writeInBatches(relations, batch => graph.query(
        'UNWIND $rows AS r MATCH (a:Entity)-[e:RELATES]->(b:Entity) WHERE a.id = r.from AND b.id = r.to AND e.relation = r.relation DELETE e',
        { rows: batch }
    ), { maxRows: batchSize });
}

export async function projectCounts(graph, scope) {
    const [counts] = await graph.query('MATCH (n:Entity) WHERE n.scope = $scope RETURN count(n) AS nodes', { scope });
    const [edges] = await graph.query('MATCH (a:Entity)-[e:RELATES]->(b:Entity) WHERE a.scope = $scope RETURN count(e) AS edges', { scope });
    return { nodes: Number(counts.nodes), edges: Number(edges.edges) };
}
