/**
 * Model Context Protocol (MCP) server for lady-lens.
 * Serves research tools, graph queries, code search and multi-repo management.
 * TODO(coverage): Current line coverage is 65.62% (< 85% target). Raise to >= 85%.
 * @module core/mcp/server
 */
import fs from 'fs';
import path from 'path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    ErrorCode,
    McpError
} from '@modelcontextprotocol/sdk/types.js';

import { RESEARCH_TOOLS, RESEARCH_TOOL_SCHEMAS } from '../search/index.js';
import { createGraphSync } from '../graph/index.js';
import { configureLensRoot, REPO_ROOT } from '../configuration/index.js';
import {
    listRegisteredRepos,
    registerRepo,
    unregisterRepo,
    resolveRepoTarget,
    idOfRepo,
    databasePathOfRepo
} from '../repository/index.js';
import { buildMcpToolSchemas } from './managementSchemas.js';

export const MCP_SERVER_INFO = {
    name: 'lady-lens',
    version: '1.0.0'
};

export { buildMcpToolSchemas };

export function activateRepoContext(repoTarget) {
    if (!repoTarget) return;
    const resolvedPath = path.resolve(repoTarget.path || repoTarget);
    const id = repoTarget.id || idOfRepo(resolvedPath);
    const database = repoTarget.database || databasePathOfRepo(id);

    fs.mkdirSync(path.dirname(database), { recursive: true });
    configureLensRoot(resolvedPath);
    process.env.LENS_REPO_ROOT = resolvedPath;
    process.env.LENS_GRAPH_DB = database;
    process.env.LENS_PROJECT_GRAPH = '1';
}

export function createLadyLensMcpServer({ defaultRepo = process.cwd() } = {}) {
    const server = new Server(MCP_SERVER_INFO, {
        capabilities: {
            tools: {}
        }
    });

    let currentRepo = resolveRepoTarget(defaultRepo) || {
        id: idOfRepo(defaultRepo),
        path: path.resolve(defaultRepo),
        database: databasePathOfRepo(idOfRepo(defaultRepo))
    };
    activateRepoContext(currentRepo);

    const toolSchemas = buildMcpToolSchemas(RESEARCH_TOOL_SCHEMAS);

    server.setRequestHandler(ListToolsRequestSchema, async () => {
        return {
            tools: toolSchemas.map(t => ({
                name: t.name,
                description: t.description,
                inputSchema: t.parameters
            }))
        };
    });

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: rawArgs = {} } = request.params;
        const args = { ...rawArgs };

        try {
            // Check for repo switch
            if (args.repo && name !== 'repo_remove') {
                const target = resolveRepoTarget(args.repo);
                if (target) {
                    activateRepoContext(target);
                }
                delete args.repo;
            } else if (currentRepo) {
                activateRepoContext(currentRepo);
            }

            // Repo management tools
            if (name === 'repo_list') {
                const repos = listRegisteredRepos();
                return {
                    content: [{ type: 'text', text: JSON.stringify(repos, null, 2) }]
                };
            }

            if (name === 'repo_add') {
                const targetPath = path.resolve(args.path);
                const reg = registerRepo(targetPath, { db: args.db || args.database });
                let syncResult = null;
                if (args.sync !== false) {
                    activateRepoContext(reg);
                    syncResult = await createGraphSync().sync({ mode: 'incremental' });
                    registerRepo(targetPath, {
                        lastSync: new Date().toISOString(),
                        nodes: syncResult.nodes
                    });
                }
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({ registered: reg, sync: syncResult }, null, 2)
                    }]
                };
            }

            if (name === 'repo_remove') {
                const removed = unregisterRepo(args.repo);
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({ removed: !!removed, repo: removed }, null, 2)
                    }]
                };
            }

            if (name === 'repo_sync') {
                const syncResult = await createGraphSync().sync({
                    mode: args.full ? 'full' : 'incremental'
                });
                const activePath = process.env.LENS_REPO_ROOT || REPO_ROOT;
                registerRepo(activePath, {
                    lastSync: new Date().toISOString(),
                    nodes: syncResult.nodes
                });
                return {
                    content: [{ type: 'text', text: JSON.stringify(syncResult, null, 2) }]
                };
            }

            // Research tools
            const toolFn = RESEARCH_TOOLS[name];
            if (!toolFn) {
                throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
            }

            const result = await toolFn(args);
            return {
                content: [{
                    type: 'text',
                    text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
                }]
            };
        } catch (error) {
            return {
                content: [{
                    type: 'text',
                    text: `Error executing ${name}: ${error.message || String(error)}`
                }],
                isError: true
            };
        }
    });

    return server;
}

export async function runMcpServer({ defaultRepo = process.cwd(), transport } = {}) {
    const server = createLadyLensMcpServer({ defaultRepo });
    const serverTransport = transport || new StdioServerTransport();
    await server.connect(serverTransport);
    return server;
}
