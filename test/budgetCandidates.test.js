/**
 * graph_query over the context budget keeps every candidate (2026-11-13: a 4000-char answer held 2 of 10 nodes next to
 * a prose `context` that repeated them): the caller's model picks the seam, so lens sends too much rather than too little.
 */
import { describe, it, expect } from 'vitest';
import { fitToBudget } from '../core/search/index.js';
import { shortNode } from '../core/graph/index.js';

const node = (i) => ({
    id: `file:core/part${i}.js`, type: 'CodeFile', path: `core/part${i}.js`, purpose: `Part ${i}: ${'does a thing '.repeat(12)}`,
    exports: ['alpha', 'beta', 'gamma'], consequences: { importedBy: 3, calledBy: ['core/a.js', 'core/b.js'], tests: 2 }, risks: []
});
const answer = () => ({
    matchCount: 20, nodes: Array.from({ length: 20 }, (_, i) => node(i)), edges: Array.from({ length: 60 }, (_, i) => ({ from: `a${i}`, to: `b${i}`, type: 'CALLS' })),
    symbols: [], context: '## Affected Modules\n' + '- core/x.js: something\n'.repeat(100), provenance: { totalNodes: 400, matchCount: 20 }
});
const SHAPE = { lists: ['nodes', 'symbols', 'edges'], texts: ['context'], drop: ['edges', 'context', 'provenance'], compact: { nodes: { keep: 1, to: shortNode } } };

describe('graph_query over the context budget', () => {
    it('keeps all 20 candidates: edges and context go first, nodes after the first become path, purpose and a few exports', () => {
        const fitted = fitToBudget(answer(), SHAPE);
        expect(JSON.stringify(fitted).length).toBeLessThanOrEqual(4000);
        expect(fitted.nodes.map(n => n.path)).toEqual(answer().nodes.map(n => n.path));
        expect(fitted.nodes[0].consequences).toBeDefined();
        expect(fitted.nodes[19]).toEqual({ path: 'core/part19.js', purpose: expect.stringMatching(/^Part 19: .{1,60}…$/), exports: ['alpha', 'beta', 'gamma'] });
        expect(fitted).not.toHaveProperty('edges');
        expect(fitted).not.toHaveProperty('context');
        expect(fitted.hint).toMatch(/edges left out, context left out, provenance left out, nodes \d+ to 20 short/);
    });

    it('drops and shortens only as much as needed', () => {
        const small = { ...answer(), nodes: answer().nodes.slice(0, 3), edges: [], context: 'x' };
        const fitted = fitToBudget({ ...small, edges: Array.from({ length: 150 }, (_, i) => ({ from: `a${i}`, to: `b${i}`, type: 'CALLS' })) }, SHAPE);
        expect(fitted).not.toHaveProperty('edges');
        expect(fitted.context).toBe('x');
        expect(fitted.nodes[2].consequences).toBeDefined();
    });
});
