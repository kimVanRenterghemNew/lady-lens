/**
 * Discussions subsystem: turn discussions into durable, graph-linked knowledge nodes.
 * Provides clean model, storage, query, and MCP tool capabilities.
 *
 * @module core/discussions
 */
export {
    slugify,
    buildDiscussionRecord,
    buildDiscussion,
    appendDiscussionResponse,
    formatDiscussionMarkdown,
    parseDiscussionMarkdown,
    CONFIDENCE,
    normalizeConfidence,
    discussionNodeId,
    resolveTargetNodeId,
    createDiscussionNode,
    createDiscussionEdges
} from './model/index.js';

export {
    saveDiscussion,
    loadDiscussions,
    editDiscussion,
    configureDiscussionSaveHook,
    extractDiscussionsFromDirectory
} from './storage/index.js';

export {
    findDiscussionsForNode,
    queryDiscussions
} from './query/index.js';

export {
    DISCUSSION_TOOL_SCHEMAS,
    handleDiscussionBuild,
    handleDiscussionSave,
    handleDiscussionEdit,
    handleDiscussionLoad,
    handleDiscussionQuery,
    handleDiscussionTool
} from './mcp/index.js';
