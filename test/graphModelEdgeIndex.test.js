/**
 * a question on a 25,000-file repo took 43 s, 29 s of it in addEdge: every new
 * edge scanned all edges so far (graph.edges.find) to find a duplicate, quadratic in the number of edges (64,000).
 * The duplicate check looks only at the edges of the source node (adjList).
 */
import { describe, it, expect } from 'vitest';
import { createGraph } from '../core/graph/index.js';

describe('addEdge does not scan every edge', () => {
    it('MUST find a duplicate without graph.edges.find, and still merge it (highest weight wins)', () => {
        const graph = createGraph('t');
        for (const id of ['a', 'b', 'c']) graph.addNode(`file:${id}.js`, 'CodeFile', { path: `${id}.js` });
        graph.edges.find = () => { throw new Error('addEdge scanned every edge'); };
        graph.addEdge('file:a.js', 'file:b.js', 'IMPORTS', 0.4);
        graph.addEdge('file:a.js', 'file:c.js', 'IMPORTS', 1);
        const merged = graph.addEdge('file:a.js', 'file:b.js', 'IMPORTS', 0.9);
        graph.addEdge('file:a.js', 'file:b.js', 'TESTS', 1);
        expect(graph.edges).toHaveLength(3);
        expect(merged.weight).toBe(0.9);
        expect(graph.edges.filter(e => e.to === 'file:b.js').map(e => e.type).sort()).toEqual(['IMPORTS', 'TESTS']);
    });
});

describe('addNode does not scan every node of its type', () => {
    it('MUST keep nodesByType without a linear includes check, and still never list a node twice', () => {
        const graph = createGraph('t');
        graph.addNode('file:a.js', 'CodeFile', { path: 'a.js' });
        graph.nodesByType.get('CodeFile').includes = () => { throw new Error('addNode scanned every node of its type'); };
        graph.addNode('file:b.js', 'CodeFile', { path: 'b.js' });
        graph.addNode('file:a.js', 'CodeFile', { path: 'a.js', name: 'again' });
        graph.addNode('file:b.js', 'Document', { path: 'b.js' });
        expect([...graph.nodesByType.get('CodeFile')]).toEqual(['file:a.js']);
        expect(graph.nodesByType.get('Document')).toEqual(['file:b.js']);
    });
});
