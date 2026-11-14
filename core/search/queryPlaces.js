/**
 * `graph_query` with `places: true`: in the best code files of the answer, the functions and lines that name the state or
 * behaviour of the question (backlog/toestand-in-de-code.md), or a plain "not found".
 */
import { tokenize, termWeights, statePlaces } from '../graph/index.js';

// more than the answer shows: for a short question about a state the file ranking is weak ("queue empty" ranked
// workQueueStorage.js above workQueue.js), the lines decide
const FILES_READ = 15;
const isCode = node => node.type === 'CodeFile' && node.kind !== 'test';
export const NOT_FOUND = 'not found: no function in the best code files names enough of the question (a state this code does not have, or other words for it)';

export function placesFor(graph, text, rankedNodes, { readFile }) {
    const code = [...graph.nodes.values()].filter(isCode);
    const terms = tokenize(text);
    const files = rankedNodes.filter(isCode).slice(0, FILES_READ)
        .map(node => ({ path: node.path, text: readFile(node.path), functions: node.functions, context: [node.purpose, ...(node.commentWords || [])].join(' ') }))
        .filter(file => file.text != null);
    const places = statePlaces({ files, terms, weights: termWeights(code, terms) });
    return places.length ? { places } : { places, placesNote: NOT_FOUND };
}
