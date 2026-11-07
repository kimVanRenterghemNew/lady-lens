import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { createMcpHttpServer, handleStreamableHttpRequest, MCP_SERVER_INFO } from '../core/mcp/index.js';

describe('MCP HTTP/SSE Server', () => {
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

    it('handles the accepted GET and DELETE methods on /mcp', async () => {
        const mcpHttp = createMcpHttpServer({ defaultRepo: process.cwd(), port: 0 });
        const { port } = await mcpHttp.start(0);
        try {
            const headers = { Accept: 'application/json, text/event-stream' };
            expect([200, 400]).toContain((await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'GET', headers })).status);
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
});
