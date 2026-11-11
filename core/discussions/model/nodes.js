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

function resolveSourceTarget(source) {
    if (typeof source === 'string') return source;
    if (!source || typeof source !== 'object') return null;
    const key = ['file', 'target', 'id', 'node'].find(k => source[k]);
    return key ? source[key] : null;
}

function confidenceFromRelevance(rel) {
    return rel >= 0.8 ? CONFIDENCE.EXTRACTED : CONFIDENCE.INFERRED;
}

function resolveSourceConfidence(source) {
    if (!source || typeof source !== 'object') return CONFIDENCE.EXTRACTED;
    if (source.confidence) return source.confidence;
    if (source.relevance != null) return confidenceFromRelevance(source.relevance);
    return CONFIDENCE.EXTRACTED;
}

function resolveSourceWeight(source) {
    if (typeof source !== 'object' || source == null) return 0.5;
    if (source.weight !== undefined) return source.weight;
    return source.relevance ? Math.min(1, source.relevance / 10) : 0.5;
}

function resolveDiscussionEdgePair(discId, source, scope, now) {
    const rawTarget = resolveSourceTarget(source);
    const targetId = resolveTargetNodeId(rawTarget);
    if (!targetId) return [];

    const confidence = normalizeConfidence(resolveSourceConfidence(source));
    const weight = resolveSourceWeight(source);
    const baseEdge = { weight, confidence, scope, createdAt: now, updatedAt: now };
    return [
        { from: discId, to: targetId, type: 'DISCUSSES', relation: 'DISCUSSES', ...baseEdge },
        { from: targetId, to: discId, type: 'DISCUSSED_IN', relation: 'DISCUSSED_IN', ...baseEdge }
    ];
}

/**
 * Creates grounding edges for a discussion.
 * @param {string} discussionId
 * @param {Array} [sources=[]]
 * @param {object} [options]
 * @returns {Array}
 */
export function createDiscussionEdges(discussionId, sources = [], { scope = 'session', now = new Date().toISOString() } = {}) {
    const discId = normalizeNodeId(discussionId);
    return sources.flatMap(source => resolveDiscussionEdgePair(discId, source, scope, now));
}
