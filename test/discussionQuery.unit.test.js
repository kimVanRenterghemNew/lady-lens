/** findDiscussionsForNode / queryDiscussions on hand-made graphs: every way a discussion is linked, and the fallbacks. */
import { describe, it, expect } from 'vitest';
import { findDiscussionsForNode, queryDiscussions } from '../core/discussions/index.js';

const DISC = { id: 'discussion:a', type: 'Discussion', title: 'Why cache', topic: 'cache', body: 'speed' };
const OTHER = { id: 'discussion:b', type: 'Discussion', title: 'Naming', purpose: 'names' };

function graphOf({ incoming = [], outgoing = [], nodes = [DISC, OTHER, { id: 'file:a.js', type: 'CodeFile' }] } = {}) {
    const byId = new Map(nodes.map(node => [node.id, node]));
    return { nodes: byId, getNode: id => byId.get(id), getIncoming: () => incoming, getOutgoing: () => outgoing };
}

describe('findDiscussionsForNode', () => {
    it('nothing for a missing graph, id or node', () => {
        expect(findDiscussionsForNode(null, 'file:a.js')).toEqual([]);
        expect(findDiscussionsForNode(graphOf(), '')).toEqual([]);
        expect(findDiscussionsForNode(graphOf(), 'file:nope.js')).toEqual([]);
    });

    it('incoming DISCUSSES and outgoing DISCUSSED_IN edges, with the edge weight and confidence or their defaults', () => {
        const graph = graphOf({
            incoming: [{ from: 'discussion:a', to: 'file:a.js', type: 'DISCUSSES', weight: 3, confidence: 'INFERRED' }, { from: 'file:b.js', to: 'file:a.js', type: 'IMPORTS' }],
            outgoing: [{ from: 'file:a.js', to: 'discussion:b', type: 'LINKS' }, { from: 'file:a.js', to: 'file:c.js', type: 'IMPORTS' }]
        });
        expect(findDiscussionsForNode(graph, 'file:a.js').map(({ id, weight, confidence, relation }) => ({ id, weight, confidence, relation }))).toEqual([
            { id: 'discussion:a', weight: 3, confidence: 'INFERRED', relation: 'DISCUSSES' },
            { id: 'discussion:b', weight: 1, confidence: 'EXTRACTED', relation: 'LINKS' }
        ]);
    });

    it('a graph without getIncoming/getOutgoing, and an edge to a node that is not a discussion', () => {
        const graph = graphOf({ outgoing: [{ from: 'file:a.js', to: 'discussion:gone', type: 'DISCUSSED_IN' }] });
        expect(findDiscussionsForNode(graph, 'file:a.js')).toEqual([]);
        const bare = { nodes: new Map([['file:a.js', { id: 'file:a.js' }]]) };
        expect(findDiscussionsForNode(bare, 'file:a.js')).toEqual([]);
    });
});

describe('queryDiscussions', () => {
    it('no graph, by node, all without a topic, and by topic words', () => {
        expect(queryDiscussions(null, { topic: 'x' })).toEqual([]);
        const graph = graphOf({ incoming: [{ from: 'discussion:a', to: 'file:a.js', type: 'discussed' }] });
        expect(queryDiscussions(graph, { node: 'file:a.js' }).map(d => d.id)).toEqual(['discussion:a']);
        expect(queryDiscussions(graph).map(d => d.id)).toEqual(['discussion:a', 'discussion:b']);
        expect(queryDiscussions(graph, { topic: 'cache speed' }).map(d => d.id)).toEqual(['discussion:a']);
        expect(queryDiscussions(graph, { topic: 'names', limit: 1 }).map(d => d.id)).toEqual(['discussion:b']);
    });

    it('a graph that only lists nodes by type', () => {
        const graph = { getNodesByType: type => (type === 'Discussion' ? [DISC] : []) };
        expect(queryDiscussions(graph, { topic: 'cache' }).map(d => d.id)).toEqual(['discussion:a']);
        expect(queryDiscussions({}, { topic: 'cache' })).toEqual([]);
    });
});
