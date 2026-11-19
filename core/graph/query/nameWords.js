/**
 * The words of names and their features: the shared base of the name matching (nameRank.js, nameTests.js).
 * @module core/graph/query/nameWords
 */

import { STOP_WORDS } from './rankTokens.js';

// lens's stop words are 3+ letters; two-letter words count here (`id`, `db`, `ui`), so their stop words do too
const SHORT_STOP_WORDS = new Set('is be of to in on or as by it an at if de en er te op je we ze nu al zo om ja tot nee'.split(' '));
const SKIP = 3;

const keep = (word) => word.length >= 2 && !STOP_WORDS.has(word) && !SHORT_STOP_WORDS.has(word) && !/^\d+$/.test(word);

/**
 * The words of a name: camelCase, capital runs and every non-letter split, lower case.
 * @example nameParts('TASK_ID_RE') // ['task', 'id', 're']; nameParts('HTTPServer') // ['http', 'server']
 * @param {string} name identifier, path segment or sentence
 * @returns {string[]} the words, unfiltered
 */
export const nameParts = (name) => String(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/**
 * The features of a run of words, after dropping stop words, numbers and one-letter words.
 * @example features(['task', 'id', 'of', 'plan']) // ['u:task', 'b:task>id', 's:task>plan', 'u:id', 'b:id>plan', 'u:plan']
 * @param {string[]|string} words in their order, or a text (split with nameParts)
 * @returns {string[]} single words `u:w`, neighbour pairs `b:a>b` and skip pairs `s:a>c` up to 3 apart; order kept.
 *   The prefix is the kind: `u` word (weight 1), `b` neighbour pair (2.5), `s` skip pair (1.5)
 */
export function features(words) {
    const list = typeof words === 'string' ? words.split(/\s+/).flatMap(nameParts) : words;
    const kept = list.filter(keep);
    const out = new Set();
    kept.forEach((word, i) => {
        out.add(`u:${word}`);
        if (kept[i + 1]) out.add(`b:${word}>${kept[i + 1]}`);
        for (let j = i + 2; j <= i + SKIP && j < kept.length; j++) out.add(`s:${word}>${kept[j]}`);
    });
    return [...out];
}

/** Words and neighbour pairs only: the features of the role test. */
export const wordsAndPairs = (text) => features(text).filter(feature => !feature.startsWith('s:'));
