/**
 * the graph model's invariants, each with a graph that MUST violate it.
 * `validateGraph` is the one place that says what a valid graph is; these tests pin every rule it enforces.
 */
import { describe, it, expect } from 'vitest';
import { createGraph, validateGraph } from '../core/graph/index.js';

const errorsOf = (graph) => validateGraph(graph).errors;

function smallGraph() {
    const g = createGraph('t');
    g.addNode('task:a', 'task');
    g.addNode('story:b', 'story');
    g.addEdge('story:b', 'task:a', 'contains');
    return g;
}

describe('graph invariants', () => {
    it('a freshly built graph is valid', () => {
        expect(errorsOf(smallGraph())).toEqual([]);
    });

    it('Given a node re-added with another type When validated Then it is listed only under its new type (regression H1)', () => {
        const g = smallGraph();
        g.addNode('task:a', 'story');
        expect(errorsOf(g)).toEqual([]);
        expect(g.getNodesByType('task')).toEqual([]);
        expect(g.getNodesByType('story').map(n => n.id).sort()).toEqual(['story:b', 'task:a']);
    });

    it('rejects an edge to a node that does not exist', () => {
        const g = smallGraph();
        g.edges.push({ from: 'story:b', to: 'task:ghost', type: 'contains' });
        expect(errorsOf(g).join('\n')).toMatch(/Edge to non-existent node: task:ghost/);
    });

    it('rejects a duplicate edge (same from, to and type)', () => {
        const g = smallGraph();
        const twin = { ...g.edges[0] };
        g.edges.push(twin);
        g.adjList.get('story:b').push(twin);
        g.revAdjList.get('task:a').push(twin);
        expect(errorsOf(g)).toEqual(['Duplicate edge: story:b|task:a|contains']);
    });

    it('rejects an edge that the adjacency indexes do not know', () => {
        const g = smallGraph();
        g.adjList.set('story:b', []);
        const errors = errorsOf(g).join('\n');
        expect(errors).toMatch(/Edge missing from adjList: story:b\|task:a\|contains/);
        expect(errors).toMatch(/adjList holds 0 edges, graph.edges 1/);
    });

    it('rejects a stale entry in the reverse index', () => {
        const g = smallGraph();
        g.revAdjList.get('task:a').push({ from: 'x', to: 'task:a', type: 'contains' });
        expect(errorsOf(g).join('\n')).toMatch(/revAdjList holds 2 edges, graph.edges 1/);
    });

    it('rejects a node that is missing from nodesByType', () => {
        const g = smallGraph();
        g.nodesByType.set('task', []);
        expect(errorsOf(g)).toEqual(['Node missing from nodesByType: task:a (task)']);
    });

    it('rejects a node id that is not in canonical form (a future ghost twin)', () => {
        const g = smallGraph();
        g.nodes.set('Task:A', { id: 'Task:A', type: 'task' });
        g.nodesByType.get('task').push('Task:A');
        expect(errorsOf(g).join('\n')).toMatch(/Node id not normalized: Task:A/);
    });

    it('rejects an invalid confidence that bypassed addEdge', () => {
        const g = smallGraph();
        g.edges[0].confidence = 'SURE';
        expect(errorsOf(g).join('\n')).toMatch(/invalid confidence: SURE/);
    });

    it('accepts a plain DTO graph without adjacency indexes (loaded from storage)', () => {
        const g = smallGraph();
        delete g.adjList; delete g.revAdjList;
        expect(errorsOf(g)).toEqual([]);
    });
});
