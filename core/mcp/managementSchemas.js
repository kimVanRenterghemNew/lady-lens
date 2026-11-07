/**
 * MCP tool schemas for repository management and multi-checkout configuration.
 *
 * @module core/mcp/managementSchemas
 */

import { RESEARCH_TOOL_SCHEMAS } from '../search/index.js';

const REPO_PARAM = {
    type: 'string',
    description: 'Optional repo path or ID (defaults to active repo)'
};

export const REPO_MANAGEMENT_SCHEMAS = [
    {
        name: 'repo_list',
        description: 'List all registered repositories in lady-lens (including shared databases and active branches).',
        parameters: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'repo_add',
        description: 'Register a repository in lady-lens, optionally linking to a shared database and syncing.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Absolute or relative path to repository root' },
                db: { type: 'string', description: 'Existing repo ID or database path to share (for multi-checkout/worktrees)' },
                branch: { type: 'string', description: 'Optional branch name when the folder is not a Git checkout' },
                sync: { type: 'boolean', description: 'Run sync immediately after registration (default true)' }
            },
            required: ['path']
        }
    },
    {
        name: 'repo_remove',
        description: 'Unregister a repository from lady-lens by ID or path.',
        parameters: {
            type: 'object',
            properties: {
                repo: { type: 'string', description: 'Repo path or ID to unregister' }
            },
            required: ['repo']
        }
    },
    {
        name: 'repo_sync',
        description: 'Index/sync the repository graph incrementally (or full).',
        parameters: {
            type: 'object',
            properties: {
                repo: REPO_PARAM,
                full: { type: 'boolean', description: 'true = re-index everything from scratch' },
                branch: { type: 'string', description: 'Index this branch or commit into its own scope `branch:<name>` without checking it out; the working copy and the project graph stay as they are' }
            }
        }
    },
    {
        name: 'branch_diff',
        description: 'Compare two branches without checking them out: files (added, removed, modified, renamed) and functions (added, removed, modified, renamed) and changed import and call relations (`relations`) that `to` changes since its merge-base with `from`.',
        parameters: {
            type: 'object',
            properties: {
                repo: REPO_PARAM,
                from: { type: 'string', description: 'Base branch or commit, e.g. main' },
                to: { type: 'string', description: 'Branch or commit to compare, e.g. feature-x' }
            },
            required: ['from', 'to']
        }
    },
    {
        name: 'branch_impact',
        description: 'Impact of a change on another branch: functions that `change` (e.g. release) modified or removed since the merge-base, where `against` (e.g. a feature) still uses them (file and line), whether `against` also modifies them (overlap), shared files and text merge conflicts.',
        parameters: {
            type: 'object',
            properties: {
                repo: REPO_PARAM,
                change: { type: 'string', description: 'Branch with the change, e.g. release' },
                against: { type: 'string', description: 'Branch to check it against, e.g. feature-x' }
            },
            required: ['change', 'against']
        }
    },
    {
        name: 'cross_repo_search',
        description: 'Search text or a symbol in several registered projects at once: every project, or only `repos`. Matches per project (file, line, definition/call/reference); names that are not registered come back in `unknown`.',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Search term or regex pattern' },
                repos: { type: 'array', items: { type: 'string' }, description: 'Registered repo ids or paths; leave out for all' },
                wholeWord: { type: 'boolean', description: 'true = match whole words only (default false)' },
                caseSensitive: { type: 'boolean', description: 'true = case-sensitive match (default false)' },
                isRegex: { type: 'boolean', description: 'true = treat query as regular expression (default false)' },
                kind: { type: 'string', enum: ['all', 'code', 'doc', 'test'], description: 'Filter by file kind (default "all")' },
                limit: { type: 'integer', description: 'Maximum matches per project (default 50)' }
            },
            required: ['query']
        }
    },
    {
        name: 'commit_show',
        description: 'What one commit changed, without checking anything out: author, date, subject, files (added, removed, modified, renamed) and functions (added, removed, modified) against its first parent. For a merge commit this is what the merge brought in.',
        parameters: {
            type: 'object',
            properties: {
                repo: REPO_PARAM,
                commit: { type: 'string', description: 'Commit hash, branch or tag, e.g. 263e4279 or HEAD~1' }
            },
            required: ['commit']
        }
    },
    {
        name: 'function_history',
        description: 'Commits that added, modified or removed one function, newest first (hash, date, author, subject). Without `name`: every commit that touched the file. Name-based: a renamed function starts a new history.',
        parameters: {
            type: 'object',
            properties: {
                repo: REPO_PARAM,
                name: { type: 'string', description: 'Function name; leave empty for the history of the whole file' },
                file: { type: 'string', description: 'File that contains the function, relative to the repository root' },
                ref: { type: 'string', description: 'Branch or commit to read the history from (default HEAD)' },
                max: { type: 'number', description: 'Maximum number of commits to return (default 20)' }
            },
            required: ['file']
        }
    },
    {
        name: 'config_grep',
        description: 'Search only supported configuration and project files, including .csproj and reference-manager XML.',
        parameters: {
            type: 'object',
            properties: {
                pattern: { type: 'string', description: 'Regular expression to search for' },
                path: { type: 'string', description: 'Optional config file, directory or glob' },
                offset: { type: 'number', description: 'Skip this many matches' },
                ignoreCase: { type: 'boolean', description: 'true = match any upper/lower case' }
            },
            required: ['pattern']
        }
    },
    {
        name: 'config_references',
        description: 'Find which config files reference a package, project, or Siemens functional block by name.',
        parameters: {
            type: 'object',
            properties: {
                reference: { type: 'string', description: 'Name to find, e.g. PUREQU_OP' },
                package: { type: 'string', description: 'Alias for reference, e.g. Puratos.OpcenterEX.PUREQU_OP' },
                path: { type: 'string', description: 'Optional config file, directory or glob' },
                ignoreCase: { type: 'boolean', description: 'true = match any upper/lower case' }
            },
            required: ['reference']
        }
    },
    {
        name: 'config_update',
        description: 'Replace one supported configuration file and refresh its graph facts. Use expectedHash to prevent lost updates.',
        parameters: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Repo-relative config path, e.g. App/App.csproj' },
                content: { type: 'string', description: 'Complete new file content' },
                expectedHash: { type: 'string', description: 'Optional SHA-256 hash from the previous read' }
            },
            required: ['path', 'content']
        }
    }
];

// management tools that change the registry, the graph or a file
const MANAGEMENT_WRITES = new Set(['repo_add', 'repo_remove', 'repo_sync', 'config_update']);

export function buildMcpToolSchemas(researchSchemas = RESEARCH_TOOL_SCHEMAS) {
    const enhancedResearch = researchSchemas.map(schema => ({
        name: schema.name,
        description: schema.description,
        readOnly: schema.readOnly !== false,
        parameters: {
            ...schema.parameters,
            properties: {
                ...schema.parameters.properties,
                repo: REPO_PARAM
            }
        }
    }));

    return [...enhancedResearch, ...REPO_MANAGEMENT_SCHEMAS.map(schema => ({ ...schema, readOnly: !MANAGEMENT_WRITES.has(schema.name) }))];
}
