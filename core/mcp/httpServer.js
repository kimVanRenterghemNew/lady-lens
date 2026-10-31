/**
 * HTTP / SSE Server for lady-lens MCP.
 * Provides a Server-Sent Events (SSE) transport endpoint and an informative status page.
 * TODO(coverage): Current line coverage is 74.57% (< 85% target). Raise to >= 85%.
 * @module core/mcp/httpServer
 */
import http from 'http';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { createLadyLensMcpServer, buildMcpToolSchemas } from './server.js';
import { resolveRepoTarget, idOfRepo } from '../repository/index.js';

export function createMcpDashboardHtml({ repo, port, tools, uiPort = 4317 }) {
    const toolRows = tools.map(t => `
        <tr>
            <td style="font-family: monospace; font-weight: 600; color: #1e293b; padding: 10px 12px; border-bottom: 1px solid #e2e8f0;">${t.name}</td>
            <td style="color: #475569; padding: 10px 12px; border-bottom: 1px solid #e2e8f0; font-size: 14px;">${t.description}</td>
        </tr>
    `).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>lady-lens MCP Server</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        :root {
            --bg: #f8fafc;
            --card-bg: #ffffff;
            --text-main: #0f172a;
            --text-muted: #64748b;
            --accent: #2563eb;
            --border: #e2e8f0;
            --success: #16a34a;
        }
        body {
            margin: 0;
            padding: 32px 16px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background: var(--bg);
            color: var(--text-main);
            overflow-x: clip;
        }
        .container {
            max-width: 860px;
            margin: 0 auto;
        }
        .header {
            margin-bottom: 24px;
        }
        .badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: #dcfce7;
            color: #166534;
            padding: 4px 10px;
            border-radius: 9999px;
            font-size: 13px;
            font-weight: 600;
        }
        .badge::before {
            content: "";
            width: 8px;
            height: 8px;
            background: var(--success);
            border-radius: 50%;
        }
        h1 {
            font-size: 26px;
            margin: 12px 0 6px 0;
            font-weight: 700;
            letter-spacing: -0.02em;
        }
        .subtitle {
            color: var(--text-muted);
            margin: 0;
            font-size: 15px;
        }
        .card {
            background: var(--card-bg);
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 24px;
        }
        .card h2 {
            font-size: 16px;
            margin: 0 0 14px 0;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: var(--text-muted);
        }
        .meta-row {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            border-bottom: 1px solid #f1f5f9;
            font-size: 14px;
        }
        .meta-row:last-child {
            border-bottom: none;
        }
        .meta-label {
            color: var(--text-muted);
        }
        .meta-value {
            font-family: monospace;
            font-weight: 500;
        }
        .meta-value a {
            color: var(--accent);
            text-decoration: none;
        }
        .meta-value a:hover {
            text-decoration: underline;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            text-align: left;
        }
        th {
            background: #f8fafc;
            color: var(--text-muted);
            font-size: 13px;
            text-transform: uppercase;
            padding: 10px 12px;
            border-bottom: 1px solid var(--border);
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <span class="badge">Running</span>
            <h1>lady-lens MCP Server</h1>
            <p class="subtitle">Model Context Protocol endpoint for AI coding agents</p>
        </div>

        <div class="card">
            <h2>Connection Endpoints</h2>
            <div class="meta-row">
                <span class="meta-label">SSE Endpoint</span>
                <span class="meta-value"><a href="http://127.0.0.1:${port}/sse">http://127.0.0.1:${port}/sse</a></span>
            </div>
            <div class="meta-row">
                <span class="meta-label">Active Repository</span>
                <span class="meta-value">${repo}</span>
            </div>
            <div class="meta-row">
                <span class="meta-label">UI Dashboard</span>
                <span class="meta-value"><a href="http://127.0.0.1:${uiPort}" target="_blank">http://127.0.0.1:${uiPort}</a></span>
            </div>
        </div>

        <div class="card">
            <h2>Available MCP Tools (${tools.length})</h2>
            <table>
                <thead>
                    <tr>
                        <th style="width: 180px;">Tool</th>
                        <th>Description</th>
                    </tr>
                </thead>
                <tbody>
                    ${toolRows}
                </tbody>
            </table>
        </div>
    </div>
</body>
</html>`;
}

export function createMcpHttpServer({ defaultRepo = process.cwd(), port = 4318, uiPort = 4317 } = {}) {
    const server = createLadyLensMcpServer({ defaultRepo });
    const sessions = new Map();
    const toolSchemas = buildMcpToolSchemas();

    const resolved = resolveRepoTarget(defaultRepo) || {
        path: defaultRepo,
        id: idOfRepo(defaultRepo)
    };

    const setCors = (res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    };

    const httpServer = http.createServer(async (req, res) => {
        setCors(res);
        if (req.method === 'OPTIONS') {
            res.writeHead(204).end();
            return;
        }

        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

        if (url.pathname === '/ui') {
            res.writeHead(302, { Location: `http://127.0.0.1:${uiPort}/` }).end();
            return;
        }

        if (url.pathname === '/sse') {
            if (req.method !== 'GET') {
                res.writeHead(405).end('Method Not Allowed');
                return;
            }

            // If a browser navigates to /sse directly expecting HTML:
            if (req.headers.accept?.includes('text/html') && !req.headers.accept?.includes('text/event-stream')) {
                const currentPort = httpServer.address()?.port || port;
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(`<!DOCTYPE html><html><body style="font-family: -apple-system, sans-serif; padding: 32px; line-height: 1.5; color: #1e293b;">
                    <h2>lady-lens MCP Server: SSE Endpoint</h2>
                    <p>This endpoint (<code>http://127.0.0.1:${currentPort}/sse</code>) is a Server-Sent Events (SSE) stream for MCP clients (Cursor, Claude Code, Antigravity, etc.).</p>
                    <p>Configure this URL in your MCP client settings.</p>
                    <p><a href="/">View MCP Dashboard</a> &nbsp;|&nbsp; <a href="http://127.0.0.1:${uiPort}">Open UI Dashboard</a></p>
                </body></html>`);
                return;
            }

            const transport = new SSEServerTransport('/messages', res);
            sessions.set(transport.sessionId, transport);
            transport.onclose = () => {
                sessions.delete(transport.sessionId);
            };

            await server.connect(transport);
            return;
        }

        if (url.pathname === '/messages') {
            if (req.method !== 'POST') {
                res.writeHead(405).end('Method Not Allowed');
                return;
            }

            const sessionId = url.searchParams.get('sessionId');
            if (!sessionId || !sessions.has(sessionId)) {
                res.writeHead(404).end('Session not found or expired');
                return;
            }

            const transport = sessions.get(sessionId);
            await transport.handlePostMessage(req, res);
            return;
        }

        if (url.pathname === '/' || url.pathname === '/status') {
            const currentPort = httpServer.address()?.port || port;
            const html = createMcpDashboardHtml({
                repo: resolved.path,
                port: currentPort,
                tools: toolSchemas,
                uiPort
            });
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(html);
            return;
        }

        res.writeHead(404).end('Not Found');
    });

    return {
        httpServer,
        server,
        start: (listenPort = port, host = '127.0.0.1') => new Promise((resolve) => {
            httpServer.listen(listenPort, host, () => {
                const actualPort = httpServer.address().port;
                resolve({ port: actualPort, host });
            });
        }),
        close: () => new Promise((resolve) => {
            httpServer.close(() => resolve());
        })
    };
}
