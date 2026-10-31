/**
 * Discussion graph nodes and relation edges.
 *
 * @module core/discussions/model/nodes
 */
import { normalizeNodeId } from '../../graph/index.js';

export const CONFIDENCE = Object.freeze({
    EXTRACTED: 'EXTRACTED',
    INFERRED: 'INFERRED',
    AMBIGUOUS: 'AMBIGUOUS'
});

const VALID_CONFIDENCE = new Set(['EXTRACTED', 'INFERRED', 'AMBIGUOUS']);

/**
 * Normalizes confidence string to EXTRACTED, INFERRED, or AMBIGUOUS.
 * @param {string} [value]
 * @returns {'EXTRACTED'|'INFERRED'|'AMBIGUOUS'}
 */
export function normalizeConfidence(value) {
    if (value === undefined || value === null || value === '') return 'AMBIGUOUS';
    const upper = String(value).toUpperCase();
    if (!VALID_CONFIDENCE.has(upper)) {
        throw new Error(`invalid confidence "${value}" (expected EXTRACTED/INFERRED/AMBIGUOUS)`);
    }
    return upper;
}

/**
 * Normalizes discussion node ID (`discussion:<key>`).
 * @param {string} key
 * @returns {string}
 */
export function discussionNodeId(key) {
    return normalizeNodeId(`discussion:${key}`);
}

/**
 * Resolves a target reference to a canonical node ID.
 * @param {string} target
 * @returns {string|null}
 */
export function resolveTargetNodeId(target) {
    if (!target || typeof target !== 'string') return null;
    const str = target.trim();
    if (!str) return null;
    if (str.includes(':')) return normalizeNodeId(str);
    if (/\.(js|mjs|cjs)$/i.test(str)) return normalizeNodeId(`file:${str}`);
    if (/\.md$/i.test(str)) return normalizeNodeId(`doc:${str}`);
    return normalizeNodeId(str);
}

/**
 * Creates a Discussion node entity.
 * @param {object} record
 * @param {object} [options]
 * @returns {object}
 */
export function createDiscussionNode(record, { scope = 'session', now = new Date().toISOString() } = {}) {
    const id = discussionNodeId(record.key);
    const metadata = {
        title: record.title || record.question,
        topic: record.question || record.title,
        body: record.body || '',
        responses: record.responses || [],
        sources: record.sources || [],
        date: record.date || now.slice(0, 10),
        observedAt: now,
        ...(record.metadata || {})
    };
    return {
        id,
        type: 'Discussion',
        kind: 'discussion',
        scope,
        name: record.title || record.question,
        title: record.title || record.question,
        topic: record.question || record.title,
        purpose: (record.body || '').slice(0, 160),
        documentation: (record.body || '').slice(0, 4000),
        body: record.body || '',
        responses: record.responses || [],
        sources: record.sources || [],
        date: record.date || now.slice(0, 10),
        createdAt: record.createdAt || now,
        updatedAt: record.updatedAt || now,
        observedAt: now,
        metadata,
        ...metadata
    };
}

/**
 * Creates grounding edges for a discussion.
 * @param {string} discussionId
 * @param {Array} [sources=[]]
 * @param {object} [options]
 * @returns {Array}
 */
export function createDiscussionEdges(discussionId, sources = [], { scope = 'session', now = new Date().toISOString() } = {}) {
    const edges = [];
    const discId = normalizeNodeId(discussionId);

    for (const source of sources) {
        const rawTarget = typeof source === 'string' ? source : (source.file || source.target || source.id || source.node);
        const targetId = resolveTargetNodeId(rawTarget);
        if (!targetId) continue;

        let conf = typeof source === 'object' ? source.confidence : null;
        if (!conf) {
            if (typeof source === 'object' && source.relevance !== undefined && source.relevance !== null) {
                conf = source.relevance >= 0.8 ? CONFIDENCE.EXTRACTED : CONFIDENCE.INFERRED;
            } else {
                conf = CONFIDENCE.EXTRACTED;
            }
        }
        const validConfidence = normalizeConfidence(conf);
        const weight = (typeof source === 'object' && source.weight !== undefined)
            ? source.weight
            : ((typeof source === 'object' && source.relevance) ? Math.min(1, source.relevance / 10) : 0.5);

        // Forward edge: Discussion discusses / grounds on target
        edges.push({
            from: discId,
            to: targetId,
            type: 'DISCUSSES',
            relation: 'DISCUSSES',
            weight,
            confidence: validConfidence,
            scope,
            createdAt: now,
            updatedAt: now
        });

        // Reverse edge: Target node is discussed in Discussion
        edges.push({
            from: targetId,
            to: discId,
            type: 'DISCUSSED_IN',
            relation: 'DISCUSSED_IN',
            weight,
            confidence: validConfidence,
            scope,
            createdAt: now,
            updatedAt: now
        });
    }

    return edges;
}
