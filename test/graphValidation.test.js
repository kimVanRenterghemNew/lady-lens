/**
 * Unit Tests: validateGraph() lifecycle + confidence validation
 */

import { describe, it, expect } from 'vitest';
import { createGraph } from '../core/graph/index.js';
import { validateGraph } from '../core/graph/index.js';

describe('validateGraph: confidence and lifecycle data', () => {
    it('flags an edge with an invalid confidence value that bypassed addEdge', () => {
        const graph = createGraph();
        graph.addNode('a', 'Module', {});
        graph.addNode('b', 'Module', {});
        graph.addEdge('a', 'b', 'calls', 1);
        // Simulate malformed data loaded directly from disk, bypassing addEdge's validation.
        graph.edges[0].confidence = 'NOT_REAL';

        const result = validateGraph(graph);

        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('NOT_REAL'))).toBe(true);
    });

    it('accepts every valid confidence value', () => {
        const graph = createGraph();
        graph.addNode('a', 'Module', {});
        graph.addNode('b', 'Module', {});
        graph.addNode('c', 'Module', {});
        graph.addEdge('a', 'b', 'calls', { confidence: 'EXTRACTED' });
        graph.addEdge('b', 'c', 'calls', { confidence: 'INFERRED' });
        graph.addEdge('a', 'c', 'relates', { confidence: 'AMBIGUOUS' });

        const result = validateGraph(graph);

        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
    });

    it('still detects a dangling edge alongside confidence checks', () => {
        const graph = createGraph();
        graph.addNode('a', 'Module', {});
        graph.edges.push({ from: 'a', to: 'missing', type: 'calls', weight: 1, confidence: 'AMBIGUOUS' });

        const result = validateGraph(graph);

        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('missing'))).toBe(true);
    });
});
