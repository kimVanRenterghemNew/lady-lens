/**
 * HTTP / SSE Server for lady-lens MCP.
 * Provides a Server-Sent Events (SSE) transport endpoint and an informative status page.
 * @module core/mcp/httpServer
 */
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { createLadyLensMcpServer, buildMcpToolSchemas, MCP_SERVER_INFO } from './server.js';
import { handleStreamableHttpRequest } from './streamableHttp.js';
import { resolveRepoTarget, idOfRepo } from '../repository/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_TEMPLATE = fs.readFileSync(path.join(HERE, 'mcpDashboard.html'), 'utf8');
const ROW_TEMPLATE = fs.readFileSync(path.join(HERE, 'mcpToolRow.html'), 'utf8');

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, ch => HTML_ESCAPES[ch]);
// a replacer function, so a `$&` or `$'` in a value is inserted as text, not expanded as a replace pattern
const fill = (template, values) => template.replace(/{{(\w+)}}/g, (match, key) => (key in values ? values[key] : match));

export function createMcpDashboardHtml({ repo, port, tools, uiPort = 4317 }) {
    const toolRows = tools.map(t => fill(ROW_TEMPLATE, { NAME: escapeHtml(t.name), DESC: escapeHtml(t.description) })).join('');
    return fill(DASHBOARD_TEMPLATE, {
        VERSION: escapeHtml(MCP_SERVER_INFO.version), PORT: String(port), REPO: escapeHtml(repo),
        UI_PORT: String(uiPort), TOOL_COUNT: String(tools.length), TOOL_ROWS: toolRows
    });
}

function resolveDefaultTarget(defaultRepo) {
    const target = resolveRepoTarget(defaultRepo);
    if (target) return target;
    return { path: defaultRepo, id: idOfRepo(defaultRepo) };
}

function setCors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function renderStatusHtml(res, ctx) {
    const currentPort = ctx.httpServer.address()?.port || ctx.port;
    const html = createMcpDashboardHtml({
        repo: ctx.resolved.path,
        port: currentPort,
        tools: ctx.toolSchemas,
        uiPort: ctx.uiPort
    });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
}

const MCP_ROUTES = {
    '/ui'(_req, res, _url, ctx) {
        res.writeHead(302, { Location: `http://127.0.0.1:${ctx.uiPort}/` }).end();
    },

    async '/mcp'(req, res, _url, ctx) {
        await handleStreamableHttpRequest(req, res, { defaultRepo: ctx.defaultRepo });
    },

    async '/sse'(req, res, _url, ctx) {
        if (req.method !== 'GET') {
            res.writeHead(405).end('Method Not Allowed');
            return;
        }
        const transport = new SSEServerTransport('/messages', res);
        ctx.sessions.set(transport.sessionId, transport);
        transport.onclose = () => { ctx.sessions.delete(transport.sessionId); };
        await ctx.server.connect(transport);
    },

    async '/messages'(req, res, url, ctx) {
        if (req.method !== 'POST') {
            res.writeHead(405).end('Method Not Allowed');
            return;
        }
        const sessionId = url.searchParams.get('sessionId');
        if (!sessionId || !ctx.sessions.has(sessionId)) {
            res.writeHead(404).end('Session not found or expired');
            return;
        }
        const transport = ctx.sessions.get(sessionId);
        await transport.handlePostMessage(req, res);
    },

    '/'(_req, res, _url, ctx) { renderStatusHtml(res, ctx); },
    '/status'(_req, res, _url, ctx) { renderStatusHtml(res, ctx); }
};

const DEFAULTS = Object.freeze({
    port: 4318,
    uiPort: 4317
});

function parseServerConfig(opts) {
    const config = Object.assign({}, DEFAULTS, opts);
    if (!config.defaultRepo) config.defaultRepo = process.cwd();
    return config;
}

export function createMcpHttpServer(opts) {
    const config = parseServerConfig(opts);
    const server = createLadyLensMcpServer({ defaultRepo: config.defaultRepo });
    const sessions = new Map();
    const toolSchemas = buildMcpToolSchemas();
    const resolved = resolveDefaultTarget(config.defaultRepo);

    let httpServer;
    const ctx = {
        uiPort: config.uiPort,
        defaultRepo: config.defaultRepo,
        server,
        sessions,
        resolved,
        toolSchemas,
        port: config.port,
        get httpServer() { return httpServer; }
    };

    httpServer = http.createServer(async (req, res) => {
        setCors(res);
        if (req.method === 'OPTIONS') {
            res.writeHead(204).end();
            return;
        }
        const host = req.headers.host || 'localhost';
        const url = new URL(req.url, `http://${host}`);
        const handler = MCP_ROUTES[url.pathname];
        if (!handler) {
            res.writeHead(404).end('Not Found');
            return;
        }
        await handler(req, res, url, ctx);
    });

    return {
        httpServer,
        server,
        start: (listenPort = config.port, host = '127.0.0.1') => new Promise(resolve => {
            httpServer.listen(listenPort, host, () => {
                const actualPort = httpServer.address().port;
                resolve({ port: actualPort, host });
            });
        }),
        close: () => new Promise(resolve => {
            httpServer.close(() => resolve());
        })
    };
}
