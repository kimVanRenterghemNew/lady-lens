import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildMcpToolSchemas, createLadyLensMcpServer } from '../core/mcp/index.js';

describe('MCP server for lady-lens', () => {
    it('declares items for every array-valued tool parameter', () => {
        const missing = [];
        const visit = (value, path = 'schema') => {
            if (!value || typeof value !== 'object') return;
            if (value.type === 'array' && !Object.hasOwn(value, 'items')) missing.push(path);
            for (const [key, child] of Object.entries(value)) visit(child, `${path}.${key}`);
        };
        visit(buildMcpToolSchemas());
        expect(missing).toEqual([]);
    });

    it('serves research and repo tools over MCP transport', async () => {
        const server = createLadyLensMcpServer({ defaultRepo: process.cwd() });
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

        const client = new Client(
            { name: 'test-client', version: '1.0.0' },
            { capabilities: {} }
        );

        await Promise.all([
            server.connect(serverTransport),
            client.connect(clientTransport)
        ]);

        // 1. List tools
        const { tools } = await client.listTools();
        const names = tools.map(t => t.name);

        expect(names).toContain('read_chunk');
        expect(names).toContain('grep');
        expect(names).toContain('glob');
        expect(names).toContain('definedIn');
        expect(names).toContain('functionView');
        expect(names).toContain('folderView');
        expect(names).toContain('graph_query');
        expect(names).toContain('health');
        expect(names).toContain('repo_list');
        expect(names).toContain('repo_add');
        expect(names).toContain('repo_remove');
        expect(names).toContain('repo_sync');
        expect(names).toContain('discussion_build');
        expect(names).toContain('discussion_save');
        expect(names).toContain('discussion_load');
        expect(names).toContain('discussion_query');

        // Check inputSchema has repo property
        const grepSchema = tools.find(t => t.name === 'grep');
        expect(grepSchema.inputSchema.properties.repo).toBeDefined();
        // a client can tell reading tools from writing ones (MCP readOnlyHint)
        const readOnly = Object.fromEntries(tools.map(t => [t.name, t.annotations?.readOnlyHint]));
        expect(readOnly).toMatchObject({ grep: true, graph_query: true, discussion_query: true, discussion_save: false, discussion_edit: false, repo_sync: false, config_update: false, branch_diff: true });

        // 2. Call discussion_build
        const buildResult = await client.callTool({
            name: 'discussion_build',
            arguments: {
                question: 'Draft discussion',
                responses: { Persona: 'Previewing markdown before save.' },
                sources: ['core/graph/index.js']
            }
        });
        expect(buildResult.isError).toBeFalsy();
        const builtParsed = JSON.parse(buildResult.content[0].text);
        expect(builtParsed.title).toBe('Draft discussion');
        expect(builtParsed.markdown).toContain('Draft discussion');

        // 3. Call discussion_save
        const saveResult = await client.callTool({
            name: 'discussion_save',
            arguments: {
                question: 'MCP discussion integration',
                responses: { Bot: 'Discussion saved via MCP.' },
                sources: ['core/mcp/server.js']
            }
        });
        expect(saveResult.isError).toBeFalsy();
        const savedParsed = JSON.parse(saveResult.content[0].text);
        expect(savedParsed.saved).toBe(true);
        expect(savedParsed.node.type).toBe('Discussion');

        // 4. Call discussion_load
        const loadResult = await client.callTool({
            name: 'discussion_load',
            arguments: {
                id: savedParsed.nodeId
            }
        });
        expect(loadResult.isError).toBeFalsy();
        const loadedParsed = JSON.parse(loadResult.content[0].text);
        expect(loadedParsed.found).toBe(true);
        expect(loadedParsed.discussion.id).toBe(savedParsed.nodeId);

        // 5. Call discussion_edit
        const editResult = await client.callTool({
            name: 'discussion_edit',
            arguments: {
                id: savedParsed.nodeId,
                appendResponse: { speaker: 'Claude', text: 'Confirmed implementation.' }
            }
        });
        expect(editResult.isError).toBeFalsy();
        const editParsed = JSON.parse(editResult.content[0].text);
        expect(editParsed.saved).toBe(true);
        expect(editParsed.node.responses.length).toBe(2);
        expect(editParsed.node.responses[1].speaker).toBe('Claude');

        // 6. Call discussion_query
        const queryResult = await client.callTool({
            name: 'discussion_query',
            arguments: { topic: 'MCP' }
        });
        expect(queryResult.isError).toBeFalsy();
        const queryParsed = JSON.parse(queryResult.content[0].text);
        expect(queryParsed.discussions.length).toBeGreaterThan(0);

        // 7. Call repo_list
        const listResult = await client.callTool({
            name: 'repo_list',
            arguments: {}
        });
        expect(listResult.isError).toBeFalsy();
        expect(listResult.content[0].type).toBe('text');
        const repos = JSON.parse(listResult.content[0].text);
        expect(Array.isArray(repos)).toBe(true);

        // 8. Call repo_add with shared db (Story 23.14)
        const addResult = await client.callTool({
            name: 'repo_add',
            arguments: {
                path: process.cwd(),
                db: 'shared-repo-test',
                sync: false
            }
        });
        expect(addResult.isError).toBeFalsy();
        const addParsed = JSON.parse(addResult.content[0].text);
        expect(addParsed.registered.database).toContain('shared-repo-test');

        // 9. Call grep
        const grepResult = await client.callTool({
            name: 'grep',
            arguments: { pattern: 'MCP_SERVER_INFO' }
        });
        expect(grepResult.isError).toBeFalsy();
        const grepParsed = JSON.parse(grepResult.content[0].text);
        expect(grepParsed.matches.length).toBeGreaterThan(0);
        expect(grepParsed.matches.some(m => m.file.includes('server.js'))).toBe(true);

        // 4. Call unknown tool
        const errorResult = await client.callTool({
            name: 'non_existent_tool',
            arguments: {}
        });
        expect(errorResult.isError).toBe(true);
        expect(errorResult.content[0].text).toContain('Unknown tool');

        await client.close();
        await server.close();
    });
});
