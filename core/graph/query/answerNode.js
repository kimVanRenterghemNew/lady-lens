/**
 * Node formatting and character-budget clipping for graph_query responses.
 * @module core/graph/query/answerNode
 */

const ANSWER_FIELDS = ['id', 'type', 'kind', 'scope', 'path', 'name', 'title', 'purpose', 'exports', 'date', 'line', 'status', 'supersededBy'];

const clipPurpose = (purpose) => (typeof purpose === 'string' && purpose.length > 160 ? `${purpose.slice(0, 160)}…` : purpose);
const clipExports = (exports) => (Array.isArray(exports) && exports.length > 20 ? [...exports.slice(0, 20), `(+${exports.length - 20} more)`] : exports);

export const answerNode = (node) => {
    if (!node || typeof node !== 'object') return node;
    const small = Object.fromEntries(ANSWER_FIELDS.filter(field => node[field] !== undefined).map(field => [field, node[field]]));
    if (small.purpose) small.purpose = clipPurpose(small.purpose);
    if (small.exports) small.exports = clipExports(small.exports);
    return small;
};

export const QUERY_NODE_PROPERTIES = ['id', 'type', 'name', 'path', 'purpose', 'exported', 'visibility'];
