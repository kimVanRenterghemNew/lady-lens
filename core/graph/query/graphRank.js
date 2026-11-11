/**
 * Ranked text matching for `graph_query`.
 *
 * @module core/graph/graphRank
 */

import { tokenize, sharesStem } from './rankTokens.js';
import { findTypoCorrections, computeTermWeights } from './rankCorrections.js';
import { getNodeSearchIndex } from './searchIndex.js';

export { tokenize } from './rankTokens.js';
export { IDF_MIN_NODES } from './rankCorrections.js';
export { getNodeSearchIndex } from './searchIndex.js';

export const MIN_SCORE = 3;

const TEST_WORDS = /^(tests?|testen|spec|specs)$/;
const DOC_WORDS = /^(backlog|docs?|documentatie|documentation|readme|story|stories|fase|phase|adr|beslissing|beslissingen|besluit|besluiten|besloten|beslist|decision|decisions|decided)$/;
const DECISION_WORDS = /^(beslissing|beslissingen|besluit|besluiten|besloten|beslist|decision|decisions|decided)$/;
const DECISION_BONUS = 6;
const DOC_PENALTY = 5;
const BARREL_PENALTY = 4;

export const asksForDocuments = (text) => tokenize(text).some(term => DOC_WORDS.test(term));

const NAME_MATCHERS = [
    { match: (idx, term, clean) => term === idx.stem || (clean && clean === idx.stemClean), score: 6, inName: true },
    { match: (idx, term) => idx.segments.includes(term), score: 4, inName: true },
    { match: (idx, term) => idx.exportTokens.has(term), score: 4, inName: false },
    { match: (idx, term) => idx.symbolTokens.has(term), score: 2, inName: false }
];

function checkTextMatch(term, idx) {
    if (idx.title.includes(term)) return 3;
    if (idx.symbolsLower.some(symbol => symbol.includes(term))) return 2;
    if (idx.purpose.includes(term)) return 2;
    return 0;
}

function checkStemOrPathMatch(term, idx) {
    if (term.length >= 5 && sharesStem(term, idx.purposeTokens)) return 2;
    if (idx.filePath.includes(term) || idx.other.includes(term)) return 1;
    return 0;
}

function scoreSecondaryMatches(term, idx, currentBest) {
    if (term.length < 4 || currentBest) return currentBest;
    const directScore = checkTextMatch(term, idx);
    if (directScore) return directScore;
    return checkStemOrPathMatch(term, idx);
}

function findTermScore(term, idx) {
    const termClean = term.replace(/[^a-z0-9]/g, '');
    const hit = NAME_MATCHERS.find(m => m.match(idx, term, termClean));
    if (hit) return { score: hit.score, inName: hit.inName };
    if (term.length >= 5 && (sharesStem(term, idx.segments) || sharesStem(term, idx.exportTokens))) {
        return { score: 3, inName: false };
    }
    const secondary = scoreSecondaryMatches(term, idx, 0);
    return { score: secondary, inName: false };
}

function termMultiplier(inName, weight) {
    if (inName) return Math.max(weight, 1);
    return weight;
}

function scoreTerm(term, idx, weights, hits) {
    const found = findTermScore(term, idx);
    if (!found.score) return null;
    if (hits) hits.add(term);
    const weight = weights ? (weights.get(term) ?? 1) : 1;
    const termScore = found.score * termMultiplier(found.inName, weight);
    return { termScore, weight };
}

function testAdjustment(isTest, wantsTests) {
    if (!isTest) return 0;
    return wantsTests ? 4 : -3;
}

function docAdjustment(isDoc, wantsDocs) {
    if (!isDoc) return 0;
    return wantsDocs ? 0 : -DOC_PENALTY;
}

function barrelAdjustment(isBarrel, terms) {
    if (isBarrel && !terms.includes('index')) return -BARREL_PENALTY;
    return 0;
}

// exclusive: a test node is never also penalised as a doc or a barrel (a test fixture's index.js)
function applyKindAdjustments(adjusted, idx, wantsTests, wantsDocs, terms) {
    if (idx.isTest) return adjusted + testAdjustment(true, wantsTests);
    if (idx.isDoc) return adjusted + docAdjustment(true, wantsDocs);
    return adjusted + barrelAdjustment(idx.isBarrel, terms);
}

function calculateScoreBonus(matched, matchedWeight, idx, terms) {
    let bonus = matched >= 2 ? 2 * Math.min(1, matchedWeight / matched) : 0;
    if (idx.nameWords.length >= 2 && idx.nameWords.every(word => terms.includes(word))) {
        bonus += 6;
    }
    return bonus;
}

function scoreNode(node, terms, wantsTests, wantsDocs, weights, hits) {
    const idx = getNodeSearchIndex(node);
    let total = 0, matched = 0, matchedWeight = 0;
    for (const term of terms) {
        const result = scoreTerm(term, idx, weights, hits);
        if (result) {
            total += result.termScore;
            matched += 1;
            matchedWeight += result.weight;
        }
    }
    if (!total) return 0;
    const bonus = calculateScoreBonus(matched, matchedWeight, idx, terms);
    return applyKindAdjustments(total + bonus, idx, wantsTests, wantsDocs, terms);
}

export const typoCorrections = (nodes, terms, wantsTests = false, wantsDocs = false) =>
    findTypoCorrections(nodes, terms, wantsTests, wantsDocs, scoreNode, getNodeSearchIndex);

export const termWeights = (nodes, terms, wantsTests = false, wantsDocs = false) =>
    computeTermWeights(nodes, terms, wantsTests, wantsDocs, scoreNode);

function nodeBonus(node, wantsDecisions, wantsDiscussions) {
    let bonus = 0;
    if (wantsDecisions && node.type === 'Decision') bonus += DECISION_BONUS;
    if (wantsDiscussions && node.type === 'Discussion') bonus += DECISION_BONUS;
    return bonus;
}

function prepareRankTerms(text, nodes, wantsTests, wantsDocs) {
    const terms = tokenize(text);
    if (!terms.length) return [];
    for (const correction of typoCorrections(nodes, terms, wantsTests, wantsDocs)) {
        if (!terms.includes(correction)) terms.push(correction);
    }
    return terms;
}

// graph_query `kind` (schema: all, code, doc, test); a missing or unknown kind keeps every node
const KIND_FILTERS = {
    __proto__: null,
    doc: node => node.type === 'Document',
    code: node => node.type === 'CodeFile' && node.kind !== 'test',
    test: node => node.kind === 'test' || node.type === 'Test'
};
export const nodeMatchesKind = (node, kind) => !KIND_FILTERS[kind] || KIND_FILTERS[kind](node);

function filterNodesByKind(graph, kind) {
    return Array.from(graph.nodes.values()).filter(node => nodeMatchesKind(node, kind));
}

const DEFAULT_RANK_OPTS = Object.freeze({ limit: 10, minScore: MIN_SCORE });

function rankOptions(options) {
    return Object.assign({}, DEFAULT_RANK_OPTS, options);
}

/**
 * @param {{nodes: Map<string, object>}} graph
 * @param {string} text
 * @param {{limit?: number, minScore?: number, kind?: 'doc'}} [options]
 * @returns {Array<{node: object, score: number}>}
 */
export function rankGraphNodes(graph, text, options) {
    const opts = rankOptions(options);
    const wantsDocs = opts.kind === 'doc' || asksForDocuments(text);
    const nodes = filterNodesByKind(graph, opts.kind);
    const wantsTests = tokenize(text).some(term => TEST_WORDS.test(term));
    const terms = prepareRankTerms(text, nodes, wantsTests, wantsDocs);
    if (!terms.length) return [];
    const weights = termWeights(nodes, terms, wantsTests, wantsDocs);
    const wantsDecisions = terms.some(term => DECISION_WORDS.test(term));
    const wantsDiscussions = terms.some(term => /^(discussie|discussies|discussion|discussions|besproken|discussed|afgesproken|afspraak|afspraken|agreed|agreement)$/.test(term));
    return nodes
        .map(node => ({ node, score: scoreNode(node, terms, wantsTests, wantsDocs, weights) + nodeBonus(node, wantsDecisions, wantsDiscussions) }))
        .filter(entry => entry.score >= opts.minScore)
        .sort((a, b) => b.score - a.score || String(a.node.path || a.node.id).localeCompare(String(b.node.path || b.node.id)))
        .slice(0, opts.limit);
}
