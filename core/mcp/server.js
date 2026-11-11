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
    ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js';

import { RESEARCH_TOOL_SCHEMAS } from '../search/index.js';
import { configureLensRoot } from '../configuration/index.js';
import {
    resolveRepoTarget,
    findRegisteredRepo,
    idOfRepo,
    databasePathOfRepo
} from '../repository/index.js';
import { buildMcpToolSchemas } from './managementSchemas.js';
import { callTool } from './toolRoutes.js';

export const MCP_SERVER_INFO = {
    name: 'lady-lens',
    version: (() => {
        try { return JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version; } catch { return 'unknown'; }
    })()
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

// The active repo lives in process-wide state, so tool calls for different repos must not interleave.
let repoLockChain = Promise.resolve();
function withRepoLock(fn) {
    const run = repoLockChain.then(fn);
    repoLockChain = run.catch(() => {});
    return run;
}

/** Runs fn with `hint` (a registered repo) or the default repo active; shares the lock with MCP tool calls. */
export function runInRepo(hint, defaultRepo, fn) {
    return withRepoLock(async () => {
        const target = hint ? findRegisteredRepo(hint) : resolveRepoTarget(defaultRepo);
        if (!target) throw Object.assign(new Error(`Repository not registered: ${hint}. Run 'lens add <folder>' first.`), { status: 403 });
        activateRepoContext(target);
        return fn(target);
    });
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
    // no activateRepoContext here: Streamable HTTP builds a server per request, and activating outside the lock switched
    // the repo of a call that was still running (answers from another repo's database). Each call activates in the lock.

    const toolSchemas = buildMcpToolSchemas(RESEARCH_TOOL_SCHEMAS);

    server.setRequestHandler(ListToolsRequestSchema, async () => {
        return {
            tools: toolSchemas.map(t => ({
                name: t.name,
                description: t.description,
                inputSchema: t.parameters,
                annotations: { readOnlyHint: t.readOnly }
            }))
        };
    });

    function syncRepoContext(args, name, fallbackRepo) {
        if (args.repo && name !== 'repo_remove') {
            const target = resolveRepoTarget(args.repo);
            if (target) activateRepoContext(target);
            delete args.repo;
            return;
        }
        if (fallbackRepo) activateRepoContext(fallbackRepo);
    }

    server.setRequestHandler(CallToolRequestSchema, (request) => withRepoLock(async () => {
        const { name, arguments: rawArgs = {} } = request.params;
        const args = { ...rawArgs };

        try {
            syncRepoContext(args, name, currentRepo);
            return await callTool(name, args, { activate: activateRepoContext });
        } catch (error) {
            return {
                content: [{
                    type: 'text',
                    text: `Error executing ${name}: ${error.message || String(error)}`
                }],
                isError: true
            };
        }
    }));

    return server;
}

export async function runMcpServer({ defaultRepo = process.cwd(), transport } = {}) {
    const server = createLadyLensMcpServer({ defaultRepo });
    const serverTransport = transport || new StdioServerTransport();
    await server.connect(serverTransport);
    return server;
}
