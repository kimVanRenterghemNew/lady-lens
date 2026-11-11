// The local search page of lady-lens (`lens ui`): the same tools as `lens ask`, plus an overview of files and their
// edges. Read-only: only the question tools; it listens on 127.0.0.1 only.
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { codeHealth } from '../core/graph/index.js';
import { traceView, locateFrames, callFlow, toMermaid, codeHistory } from '../core/search/index.js';
import { createGit } from '../core/git/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = name => fs.readFileSync(path.join(HERE, name), 'utf8');
// `<!-- graph-ui-x.html -->` in the page takes in that part (its own script), so each part stays a small file.
const PAGE = read('graph-ui.html').replace(/<!-- (graph-ui-[\w-]+\.html) -->/g, (_, name) => read(name));
const CSS = read('graph-ui.css');
const MAX_TRACE_BYTES = 256 * 1024;
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

/** The health of one code file for the code view: its issues and its complex functions (lines, complexity, issues). */
function healthOf({ nodes, edges }, filePath) {
    const entry = codeHealth({ nodes: new Map(nodes.map(node => [node.id, node])), edges }, { only: [filePath] }).files.find(file => file.path === filePath);
    return entry ? { issues: entry.issues, functions: (entry.complexFunctions || []).map(({ name, loc, cyclomaticComplexity, lines, issues }) => ({ name, loc, cyclomaticComplexity, lines, issues })) } : null;
}

/** The request body as text, or null when it is longer than `max` bytes. */
function readBody(req, max) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', chunk => { size += chunk.length; if (size <= max) chunks.push(chunk); });
        req.on('end', () => resolve(size > max ? null : Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

const ROUTE_HANDLERS = {
    '/'(_req, res, _url, { send }) {
        send(res, 200, PAGE, 'text/html; charset=utf-8');
    },

    '/graph-ui.css'(_req, res, _url, { send }) {
        send(res, 200, CSS, 'text/css; charset=utf-8');
    },

    '/api/tools'(_req, res, _url, { send, tools }) {
        send(res, 200, Object.keys(tools));
    },

    '/api/repos'(_req, res, _url, { send, listRepos }) {
        send(res, 200, listRepos().map(({ id, path: repoPath }) => ({ id, path: repoPath })));
    },

    async '/api/repo'(_req, res, url, { send, inRepo, repo }) {
        send(res, 200, await inRepo(url, target => ({ repo: target?.path ?? repo })));
    },

    async '/api/overview'(_req, res, url, { send, inRepo, loadOverview }) {
        send(res, 200, await inRepo(url, async () => overviewOf(await loadOverview())));
    },

    async '/api/trace'(req, res, url, { send, inRepo, loadOverview }) {
        if (req.method !== 'POST') return send(res, 405, { error: 'POST the stack trace as the body' });
        const text = await readBody(req, MAX_TRACE_BYTES);
        if (text === null) return send(res, 413, { error: `stack trace over ${MAX_TRACE_BYTES} bytes` });
        send(res, 200, await inRepo(url, async () => traceView(text, (await loadOverview()).nodes)));
    },

    async '/api/at'(_req, res, url, { send, inRepo, loadOverview }) {
        const file = url.searchParams.get('path');
        const line = Number(url.searchParams.get('line')) || 1;
        if (!file) return send(res, 400, { error: 'path is required' });
        send(res, 200, await inRepo(url, async () => {
            const graph = await loadOverview();
            const at = locateFrames([{ file, line }], graph.nodes)[0];
            return { ...at, health: at.path ? healthOf(graph, at.path) : null };
        }));
    },

    async '/api/flow'(_req, res, url, { send, inRepo, tools }) {
        const symbol = url.searchParams.get('symbol');
        if (!symbol) return send(res, 400, { error: 'symbol is required' });
        const args = { symbol, path: url.searchParams.get('path'), depth: url.searchParams.get('depth'), direction: url.searchParams.get('direction') || 'both' };
        send(res, 200, await inRepo(url, async () => {
            const flow = await callFlow({ ...args, ...(tools.functionView ? { view: tools.functionView } : {}) });
            return { ...flow, mermaid: toMermaid(flow, flow.root ? [flow.root] : []) };
        }));
    },

    async '/api/history'(_req, res, url, { send, inRepo, repo, loadOverview, gitFor }) {
        const file = url.searchParams.get('path');
        if (!file) return send(res, 400, { error: 'path is required' });
        send(res, 200, await inRepo(url, async target => {
            const root = target?.path ?? repo;
            return codeHistory({ path: file, symbol: url.searchParams.get('symbol'), root, graph: await loadOverview(), git: gitFor(root) });
        }));
    },

    async '/api/health'(_req, res, url, { send, inRepo, tools, loadOverview }) {
        send(res, 200, await inRepo(url, async () => {
            if (tools.health) return tools.health({});
            const ov = await loadOverview();
            const rep = codeHealth({ nodes: new Map(ov.nodes.map(n => [n.id, n])), edges: ov.edges });
            return {
                relation: 'health',
                summary: rep.summary,
                topCentralNodes: rep.topCentralNodes,
                zoneOfPain: rep.zoneOfPain,
                complexFunctions: rep.complexFunctions.slice(0, 30),
                designSmells: (rep.designSmells || []).slice(0, 30),
                hotspots: rep.hotspots,
                cycles: rep.cycles
            };
        }));
    },

    async '/api/ask'(_req, res, url, { send, inRepo, tools }) {
        const name = url.searchParams.get('tool');
        if (!tools[name]) return send(res, 400, { error: `unknown tool "${name}"; available: ${Object.keys(tools).join(', ')}` });
        let args;
        try {
            args = JSON.parse(url.searchParams.get('args') ?? '{}');
        } catch (error) {
            return send(res, 400, { error: `args must be JSON: ${error.message}` });
        }
        send(res, 200, await inRepo(url, () => tools[name](args)));
    }
};

/**
 * @param {{tools: Record<string, Function>, loadOverview: () => Promise<{nodes: object[], edges: object[]}>}} deps
 * @returns {http.Server}
 */
export function createGraphUiServer({ tools, loadOverview, repo = null, runInRepo = null, listRepos = () => [], gitFor = root => createGit({ root }) }) {
    const send = (res, status, body, type = 'application/json; charset=utf-8') => {
        res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
        res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
    };
    const inRepo = (url, fn) => runInRepo ? runInRepo(url.searchParams.get('repo'), fn) : fn({ path: repo });
    const ctx = { send, inRepo, tools, loadOverview, repo, gitFor, listRepos };

    return http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://localhost');
        try {
            const handler = ROUTE_HANDLERS[url.pathname];
            if (!handler) return send(res, 404, { error: 'not found' });
            await handler(req, res, url, ctx);
        } catch (error) {
            send(res, error.status || 500, { error: error.message });
        }
    });
}
