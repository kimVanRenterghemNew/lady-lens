/**
 * Shared node-ID normalization: the single source of truth for canonicalizing
 * graph node IDs, so the same conceptual entity never ends up as two "ghost" nodes just because
 * two producers wrote its ID with different casing/separators.
 *
 * @module core/graph/graphIds
 */

/** Canonicalize one `:`-delimited segment: lowercase, collapse separator runs, keep `/` paths. */
function sanitizeSegment(segment) {
    return segment
        .trim()
        .toLowerCase()
        .replace(/\\/g, '/')
        .replace(/[\s_-]+/g, '-')
        .replace(/\/+/g, '/')
        .replace(/^[-/]+|[-/]+$/g, '');
}

/**
 * Canonicalize a session-graph node ID (`type:key` or `type:key/path` convention used by
 * `core/graph/graphModel.js`). Deterministic and idempotent: normalizing an already-normalized
 * ID returns it unchanged. Preserves `:`-delimited type/key structure - different types never
 * collide just because their keys normalize to the same string.
 * @param {string} id
 * @returns {string}
 * @throws {Error} if `id` is not a non-empty string, or nothing is left of it after normalization
 */
export function normalizeNodeId(id) {
    if (typeof id !== 'string' || id.trim() === '') {
        throw new Error(`normalizeNodeId: id must be a non-empty string, got: ${JSON.stringify(id)}`);
    }
    const normalized = id.normalize('NFKC').split(':').map(sanitizeSegment).join(':');
    // '--' or '_' normalized to '' and became an unreachable node with an empty id.
    if (normalized === '') throw new Error(`normalizeNodeId: id ${JSON.stringify(id)} has no characters left after normalization`);
    return normalized;
}

/** The scope of code files and documents written by GraphSync (session scopes are `session:<id>`). */
export const PROJECT_SCOPE = 'project';

/** Format chunk node ID: `chunk:<repo-relative-path>#<symbol>`. */
export function chunkNodeId(path, symbol) {
    const cleanPath = String(path || '').replace(/\\/g, '/');
    return normalizeNodeId(`chunk:${cleanPath}#${symbol}`);
}

/** Pure factory for AST CodeChunk nodes. */
export function createChunkNode({ path, symbol, name, startLine, endLine, kind = 'function', scope = PROJECT_SCOPE, now = new Date().toISOString() }) {
    const sym = symbol || name;
    const cleanPath = String(path || '').replace(/\\/g, '/');
    return {
        id: chunkNodeId(cleanPath, sym),
        type: 'CodeChunk',
        kind,
        name: sym,
        path: cleanPath,
        startLine,
        endLine,
        scope,
        createdAt: now,
        updatedAt: now,
        observedAt: now
    };
}
