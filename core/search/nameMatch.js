/**
 * MCP tool `name_match`: which of a set of files fits a text by name. The words and word pairs of the text are matched
 * against each file's path, exports, symbols, purpose and calls (the name matching of graph_query, nameRank.js), on the
 * files the caller chooses. Each match says why: the words and pairs it shares with the text.
 * @module core/search/nameMatch
 */
import { buildNameIndex, nameScores, filesNamedIn } from '../graph/index.js';
import { loadGraphModel, refreshProjectGraph, readRepoFile } from './graphModelLoader.js';
import { globToRegExp } from './grepSearch.js';

const DEFAULT_LIMIT = 10;

const isCodeFile = (node) => node.type === 'CodeFile';

const listed = (files) => (Array.isArray(files) ? files.map(String) : []);
const pattern = (glob) => String(glob ?? '').trim();

/** The files to choose from: the listed ones, else those of the glob, else every code and test file. */
function chooser(args) {
    const wanted = new Set(listed(args.files));
    if (wanted.size) return (node) => wanted.has(node.path);
    const glob = pattern(args.glob);
    if (!glob) return () => true;
    const regex = globToRegExp(glob);
    return (node) => regex.test(node.path);
}

/** `u:task` -> words, `b:task>id` -> 'task id', `s:task>plan` -> 'task … plan' */
function reasons(matched) {
    const words = [], pairs = [];
    for (const feature of [...new Set(matched)]) {
        const [a, b] = feature.slice(2).split('>');
        if (feature[0] === 'u') words.push(a);
        else pairs.push(feature[0] === 'b' ? `${a} ${b}` : `${a} … ${b}`);
    }
    return { pairs, words };
}

const round = (value) => Math.round(value * 100) / 100;

const limitOf = (limit) => Math.max(1, Number(limit) || DEFAULT_LIMIT);
const asMatch = (entry, fromDoc = false) => ({ path: entry.node.path, kind: entry.node.kind, score: round(entry.score), ...reasons(entry.matched), ...(fromDoc ? { fromDoc } : {}) });

// a clear first among the files the document names: a word pair, and twice the score of the second (measured: 81 % right
// on one repo's docs, under 50 % on another's, so a suggestion, never an edge)
const DOC_LEAD = 2;
const clearFirst = (scores) => scores[0]?.matched.some(f => f.startsWith('b:')) && (!scores[1] || scores[0].score >= DOC_LEAD * scores[1].score);

/** With `doc`: the files that document names come first when one of them is a clear match; the rest follow. */
function docFirst(doc, candidates, text, readFile) {
    const named = new Set(filesNamedIn(readFile(doc) ?? '', candidates.map(node => node.path)));
    const inDoc = candidates.filter(node => named.has(node.path));
    const scores = inDoc.length ? nameScores(buildNameIndex(inDoc), text) : [];
    return { docFiles: inDoc.length, first: clearFirst(scores) ? [asMatch(scores[0], true)] : [] };
}

/**
 * @param {{text: string, files?: string[], glob?: string, doc?: string, limit?: number}} args `doc`: the document the
 *   text comes from; the files it names elsewhere come first when one is a clear match
 * @param {{refresh?: Function, load?: Function, readFile?: Function}} [deps]
 * @returns {Promise<object>} { text, candidates, matches: [{ path, kind, score, pairs, words, fromDoc? }], docFiles?, freshness } or { error }
 */
export async function nameMatch(args, deps) {
    const { refresh, load, readFile } = { refresh: refreshProjectGraph, load: loadGraphModel, readFile: readRepoFile, ...deps };
    const text = String(args?.text ?? '').trim();
    if (!text) return { error: 'text is required: a sentence, a request or a path to match names against' };
    const freshness = await refresh();
    const { graph } = await load({ includeProject: true, text });
    const candidates = [...graph.nodes.values()].filter(isCodeFile).filter(chooser(args));
    if (!candidates.length) return { error: 'no code file matches files/glob: check the paths with glob', freshness };
    return { text, candidates: candidates.length, ...ranked(candidates, text, args, readFile), freshness };
}

/** The matches (a clear match of the document's own files first, with `doc`), and how many files the document names. */
function ranked(candidates, text, args, readFile) {
    const fromDoc = args.doc ? docFirst(args.doc, candidates, text, readFile) : { first: [] };
    const rest = nameScores(buildNameIndex(candidates), text).map(entry => asMatch(entry)).filter(m => !fromDoc.first.some(f => f.path === m.path));
    const matches = [...fromDoc.first, ...rest].slice(0, limitOf(args.limit));
    return { matches, ...(args.doc ? { docFiles: fromDoc.docFiles } : {}) };
}
