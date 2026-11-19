/**
 * Ranking grounds on what the request names (paths), never on a fixed list of file or function names.
 */
import { describe, it, expect } from 'vitest';
import { createGraph, rankGraphNodes, pathGroundingBonus } from '../core/graph/index.js';

function twinGraph(first, second) {
    const graph = createGraph('t');
    for (const [path, name] of [first, second]) {
        graph.addNode(`file:${path}`, 'CodeFile', {
            path,
            purpose: 'Decides how an incoming request is handled',
            exports: [name],
            symbols: [name, 'EXECUTE_VERB_RE']
        });
    }
    return graph;
}

describe('ranking grounds on the request, not on fixed names', () => {
    it('pathGroundingBonus gives +100 for exact path in text, +50 for basename', () => {
        const node = { path: 'src/app/router/requestRouter.js' };
        expect(pathGroundingBonus(node, 'wijzig src/app/router/requestRouter.js')).toBe(100);
        expect(pathGroundingBonus(node, 'pas requestRouter.js aan')).toBe(50);
        expect(pathGroundingBonus(node, 'iets anders')).toBe(0);
        expect(pathGroundingBonus(null, 'requestRouter.js')).toBe(0);
        expect(pathGroundingBonus(node, undefined)).toBe(0);
    });

    it('two files with the same purpose and terms score equally, whatever their name or export', () => {
        const graph = twinGraph(['src/routing/modeClassifier.js', 'classifyMode'], ['src/routing/xyzSelector.js', 'pickXyz']);
        const ranked = rankGraphNodes(graph, 'execute verb, stays discuss: which file handles the request', { minScore: 0 });
        expect(ranked).toHaveLength(2);
        expect(ranked[0].score).toBe(ranked[1].score);
    });

    it('a file whose path is written in the request ranks first', () => {
        const graph = twinGraph(['src/a/requestHandler.js', 'handleRequest'], ['src/b/otherHandler.js', 'handleOther']);
        const ranked = rankGraphNodes(graph, 'Change how a request is handled in src/b/otherHandler.js', { minScore: 1 });
        expect(ranked[0].node.path).toBe('src/b/otherHandler.js');
        expect(ranked[0].score).toBeGreaterThan(ranked[1].score + 50);
    });
});
