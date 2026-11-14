/**
 * graph_query `places`: the functions of the best code files that name the state of the question, or a plain "not found".
 */
import { describe, it, expect } from 'vitest';
import { placesFor, NOT_FOUND } from '../core/search/index.js';

const queue = { id: 'file:core/queue/workQueue.js', type: 'CodeFile', kind: 'source', path: 'core/queue/workQueue.js', purpose: 'The work queue', commentWords: ['queue'], functions: [{ name: 'pull', loc: [1, 3] }] };
const test = { id: 'file:test/workQueue.test.js', type: 'CodeFile', kind: 'test', path: 'test/workQueue.test.js', functions: [{ name: 'it', loc: [1, 1] }] };
const graph = { nodes: new Map([[queue.id, queue], [test.id, test]]), edges: [] };
const texts = { 'core/queue/workQueue.js': 'async pull() {\n    if (state.paused) return null;\n}', 'test/workQueue.test.js': "it('paused queue', () => {});" };
const readFile = path => texts[path] ?? null;

describe('graph_query places', () => {
    it('gives the function and line of a state, from code files only', () => {
        expect(placesFor(graph, 'als de wachtrij gepauzeerd is', [test, queue], { readFile })).toEqual({ places: [expect.objectContaining({ path: 'core/queue/workQueue.js', function: 'pull', lines: [2] })] });
    });

    it('says not found when no function names the state', () => {
        expect(placesFor(graph, 'als de gebruiker is ingelogd', [queue], { readFile })).toEqual({ places: [], placesNote: NOT_FOUND });
        expect(placesFor(graph, 'als de wachtrij gepauzeerd is', [{ ...queue, path: 'core/queue/gone.js' }], { readFile })).toMatchObject({ places: [] });
    });
});
