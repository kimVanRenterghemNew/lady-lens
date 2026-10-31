/**
 * Scoring for a search bench: hand-checked questions, each asked to one or more search systems as an agent would, and
 * the answer text scored. Per question: correct (every expected path named, nothing forbidden), recall, precision (share
 * of named paths that are expected), characters per correct item and richness (how many RICH_FIELDS the answer carries).
 * Question: `{ id, kind, expect?: [paths], forbid?: [paths], names?: [strings] }`, or for kind `exists` `{ path, exists }`.
 * TODO(coverage): Current line coverage is 70.83% (< 85% target). Raise to >= 85%.
 */
export const RICH_FIELDS = ['summary', 'consequences', 'risks', 'discussions', 'decisions'];

/** Repo paths named in an answer, in order, without duplicates; paths under `ignorePrefixes` do not count. */
export function pathsIn(text, { ignorePrefixes = [] } = {}) {
    const found = String(text).replace(/\\/g, '/').match(/[\w.-]+(?:\/[\w.-]+)+\.(?:js|mjs|cjs|md|json|yaml)\b/g) ?? [];
    return [...new Set(found.map(p => p.replace(/^\.\//, '')).filter(p => !ignorePrefixes.some(prefix => p.startsWith(prefix))))];
}

/** Richness: which of RICH_FIELDS an answer carries as a JSON key (plain text has none). */
export function richness(text) {
    return RICH_FIELDS.filter(field => new RegExp(`"${field}"\\s*:`).test(String(text))).length;
}

/**
 * Score one answer. Kind `exists` is right when the answer says the file exists exactly when it does: a JSON answer
 * (`jsonAnswer`, as lens tools give) by `"exists": true`, plain text by naming the path.
 */
export function scoreAnswer(question, text, { jsonAnswer = false, ignorePrefixes } = {}) {
    const got = pathsIn(text, { ignorePrefixes });
    const chars = String(text).length;
    if (question.kind === 'exists') {
        const said = jsonAnswer ? /"exists"\s*:\s*true/.test(text) : got.includes(question.path);
        const correct = said === question.exists;
        return { correct, recall: correct ? 1 : 0, precision: correct ? 1 : 0, falseItems: 0, chars, charsPerCorrect: correct ? chars : null, richness: richness(text) };
    }
    const expected = question.expect ?? [];
    const hits = expected.filter(p => got.includes(p));
    const namesOk = (question.names ?? []).every(name => String(text).includes(name));
    const falseItems = (question.forbid ?? []).filter(p => got.includes(p)).length;
    const recall = expected.length ? hits.length / expected.length : 1;
    return {
        correct: recall === 1 && namesOk && falseItems === 0, recall, precision: got.length ? hits.length / got.length : 0, falseItems, chars,
        charsPerCorrect: hits.length ? Math.round(chars / hits.length) : null, richness: richness(text)
    };
}

const mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;

/** Rows `{ system, kind, ms, ...scoreAnswer }` summed per `<system> <kind>` and `<system> all`. */
export function summarize(rows) {
    const by = {};
    for (const row of rows) (by[`${row.system} ${row.kind}`] ??= []).push(row), (by[`${row.system} all`] ??= []).push(row);
    return Object.fromEntries(Object.entries(by).map(([key, list]) => [key, {
        n: list.length, correct: list.filter(r => r.correct).length, recall: mean(list.map(r => r.recall)), precision: mean(list.map(r => r.precision)),
        falseItems: list.reduce((a, r) => a + r.falseItems, 0), chars: Math.round(mean(list.map(r => r.chars))),
        charsPerCorrect: Math.round(mean(list.map(r => r.charsPerCorrect).filter(v => v !== null))), ms: Math.round(mean(list.map(r => r.ms))),
        richness: mean(list.map(r => r.richness))
    }]));
}
