/**
 * Training of the name model (nameModel.js): pairs "paragraph of a document ↔ the code files it names" (the names are
 * taken out of the text), the candidates of each pair with their feature rows, and a linear model learned on them
 * with a pairwise logistic loss and gradient descent. Deterministic: the same pairs in the same order give byte-equal
 * weights, so the caller sorts its input (namePairsFromDocs does). A caller selects what to train on: documents by
 * include/exclude, or its own pairs.
 * @module core/graph/query/nameTraining
 */

import { NAME_FEATURES, nameCandidates } from './nameModel.js';

const CODE_REF = /[\w./-]+\.(?:m?js|cjs|ts|tsx|jsx|py|cs)\b/g;
const MAX_FILES = 3;
const MIN_WORDS = 5;
const MAX_TEXT = 600;

const pathOf = (node) => String(node.path || node.id);
const under = (doc, prefix) => doc === prefix || doc.startsWith(`${prefix.replace(/\/$/, '')}/`);
const selected = (doc, include, exclude) => (!include.length || include.some(p => under(doc, p))) && !exclude.some(p => under(doc, p));

const baseName = (p) => p.split('/').pop();

function resolver(codePaths) {
    // no Map.groupBy: lens runs on Node 18 and 20 too
    const byBase = new Map();
    codePaths.forEach(p => byBase.set(baseName(p), [...(byBase.get(baseName(p)) ?? []), p]));
    return (token) => {
        const clean = token.replace(/^\.?\//, '');
        const full = codePaths.find(p => p === clean || p.endsWith(`/${clean}`));
        const same = byBase.get(clean.split('/').pop()) ?? [];
        return full ?? (same.length === 1 ? same[0] : null);
    };
}

/**
 * The code files a text names (a full path, or a file name only one code file has).
 * @param {string} text a document or paragraph
 * @param {string[]} codePaths repo-relative paths of the code files
 * @returns {string[]} the named files, in order of first mention
 */
export function filesNamedIn(text, codePaths) {
    const resolve = resolver(codePaths);
    return [...new Set([...String(text).matchAll(CODE_REF)].map(match => resolve(match[0])).filter(Boolean))];
}

/** The code files a paragraph names, and its text without those names. */
function takeOutNames(paragraph, resolve) {
    const named = [...paragraph.matchAll(CODE_REF)].map(match => [match[0], resolve(match[0])]).filter(([, file]) => file);
    const text = named.reduce((rest, [token]) => rest.split(token).join(' '), paragraph);
    return { files: new Set(named.map(([, file]) => file)), text: text.replace(/[`*#>[\]()|_-]+/g, ' ').replace(/\s+/g, ' ').trim() };
}

function pairOf(paragraph, resolve) {
    const { files, text } = takeOutNames(paragraph, resolve);
    const usable = files.size && files.size <= MAX_FILES && text.split(' ').length >= MIN_WORDS;
    return usable ? { text: text.slice(0, MAX_TEXT), files: [...files].sort() } : null;
}

/**
 * Training pairs from documents: every paragraph that names 1 to 3 code files, with those names taken out of its text.
 * A paragraph repeated in another document (a mirror such as .agents/ or .claude/) counts once.
 * @param {Array<{path: string, text: string}>} docs markdown documents, repo-relative paths
 * @param {string[]} codePaths repo-relative paths of the code files the pairs may point to
 * @param {{include?: string[], exclude?: string[]}} [options] documents or folders to keep (default all) and to leave out
 *   (a paragraph seen before, in this or an earlier document, is skipped)
 * @returns {Array<{doc: string, text: string, files: string[]}>} in document path order, then paragraph order
 */
export function namePairsFromDocs(docs, codePaths, options) {
    const { include, exclude } = { include: [], exclude: [], ...options };
    const resolve = resolver(codePaths);
    const seen = new Set();
    const fresh = (pair) => pair && !seen.has(pair.text.toLowerCase()) && seen.add(pair.text.toLowerCase());
    return [...docs]
        .filter(doc => selected(doc.path, include, exclude))
        .sort((a, b) => a.path.localeCompare(b.path))
        .flatMap(doc => String(doc.text).split(/\n\s*\n/).map(paragraph => pairOf(paragraph, resolve)).filter(fresh).map(pair => ({ doc: doc.path, ...pair })));
}

/**
 * The training examples of pairs: per pair its candidates (term order + name order) with feature rows, the files of the
 * pair marked positive. A pair whose files no candidate reaches teaches nothing and has no positive row.
 * @param {{postings: Map, size: number}} index from buildNameIndex over the code files
 * @param {Array<{text: string, files: string[]}>} pairs from namePairsFromDocs, or the caller's own
 * @param {(text: string) => object[]} [termOrderFor] the term order of a text (graph_query's ranking without names)
 * @returns {Array<{rows: Array<{path: string, row: number[], positive: boolean}>}>}
 */
export function nameTrainingExamples(index, pairs, termOrderFor = () => []) {
    return pairs.map(pair => ({
        ...pair,
        rows: nameCandidates(index, pair.text, termOrderFor(pair.text)).map(({ node, row }) => ({ path: pathOf(node), row, positive: pair.files.includes(pathOf(node)) }))
    }));
}

function standardizer(rows) {
    const n = Math.max(1, rows.length);
    const mean = NAME_FEATURES.map((_, j) => rows.reduce((sum, row) => sum + row[j], 0) / n);
    const std = NAME_FEATURES.map((_, j) => Math.sqrt(rows.reduce((sum, row) => sum + (row[j] - mean[j]) ** 2, 0) / n) || 1);
    return { mean, std };
}

/** Per example, every (positive − negative) difference of standardized rows: the pairs the loss compares. */
function differences(examples, z) {
    return examples.flatMap(example => {
        const pos = example.rows.filter(r => r.positive).map(r => z(r.row));
        const neg = example.rows.filter(r => !r.positive).map(r => z(r.row));
        return pos.flatMap(p => neg.map(n => p.map((value, j) => value - n[j])));
    });
}

function step(w, diffs, lr, l2) {
    const grad = w.map(weight => l2 * weight);
    for (const diff of diffs) {
        const g = -1 / (1 + Math.exp(diff.reduce((sum, value, j) => sum + w[j] * value, 0)));
        diff.forEach((value, j) => { grad[j] += g * value; });
    }
    return w.map((weight, j) => weight - (lr * 10 * grad[j]) / Math.max(1, diffs.length));
}

/**
 * Learn a name model: minimise Σ ln(1 + e^−(s(positive) − s(negative))) over every positive/negative pair of rows
 * within an example, with L2, by full-batch gradient descent from zero weights. Deterministic for the same input order.
 * @param {Array<{rows: Array<{row: number[], positive: boolean}>}>} examples from nameTrainingExamples
 * @param {{epochs?: number, lr?: number, l2?: number}} [options]
 * @returns {{features: string[], mean: number[], std: number[], w: number[], pairs: number}} usable by rankWithNameModel and configureNameModel
 */
export function trainNameModel(examples, options) {
    const { epochs, lr, l2 } = { epochs: 300, lr: 0.1, l2: 1e-3, ...options };
    const { mean, std } = standardizer(examples.flatMap(example => example.rows.map(r => r.row)));
    const z = (row) => row.map((value, j) => (value - mean[j]) / std[j]);
    const diffs = differences(examples, z);
    let w = NAME_FEATURES.map(() => 0);
    for (let epoch = 0; epoch < epochs; epoch++) w = step(w, diffs, lr, l2);
    return { features: [...NAME_FEATURES], mean, std, w, pairs: diffs.length };
}
