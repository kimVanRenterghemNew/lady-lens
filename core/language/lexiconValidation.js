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

function checkCandidateReason(dutch, english, repoTokens) {
    if (!/^[a-z]{3,}$/.test(dutch)) return 'not a plain lowercase word';
    if (dutch === english) return 'same as the English word';
    if (DUTCH_STOP.has(dutch)) return 'stop word';
    if (repoTokens.has(dutch)) return 'is itself a code token';
    return null;
}

function assessCandidate(candidate, english, repoTokens) {
    const dutch = typeof candidate === 'string' ? candidate.trim().toLowerCase() : '';
    const reason = checkCandidateReason(dutch, english, repoTokens);
    return reason ? { valid: false, dutch: String(candidate), reason } : { valid: true, dutch };
}

function validateCandidate(candidate, english, repoTokens, entries, rejected) {
    const result = assessCandidate(candidate, english, repoTokens);
    if (!result.valid) {
        rejected.push({ english, dutch: result.dutch, reason: result.reason });
        return;
    }
    entries[result.dutch] = [...new Set([...(entries[result.dutch] || []), english])];
}

function validateProposalEntry(rawEnglish, rawDutch, repoTokens, entries, rejected) {
    const english = String(rawEnglish).toLowerCase();
    if (!repoTokens.has(english)) {
        rejected.push({ english, reason: 'not a token of this repository' });
        return;
    }
    const candidates = Array.isArray(rawDutch) ? rawDutch : (typeof rawDutch === 'string' ? [rawDutch] : []);
    if (!candidates.length) {
        rejected.push({ english, reason: 'no Dutch words' });
        return;
    }
    candidates.forEach(c => validateCandidate(c, english, repoTokens, entries, rejected));
}

/**
 * @param {Object<string, unknown>} proposal - model output: { english: [dutch, ...] }
 * @param {Set<string>} repoTokens - lowercase tokens of the repository (identifier parts, file name parts)
 * @returns {{entries: Object<string, string[]>, rejected: Array<{english: string, dutch?: string, reason: string}>}}
 */
export function validateLexiconEntries(proposal, repoTokens) {
    const entries = {};
    const rejected = [];
    Object.entries(proposal || {}).forEach(([rawEnglish, rawDutch]) => {
        validateProposalEntry(rawEnglish, rawDutch, repoTokens, entries, rejected);
    });
    Object.entries(entries).forEach(([dutch, english]) => {
        if (english.length > 3) {
            rejected.push({ english: english.join(','), dutch, reason: 'maps to more than 3 English words' });
            delete entries[dutch];
        }
    });
    return { entries, rejected };
}
