import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { createMcpHttpServer, createMcpDashboardHtml, handleStreamableHttpRequest, MCP_SERVER_INFO } from '../core/mcp/index.js';

describe('MCP HTTP/SSE Server', () => {
    it("status page: a tool description with $' or markup stays text and does not break the page", () => {
        const html = createMcpDashboardHtml({ repo: 'C:/r&d', port: 4318, tools: [{ name: 'x', description: "costs $' and <b>more</b>" }] });
        expect(html).toContain('costs $&#39; and &lt;b&gt;more&lt;/b&gt;');
        expect(html).toContain('C:/r&amp;d');
        expect(html).not.toMatch(/{{[A-Z_]+}}/);
        expect(html.match(/<\/html>/gi)).toHaveLength(1);
    });

    it('returns a JSON error when the Streamable HTTP server fails', async () => {
        const response = {
            headersSent: false,
            writableEnded: false,
            writeHead(status) { this.status = status; },
            end(body) { this.body = body; this.writableEnded = true; }
        };
        await handleStreamableHttpRequest(
            { method: 'POST' },
            response,
            { defaultRepo: process.cwd(), createServer: () => ({ connect: async () => { throw new Error('test failure'); }, close: async () => {} }), createTransport: () => ({ close: async () => {} }) }
        );
        expect(response.status).toBe(500);
        expect(JSON.parse(response.body).error).toBe('test failure');
    });

    it('rejects a ?repo= that is not registered', async () => {
        const response = {
            headersSent: false,
            writableEnded: false,
            writeHead(status) { this.status = status; return this; },
            end(body) { this.body = body; this.writableEnded = true; }
        };
        await handleStreamableHttpRequest(
            { method: 'POST', url: '/mcp?repo=' + encodeURIComponent('Z:\\not\\registered\\anywhere'), headers: {} },
            response,
            { defaultRepo: process.cwd(), createServer: () => { throw new Error('must not start'); } }
        );
        expect(response.status).toBe(403);
        expect(JSON.parse(response.body).error).toContain('lens add');
    });

    it('rejects unsupported methods on /mcp', async () => {
        const mcpHttp = createMcpHttpServer({ defaultRepo: process.cwd(), port: 0 });
        const { port } = await mcpHttp.start(0);
        try {
            const response = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'PUT' });
            expect(response.status).toBe(405);
            expect(response.headers.get('allow')).toContain('POST');
        } finally {
            await mcpHttp.close();
        }
    });

    it('answers GET on /mcp with 405 (stateless: no event stream) and accepts DELETE', async () => {
        const mcpHttp = createMcpHttpServer({ defaultRepo: process.cwd(), port: 0 });
        const { port } = await mcpHttp.start(0);
        try {
            const headers = { Accept: 'application/json, text/event-stream' };
            const get = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'GET', headers });
            expect(get.status).toBe(405);
            expect(get.headers.get('allow')).toBe('POST, DELETE');
            expect([200, 400]).toContain((await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'DELETE', headers })).status);
        } finally {
            await mcpHttp.close();
        }
    });

    it('serves stateless Streamable HTTP at /mcp', async () => {
        const mcpHttp = createMcpHttpServer({ defaultRepo: process.cwd(), port: 0 });
        const { port } = await mcpHttp.start(0);
        try {
            const endpoint = `http://127.0.0.1:${port}/mcp`;
            const headers = { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' };
            const initialize = await fetch(endpoint, {
                method: 'POST', headers,
                body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } } })
            });
            expect(initialize.status).toBe(200);
            const sessionId = initialize.headers.get('mcp-session-id');
            const notification = await fetch(endpoint, {
                method: 'POST', headers: sessionId ? { ...headers, 'mcp-session-id': sessionId } : headers,
                body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
            });
            expect(notification.status).toBe(202);
            const tools = await fetch(endpoint, {
                method: 'POST', headers: sessionId ? { ...headers, 'mcp-session-id': sessionId } : headers,
                body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
            });
            expect(tools.status).toBe(200);
            const body = await tools.text();
            const payload = tools.headers.get('content-type')?.includes('text/event-stream')
                ? JSON.parse(body.split('data: ').at(-1).trim())
                : JSON.parse(body);
            expect(payload.result.tools.length).toBeGreaterThan(10);
        } finally {
            await mcpHttp.close();
        }
    });

    it('serves dashboard HTML and SSE transport for MCP clients', async () => {
        const mcpHttp = createMcpHttpServer({ defaultRepo: process.cwd(), port: 0 });
        const { port } = await mcpHttp.start(0);

        try {
            // 1. Dashboard test
            const res = await fetch(`http://127.0.0.1:${port}/`);
            expect(res.status).toBe(200);
            const html = await res.text();
            expect(html).toContain('lady-lens MCP Server');
            expect(html).toContain(`Running · v${MCP_SERVER_INFO.version}`);
            expect(html).toContain(`http://127.0.0.1:${port}/mcp`);
            expect(html).toContain(`http://127.0.0.1:${port}/sse`);
            expect(html).toContain('read_chunk');
            expect(html).toContain('grep');

            // 2. Client connection over SSE
            const sseUrl = new URL(`http://127.0.0.1:${port}/sse`);
            const clientTransport = new SSEClientTransport(sseUrl);

            const client = new Client(
                { name: 'test-sse-client', version: '1.0.0' },
                { capabilities: {} }
            );

            await client.connect(clientTransport);

            // 3. List tools over SSE
            const { tools } = await client.listTools();
            expect(tools.length).toBeGreaterThan(10);
            expect(tools.some(t => t.name === 'definedIn')).toBe(true);

            // 4. Call tool over SSE
            const grepResult = await client.callTool({
                name: 'grep',
                arguments: { pattern: 'createMcpHttpServer' }
            });
            expect(grepResult.isError).toBeFalsy();
            const parsed = JSON.parse(grepResult.content[0].text);
            expect(parsed.matches.length).toBeGreaterThan(0);

            await client.close();
        } finally {
            await mcpHttp.close();
        }
    });

    it('covers HTTP endpoints: OPTIONS, /ui redirect, /status, invalid methods and 404', async () => {
        const mcpHttp = createMcpHttpServer({ defaultRepo: process.cwd(), port: 0, uiPort: 54321 });
        const { port } = await mcpHttp.start(0);
        try {
            const opt = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'OPTIONS' });
            expect(opt.status).toBe(204);

            const uiRes = await fetch(`http://127.0.0.1:${port}/ui`, { redirect: 'manual' });
            expect(uiRes.status).toBe(302);
            expect(uiRes.headers.get('location')).toBe('http://127.0.0.1:54321/');

            const statusRes = await fetch(`http://127.0.0.1:${port}/status`);
            expect(statusRes.status).toBe(200);

            const badSse = await fetch(`http://127.0.0.1:${port}/sse`, { method: 'POST' });
            expect(badSse.status).toBe(405);

            const badMsg = await fetch(`http://127.0.0.1:${port}/messages`, { method: 'GET' });
            expect(badMsg.status).toBe(405);

            const missingSession = await fetch(`http://127.0.0.1:${port}/messages?sessionId=nonexistent`, { method: 'POST' });
            expect(missingSession.status).toBe(404);

            const noSession = await fetch(`http://127.0.0.1:${port}/messages`, { method: 'POST' });
            expect(noSession.status).toBe(404);

            const notFound = await fetch(`http://127.0.0.1:${port}/nonexistent-path`);
            expect(notFound.status).toBe(404);
        } finally {
            await mcpHttp.close();
        }
    });
});
