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
                full: { type: 'boolean', description: 'true = re-index everything from scratch' }
            }
        }
    }
];

export function buildMcpToolSchemas(researchSchemas = RESEARCH_TOOL_SCHEMAS) {
    const enhancedResearch = researchSchemas.map(schema => ({
        name: schema.name,
        description: schema.description,
        parameters: {
            ...schema.parameters,
            properties: {
                ...schema.parameters.properties,
                repo: REPO_PARAM
            }
        }
    }));

    return [...enhancedResearch, ...REPO_MANAGEMENT_SCHEMAS];
}
