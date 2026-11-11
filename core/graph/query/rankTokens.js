/**
 * Text tokenization and stem matching for graph ranking.
 * @module core/graph/query/rankTokens
 */

import { NL_EN } from '../../language/index.js';

export const STOP_WORDS = new Set([
    'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'new', 'add', 'use', 'using', 'all', 'any', 'should', 'would', 'could', 'must', 'not', 'are', 'can', 'has', 'have', 'its', 'also', 'when', 'then',
    'een', 'het', 'van', 'voor', 'die', 'dat', 'met', 'toe', 'aan', 'naar', 'kan', 'nog', 'ook', 'wel', 'zijn', 'wordt', 'niet', 'geen', 'maar', 'dan', 'als', 'bij', 'uit', 'over', 'onder', 'eerst', 'zonder', 'deze', 'door', 'mag', 'moet', 'dit', 'wat', 'hoe', 'zodat', 'gaan', 'gaat', 'worden', 'waar', 'wanneer', 'omdat', 'zou', 'zal', 'heeft', 'hebben', 'alle', 'elke', 'iets', 'graag'
]);

function addWordTokens(tokens, raw) {
    const whole = raw.toLowerCase().replace(/[.]+$/, '');
    const camelParts = raw.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[\s._-]+/);
    const wholeParts = whole.split(/[._-]+/);
    const parts = [...camelParts, ...wholeParts].map(part => part.toLowerCase());
    for (const token of [whole, ...parts]) {
        if (token.length >= 3 && !STOP_WORDS.has(token)) tokens.add(token);
    }
}

/** `commandHandlers` -> ['commandhandlers', 'command', 'handlers']; `main.js` -> ['main.js', 'main']. */
export function tokenize(text) {
    const tokens = new Set();
    const rawMatches = String(text).match(/[A-Za-z][A-Za-z0-9_.-]*/g) || [];
    for (const raw of rawMatches) addWordTokens(tokens, raw);
    for (const token of [...tokens]) {
        const translations = Object.hasOwn(NL_EN, token) ? NL_EN[token] : [];
        translations.forEach(e => tokens.add(e));
    }
    return [...tokens];
}

export function words(value) {
    return tokenize(Array.isArray(value) ? value.join(' ') : String(value ?? ''));
}

function matchStemPrefix(term, token) {
    const limit = Math.min(term.length, token.length);
    let prefix = 0;
    while (prefix < limit && term[prefix] === token[prefix]) prefix += 1;
    return prefix;
}

/** Shared prefix of >= 5 chars covering 75% of the shorter word and leaving at most 2 letters of the longer one. */
export function sharesStem(term, tokens) {
    for (const token of tokens) {
        const limit = Math.min(term.length, token.length);
        const prefix = matchStemPrefix(term, token);
        const coversShorter = prefix >= 5 && prefix / limit >= 0.75;
        const leavesLonger = Math.max(term.length, token.length) - prefix <= 2;
        if (coversShorter && leavesLonger) return true;
    }
    return false;
}
