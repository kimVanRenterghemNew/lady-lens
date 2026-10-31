/**
 * Unit Tests: graphModel.js edge confidence + lifecycle timestamps
 */

import { describe, it, expect, vi } from 'vitest';
import { createGraph } from '../core/graph/index.js';
import { normalizeNodeId } from '../core/graph/index.js';

describe('Shared node-ID normalization', () => {
    it('node write, edge write and lookup all resolve to the same canonical ID', () => {
        const graph = createGraph();
        const written = graph.addNode('Mod:Core\\Auth.js', 'Module', { path: 'core/auth.js' });
        expect(written.id).toBe(normalizeNodeId('Mod:Core\\Auth.js'));

        const found = graph.getNode('mod:core/auth.js');
        expect(found).toBe(written);
    });

    it('two producers writing the "same" entity with different casing never create ghost nodes', () => {
        const graph = createGraph();
        graph.addNode('MOD:Core/Auth.js', 'Module', { path: 'core/auth.js' });
        graph.addNode('mod:core/auth.js', 'Module', { path: 'core/auth.js' });

        expect(graph.nodes.size).toBe(1);
    });

    it('edge endpoints are normalized too, so an edge written with non-canonical casing is still found via canonical lookups', () => {
        const graph = createGraph();
        graph.addNode('Dec:OAuth2', 'Decision', {});
        graph.addNode('Mod:Core/Auth.js', 'Module', {});
        graph.addEdge('Dec:OAuth2', 'Mod:Core/Auth.js', 'affects', 1);

        expect(graph.getOutgoing('dec:oauth2')).toHaveLength(1);
        expect(graph.getIncoming('mod:core/auth.js')).toHaveLength(1);
    });

    it('migrates legacy non-canonical persisted IDs on load without duplicating the node', () => {
        // Simulates a graph.json written by an older producer with inconsistent casing.
        const graph = createGraph();
        graph.addNode('Decision:OAuth', 'Decision', { title: 'Use OAuth' });
        // A second producer re-registers the "same" node, canonical this time.
        const reloaded = graph.addNode('decision:oauth', 'Decision', { title: 'Use OAuth' });

        expect(graph.nodes.size).toBe(1);
        expect(graph.getNode('Decision:OAuth')).toBe(reloaded);
    });
});

describe('Edge confidence contract', () => {
    it('defaults a missing confidence to AMBIGUOUS', () => {
        const graph = createGraph();
        graph.addNode('a', 'Module', {});
        graph.addNode('b', 'Module', {});
        const edge = graph.addEdge('a', 'b', 'calls', 1);
        expect(edge.confidence).toBe('AMBIGUOUS');
    });

    it('preserves an explicit valid confidence', () => {
        const graph = createGraph();
        graph.addNode('a', 'Module', {});
        graph.addNode('b', 'Module', {});
        const edge = graph.addEdge('a', 'b', 'calls', { weight: 1, confidence: 'EXTRACTED' });
        expect(edge.confidence).toBe('EXTRACTED');
    });

    it('rejects an invalid confidence value', () => {
        const graph = createGraph();
        graph.addNode('a', 'Module', {});
        graph.addNode('b', 'Module', {});
        expect(() => graph.addEdge('a', 'b', 'calls', { confidence: 'WRONG' })).toThrow(/confidence/i);
    });

    it('survives deduplication (second call upgrades weight, keeps explicit confidence)', () => {
        const graph = createGraph();
        graph.addNode('a', 'Module', {});
        graph.addNode('b', 'Module', {});
        graph.addEdge('a', 'b', 'calls', { weight: 0.5, confidence: 'INFERRED' });
        const edge = graph.addEdge('a', 'b', 'calls', { weight: 0.9, confidence: 'EXTRACTED' });
        expect(edge.weight).toBe(0.9);
        expect(edge.confidence).toBe('EXTRACTED');
        expect(graph.edges).toHaveLength(1);
    });

    it('keeps the earlier confidence when a dedup call omits it', () => {
        const graph = createGraph();
        graph.addNode('a', 'Module', {});
        graph.addNode('b', 'Module', {});
        graph.addEdge('a', 'b', 'calls', { confidence: 'EXTRACTED' });
        const edge = graph.addEdge('a', 'b', 'calls', { weight: 1 });
        expect(edge.confidence).toBe('EXTRACTED');
    });
});

describe('Lifecycle timestamps', () => {
    it('keeps createdAt stable across a re-add with identical content', () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(1000);
            const graph = createGraph();
            const first = graph.addNode('a', 'Module', { path: 'core/a.js' });
            vi.setSystemTime(5000);
            const second = graph.addNode('a', 'Module', { path: 'core/a.js' });
            expect(second.createdAt).toBe(first.createdAt);
            expect(second.updatedAt).toBe(first.updatedAt);
        } finally {
            vi.useRealTimers();
        }
    });

    it('bumps updatedAt only when node content actually changes', () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(1000);
            const graph = createGraph();
            const first = graph.addNode('a', 'Module', { path: 'core/a.js' });
            vi.setSystemTime(5000);
            const second = graph.addNode('a', 'Module', { path: 'core/a.js (renamed)' });
            expect(second.createdAt).toBe(first.createdAt);
            expect(second.updatedAt).toBe(5000);
        } finally {
            vi.useRealTimers();
        }
    });

    it('keeps an edge createdAt stable across dedup, updating updatedAt', () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(1000);
            const graph = createGraph();
            graph.addNode('a', 'Module', {});
            graph.addNode('b', 'Module', {});
            const first = graph.addEdge('a', 'b', 'calls', 0.5);
            vi.setSystemTime(5000);
            const second = graph.addEdge('a', 'b', 'calls', 0.9);
            expect(second.createdAt).toBe(first.createdAt);
            expect(second.updatedAt).toBe(5000);
        } finally {
            vi.useRealTimers();
        }
    });

    it('tags a node with no provided timestamp info as timestampStatus unknown, and known otherwise', () => {
        const graph = createGraph();
        const legacy = graph.addNode('legacy', 'Module', {});
        expect(legacy.timestampStatus).toBe('unknown');

        const known = graph.addNode('known', 'Module', { observedAt: '2026-01-01T00:00:00.000Z' });
        expect(known.timestampStatus).toBe('known');
    });

    it('round-trips confidence and timestamps through toJSON', () => {
        const graph = createGraph();
        graph.addNode('a', 'Module', {});
        graph.addNode('b', 'Module', {});
        const edge = graph.addEdge('a', 'b', 'calls', { confidence: 'EXTRACTED' });
        const json = graph.toJSON();
        expect(json.edges[0]).toMatchObject({ confidence: 'EXTRACTED', createdAt: edge.createdAt, updatedAt: edge.updatedAt });
    });
});
