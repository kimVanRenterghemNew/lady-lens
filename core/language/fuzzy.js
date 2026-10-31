/**
 * Typo tolerance for search terms: a misspelled word (one letter missing, extra, wrong or two
 * letters swapped) is corrected to the closest word the code or the lexicon knows.
 *
 * Deliberately narrow, because a loose fuzzy match is worse than none:
 *   - only terms of at least 5 letters that matched NOTHING exactly are corrected;
 *   - at most 1 edit per 5 letters (5-9 letters: 1 edit, 10-14: 2), counting a swap of two letters as one edit;
 *   - same first letter, and the length differs by at most the edit budget;
 *   - only whole words from a known vocabulary are suggested (never substrings).
 *
 * @module core/language/fuzzy
 */

/** Optimal-string-alignment distance: insert, delete, substitute, swap two adjacent letters = 1 each. */
export function editDistance(a, b) {
    const s = String(a), t = String(b);
    const d = Array.from({ length: s.length + 1 }, (_, i) => [i, ...Array(t.length).fill(0)]);
    for (let j = 1; j <= t.length; j++) d[0][j] = j;
    for (let i = 1; i <= s.length; i++) {
        for (let j = 1; j <= t.length; j++) {
            const cost = s[i - 1] === t[j - 1] ? 0 : 1;
            d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
            if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
        }
    }
    return d[s.length][t.length];
}

export const editBudget = (word) => Math.floor(String(word).length / 5);

/**
 * The closest vocabulary word within the edit budget, or null. Ties: the shorter distance, then the word seen first in
 * `vocabulary` (callers pass it most-relevant first).
 * @param {string} term
 * @param {Iterable<string>} vocabulary
 * @returns {string|null}
 */
export function closestWord(term, vocabulary) {
    const word = String(term).toLowerCase();
    const budget = editBudget(word);
    if (word.length < 5 || budget < 1) return null;
    let best = null;
    let bestDistance = Infinity;
    for (const candidate of vocabulary) {
        if (candidate === word) return null;   // an exact word is not a typo
        if (candidate[0] !== word[0] || Math.abs(candidate.length - word.length) > budget || candidate.length < 4) continue;
        const distance = editDistance(word, candidate);
        if (distance <= budget && distance < bestDistance) { best = candidate; bestDistance = distance; }
    }
    return best;
}
