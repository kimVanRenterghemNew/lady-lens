/**
 * Deterministic gate for a generated lexicon. A small local model proposes Dutch words for the
 * English words of the code; nothing it says is trusted:
 *   - the English word must be a real token of this repository (no invented code words);
 *   - a Dutch word must be lowercase letters only, at least 3 long, not a stop word, and NOT itself a code token
 *     (otherwise "status" -> "state" style entries would redirect English words that already match);
 *   - the same Dutch word may map to at most 3 English words (a model that maps "maken" to everything is noise).
 * Every rejected entry is returned with its reason, so a build report shows what the model got wrong.
 * TODO(coverage): Current line coverage is 5% (< 85% target). Raise to >= 85%.
 *
 * @module core/language/lexiconValidation
 */

const DUTCH_STOP = new Set(['een', 'het', 'van', 'voor', 'die', 'dat', 'met', 'toe', 'aan', 'naar', 'maar', 'als', 'bij', 'uit', 'over', 'zijn', 'worden', 'maken', 'doen', 'hebben', 'gaan', 'komen', 'ding', 'iets']);

/**
 * @param {Object<string, unknown>} proposal - model output: { english: [dutch, ...] }
 * @param {Set<string>} repoTokens - lowercase tokens of the repository (identifier parts, file name parts)
 * @returns {{entries: Object<string, string[]>, rejected: Array<{english: string, dutch?: string, reason: string}>}}
 *   entries keyed by DUTCH word (the direction the lexicon is used in)
 */
export function validateLexiconEntries(proposal, repoTokens) {
    const entries = {};
    const rejected = [];
    for (const [rawEnglish, rawDutch] of Object.entries(proposal || {})) {
        const english = String(rawEnglish).toLowerCase();
        if (!repoTokens.has(english)) { rejected.push({ english, reason: 'not a token of this repository' }); continue; }
        const candidates = Array.isArray(rawDutch) ? rawDutch : (typeof rawDutch === 'string' ? [rawDutch] : []);
        if (!candidates.length) { rejected.push({ english, reason: 'no Dutch words' }); continue; }
        for (const candidate of candidates) {
            const dutch = typeof candidate === 'string' ? candidate.trim().toLowerCase() : '';
            if (!/^[a-z]{3,}$/.test(dutch)) { rejected.push({ english, dutch: String(candidate), reason: 'not a plain lowercase word' }); continue; }
            if (dutch === english) { rejected.push({ english, dutch, reason: 'same as the English word' }); continue; }
            if (DUTCH_STOP.has(dutch)) { rejected.push({ english, dutch, reason: 'stop word' }); continue; }
            if (repoTokens.has(dutch)) { rejected.push({ english, dutch, reason: 'is itself a code token' }); continue; }
            entries[dutch] = [...new Set([...(entries[dutch] || []), english])];
        }
    }
    for (const [dutch, english] of Object.entries(entries)) {
        if (english.length > 3) {
            rejected.push({ english: english.join(','), dutch, reason: 'maps to more than 3 English words' });
            delete entries[dutch];
        }
    }
    return { entries, rejected };
}
