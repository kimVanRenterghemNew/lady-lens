/**
 * Node formatting and character-budget clipping for graph_query responses.
 * @module core/graph/query/answerNode
 */

const ANSWER_FIELDS = ['id', 'type', 'kind', 'scope', 'path', 'name', 'title', 'purpose', 'exports', 'date', 'line', 'status', 'supersededBy'];

const clipPurpose = (purpose, max = 160) => (typeof purpose === 'string' && purpose.length > max ? `${purpose.slice(0, max)}…` : purpose);
const clipExports = (exports) => (Array.isArray(exports) && exports.length > 20 ? [...exports.slice(0, 20), `(+${exports.length - 20} more)`] : exports);

export const answerNode = (node) => {
    if (!node || typeof node !== 'object') return node;
    const small = Object.fromEntries(ANSWER_FIELDS.filter(field => node[field] !== undefined).map(field => [field, node[field]]));
    if (small.purpose) small.purpose = clipPurpose(small.purpose);
    if (small.exports) small.exports = clipExports(small.exports);
    return small;
};

/** A candidate in few characters, for an answer over the context budget: where it is and what it is for. */
export const shortNode = (node) => ({
    path: node.path ?? node.id,
    ...(node.purpose ? { purpose: clipPurpose(node.purpose, 60) } : {}),
    // a few names tell a model what the file offers; more go in the full form
    ...(node.exports?.length ? { exports: node.exports.slice(0, 3) } : {})
});

export const QUERY_NODE_PROPERTIES = ['id', 'type', 'name', 'path', 'purpose', 'exported', 'visibility'];
