// TODO(coverage): Current line coverage is 82.5% (< 85% target). Raise to >= 85%.
import { PROJECT_SCOPE, parseJson, rowToNode, rowToEdge } from '../../model/index.js';

export function createMemoryDirectQueries(nodes, edges, isWritten) {
    return {
        async directDefinedIn(symbol) {
            if (!isWritten()) return [];
            const locations = [];
            for (const row of nodes.values()) {
                if (row.scope !== PROJECT_SCOPE || row.type !== 'CodeFile' || row.kind === 'test') continue;
                const meta = parseJson(row.metadata_json, {});
                const range = meta.symbolRanges?.[symbol];
                const isRange = Array.isArray(range);
                const isExported = Array.isArray(meta.exports) && meta.exports.includes(symbol);
                if (isRange || isExported) {
                    locations.push(isRange ? { path: row.path, startLine: range[0], endLine: range[1] } : { path: row.path });
                }
            }
            return locations.sort((a, b) => a.path.localeCompare(b.path));
        },

        async directExports(file) {
            const wanted = String(file ?? '').trim().replace(/\\/g, '/').replace(/^file:/i, '').replace(/^\.\//, '');
            if (!wanted || !isWritten()) return { file: wanted, found: false, candidates: [], names: [] };
            const candidates = [];
            for (const row of nodes.values()) {
                if (row.scope !== PROJECT_SCOPE || row.type !== 'CodeFile') continue;
                if (row.path.toLowerCase() === wanted.toLowerCase() || (row.name && row.name.toLowerCase() === wanted.toLowerCase())) {
                    candidates.push(row);
                }
            }
            if (!candidates.length) return { file: wanted, found: false, candidates: [], names: [] };
            const exact = candidates.find(r => r.path === wanted) ?? candidates.find(r => r.path.toLowerCase() === wanted.toLowerCase());
            if (exact) {
                const meta = parseJson(exact.metadata_json, {});
                const names = [...new Set((meta.exports || []).filter(n => typeof n === 'string'))].sort();
                return { file: exact.path, found: true, candidates: [], names };
            }
            if (!wanted.includes('/')) {
                if (candidates.length === 1) {
                    const meta = parseJson(candidates[0].metadata_json, {});
                    const names = [...new Set((meta.exports || []).filter(n => typeof n === 'string'))].sort();
                    return { file: candidates[0].path, found: true, candidates: [], names };
                }
                return { file: wanted, found: false, candidates: candidates.map(r => r.path).sort(), names: [] };
            }
            return { file: wanted, found: false, candidates: [], names: [] };
        },

        async directExists(file) {
            const wanted = String(file ?? '').trim().replace(/\\/g, '/').replace(/^file:/i, '').replace(/^\.\//, '');
            if (!wanted || !isWritten()) return { file: wanted, exists: false, similar: [] };
            const base = wanted.split('/').pop().toLowerCase();
            let exists = false;
            const similar = [];
            for (const row of nodes.values()) {
                if (row.scope !== PROJECT_SCOPE || (row.type !== 'CodeFile' && row.type !== 'Document')) continue;
                if (row.path.toLowerCase() === wanted.toLowerCase()) exists = true;
                else if (row.path.split('/').pop().toLowerCase() === base) similar.push(row.path);
            }
            return { file: wanted, exists, similar: exists ? [] : similar.sort() };
        },

        async directImports(file) {
            const wanted = String(file ?? '').trim().replace(/\\/g, '/').replace(/^file:/i, '').replace(/^\.\//, '');
            if (!wanted || !isWritten()) return { file: wanted, found: false, candidates: [], files: [] };
            const candidates = [];
            for (const row of nodes.values()) {
                if (row.scope !== PROJECT_SCOPE || row.type !== 'CodeFile') continue;
                if (row.path.toLowerCase() === wanted.toLowerCase() || (row.name && row.name.toLowerCase() === wanted.toLowerCase())) {
                    candidates.push(row);
                }
            }
            if (!candidates.length) return { file: wanted, found: false, candidates: [], files: [] };
            const exact = candidates.find(r => r.path === wanted) ?? candidates.find(r => r.path.toLowerCase() === wanted.toLowerCase());
            let matched = exact;
            if (!matched && !wanted.includes('/')) {
                if (candidates.length === 1) matched = candidates[0];
                else return { file: wanted, found: false, candidates: candidates.map(r => r.path).sort(), files: [] };
            }
            if (!matched) return { file: wanted, found: false, candidates: [], files: [] };
            const results = new Set();
            for (const edge of edges.values()) {
                if (edge.from_id === matched.id && edge.relation === 'IMPORTS') {
                    const toNode = nodes.get(edge.to_id);
                    if (toNode && toNode.type === 'CodeFile' && toNode.path !== matched.path) {
                        results.add(toNode.path);
                    }
                }
            }
            return { file: matched.path, found: true, candidates: [], files: [...results].sort() };
        },

        async directImportedBy(file) {
            const wanted = String(file ?? '').trim().replace(/\\/g, '/').replace(/^file:/i, '').replace(/^\.\//, '');
            if (!wanted || !isWritten()) return { file: wanted, found: false, candidates: [], files: [] };
            const candidates = [];
            for (const row of nodes.values()) {
                if (row.scope !== PROJECT_SCOPE || row.type !== 'CodeFile') continue;
                if (row.path.toLowerCase() === wanted.toLowerCase() || (row.name && row.name.toLowerCase() === wanted.toLowerCase())) {
                    candidates.push(row);
                }
            }
            if (!candidates.length) return { file: wanted, found: false, candidates: [], files: [] };
            const exact = candidates.find(r => r.path === wanted) ?? candidates.find(r => r.path.toLowerCase() === wanted.toLowerCase());
            let matched = exact;
            if (!matched && !wanted.includes('/')) {
                if (candidates.length === 1) matched = candidates[0];
                else return { file: wanted, found: false, candidates: candidates.map(r => r.path).sort(), files: [] };
            }
            if (!matched) return { file: wanted, found: false, candidates: [], files: [] };
            const results = new Set();
            for (const edge of edges.values()) {
                if (edge.to_id === matched.id && edge.relation === 'IMPORTS') {
                    const fromNode = nodes.get(edge.from_id);
                    if (fromNode && fromNode.type === 'CodeFile' && fromNode.path !== matched.path) {
                        results.add(fromNode.path);
                    }
                }
            }
            return { file: matched.path, found: true, candidates: [], files: [...results].sort() };
        },

        async directFunctionViewGraph(symbol) {
            if (!isWritten()) return { nodes: [], edges: [] };
            const defNodes = [];
            for (const r of nodes.values()) {
                if (r.scope !== PROJECT_SCOPE || r.type !== 'CodeFile' || r.kind === 'test') continue;
                if (String(r.metadata_json ?? '').includes(symbol)) defNodes.push(rowToNode(r));
            }
            const defIds = new Set(defNodes.map(n => n.id));
            if (!defIds.size) return { nodes: [], edges: [] };

            const barrelNodes = [];
            for (const r of nodes.values()) {
                if (r.scope !== PROJECT_SCOPE || (r.name !== 'index.js' && !String(r.path).endsWith('/index.js'))) continue;
                for (const edge of edges.values()) {
                    if (edge.from_id === r.id && defIds.has(edge.to_id) && edge.relation === 'IMPORTS') {
                        barrelNodes.push(rowToNode(r));
                        break;
                    }
                }
            }
            const targetIds = new Set([...defIds, ...barrelNodes.map(n => n.id)]);
            const matchedEdges = [];
            const callerIds = new Set();
            for (const edge of edges.values()) {
                if (targetIds.has(edge.to_id)) {
                    matchedEdges.push(rowToEdge(edge));
                    callerIds.add(edge.from_id);
                }
            }
            const callerNodes = [];
            for (const id of callerIds) {
                const r = nodes.get(id);
                if (r) callerNodes.push(rowToNode(r));
            }

            const docNodes = [];
            for (const r of nodes.values()) {
                if (r.scope !== PROJECT_SCOPE || r.type !== 'Document') continue;
                if (String(r.metadata_json ?? '').includes(symbol) || String(r.documentation ?? '').includes(symbol)) {
                    docNodes.push(rowToNode(r));
                }
            }

            const allNodes = new Map();
            for (const n of [...defNodes, ...barrelNodes, ...callerNodes, ...docNodes]) {
                allNodes.set(n.id, n);
            }
            const allIds = new Set(allNodes.keys());
            return {
                nodes: Array.from(allNodes.values()),
                edges: matchedEdges.filter(e => allIds.has(e.from) && allIds.has(e.to))
            };
        }
    };
}
