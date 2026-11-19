/**
 * Name matching: words and word pairs from the names in the code (path, definitions, purpose, calls), weighted with
 * IDF. nameModel.js turns them into the ranking of code queries (backlog/bloom-tree-compresier-match.md).
 * @module core/graph/query/nameRank
 */

import { NL_EN } from '../../language/index.js';
import { nameParts, features } from './nameWords.js';
import { testPostings, graphTestNames, addTestVectors } from './nameTests.js';

export { nameParts, features } from './nameWords.js';

const ROLE = { name: 2, purpose: 1.5, use: 0.4 };
const KIND = { u: 1, b: 2.5, s: 1.5 };
const GATE_LEAD = 1.5;
const GATE_RANK = 5;
const ROLE_OF_WEIGHT = new Map(Object.entries(ROLE).map(([role, weight]) => [weight, role]));

const pathOf = (node) => String(node.path || node.id);

const putMax = (feats, feature, weight) => feats.set(feature, Math.max(feats.get(feature) ?? 0, weight));
const addRun = (feats, words, weight) => features(words).forEach(feature => putMax(feats, feature, weight));

const asList = (value) => (Array.isArray(value) ? value : []);
const callee = (call) => (Array.isArray(call) ? call[1] : call);
const usedNames = (node) => [...asList(node.calls).map(callee), ...asList(node.reads)].filter(name => typeof name === 'string');
const definedNames = (node) => [...asList(node.exports), ...asList(node.symbols)];
const sentences = (node) => String(node.purpose || '').split(/[.\n:;()]+/);

/** Feature -> highest role weight in which the node has it (max, no sum). */
function nodeFeatures(node) {
    const feats = new Map();
    addRun(feats, pathOf(node).replace(/\.\w+$/, '').split('/').flatMap(nameParts), ROLE.name);
    definedNames(node).forEach(name => addRun(feats, nameParts(name), ROLE.name));
    sentences(node).forEach(sentence => addRun(feats, sentence.split(/\s+/).flatMap(nameParts), ROLE.purpose));
    usedNames(node).forEach(name => addRun(feats, nameParts(name), ROLE.use));
    return feats;
}

function post(postings, feature, entry) {
    if (!postings.has(feature)) postings.set(feature, []);
    postings.get(feature).push(entry);
}

/**
 * The name index of a set of code files: per feature the files that have it, with their highest role weight
 * (name 2: path, exports, symbols; purpose 1.5; use 0.4: calls, reads), and apart from it the role test: the names of
 * the tests that cover a file.
 * @param {object[]} nodes `CodeFile` nodes (path, exports, symbols, purpose, calls, reads)
 * @param {{testNamesOf?: (node: object) => string[]}} [options] the test names of a code file (default: none)
 * @returns {{postings: Map<string, Array<[object, number]>>, tests: Map<string, object[]>, size: number}} the length of a postings list is the feature's document frequency
 */
export function buildNameIndex(nodes, options) {
    const postings = new Map();
    for (const node of nodes) nodeFeatures(node).forEach((weight, feature) => post(postings, feature, [node, weight]));
    return { postings, tests: testPostings(nodes, options?.testNamesOf ?? (() => [])), size: nodes.length };
}

const translate = (word) => (Object.hasOwn(NL_EN, word) ? NL_EN[word]?.[0] : undefined) ?? word;

/** The words of the question, plus the same sentence with every word in its first translation (so pairs form in English too). */
function queryFeatures(text) {
    const words = String(text).split(/\s+/).flatMap(nameParts);
    return new Set([...features(words), ...features(words.map(translate).flatMap(nameParts))]);
}

function addFeature(scores, list, feature, size) {
    const weight = Math.log(1 + size / list.length) * KIND[feature[0]];
    for (const [node, role] of list) {
        const entry = scores.get(node) ?? { node, score: 0, pairInName: false, matched: [] };
        entry.score += weight * role;
        entry.matched.push(feature);
        if (feature[0] === 'b' && role >= ROLE.purpose) entry.pairInName = true;
        scores.set(node, entry);
    }
}

/**
 * Score every file of the index for a query: Σ ln(1 + N / df) · kind weight (word 1, pair 2.5, skip pair 1.5) · role weight.
 * The query also counts in its first lexicon translation, so a Dutch question forms English pairs.
 * @param {{postings: Map<string, Array<[object, number]>>, size: number}} index from buildNameIndex
 * @param {string} text the query
 * @returns {Array<{node: object, score: number, pairInName: boolean, matched: string[]}>} files with a score > 0, best first
 *   (ties by path); `pairInName`: a neighbour pair of the query in the file's path, definitions or purpose; `matched`: the
 *   query features the file has (`u:word`, `b:a>b`, `s:a>c`), the reasons of its score
 */
export function nameScores(index, text) {
    const scores = new Map();
    for (const feature of queryFeatures(text)) {
        const list = index.postings.get(feature);
        if (list) addFeature(scores, list, feature, index.size);
    }
    return [...scores.values()].sort((a, b) => b.score - a.score || pathOf(a.node).localeCompare(pathOf(b.node)));
}

const INDEX_CACHE = new WeakMap();

/**
 * The cached name index of a loaded graph; built on first use. A sync loads a new graph, so the next query builds a new index.
 * @param {{nodes: Map<string, object>}} graph the loaded graph (its `nodes` map is the cache key)
 * @param {object[]} nodes the code files of that graph to index
 * @returns {{postings: Map<string, Array<[object, number]>>, size: number}}
 */
export function nameIndexFor(graph, nodes) {
    queried = true;
    return indexOf(graph, nodes);
}

// set by the first code query of this process: only then does a later graph load warm its index
let queried = false;

function indexOf(graph, nodes) {
    const cached = INDEX_CACHE.get(graph.nodes);
    if (cached && cached.size === nodes.length) return cached;
    const index = buildNameIndex(nodes, { testNamesOf: graphTestNames(graph) });
    INDEX_CACHE.set(graph.nodes, index);
    return index;
}

/** @returns {boolean} whether the name index of this graph is built already */
export const nameIndexReady = (graph) => INDEX_CACHE.has(graph.nodes);

/**
 * Build the name index of a loaded graph in the background, so the next code query finds it ready. Only in a process
 * that asked a code query before (a daemon or MCP server that uses the name ranking): a process that never ranks code
 * spends nothing on it. The timer is unref'd: a short CLI run exits without waiting for it.
 * @param {{nodes: Map<string, object>}} graph the loaded graph
 * @param {object[]} nodes its code files (the nodes a code query ranks)
 * @returns {boolean} whether a warm-up was scheduled
 */
export function warmNameIndex(graph, nodes) {
    if (!queried) return false;
    setTimeout(() => indexOf(graph, nodes), 0).unref?.();
    return true;
}

/**
 * The gate: the best name hit has a neighbour pair of the query in a name or purpose, and it clearly leads (at least
 * GATE_LEAD times the score of the GATE_RANK-th hit). A pair that many files share leaves no clear lead.
 * @param {Array<{score: number, pairInName: boolean}>} names from nameScores
 * @returns {boolean}
 */
export function gateOpens(names) {
    if (!names[0]?.pairInName) return false;
    const fifth = names[GATE_RANK - 1];
    return !fifth || names[0].score >= GATE_LEAD * fifth.score;
}

function addToVector(vectors, list, feature, size) {
    const idf = Math.log(1 + size / list.length);
    for (const [node, weight] of list) {
        const key = `${feature[0]}|${ROLE_OF_WEIGHT.get(weight)}`;
        const vector = vectors.get(node) ?? {};
        vector[key] = (vector[key] ?? 0) + idf;
        vectors.set(node, vector);
    }
}

/**
 * The name vector of every file the query touches: Σ ln(1 + N / df) per kind × role, kept apart (no weights applied),
 * the input of a learned scorer (nameModel.js).
 * @param {{postings: Map<string, Array<[object, number]>>, size: number}} index from buildNameIndex
 * @param {string} text the query
 * @returns {Map<object, Object<string, number>>} node -> { 'u|name': …, 'b|purpose': …, … }; kinds u, b, s; roles name, purpose, use
 */
export function nameVectors(index, text) {
    const vectors = new Map();
    for (const feature of queryFeatures(text)) {
        const list = index.postings.get(feature);
        if (list) addToVector(vectors, list, feature, index.size);
    }
    addTestVectors(vectors, index, text);
    return vectors;
}
