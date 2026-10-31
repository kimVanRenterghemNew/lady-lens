import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
    createLadyLensMcpServer,
    activateRepoContext,
    runMcpServer
} from '../core/mcp/index.js';

describe('mcpServer branch coverage', () => {
    it('activateRepoContext handles null, strings and custom objects', () => {
        expect(() => activateRepoContext(null)).not.toThrow();
        expect(() => activateRepoContext(process.cwd())).not.toThrow();
        expect(() => activateRepoContext({ path: process.cwd() })).not.toThrow();
    });

    it('runMcpServer connects with custom transport', async () => {
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        const server = await runMcpServer({ defaultRepo: process.cwd(), transport: serverTransport });
        const client = new Client({ name: 'test-client', version: '1.0' }, { capabilities: {} });
        await client.connect(clientTransport);

        const list = await client.listTools();
        expect(list.tools.length).toBeGreaterThan(0);

        await client.close();
        await server.close();
    });

    it('handles repo parameter switch, repo_remove, and tool execution error branches', async () => {
        const server = createLadyLensMcpServer();
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        const client = new Client({ name: 'test-client-2', version: '1.0' }, { capabilities: {} });

        await Promise.all([
            server.connect(serverTransport),
            client.connect(clientTransport)
        ]);

        // Tool call with repo switch
        const listResult = await client.callTool({
            name: 'repo_list',
            arguments: { repo: process.cwd() }
        });
        expect(listResult.isError).toBeFalsy();

        // repo_remove
        const removeResult = await client.callTool({
            name: 'repo_remove',
            arguments: { repo: 'dummy-repo-key-12345' }
        });
        expect(removeResult.isError).toBeFalsy();
        const remParsed = JSON.parse(removeResult.content[0].text);
        expect(remParsed.removed).toBe(false);

        await client.close();
        await server.close();
    });
});
