// The local search page of lady-lens (`lens ui`): the same tools as `lens ask`, plus an overview of files and their
// edges. Read-only: only the question tools; it listens on 127.0.0.1 only.
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { codeHealth } from '../core/graph/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = fs.readFileSync(path.join(HERE, 'graph-ui.html'), 'utf8');
const CSS = fs.readFileSync(path.join(HERE, 'graph-ui.css'), 'utf8');
const EDGE_TYPES = new Set(['IMPORTS', 'TESTS', 'READS', 'RUNS']);

/** Files (code and documents) and their import/test edges, small enough for the browser; code files carry their health issues (the ring). */
export function overviewOf({ nodes, edges }) {
    const health = new Map(codeHealth({ nodes: new Map(nodes.map(node => [node.id, node])), edges }).files.map(entry => [entry.path, entry.issues]));
    const files = nodes.filter(node => ['CodeFile', 'Document', 'Config'].includes(node.type) && typeof node.path === 'string');
    const ids = new Set(files.map(node => node.id));
    return {
        nodes: files.map(node => ({ id: node.id, path: node.path, kind: node.kind ?? (node.type === 'Document' ? 'doc' : 'code'), folder: node.path.split('/').slice(0, 2).join('/'), issues: health.get(node.path) || [] })),
        edges: edges.filter(edge => EDGE_TYPES.has(edge.type) && ids.has(edge.from) && ids.has(edge.to)).map(edge => ({ from: edge.from, to: edge.to, type: edge.type }))
    };
}

/**
 * @param {{tools: Record<string, Function>, loadOverview: () => Promise<{nodes: object[], edges: object[]}>}} deps
 * @returns {http.Server}
 */
export function createGraphUiServer({ tools, loadOverview, repo = null }) {
    const send = (res, status, body, type = 'application/json; charset=utf-8') => {
        res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
        res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
    };
    return http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://localhost');
        try {
            if (url.pathname === '/') return send(res, 200, PAGE, 'text/html; charset=utf-8');
            if (url.pathname === '/graph-ui.css') return send(res, 200, CSS, 'text/css; charset=utf-8');
            if (url.pathname === '/api/tools') return send(res, 200, Object.keys(tools));
            if (url.pathname === '/api/repo') return send(res, 200, { repo });
            if (url.pathname === '/api/overview') return send(res, 200, overviewOf(await loadOverview()));
            if (url.pathname === '/api/health') {
                if (tools.health) return send(res, 200, await tools.health({}));
                const ov = await loadOverview();
                const rep = codeHealth({ nodes: new Map(ov.nodes.map(n => [n.id, n])), edges: ov.edges });
                return send(res, 200, {
                    relation: 'health',
                    summary: rep.summary,
                    topCentralNodes: rep.topCentralNodes || [],
                    zoneOfPain: rep.zoneOfPain || [],
                    complexFunctions: (rep.complexFunctions || []).slice(0, 30),
                    hotspots: rep.hotspots || [],
                    cycles: rep.cycles || []
                });
            }
            if (url.pathname === '/api/ask') {
                const name = url.searchParams.get('tool');
                if (!tools[name]) return send(res, 400, { error: `unknown tool "${name}"; available: ${Object.keys(tools).join(', ')}` });
                let args;
                try { args = JSON.parse(url.searchParams.get('args') ?? '{}'); } catch (error) { return send(res, 400, { error: `args must be JSON: ${error.message}` }); }
                return send(res, 200, await tools[name](args));
            }
            return send(res, 404, { error: 'not found' });
        } catch (error) {
            return send(res, 500, { error: error.message });
        }
    });
}
