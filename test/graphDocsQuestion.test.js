/**
 * one rule for "this question is about documents". The ranking knew `decision`,
 * the loader did not, so a decision question ranked documents up that were never loaded (decision questions 0/2).
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { asksForDocuments } from '../core/graph/index.js';

describe('asksForDocuments', () => {
    it('recognises questions about decisions, stories and docs, in English and Dutch', () => {
        expect(asksForDocuments('decision cloud model local Ollama')).toBe(true);
        expect(asksForDocuments('wat werd besloten over de cloudmodellen')).toBe(true);
        expect(asksForDocuments('welke besluiten gelden voor de review')).toBe(true);
        expect(asksForDocuments('dwingende review stories get reviewed')).toBe(true);
    });

    it('MUST NOT pull documents into a code question', () => {
        expect(asksForDocuments('where is runPipeline defined')).toBe(false);
        expect(asksForDocuments('ladybug repository store cypher adapter')).toBe(false);
    });

    it('the loader has no list of its own (one rule, used by ranking and loading)', () => {
        const src = fs.readFileSync('core/search/graphModelLoader.js', 'utf8');
        expect(src).not.toMatch(/DOCS_QUESTION\s*=/);
        expect(src).toMatch(/asksForDocuments\(/);
    });
});

describe('a document in a graph_query answer is compact', () => {
    it('MUST clip the text of a document so ten of them fit the tool budget (one doc of 4,077 chars emptied the answer)', async () => {
        const { answerNode } = await import('../core/graph/index.js');
        const doc = { id: 'doc:a.md', type: 'Document', path: 'a.md', name: 'A', purpose: 'x'.repeat(4077) };
        const small = answerNode(doc);
        expect(small.path).toBe('a.md');
        expect(small.purpose.length).toBeLessThanOrEqual(161);
        expect(JSON.stringify(Array(10).fill(small)).length).toBeLessThan(4000);
        const code = { id: 'file:b.js', type: 'CodeFile', kind: 'code', path: 'b.js', purpose: 'short', exports: ['f'], symbolRanges: { f: [1, 900] } };
        expect(answerNode(code)).toEqual({ id: 'file:b.js', type: 'CodeFile', kind: 'code', path: 'b.js', purpose: 'short', exports: ['f'] });
    });
});

describe('graph_query cuts edges before nodes', () => {
    it('MUST keep the nodes (the answer) and drop edges first when over budget (live: 10 matches, 0 nodes, 14 omitted)', async () => {
        const { fitToBudget } = await import('../core/search/index.js');
        const big = (n, tag) => Array.from({ length: n }, (_, i) => ({ id: `${tag}${i}`, text: 'y'.repeat(300) }));
        const src = fs.readFileSync('core/search/index.js', 'utf8');
        const lists = JSON.parse(src.match(/graph_query: withBudget\(graph_query, \{ lists: (\[[^\]]*\])/)[1].replace(/'/g, '"'));
        const fitted = fitToBudget({ nodes: big(8, 'n'), edges: big(20, 'e') }, { lists });
        expect(fitted.nodes.length).toBe(8);
        expect(fitted.edges.length).toBeLessThan(20);
    });
});

describe('search only the documentation', () => {
    it('kind doc ranks only documents, without the code-first penalty, even when code matches better', async () => {
        const { rankGraphNodes } = await import('../core/graph/index.js');
        const nodes = [
            { id: 'file:core/review/planReview.js', type: 'CodeFile', path: 'core/review/planReview.js', exports: ['reviewPlan'], symbols: ['review', 'plan'] },
            { id: 'doc:backlog/story-review.md', type: 'Document', path: 'backlog/story-review.md', name: 'Plan review story', purpose: 'the plan review decides' }
        ];
        const graph = { nodes: new Map(nodes.map(n => [n.id, n])) };
        expect(rankGraphNodes(graph, 'plan review', { limit: 5 }).map(e => e.node.path)[0]).toBe('core/review/planReview.js');
        expect(rankGraphNodes(graph, 'plan review', { limit: 5, kind: 'doc' }).map(e => e.node.path)).toEqual(['backlog/story-review.md']);
    });
});
