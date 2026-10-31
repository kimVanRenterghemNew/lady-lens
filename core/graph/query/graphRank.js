/**
 * Ranked text matching for `graph_query`.
 *
 * The old matcher kept every node whose JSON contained ANY query word as a substring. With a
 * Dutch task description that is all of them ("de", "een", "toe"), so the first 10 nodes won
 * regardless of relevance. This ranks by where the term matches (file name > path segment >
 * exported symbol > purpose > any other field) and drops weak matches.
 *
 * @module core/graph/graphRank
 */

const STOP_WORDS = new Set([
    // English
    'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'new', 'add', 'use', 'using', 'all', 'any', 'should', 'would', 'could', 'must', 'not', 'are', 'can', 'has', 'have', 'its', 'also', 'when', 'then',
    // Dutch
    'een', 'het', 'van', 'voor', 'die', 'dat', 'met', 'toe', 'aan', 'naar', 'kan', 'nog', 'ook', 'wel', 'zijn', 'wordt', 'niet', 'geen', 'maar', 'dan', 'als', 'bij', 'uit', 'over', 'onder', 'eerst', 'zonder', 'deze', 'door', 'mag', 'moet', 'dit', 'wat', 'hoe',
    'zodat', 'gaan', 'gaat', 'worden', 'waar', 'wanneer', 'omdat', 'zou', 'zal', 'heeft', 'hebben', 'alle', 'elke', 'iets', 'graag'
]);
// The NL->EN domain lexicon lives in core/language: graph ranking and repository research share it.

import { NL_EN, closestWord, withTranslations } from '../../language/index.js';

const SKIPPED_FIELDS = new Set(['id', 'type', 'createdAt', 'updatedAt', 'timestamp', 'timestampStatus', 'observedAt']);
export const MIN_SCORE = 3;
export const IDF_MIN_NODES = 50;

/** `commandHandlers` -> ['commandhandlers', 'command', 'handlers']; `main.js` -> ['main.js', 'main']. */
export function tokenize(text) {
    const tokens = new Set();
    for (const raw of String(text).match(/[A-Za-z][A-Za-z0-9_.-]*/g) || []) {
        const whole = raw.toLowerCase().replace(/[.]+$/, '');
        const parts = [
            ...raw.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[\s._-]+/),
            ...whole.split(/[._-]+/)
        ].map(part => part.toLowerCase());
        for (const token of [whole, ...parts]) {
            if (token.length >= 3 && !STOP_WORDS.has(token)) tokens.add(token);
        }
    }
    // Object.hasOwn: "constructor"/"toString" are words, not Object.prototype members (live crash 2026-10-10).
    for (const token of [...tokens]) for (const english of (Object.hasOwn(NL_EN, token) ? NL_EN[token] : [])) tokens.add(english);
    return [...tokens];
}

function words(value) {
    return tokenize(Array.isArray(value) ? value.join(' ') : String(value ?? ''));
}

/** Shared prefix of >= 5 chars covering 75% of the shorter word: catches plurals and NL/EN cognates (sessie/session). */
function sharesStem(term, tokens) {
    for (const token of tokens) {
        const limit = Math.min(term.length, token.length);
        let prefix = 0;
        while (prefix < limit && term[prefix] === token[prefix]) prefix += 1;
        if (prefix >= 5 && prefix / limit >= 0.75) return true;
    }
    return false;
}

const TEST_WORDS = /^(tests?|testen|spec|specs)$/;
const DOC_WORDS = /^(backlog|docs?|documentatie|documentation|readme|story|stories|fase|phase|adr|beslissing|beslissingen|besluit|besluiten|besloten|beslist|decision|decisions|decided)$/;

// a question about what was decided puts Decision nodes first (live: the decision was on place 4 behind long docs).
const DECISION_WORDS = /^(beslissing|beslissingen|besluit|besluiten|besloten|beslist|decision|decisions|decided)$/;
const DECISION_BONUS = 6;

/** the one rule for "this question is about documents"; the loader and the ranking both use it. */
export const asksForDocuments = (text) => tokenize(text).some(term => DOC_WORDS.test(term));
const DOC_PENALTY = 5;
const BARREL_PENALTY = 4;

const NODE_SEARCH_CACHE = new WeakMap();

export function getNodeSearchIndex(node) {
    let index = NODE_SEARCH_CACHE.get(node);
    if (index) return index;

    const rawPath = String(node.path || ''), filePath = rawPath.toLowerCase();
    const segments = [...new Set([...filePath.split(/[/._-]+/), ...rawPath.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[\s/._-]+/)].filter(Boolean))];
    const stemOnly = filePath.split('/').pop() || '';
    const stem = stemOnly.replace(/\.[^.]+$/, '').replace(/\.(test|spec)$/, '');
    const exportTokens = new Set([...words(node.exports), ...words(node.keywords)]);
    const nameWords = stem.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[\s._-]+/).filter(word => word.length >= 3);
    const other = Object.entries(node)
        .filter(([key]) => !SKIPPED_FIELDS.has(key) && !['path', 'purpose', 'exports', 'symbols', 'keywords', 'title', 'name', 'symbolRanges', 'functions', 'calls', 'reads'].includes(key))
        .map(([, v]) => (typeof v === 'string' ? v : (Array.isArray(v) ? v.filter(x => typeof x === 'string').join(' ') : ''))).join(' ').toLowerCase();

    index = {
        rawPath, filePath, segments, stem, stemClean: stem.replace(/[^a-z0-9]/g, ''),
        symbolTokens: new Set([...exportTokens, ...words(node.symbols)]), exportTokens,
        symbolsLower: [...(node.exports || []), ...(node.symbols || [])].map(item => String(item).toLowerCase()),
        title: `${node.title || ''} ${node.name || ''}`.toLowerCase(),
        purpose: String(node.purpose || '').toLowerCase(), purposeTokens: words(node.purpose),
        other, stemOnly, nameWords,
        isTest: node.kind === 'test' || node.type === 'Test',
        isDoc: node.type === 'Document' || (node.type === 'Decision' && node.kind === 'decision') || node.type === 'Discussion',
        isBarrel: /^index\.[cm]?js$/.test(stemOnly)
    };
    NODE_SEARCH_CACHE.set(node, index);
    return index;
}

function scoreNode(node, terms, wantsTests, wantsDocs, weights = null, hits = null) {
    const idx = getNodeSearchIndex(node);

    let total = 0, matched = 0, matchedWeight = 0;
    for (const term of terms) {
        let best = 0, inName = false;
        const termClean = term.replace(/[^a-z0-9]/g, '');
        if (idx.stem === term || (termClean && idx.stemClean === termClean)) { best = 6; inName = true; }
        else if (idx.segments.includes(term)) { best = 4; inName = true; }
        else if (idx.exportTokens.has(term)) best = 4;
        else if (idx.symbolTokens.has(term)) best = 2;
        if (term.length >= 5 && !best && (sharesStem(term, idx.segments) || sharesStem(term, idx.exportTokens))) best = 3;
        if (term.length >= 4) {
            if (!best && idx.symbolsLower.some(symbol => symbol.includes(term))) best = 2;
            if (!best && idx.title.includes(term)) best = 3;
            if (!best && (idx.purpose.includes(term) || (term.length >= 5 && sharesStem(term, idx.purposeTokens)))) best = 2;
            if (!best && (idx.filePath.includes(term) || idx.other.includes(term))) best = 1;
        }
        if (best) {
            hits?.add(term);
            const weight = weights?.get(term) ?? 1;
            total += best * (inName ? Math.max(weight, 1) : weight);
            matched += 1;
            matchedWeight += weight;
        }
    }
    if (!total) return 0;
    const bonus = matched >= 2 ? 2 * Math.min(1, matchedWeight / matched) : 0;
    const compound = idx.nameWords.length >= 2 && idx.nameWords.every(word => terms.includes(word)) ? 6 : 0;
    total += compound;
    if (idx.isTest) return total + bonus + (wantsTests ? 4 : -3);
    if (idx.isDoc) return total + bonus - (wantsDocs ? 0 : DOC_PENALTY);
    if (idx.isBarrel && !terms.includes('index')) return total + bonus - BARREL_PENALTY;
    return total + bonus;
}

/**
 * Corrections for terms that match no node at all.
 * @returns {string[]} corrected words plus their lexicon translations
 */
export function typoCorrections(nodes, terms, wantsTests = false, wantsDocs = false) {
    const translations = new Set(terms.flatMap(term => NL_EN[term] || []));
    const targetTerms = terms.filter(term => term.length >= 5 && !translations.has(term));
    if (!targetTerms.length) return [];
    const matched = new Set();
    for (const node of nodes) {
        if (node.type === 'Document' || /\.(json|md|ya?ml)$/i.test(String(node.path || ''))) continue;
        scoreNode(node, targetTerms, wantsTests, wantsDocs, null, matched);
        if (targetTerms.every(term => matched.has(term))) return [];
    }
    const unmatched = targetTerms.filter(term => !matched.has(term));
    if (!unmatched.length) return [];
    const vocabulary = new Set(Object.keys(NL_EN));
    for (const node of nodes) {
        if (node.type === 'Document' || /\.(json|md|ya?ml)$/i.test(String(node.path || ''))) continue;
        const idx = getNodeSearchIndex(node);
        for (const part of idx.segments) if (part.length >= 4) vocabulary.add(part);
        for (const token of idx.symbolTokens) if (token.length >= 4) vocabulary.add(token);
    }
    const corrections = [];
    for (const term of unmatched) {
        const fixed = closestWord(term, vocabulary);
        if (fixed) corrections.push(...withTranslations([fixed]));
    }
    return [...new Set(corrections)];
}

/**
 * IDF weight per term. Before, every matching term counted the same, so a Dutch request with common
 * words ("status" is a local variable in dozens of files, "command" is in every handler) ranked validateAgent.js above
 * the command router. A term found in 5% of the nodes weighs 1; rarer terms up to 2, very common ones down to 0.25.
 * @returns {Map<string, number>}
 */
export function termWeights(nodes, terms, wantsTests = false, wantsDocs = false) {
    // In a small graph (a session with a handful of decisions) document frequency says nothing: one node holding the
    // term is not "common". IDF only from 50 nodes up; below that every term weighs 1, as before.
    if (nodes.length < IDF_MIN_NODES) return new Map(terms.map(term => [term, 1]));
    const df = new Map(terms.map(term => [term, 0]));
    for (const node of nodes) {
        const hits = new Set();
        scoreNode(node, terms, wantsTests, wantsDocs, null, hits);
        for (const term of hits) df.set(term, df.get(term) + 1);
    }
    const total = Math.max(nodes.length, 1);
    const reference = Math.log(20);   // df = 5% of the nodes -> weight 1
    return new Map(terms.map(term => {
        const count = df.get(term);
        const weight = count ? Math.log(total / count) / reference : 1;
        // A Dutch word that has an English translation in the lexicon is matched through that translation (the code is
        // English). Scored at full IDF it was the rarest term of the query and pulled our Dutch backlog docs to the top.
        if (NL_EN[term]) return [term, 0.25];
        return [term, Math.min(2, Math.max(0.25, weight))];
    }));
}

/**
 * @param {{nodes: Map<string, object>}} graph
 * @param {string} text
 * @param {{limit?: number, minScore?: number, kind?: 'doc'}} [options] - kind 'doc': rank only documents (search the documentation)
 * @returns {Array<{node: object, score: number}>} best first, ties broken by path/id for determinism
 */
export function rankGraphNodes(graph, text, { limit = 10, minScore = MIN_SCORE, kind } = {}) {
    const terms = tokenize(text);
    if (!terms.length) return [];
    const wantsTests = terms.some(term => TEST_WORDS.test(term));
    const wantsDocs = kind === 'doc' || asksForDocuments(text);
    const nodes = Array.from(graph.nodes.values()).filter(node => kind !== 'doc' || node.type === 'Document');
    // Story 17.9.14 step 3: a term that matches nothing (a misspelling) is corrected to the closest word of
    // the graph's own vocabulary or the lexicon, within a strict edit budget; its translation comes along.
    for (const correction of typoCorrections(nodes, terms, wantsTests, wantsDocs)) if (!terms.includes(correction)) terms.push(correction);
    const weights = termWeights(nodes, terms, wantsTests, wantsDocs);
    const wantsDecisions = terms.some(term => DECISION_WORDS.test(term));
    const wantsDiscussions = terms.some(term => /^(discussie|discussies|discussion|discussions|besproken|discussed|afgesproken|afspraak|afspraken|agreed|agreement)$/.test(term));
    return nodes
        .map(node => ({ node, score: scoreNode(node, terms, wantsTests, wantsDocs, weights) + (wantsDecisions && node.type === 'Decision' ? DECISION_BONUS : 0) + (wantsDiscussions && node.type === 'Discussion' ? DECISION_BONUS : 0) }))
        .filter(entry => entry.score >= minScore)
        .sort((a, b) => b.score - a.score || String(a.node.path || a.node.id).localeCompare(String(b.node.path || b.node.id)))
        .slice(0, limit);
}
