/**
 * Where does the code know a state the question names ("when the queue is empty", "after a failed attempt")? The function
 * and the line, or nothing (backlog/toestand-in-de-code.md). Pure: the caller gives the text of the best files.
 *
 * A concept is a word of the question with its translations ("leeg", "empty", "nothing"): it counts once. A function
 * qualifies when its own lines name at least one concept and, together with its file (path, header, comments: the subject
 * "queue" is often only there), at least MIN_COVERAGE of them, weighted by how rare they are in the code. A word without a
 * translation that no read file contains is left out (an unknown word says nothing); a translated word always counts, so
 * "when the user is logged in" in code without a login has no place, which is an answer too.
 */
import { NL_EN } from '../../language/index.js';
import { sharesStem } from './rankTokens.js';

export const MIN_COVERAGE = 0.6;
const MAX_PLACES = 5;

/** The question's terms grouped: a Dutch word with its translations is one concept, any other term its own. */
export function conceptsOf(terms) {
    const seen = new Set();
    const concepts = [];
    for (const term of terms) {
        if (seen.has(term)) continue;
        const group = [term, ...(NL_EN[term] || [])];
        group.forEach(word => seen.add(word));
        concepts.push(group);
    }
    return concepts;
}

/** `lastFailureSignature`, `'in-progress'` -> last, failure, signature, lastfailuresignature, in, progress */
const lineTokens = line => [...new Set((line.match(/[A-Za-z][A-Za-z0-9]*/g) || []).flatMap(word => [word.toLowerCase(), ...word.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(' ')]))];

const names = (term, tokens) => tokens.includes(term) || (term.length >= 5 && sharesStem(term, tokens));
const conceptIn = (concept, tokens) => concept.some(term => names(term, tokens));
const weightOf = (concept, weights) => Math.max(...concept.map(term => weights.get(term) ?? 1));

/** The innermost function around each 1-based line: [start, end, name] ranges, smallest first. */
function functionRanges(functions) {
    return (functions || [])
        .map(fn => [fn.loc?.[0] ?? fn.startLine, fn.loc?.[1] ?? fn.endLine, fn.name])
        .filter(([start, end, name]) => Number.isInteger(start) && Number.isInteger(end) && name)
        .sort((a, b) => (a[1] - a[0]) - (b[1] - b[0]));
}

// the code KNOWS a state where it decides on it (`if (state.paused)`, `status === 'in-progress'`, `.find(...)`); a line that
// only sets or returns it (`pause()`, `isPaused()`) counts less
const DECIDES = /\bif\s*\(|\bwhile\s*\(|[!=]==?|\?\s|\.(find|filter|some|every)\(|&&|\|\|/;
const DECISION_WEIGHT = 1.5;

/** Per line: the concepts it names and their weight, more where the line decides on them. */
function lineHits(lines, concepts, weights) {
    return lines.map((line, i) => {
        const tokens = lineTokens(line);
        const hit = concepts.filter(concept => conceptIn(concept, tokens));
        const weight = hit.reduce((sum, concept) => sum + weightOf(concept, weights), 0);
        return { line: i + 1, hit, weight: DECIDES.test(line) ? weight * DECISION_WEIGHT : weight };
    });
}

function placeOf(file, [start, end, name], hits, concepts, weights) {
    const inside = hits.filter(({ line, hit }) => line >= start && line <= end && hit.length);
    if (!inside.length) return null;
    const around = lineTokens(`${file.path} ${file.context || ''} ${name}`);
    const covered = concepts.filter(concept => inside.some(({ hit }) => hit.includes(concept)) || conceptIn(concept, around));
    const total = concepts.reduce((sum, concept) => sum + weightOf(concept, weights), 0);
    const coverage = total ? covered.reduce((sum, concept) => sum + weightOf(concept, weights), 0) / total : 0;
    const best = [...inside].sort((a, b) => b.weight - a.weight || a.line - b.line);
    const lines = best.filter(entry => entry.weight >= best[0].weight / 2).slice(0, 3).map(entry => entry.line).sort((a, b) => a - b);
    return { path: file.path, function: name, startLine: start, endLine: end, lines, coverage: Math.round(coverage * 100) / 100, names: covered.map(concept => concept[0]), score: coverage * 10 + best[0].weight };
}

/**
 * @param {{files: Array<{path: string, text: string, functions: object[]}>, terms: string[], weights: Map<string, number>}} input
 * @returns {Array<{path, function, startLine, endLine, lines, coverage, names}>} best first; [] when no function names enough
 */
export function statePlaces({ files, terms, weights, minCoverage = MIN_COVERAGE }) {
    const read = lineTokens(files.map(file => `${file.path} ${file.context || ''} ${file.text}`).join(' '));
    const concepts = conceptsOf(terms).filter(concept => concept.length > 1 || conceptIn(concept, read));
    if (!concepts.length) return [];
    const places = files.flatMap(file => {
        const hits = lineHits(String(file.text).split(/\r?\n/), concepts, weights);
        const taken = new Set();
        return functionRanges(file.functions).flatMap(range => {
            const place = placeOf(file, range, hits.filter(({ line }) => !taken.has(line)), concepts, weights);
            for (let line = range[0]; line <= range[1]; line++) taken.add(line); // a line belongs to its innermost function
            return place && place.coverage >= minCoverage ? [place] : [];
        });
    });
    return places.sort((a, b) => b.score - a.score).slice(0, MAX_PLACES).map(({ score, ...place }) => place);
}
