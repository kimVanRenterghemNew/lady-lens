/**
 * Typo corrections and IDF term weights for graph ranking.
 * @module core/graph/query/rankCorrections
 */

import { NL_EN, closestWord, withTranslations } from '../../language/index.js';

export const IDF_MIN_NODES = 50;

const isCodeNode = (node) => node.type !== 'Document' && !/\.(json|md|ya?ml)$/i.test(String(node.path || ''));

function addIndexVocabulary(idx, vocabulary) {
    for (const t of [...idx.segments, ...idx.symbolTokens]) {
        if (t.length >= 4) vocabulary.add(t);
    }
}

function buildSearchVocabulary(nodes, getNodeSearchIndex) {
    const vocabulary = new Set(Object.keys(NL_EN));
    for (const node of nodes.filter(isCodeNode)) {
        addIndexVocabulary(getNodeSearchIndex(node), vocabulary);
    }
    return vocabulary;
}

function filterTargetTerms(terms) {
    const translations = new Set(terms.flatMap(term => NL_EN[term] || []));
    return terms.filter(term => term.length >= 5 && !translations.has(term));
}

function collectMatchingHits(nodes, targetTerms, wantsTests, wantsDocs, scoreNode) {
    const matched = new Set();
    for (const node of nodes.filter(isCodeNode)) {
        scoreNode(node, targetTerms, wantsTests, wantsDocs, null, matched);
        if (targetTerms.every(term => matched.has(term))) return null;
    }
    const unmatched = targetTerms.filter(term => !matched.has(term));
    return unmatched.length ? unmatched : null;
}

function resolveClosestWords(unmatched, vocabulary) {
    const corrections = [];
    for (const term of unmatched) {
        const fixed = closestWord(term, vocabulary);
        if (fixed) corrections.push(...withTranslations([fixed]));
    }
    return [...new Set(corrections)];
}

/**
 * Corrections for terms that match no node at all.
 * @returns {string[]} corrected words plus their lexicon translations
 */
export function findTypoCorrections(nodes, terms, wantsTests, wantsDocs, scoreNode, getNodeSearchIndex) {
    const targetTerms = filterTargetTerms(terms);
    if (!targetTerms.length) return [];
    const unmatched = collectMatchingHits(nodes, targetTerms, wantsTests, wantsDocs, scoreNode);
    if (!unmatched) return [];
    const vocabulary = buildSearchVocabulary(nodes, getNodeSearchIndex);
    return resolveClosestWords(unmatched, vocabulary);
}

function calculateTermIdf(term, df, total, reference) {
    if (NL_EN[term]) return 0.25;
    const count = df.get(term);
    const weight = count ? Math.log(total / count) / reference : 1;
    return Math.min(2, Math.max(0.25, weight));
}

/**
 * IDF weight per term.
 * @returns {Map<string, number>}
 */
export function computeTermWeights(nodes, terms, wantsTests, wantsDocs, scoreNode) {
    if (nodes.length < IDF_MIN_NODES) return new Map(terms.map(term => [term, 1]));
    const df = new Map(terms.map(term => [term, 0]));
    for (const node of nodes) {
        const hits = new Set();
        scoreNode(node, terms, wantsTests, wantsDocs, null, hits);
        hits.forEach(term => df.set(term, df.get(term) + 1));
    }
    const total = Math.max(nodes.length, 1);
    const reference = Math.log(20);
    return new Map(terms.map(term => [term, calculateTermIdf(term, df, total, reference)]));
}
