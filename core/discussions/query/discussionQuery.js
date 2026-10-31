/**
 * Discussion query engine.
 *
 * @module core/discussions/query/discussionQuery
 */
import { normalizeNodeId } from '../../graph/index.js';
import { resolveTargetNodeId } from '../model/index.js';

/**
 * Finds all discussions connected to a given node in the graph.
 * @param {object} graph
 * @param {string} nodeId
 * @returns {Array<object>}
 */
export function findDiscussionsForNode(graph, nodeId) {
    if (!graph || !nodeId) return [];
    const targetId = resolveTargetNodeId(nodeId) || normalizeNodeId(nodeId);
    const targetNode = graph.getNode?.(targetId);
    if (!targetNode && !graph.nodes?.has?.(targetId)) return [];

    const incoming = graph.getIncoming?.(targetId) || [];
    const outgoing = graph.getOutgoing?.(targetId) || [];

    const discussionIds = new Set();
    const relations = new Map();

    for (const edge of incoming) {
        if (edge.type === 'DISCUSSES' || edge.type === 'discussed' || edge.from.startsWith('discussion:')) {
            discussionIds.add(edge.from);
            relations.set(edge.from, edge);
        }
    }

    for (const edge of outgoing) {
        if (edge.type === 'DISCUSSED_IN' || edge.to.startsWith('discussion:')) {
            discussionIds.add(edge.to);
            relations.set(edge.to, edge);
        }
    }

    const results = [];
    for (const id of discussionIds) {
        const node = graph.getNode?.(id);
        if (node && node.type === 'Discussion') {
            const rel = relations.get(id);
            results.push({
                ...node,
                confidence: rel?.confidence || 'EXTRACTED',
                weight: rel?.weight ?? 1,
                relation: rel?.type || 'DISCUSSES'
            });
        }
    }

    return results;
}

/**
 * Queries discussions in the graph by topic keyword or connected node.
 * @param {object} graph
 * @param {object} [options]
 * @param {string} [options.topic]
 * @param {string} [options.node]
 * @param {number} [options.limit=10]
 * @returns {Array<object>}
 */
export function queryDiscussions(graph, { topic, node, limit = 10 } = {}) {
    if (!graph) return [];
    if (node) {
        const direct = findDiscussionsForNode(graph, node);
        return direct.slice(0, limit);
    }

    const allDiscussions = [];
    const nodes = graph.nodes?.values ? [...graph.nodes.values()] : (graph.getNodesByType ? graph.getNodesByType('Discussion') : []);

    for (const n of nodes) {
        if (n.type === 'Discussion') allDiscussions.push(n);
    }

    if (!topic || typeof topic !== 'string' || !topic.trim()) {
        return allDiscussions.slice(0, limit);
    }

    const terms = topic.toLowerCase().split(/\s+/).filter(t => t.length >= 2);
    const scored = allDiscussions.map(disc => {
        const text = `${disc.title || ''} ${disc.topic || ''} ${disc.purpose || ''} ${disc.body || ''}`.toLowerCase();
        let score = 0;
        for (const term of terms) {
            if (text.includes(term)) score += 1;
        }
        return { discussion: disc, score };
    });

    return scored
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .map(s => s.discussion)
        .slice(0, limit);
}
