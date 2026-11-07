/**
 * The MCP tool routes: one handler per management tool (core/mcp/handlers, shared with the `lens` CLI); any other name is a research tool.
 * @module core/mcp/toolRoutes
 */
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { RESEARCH_TOOLS, withBudget } from '../search/index.js';
import { configGrep, configReferences, configUpdate, repoList, repoAdd, repoRemove, repoSync, branchDiff, branchImpact, commitShow, functionHistory, crossRepoSearch } from './handlers/index.js';

const text = value => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });

/** `handle(args, { activate })` returns plain data; `activate` makes a repository the active one. */
export const TOOL_ROUTES = [
    { name: 'repo_list', handle: repoList },
    { name: 'repo_add', handle: repoAdd },
    { name: 'repo_remove', handle: repoRemove },
    { name: 'repo_sync', handle: repoSync },
    { name: 'branch_diff', handle: branchDiff },
    { name: 'branch_impact', handle: branchImpact },
    { name: 'cross_repo_search', handle: withBudget(args => crossRepoSearch(args), { lists: ['repos'], narrow: 'name fewer repos, or a more specific query' }) },
    { name: 'commit_show', handle: commitShow },
    { name: 'function_history', handle: functionHistory },
    { name: 'config_grep', handle: configGrep },
    { name: 'config_references', handle: configReferences },
    { name: 'config_update', handle: configUpdate }
];

export async function callTool(name, args, context) {
    const route = TOOL_ROUTES.find(r => r.name === name);
    if (route) return text(await route.handle(args, context));
    const tool = RESEARCH_TOOLS[name];
    if (!tool) throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    return text(await tool(args));
}
