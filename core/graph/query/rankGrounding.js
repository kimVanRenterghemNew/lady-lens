/**
 * Path grounding for graph ranking: a file named in the request ranks first.
 * @module core/graph/query/rankGrounding
 */

const NORM_SEP_RE = /\\/g;

function matchBaseFilename(normPath, normText) {
    const base = normPath.split('/').pop();
    return base.length >= 4 && normText.includes(base);
}

function checkPathMatch(normPath, normText) {
    if (normText.includes(normPath)) return 100;
    return matchBaseFilename(normPath, normText) ? 50 : 0;
}

/**
 * Absolute priority for files explicitly mentioned in the request text.
 * - Exact path match in text -> +100 bonus (forces rank #1).
 * - Basename match in text -> +50 bonus.
 */
export function pathGroundingBonus(node, text) {
    const rawPath = node ? node.path : null;
    if (typeof rawPath !== 'string' || typeof text !== 'string') return 0;
    const normText = text.replace(NORM_SEP_RE, '/');
    const normPath = rawPath.replace(NORM_SEP_RE, '/');
    return checkPathMatch(normPath, normText);
}
