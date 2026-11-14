/**
 * Questions about behaviour, in plain Dutch (backlog/zoeken-op-gedrag.md, evals/behaviour-gold.json). Measured on Kura at
 * the commits before each change: 1 of 7 in the top 3 with 1.6.2, 4 of 7 with these rules.
 */
import { describe, it, expect } from 'vitest';
import { rankGraphNodes, tokenize, commentWordsOf } from '../core/graph/index.js';

const file = (path, extra = {}) => ({ id: `file:${path}`, type: 'CodeFile', path, name: path.split('/').pop(), kind: 'source', exports: [], symbols: [], ...extra });
const graphOf = (...nodes) => ({ nodes: new Map(nodes.map(node => [node.id, node])), edges: [] });
const ranked = (graph, question, kind = 'code') => rankGraphNodes(graph, question, { kind }).map(entry => entry.node.path);

describe('behaviour questions', () => {
    it('translates the Dutch words of behaviour and leaves out Dutch filler', () => {
        const terms = tokenize('Een vraag krijgt twee keer een antwoord; het aantal threads moet begrensd en instelbaar zijn');
        expect(terms).toEqual(expect.arrayContaining(['question', 'answer', 'limit', 'setting']));
        expect(terms).not.toEqual(expect.arrayContaining(['twee']));
        expect(terms).not.toContain('keer');
        expect(tokenize('starten')).not.toContain('run'); // run.mjs won every question that said "start"
    });

    it('a barrel does not outrank the file that defines what it re-exports', () => {
        const barrel = file('core/planning/index.js', { exports: ['taskQueue', 'answerQuestion', 'shortReply'] });
        const real = file('core/planning/taskQueue.js', { exports: ['taskQueue'] });
        expect(ranked(graphOf(barrel, real), 'task queue')[0]).toBe('core/planning/taskQueue.js');
    });

    it('a header that names what the question asks about lifts its file, but not a test that repeats the question', () => {
        const question = 'Een vraag krijgt één antwoord van de best passende persona';
        const scoreOf = node => rankGraphNodes(graphOf(node), question, { kind: 'all' })[0]?.score ?? 0;
        const described = file('core/pipelines/discussPipeline.js', { purpose: 'Discuss pipeline: free-form question -> persona selection -> one answer per persona' });
        const terse = file('core/pipelines/discussPipeline.js', { purpose: 'Discuss pipeline: one persona' });
        expect(scoreOf(described) - scoreOf(terse)).toBeGreaterThanOrEqual(4); // 2 words more in the header, plus the bonus for naming 3
        const test = file('test/discussPipeline.test.js', { kind: 'test', purpose: 'Discuss pipeline: free-form question -> persona selection -> one answer per persona' });
        expect(ranked(graphOf(described, test), question, 'all')[0]).toBe('core/pipelines/discussPipeline.js');
    });

    it('keeps the words of the comments, for the places of a state (not for the ranking: no gain there, measured)', () => {
        const source = '/** Router. */\nexport function route(line) {\n  // a loose y or n while no question is open: nothing starts\n  return line;\n}\n# python style comment\n';
        expect(commentWordsOf(source)).toEqual(expect.arrayContaining(['loose', 'question', 'open', 'nothing', 'starts', 'python']));
    });
});
