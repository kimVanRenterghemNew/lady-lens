import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { createMcpHttpServer } from '../core/mcp/index.js';

describe('MCP HTTP/SSE Server', () => {
    it('serves dashboard HTML and SSE transport for MCP clients', async () => {
        const mcpHttp = createMcpHttpServer({ defaultRepo: process.cwd(), port: 0 });
        const { port } = await mcpHttp.start(0);

        try {
            // 1. Dashboard test
            const res = await fetch(`http://127.0.0.1:${port}/`);
            expect(res.status).toBe(200);
            const html = await res.text();
            expect(html).toContain('lady-lens MCP Server');
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
