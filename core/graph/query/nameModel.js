/**
 * Learned ranking of code queries: a linear model over the name vector of a file (kind × role, nameRank.js) and its
 * place in the term order. The weights are learned with a pairwise logistic loss on pairs "paragraph of a document ↔
 * the code file it names" (nameTraining.js, evals/learnNameModel.mjs). Every step is public, so a caller can rank its
 * own entries, train its own weights on the pairs it selects, and give lens that model (backlog/bloom-tree-compresier-match.md).
 * @module core/graph/query/nameModel
 */

import { nameVectors, nameScores, nameIndexFor, gateOpens } from './nameRank.js';
import { fuseWithNames } from './nameFusion.js';

const TERM_DEPTH = 20;
const NAMES_DEPTH = 50;
const TERM_OFFSET = 6;

/**
 * The features of a candidate, in model order: kind (u word, b pair, s skip pair) | role (name, purpose, use), the
 * term rank, then the role test (words and pairs of the names of the tests that cover the file).
 */
export const NAME_FEATURES = Object.freeze(['u|name', 'u|purpose', 'u|use', 'b|name', 'b|purpose', 'b|use', 's|name', 's|purpose', 's|use', 'term', 'u|test', 'b|test']);

/**
 * The model lens ships: learned with evals/learnNameModel.mjs on two repositories (a Python and a JavaScript project,
 * 197 pairs from 37 documents, the second project without the documents of its own eval cases), 70 % of the documents
 * for training, seed 7.
 */
export const NAME_MODEL = Object.freeze({
    features: NAME_FEATURES,
    mean: Object.freeze([1.6526542259430943, 0.8868963122275553, 0.37071221674908705, 0.20690353304433953, 0.1859308473609336, 0.04250966920859464, 0.06729289766176406, 0.09127178004451884, 0.014897862014717092, 0.029874338139579622, 0.48857849262184655, 0.09548087778838672]),
    std: Object.freeze([0.8402546203292991, 0.9289604656245378, 0.6976827762445981, 0.583009711184198, 0.5405618900753307, 0.26120477963014505, 0.35186763478861943, 0.42094811533913906, 0.15352463386463996, 0.04371004806336343, 1.0969320903998112, 0.45684271897247763]),
    w: Object.freeze([0.26790591076327175, 0.17631640615686547, 0.08746948956591231, 0.2745016236947942, 0.06315906943132228, 0.27328335950972815, 0.13227271929975615, 0.07402243534324963, 0.13289318240663306, 0.7233649196943616, -0.15285535517799673, 0.14854317664045294])
});

checkModel(NAME_MODEL); // the shipped weights must match NAME_FEATURES: a mismatch fails at load, not as NaN scores

let configuredModel = null;

/**
 * Rank every code query of this process (graph_query, rankGraphNodes) with a learned model: NAME_MODEL or one from
 * trainNameModel. null = back to the default ranking (the fusion of nameFusion.js).
 * @param {{features: string[], mean: number[], std: number[], w: number[]}|null} model from trainNameModel (or its JSON), or NAME_MODEL
 */
export function configureNameModel(model) {
    if (model) checkModel(model);
    configuredModel = model ?? null;
}

/** @returns {{features: string[], mean: number[], std: number[], w: number[]}} the model a learned ranking uses (configured, else NAME_MODEL) */
export const activeNameModel = () => configuredModel ?? NAME_MODEL;

/** @returns {object|null} the model of a learned ranking for these options, null for the default fusion */
const learnedModelFor = (opts) => opts.nameModel ?? (opts.ranking === 'learned' ? activeNameModel() : configuredModel);

function checkModel(model) {
    const ok = Array.isArray(model.features) && model.features.join() === NAME_FEATURES.join()
        && [model.mean, model.std, model.w].every(list => Array.isArray(list) && list.length === NAME_FEATURES.length);
    if (!ok) throw new Error(`a name model needs features [${NAME_FEATURES.join(', ')}] with mean, std and w of the same length`);
}

/**
 * The feature row of one candidate.
 * @param {Object<string, number>|undefined} vector from nameVectors (undefined = no name feature of the query)
 * @param {number} termRank 0-based place in the term order, -1 when not in it
 * @returns {number[]} ln(1 + Σ idf) per kind × role, then 1 / (6 + term rank) (0 outside the term order)
 */
export function nameFeatureRow(vector, termRank) {
    return NAME_FEATURES.map(feature => {
        if (feature === 'term') return termRank < 0 ? 0 : 1 / (TERM_OFFSET + termRank);
        return Math.log1p(vector?.[feature] ?? 0);
    });
}

/**
 * The model score of a feature row: Σ w · (x − mean) / std.
 * @param {number[]} row from nameFeatureRow
 * @param {{mean: number[], std: number[], w: number[]}} [model] default: the active model
 * @returns {number}
 */
export function scoreNameRow(row, model = activeNameModel()) {
    return row.reduce((sum, value, j) => sum + model.w[j] * (value - model.mean[j]) / (model.std[j] || 1), 0);
}

const pathOf = (node) => String(node.path || node.id);

/**
 * The candidates of a query with their feature rows: the term order (top 20) and the name order (top 50 by nameScores).
 * @param {{postings: Map, size: number}} index from buildNameIndex
 * @param {string} text the query
 * @param {object[]} [termOrder] nodes in the order a term ranking gives (graph_query's own ranking without names)
 * @returns {Array<{node: object, row: number[]}>}
 */
export function nameCandidates(index, text, termOrder = []) {
    const term = termOrder.slice(0, TERM_DEPTH);
    // by path, not by object: a caller's own entries are other objects than the nodes of its term order
    const termRankOf = new Map(term.map((node, i) => [pathOf(node), i]).reverse());
    const vectors = nameVectors(index, text);
    const names = nameScores(index, text).slice(0, NAMES_DEPTH).map(entry => entry.node);
    const seen = new Set();
    return [...term, ...names]
        .filter(node => !seen.has(pathOf(node)) && seen.add(pathOf(node)))
        .map(node => ({ node, row: nameFeatureRow(vectors.get(node), termRankOf.get(pathOf(node)) ?? -1) }));
}

/**
 * Rank the candidates of a query with a model. Without a term order this ranks on names alone: entries a caller built
 * itself (for example the test files of a repo against a source path) need no graph.
 * @param {{postings: Map, size: number}} index from buildNameIndex
 * @param {string} text the query
 * @param {{termOrder?: object[], model?: {mean: number[], std: number[], w: number[]}}} [options]
 * @returns {Array<{node: object, score: number, row: number[]}>} best first, ties by path
 */
export function rankWithNameModel(index, text, { termOrder = [], model = activeNameModel() } = {}) {
    return nameCandidates(index, text, termOrder)
        .map(entry => ({ ...entry, score: scoreNameRow(entry.row, model) }))
        .sort((a, b) => b.score - a.score || pathOf(a.node).localeCompare(pathOf(b.node)));
}

/**
 * The step `rankGraphNodes` takes after its term order for code queries: the learned ranking of term and name candidates.
 * @param {{nodes: Map<string, object>}} graph the loaded graph
 * @param {object[]} nodes the nodes of the query's kind
 * @param {string} text the query
 * @param {{kind?: string, names?: boolean, nameModel?: object, ranking?: 'fusion'|'learned'}} opts `rankGraphNodes` options;
 *   `names: false` = term order only; default the fusion; `ranking: 'learned'` or a `nameModel` (or configureNameModel) = the learned model
 * @param {Array<{node: object, score: number}>} ranked the term order (above the minimum score)
 * @param {Array<{node: object, score: number}>} scored every node with its term score
 * @returns {Array<{node: object, score: number}>} each `score` stays the term score
 */
// names count for code and for all kinds together (measured on six sets: kind all at or above without names on each);
// the index always holds the code files only, so docs and decisions are never lifted by names
const NAMED_KINDS = new Set(['code', 'all', undefined]);
const isCode = (node) => node.type === 'CodeFile' && node.kind !== 'test';

export function withNames(graph, nodes, text, opts, ranked, scored) {
    if (!NAMED_KINDS.has(opts.kind) || opts.names === false) return ranked;
    const index = nameIndexFor(graph, nodes.filter(isCode));
    const model = learnedModelFor(opts);
    if (!model) return fuseWithNames(ranked, nameScores(index, text), scored);
    const learned = gated(index, text, ranked, rankWithNameModel(index, text, { termOrder: ranked.map(entry => entry.node), model }));
    const scoreOf = new Map(scored.map(entry => [entry.node, entry.score]));
    const seen = new Set(learned.map(entry => entry.node));
    return [...learned.map(({ node }) => ({ node, score: scoreOf.get(node) ?? 0 })), ...ranked.filter(entry => !seen.has(entry.node))];
}

/**
 * The brake on name-only candidates (files the term order does not hold): they rank with the rest only when the gate
 * opens (the best name hit has a query pair in a name or purpose and clearly leads). Otherwise the model reorders the
 * term order and they follow it. Measured: a long request with many domain words lets many weak name hits in.
 */
function gated(index, text, ranked, learned) {
    if (gateOpens(nameScores(index, text))) return learned;
    const inTerm = new Set(ranked.slice(0, TERM_DEPTH).map(entry => pathOf(entry.node)));
    return [...learned.filter(e => inTerm.has(pathOf(e.node))), ...learned.filter(e => !inTerm.has(pathOf(e.node)))];
}
