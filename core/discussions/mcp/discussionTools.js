/**
 * Discussion tools for MCP (Model Context Protocol).
 *
 * @module core/discussions/mcp/discussionTools
 */
import { saveDiscussion, loadDiscussions, editDiscussion } from '../storage/index.js';
import { queryDiscussions } from '../query/index.js';
import { buildDiscussion } from '../model/index.js';
import { createGraphRepository, sessionScope, createGraph, PROJECT_SCOPE } from '../../graph/index.js';

export const DISCUSSION_TOOL_SCHEMAS = [
    {
        name: 'discussion_build',
        description: 'Build and shape a discussion record with frontmatter markdown and metadata without saving it.',
        parameters: {
            type: 'object',
            properties: {
                question: { type: 'string', description: 'The question or topic that started the discussion' },
                responses: {
                    type: 'object',
                    description: 'Persona or speaker responses map (speaker -> response text), or array of {speaker, text}'
                },
                sources: {
                    type: 'array',
                    description: 'Grounding sources consulted (array of file paths or {file, relevance, confidence})'
                },
                key: { type: 'string', description: 'Optional unique slug/key for the discussion' }
            },
            required: ['question', 'responses']
        }
    },
    {
        name: 'discussion_save',
        description: 'Save an AI round or conversation as a Discussion node in the graph, linked to grounded code/docs/decisions.',
        parameters: {
            type: 'object',
            properties: {
                question: { type: 'string', description: 'The question or topic that started the discussion' },
                responses: {
                    type: 'object',
                    description: 'Persona or speaker responses map (speaker -> response text), or array of {speaker, text}'
                },
                sources: {
                    type: 'array',
                    description: 'Grounding sources consulted (array of file paths or {file, relevance, confidence})'
                },
                sessionId: { type: 'string', description: 'Session ID (default: default)' },
                writeMarkdown: { type: 'boolean', description: 'Also write markdown file to discussions/ folder (default: false)' }
            },
            required: ['question', 'responses']
        }
    },
    {
        name: 'discussion_edit',
        description: 'Edit or append to an existing discussion (add responses from Claude/personas, add source links, update text).',
        parameters: {
            type: 'object',
            properties: {
                id: { type: 'string', description: 'Discussion node ID to edit' },
                key: { type: 'string', description: 'Discussion slug/key to edit' },
                appendResponse: {
                    type: 'object',
                    description: 'New response to append: { speaker: string, text: string }',
                    properties: {
                        speaker: { type: 'string' },
                        text: { type: 'string' }
                    }
                },
                addSources: {
                    type: 'array',
                    description: 'New grounding sources to link to the discussion'
                },
                question: { type: 'string', description: 'Updated question/title' },
                sessionId: { type: 'string', description: 'Session ID (default: default)' },
                writeMarkdown: { type: 'boolean', description: 'Also update markdown file on disk' }
            }
        }
    },
    {
        name: 'discussion_load',
        description: 'Load stored discussions from the graph (by session, or by specific id/key).',
        parameters: {
            type: 'object',
            properties: {
                sessionId: { type: 'string', description: 'Session ID (default: default)' },
                id: { type: 'string', description: 'Discussion node ID to load' },
                key: { type: 'string', description: 'Discussion key/slug to load' }
            }
        }
    },
    {
        name: 'discussion_query',
        description: 'Find discussions related to a code file, decision, symbol, or topic keyword.',
        parameters: {
            type: 'object',
            properties: {
                topic: { type: 'string', description: 'Topic or keyword to search discussions for' },
                node: { type: 'string', description: 'Node ID or path (e.g. file:core/graph.js) to find discussions for' },
                sessionId: { type: 'string', description: 'Session ID (default: default)' },
                limit: { type: 'number', description: 'Maximum discussions to return (default: 10)' }
            }
        }
    }
];

export async function handleDiscussionBuild(args = {}) {
    const built = buildDiscussion(args);
    return { key: built.record.key, title: built.record.title, record: built.record, markdown: built.markdown };
}

export async function handleDiscussionSave(args = {}, deps = {}) {
    const result = await saveDiscussion(args);
    if (typeof deps.onSave === 'function') deps.onSave(result);
    return {
        saved: true, nodeId: result.node.id, node: result.node,
        edges: result.edges, scope: result.scope, path: result.path
    };
}

export async function handleDiscussionEdit(args = {}, deps = {}) {
    const result = await editDiscussion(args);
    if (typeof deps.onSave === 'function') deps.onSave(result);
    return {
        saved: true, updated: true, nodeId: result.node.id, node: result.node,
        edges: result.edges, scope: result.scope, path: result.path
    };
}

export async function handleDiscussionLoad(args = {}) {
    const loaded = await loadDiscussions(args);
    return { sessionId: args.sessionId || 'default', ...loaded };
}

export async function handleDiscussionQuery(args = {}, { repository = null } = {}) {
    const sessionId = args.sessionId || 'default';
    const repo = repository || createGraphRepository();
    const loaded = await repo.loadGraph({ scopes: [sessionScope(sessionId), PROJECT_SCOPE] });
    const graph = createGraph(sessionId);
    for (const node of loaded.nodes) graph.addNode(node.id, node.type, node);
    for (const edge of loaded.edges) {
        graph.addEdge(edge.from, edge.to, edge.type, { weight: edge.weight, confidence: edge.confidence });
    }
    const matches = queryDiscussions(graph, { topic: args.topic, node: args.node, limit: args.limit || 10 });
    return { sessionId, matchCount: matches.length, discussions: matches };
}

export async function handleDiscussionTool(name, args, deps = {}) {
    if (name === 'discussion_build') return handleDiscussionBuild(args);
    if (name === 'discussion_save') return handleDiscussionSave(args, deps);
    if (name === 'discussion_edit') return handleDiscussionEdit(args, deps);
    if (name === 'discussion_load') return handleDiscussionLoad(args);
    if (name === 'discussion_query') return handleDiscussionQuery(args, deps);
    throw new Error(`Unknown discussion tool: ${name}`);
}
