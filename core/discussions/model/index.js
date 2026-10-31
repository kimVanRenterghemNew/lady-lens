/**
 * Discussion model layer index.
 *
 * @module core/discussions/model
 */
export {
    slugify,
    buildDiscussionRecord,
    buildDiscussion,
    appendDiscussionResponse,
    formatDiscussionMarkdown,
    parseDiscussionMarkdown
} from './record.js';

export {
    CONFIDENCE,
    normalizeConfidence,
    discussionNodeId,
    resolveTargetNodeId,
    createDiscussionNode,
    createDiscussionEdges
} from './nodes.js';
