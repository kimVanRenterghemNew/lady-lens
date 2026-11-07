/** Hubs and bridges (backlog diff-impact-en-graafvragen.md, J6 / J7, AC7 / AC8). */
import { describe, it, expect } from 'vitest';
import { createGraph, hubsAndBridges } from '../core/graph/index.js';

/** Two clusters joined through bridge.js; hub.js is linked to every file of the left cluster. */
function sample() {
    const graph = createGraph('test');
    const files = ['hub.js', 'l1.js', 'l2.js', 'l3.js', 'bridge.js', 'r1.js', 'r2.js'];
    for (const file of files) graph.addNode(`file:${file}`, 'CodeFile', { path: file });
    graph.addNode('doc:readme', 'Document', { path: 'README.md' });
    const link = (a, b, type = 'IMPORTS') => graph.addEdge(`file:${a}`, `file:${b}`, type);
    for (const leaf of ['l1.js', 'l2.js', 'l3.js']) link(leaf, 'hub.js');
    link('hub.js', 'bridge.js', 'CALLS');
    link('bridge.js', 'r1.js');
    link('r1.js', 'r2.js');
    graph.addEdge('doc:readme', 'file:hub.js', 'MENTIONS');
    return graph;
}

describe('hubs and bridges', () => {
    it('J6: the known hub and bridge come first, highest value first', () => {
        const { hubs, bridges } = hubsAndBridges(sample(), { hubs: true, bridges: true, limit: 3 });
        expect(hubs.nodes[0]).toEqual({ path: 'hub.js', degree: 4 });
        expect(bridges.nodes.map(node => node.path)).toEqual(['hub.js', 'bridge.js', 'r1.js']);
        expect(bridges.nodes[0].betweenness).toBeGreaterThan(bridges.nodes[1].betweenness);
    });

    it('nothing unless asked, and nothing for an empty graph', () => {
        expect(hubsAndBridges(sample())).toEqual({});
        expect(hubsAndBridges(createGraph('empty'), { hubs: true, bridges: true })).toEqual({ hubs: { total: 0, truncated: false, nodes: [] }, bridges: { total: 0, truncated: false, nodes: [] } });
    });

    it('J7: 300 files (299 and the center) above the limit give total 300 and truncated', () => {
        const graph = createGraph('star');
        graph.addNode('file:center.js', 'CodeFile', { path: 'center.js' });
        for (let i = 0; i < 299; i++) {
            graph.addNode(`file:f${i}.js`, 'CodeFile', { path: `f${i}.js` });
            graph.addEdge(`file:f${i}.js`, 'file:center.js', 'IMPORTS');
        }
        const { hubs } = hubsAndBridges(graph, { hubs: true, limit: 20 });
        expect(hubs).toMatchObject({ total: 300, truncated: true });
        expect(hubs.nodes).toHaveLength(20);
    });
});
