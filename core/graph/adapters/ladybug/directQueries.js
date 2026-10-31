// TODO(coverage): Current statement coverage is 71.79% (< 85% target). Raise to >= 85%.
import fs from 'fs';
import { parseJson, rowToNode, rowToEdge } from '../../model/index.js';

export function createDirectQueries(withGraph, location, nodeReturn) {
    return {
        async directDefinedIn(symbol) {
            if (!fs.existsSync(location())) return [];
            return withGraph(async graph => {
                const rows = await graph.query(
                    "MATCH (n:Entity) WHERE n.scope = 'project' AND n.type = 'CodeFile' AND (n.kind <> 'test' OR n.kind IS NULL) AND n.metadata_json CONTAINS $symbol RETURN n.path AS path, n.metadata_json AS metadata_json",
                    { symbol }
                );
                const locations = [];
                for (const row of rows) {
                    const meta = parseJson(row.metadata_json, {});
                    const range = meta.symbolRanges?.[symbol];
                    const isRange = Array.isArray(range);
                    const isExported = Array.isArray(meta.exports) && meta.exports.includes(symbol);
                    if (isRange || isExported) {
                        locations.push(isRange ? { path: row.path, startLine: range[0], endLine: range[1] } : { path: row.path });
                    }
                }
                return locations.sort((a, b) => a.path.localeCompare(b.path));
            });
        },

        async directExports(file) {
            const wanted = String(file ?? '').trim().replace(/\\/g, '/').replace(/^file:/i, '').replace(/^\.\//, '');
            if (!wanted || !fs.existsSync(location())) return { file: wanted, found: false, candidates: [], names: [] };
            return withGraph(async graph => {
                const rows = await graph.query(
                    "MATCH (n:Entity) WHERE n.scope = 'project' AND n.type = 'CodeFile' AND (lower(n.path) = lower($wanted) OR (n.name IS NOT NULL AND lower(n.name) = lower($wanted))) RETURN n.path AS path, n.name AS name, n.metadata_json AS metadata_json",
                    { wanted }
                );
                if (!rows.length) return { file: wanted, found: false, candidates: [], names: [] };
                const exact = rows.find(r => r.path === wanted) ?? rows.find(r => r.path.toLowerCase() === wanted.toLowerCase());
                if (exact) {
                    const meta = parseJson(exact.metadata_json, {});
                    const names = [...new Set((meta.exports || []).filter(n => typeof n === 'string'))].sort();
                    return { file: exact.path, found: true, candidates: [], names };
                }
                if (!wanted.includes('/')) {
                    if (rows.length === 1) {
                        const meta = parseJson(rows[0].metadata_json, {});
                        const names = [...new Set((meta.exports || []).filter(n => typeof n === 'string'))].sort();
                        return { file: rows[0].path, found: true, candidates: [], names };
                    }
                    return { file: wanted, found: false, candidates: rows.map(r => r.path).sort(), names: [] };
                }
                return { file: wanted, found: false, candidates: [], names: [] };
            });
        },

        async directExists(file) {
            const wanted = String(file ?? '').trim().replace(/\\/g, '/').replace(/^file:/i, '').replace(/^\.\//, '');
            if (!wanted || !fs.existsSync(location())) return { file: wanted, exists: false, similar: [] };
            const base = wanted.split('/').pop().toLowerCase();
            return withGraph(async graph => {
                const rows = await graph.query(
                    "MATCH (n:Entity) WHERE n.scope = 'project' AND (n.type = 'CodeFile' OR n.type = 'Document') AND (lower(n.path) = lower($wanted) OR (n.name IS NOT NULL AND lower(n.name) = lower($base))) RETURN n.path AS path",
                    { wanted, base }
                );
                const exists = rows.some(r => r.path.toLowerCase() === wanted.toLowerCase());
                const similar = exists ? [] : rows.filter(r => r.path.split('/').pop().toLowerCase() === base).map(r => r.path).sort();
                return { file: wanted, exists, similar };
            });
        },

        async directImports(file) {
            const wanted = String(file ?? '').trim().replace(/\\/g, '/').replace(/^file:/i, '').replace(/^\.\//, '');
            if (!wanted || !fs.existsSync(location())) return { file: wanted, found: false, candidates: [], files: [] };
            return withGraph(async graph => {
                const rows = await graph.query(
                    "MATCH (a:Entity) WHERE a.scope = 'project' AND a.type = 'CodeFile' AND (lower(a.path) = lower($wanted) OR (a.name IS NOT NULL AND lower(a.name) = lower($wanted))) RETURN a.id AS id, a.path AS path",
                    { wanted }
                );
                if (!rows.length) return { file: wanted, found: false, candidates: [], files: [] };
                const exact = rows.find(r => r.path === wanted) ?? rows.find(r => r.path.toLowerCase() === wanted.toLowerCase());
                let matched = exact;
                if (!matched && !wanted.includes('/')) {
                    if (rows.length === 1) matched = rows[0];
                    else return { file: wanted, found: false, candidates: rows.map(r => r.path).sort(), files: [] };
                }
                if (!matched) return { file: wanted, found: false, candidates: [], files: [] };
                const edges = await graph.query(
                    "MATCH (a:Entity)-[e:RELATES]->(b:Entity) WHERE a.id = $id AND e.relation = 'IMPORTS' AND b.type = 'CodeFile' AND b.path <> a.path RETURN DISTINCT b.path AS path",
                    { id: matched.id }
                );
                return { file: matched.path, found: true, candidates: [], files: edges.map(e => e.path).sort() };
            });
        },

        async directImportedBy(file) {
            const wanted = String(file ?? '').trim().replace(/\\/g, '/').replace(/^file:/i, '').replace(/^\.\//, '');
            if (!wanted || !fs.existsSync(location())) return { file: wanted, found: false, candidates: [], files: [] };
            return withGraph(async graph => {
                const rows = await graph.query(
                    "MATCH (a:Entity) WHERE a.scope = 'project' AND a.type = 'CodeFile' AND (lower(a.path) = lower($wanted) OR (a.name IS NOT NULL AND lower(a.name) = lower($wanted))) RETURN a.id AS id, a.path AS path",
                    { wanted }
                );
                if (!rows.length) return { file: wanted, found: false, candidates: [], files: [] };
                const exact = rows.find(r => r.path === wanted) ?? rows.find(r => r.path.toLowerCase() === wanted.toLowerCase());
                let matched = exact;
                if (!matched && !wanted.includes('/')) {
                    if (rows.length === 1) matched = rows[0];
                    else return { file: wanted, found: false, candidates: rows.map(r => r.path).sort(), files: [] };
                }
                if (!matched) return { file: wanted, found: false, candidates: [], files: [] };
                const edges = await graph.query(
                    "MATCH (b:Entity)-[e:RELATES]->(a:Entity) WHERE a.id = $id AND e.relation = 'IMPORTS' AND b.type = 'CodeFile' AND b.path <> a.path RETURN DISTINCT b.path AS path",
                    { id: matched.id }
                );
                return { file: matched.path, found: true, candidates: [], files: edges.map(e => e.path).sort() };
            });
        },

        async directFunctionViewGraph(symbol) {
            if (!fs.existsSync(location())) return { nodes: [], edges: [] };
            return withGraph(async graph => {
                const defRows = await graph.query(
                    `MATCH (n:Entity) WHERE n.scope = 'project' AND n.type = 'CodeFile' AND (n.kind <> 'test' OR n.kind IS NULL) AND n.metadata_json CONTAINS $symbol RETURN ${nodeReturn}`,
                    { symbol }
                );
                const defNodes = defRows.map(rowToNode);
                const defIds = defNodes.map(n => n.id);
                if (!defIds.length) return { nodes: [], edges: [] };

                const barrelRows = await graph.query(
                    `MATCH (n:Entity)-[e:RELATES]->(target:Entity) WHERE n.scope = 'project' AND target.id IN $defIds AND e.relation = 'IMPORTS' AND (n.name = 'index.js' OR ends_with(n.path, '/index.js')) RETURN ${nodeReturn}`,
                    { defIds }
                );
                const barrelNodes = barrelRows.map(rowToNode);
                const targetIds = [...new Set([...defIds, ...barrelNodes.map(node => node.id)])];

                const edgeRows = await graph.query(
                    "MATCH (caller:Entity)-[e:RELATES]->(target:Entity) WHERE caller.scope = 'project' AND target.id IN $targetIds "
                    + "RETURN caller.id AS from_id, target.id AS to_id, e.relation AS relation, e.confidence AS confidence, e.weight AS weight, e.created_at AS created_at, e.updated_at AS updated_at",
                    { targetIds }
                );
                const callerIds = [...new Set(edgeRows.map(e => e.from_id))];
                const callerRows = callerIds.length ? await graph.query(
                    `MATCH (n:Entity) WHERE n.id IN $callerIds RETURN ${nodeReturn}`,
                    { callerIds }
                ) : [];

                const docRows = await graph.query(
                    `MATCH (n:Entity) WHERE n.scope = 'project' AND n.type = 'Document' AND (n.metadata_json CONTAINS $symbol OR n.documentation CONTAINS $symbol) RETURN ${nodeReturn}`,
                    { symbol }
                );

                const allNodes = new Map();
                for (const n of [...defNodes, ...barrelNodes, ...callerRows.map(rowToNode), ...docRows.map(rowToNode)]) {
                    allNodes.set(n.id, n);
                }
                const ids = new Set(allNodes.keys());
                return {
                    nodes: Array.from(allNodes.values()),
                    edges: edgeRows.filter(e => ids.has(e.from_id) && ids.has(e.to_id)).map(rowToEdge)
                };
            });
        }
    };
}
