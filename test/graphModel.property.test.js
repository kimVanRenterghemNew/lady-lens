/**
 * property-based tests on the graph model. fast-check invents the operation sequences; a shrunk counterexample
 * becomes a plain regression test (see test/graphInvariants.test.js for H1, the retype bug these properties found).
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createGraph, validateGraph, normalizeNodeId } from '../core/graph/index.js';

// Ids that differ only in case/separators on purpose: normalization must fold them into one node, never two.
const nodeId = fc.constantFrom('task:a', 'Task:A', 'task:a_b', 'task:a-b', 'task:A B', 'file:src/Foo.js', 'file:src\\foo.js', 'story:x', 'story:X ');
const nodeType = fc.constantFrom('task', 'story', 'file');
const edgeType = fc.constantFrom('contains', 'dependsOn', 'touches');
const confidence = fc.constantFrom(undefined, 'EXTRACTED', 'INFERRED', 'AMBIGUOUS');
const operation = fc.oneof(
    fc.record({ kind: fc.constant('node'), id: nodeId, type: nodeType, title: fc.string({ maxLength: 5 }) }),
    fc.record({ kind: fc.constant('edge'), from: nodeId, to: nodeId, type: edgeType, weight: fc.double({ min: -1, max: 2, noNaN: true }), confidence })
);

function apply(graph, op) {
    if (op.kind === 'node') return graph.addNode(op.id, op.type, { title: op.title });
    if (!graph.getNode(op.from) || !graph.getNode(op.to)) return null;   // addEdge rejects unknown nodes by contract
    return graph.addEdge(op.from, op.to, op.type, { weight: op.weight, confidence: op.confidence });
}

describe('graph model properties', () => {
    it('any sequence of addNode/addEdge leaves a valid graph', () => {
        fc.assert(fc.property(fc.array(operation, { maxLength: 60 }), ops => {
            const graph = createGraph('prop');
            for (const op of ops) apply(graph, op);
            const { errors } = validateGraph(graph);
            expect(errors).toEqual([]);
        }), { numRuns: 400 });
    });

    it('edge weights stay within [0, 1] and edges never loop on themselves', () => {
        fc.assert(fc.property(fc.array(operation, { maxLength: 60 }), ops => {
            const graph = createGraph('prop');
            for (const op of ops) apply(graph, op);
            for (const edge of graph.edges) {
                expect(edge.weight).toBeGreaterThanOrEqual(0);
                expect(edge.weight).toBeLessThanOrEqual(1);
                expect(edge.from).not.toBe(edge.to);
            }
        }), { numRuns: 200 });
    });

    it('re-adding the same node does not change the node count (idempotent upsert)', () => {
        fc.assert(fc.property(fc.array(operation, { maxLength: 40 }), ops => {
            const graph = createGraph('prop');
            for (const op of ops) apply(graph, op);
            const before = graph.nodes.size;
            for (const node of [...graph.nodes.values()]) graph.addNode(node.id, node.type, { title: node.title });
            expect(graph.nodes.size).toBe(before);
            expect(validateGraph(graph).errors).toEqual([]);
        }), { numRuns: 200 });
    });

    it('normalizeNodeId is idempotent for any non-empty string, or refuses it', () => {
        fc.assert(fc.property(fc.string({ minLength: 1 }), raw => {
            let once;
            try { once = normalizeNodeId(raw); } catch { return; }   // refusing (empty after normalization) is allowed
            expect(once).not.toBe('');
            expect(normalizeNodeId(once)).toBe(once);
        }), { numRuns: 500 });
    });

    it('an id that normalizes to nothing is refused instead of becoming an unreachable node (regression)', () => {
        const graph = createGraph('prop');
        expect(() => graph.addNode('--', 'task')).toThrow(/no characters left/);
        expect(graph.nodes.size).toBe(0);
    });
});
