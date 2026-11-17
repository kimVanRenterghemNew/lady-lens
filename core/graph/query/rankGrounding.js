/**
 * Path grounding and call-hierarchy seam priority for graph ranking.
 * @module core/graph/query/rankGrounding
 */

const NORM_SEP_RE = /\\/g;
const ROUTING_KEYWORDS_RE = /\b(classifyMode|routing|router|mode|classify|execute verb|stays discuss)\b/i;

function matchBaseFilename(normPath, normText) {
    const base = normPath.split('/').pop() || '';
    return base.length >= 4 && normText.includes(base);
}

function checkPathMatch(normPath, normText) {
    if (normText.includes(normPath)) return 100;
    return matchBaseFilename(normPath, normText) ? 50 : 0;
}

/**
 * Story 32.59: Absolute priority for files explicitly mentioned in the request text.
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

function isClassifierNode(node) {
    const all = [...(node.exports || []), ...(node.symbols || [])];
    if (all.includes('classifyMode')) return true;
    return String(node.path || '').includes('modeClassifier');
}

export function routingSeamBonus(node, text) {
    if (!node) return 0;
    if (typeof text !== 'string') return 0;
    if (!ROUTING_KEYWORDS_RE.test(text)) return 0;
    return isClassifierNode(node) ? 30 : 0;
}

export function graphGroundingScore(node, text) {
    return pathGroundingBonus(node, text) + routingSeamBonus(node, text);
}
