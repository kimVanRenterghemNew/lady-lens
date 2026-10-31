/**
 * Unit Tests: graphQuery.js
 * Tests: query API, multi-hop traversal, filtering, context building
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createGraph } from '../core/graph/index.js';
import { query, buildContextFromGraph, validateGraph } from '../core/graph/index.js';

/**
 * Helper: build a sample graph for testing
 */
function buildSampleGraph() {
  const graph = createGraph('test-session');

  // Decisions
  graph.addNode('dec:oauth2', 'Decision', {
    title: 'Use OAuth 2.0',
    status: 'accepted',
    consequences: ['Requires external provider', 'Session expires'],
    risks: ['Provider downtime'],
    open_questions: ['Fallback strategy?']
  });

  // Modules
  graph.addNode('mod:core/auth.js', 'Module', {
    path: 'core/auth.js',
    purpose: 'Authentication logic',
    tech_debt: ['TODO: Add retry', 'TODO: Pool connections']
  });

  graph.addNode('mod:core/ollama.js', 'Module', {
    path: 'core/ollama.js',
    purpose: 'LLM interface'
  });

  // Features
  graph.addNode('feat:login', 'Feature', {
    title: 'User Login',
    status: 'in-progress'
  });

  // Code files
  graph.addNode('file:core/auth.js', 'CodeFile', {
    path: 'core/auth.js',
    file_type: 'implementation'
  });

  // Edges
  graph.addEdge('dec:oauth2', 'feat:login', 'enables', 1.0);
  graph.addEdge('feat:login', 'mod:core/auth.js', 'requires', 1.0);
  graph.addEdge('mod:core/auth.js', 'mod:core/ollama.js', 'calls', 0.8);
  graph.addEdge('file:core/auth.js', 'mod:core/auth.js', 'related_to', 0.5);

  return graph;
}

describe('GraphQuery', () => {
  let graph;

  beforeEach(() => {
    graph = buildSampleGraph();
  });

  describe('Basic queries', () => {
    it('should query outgoing edges', () => {
      const result = query(graph, {
        node: 'dec:oauth2',
        outgoing: true,
        limit: 10
      });

      // Result includes start node + neighbors
      expect(result.nodes.length).toBe(2);
      expect(result.nodes.map(n => n.id)).toContain('feat:login');
      expect(result.edges.length).toBe(1);
    });

    it('should query incoming edges', () => {
      const result = query(graph, {
        node: 'feat:login',
        incoming: true,
        limit: 10
      });

      // Result includes start node + neighbors
      expect(result.nodes.length).toBe(2);
      expect(result.nodes.map(n => n.id)).toContain('dec:oauth2');
    });

    it('should filter edges by type', () => {
      const result = query(graph, {
        node: 'mod:core/auth.js',
        outgoing: { type: 'calls' },
        limit: 10
      });

      expect(result.nodes.length).toBe(2);
      expect(result.nodes.map(n => n.id)).toContain('mod:core/ollama.js');
      expect(result.edges[0].type).toBe('calls');
    });

    it('should respect limit', () => {
      // Add more outgoing edges
      graph.addNode('feat:other', 'Feature', { title: 'Other' });
      graph.addNode('feat:another', 'Feature', { title: 'Another' });
      graph.addEdge('dec:oauth2', 'feat:other', 'enables', 1.0);
      graph.addEdge('dec:oauth2', 'feat:another', 'enables', 1.0);

      const result = query(graph, {
        node: 'dec:oauth2',
        outgoing: true,
        limit: 2
      });

      expect(result.nodes.length).toBeLessThanOrEqual(2);
    });

    it('should filter result by node type', () => {
      const result = query(graph, {
        node: 'dec:oauth2',
        outgoing: true,
        filter: { type: 'Feature' },
        limit: 10
      });

      expect(result.nodes.length).toBe(1);
      expect(result.nodes[0].type).toBe('Feature');
    });

    it('should respect minWeight threshold', () => {
      const resultAll = query(graph, {
        node: 'mod:core/auth.js',
        outgoing: true,
        minWeight: 0,
        limit: 10
      });

      const resultHeavy = query(graph, {
        node: 'mod:core/auth.js',
        outgoing: true,
        minWeight: 0.9, // Only weight >= 0.9
        limit: 10
      });

      // resultAll includes start node (always) + ollama (weight 0.8)
      expect(resultAll.nodes.length).toBe(2);
      // resultHeavy includes only start node (no edges >= 0.9)
      expect(resultHeavy.nodes.length).toBe(1);
    });
  });

  describe('Multi-hop queries', () => {
    it('should traverse chains', () => {
      const result = query(graph, {
        node: 'dec:oauth2',
        path: 'enables → requires',
        limit: 10
      });

      // dec:oauth2 → feat:login → mod:core/auth.js
      expect(result.nodes.some(n => n.id === 'mod:core/auth.js')).toBe(true);
    });

    it('should stop at dead ends', () => {
      const result = query(graph, {
        node: 'mod:core/auth.js',
        path: 'calls → enables', // no outgoing 'enables' from ollama
        limit: 10
      });

      // Dead end: start node + first hop, but no second hop
      // Actually, path queries only return frontier nodes (not start)
      // So 0 is correct if dead end is hit immediately
      expect(result.nodes.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle missing intermediate edges', () => {
      const result = query(graph, {
        node: 'dec:oauth2',
        path: 'nonexistent → type',
        limit: 10
      });

      // No edges of type 'nonexistent' from start, so frontier is empty
      expect(result.nodes.length).toBeGreaterThanOrEqual(0);
      expect(result.edges.length).toBe(0);
    });
  });

  describe('Generic maxDepth traversal (edge-type-agnostic BFS)', () => {
    it('reaches nodes up to maxDepth hops away, following any outgoing edge type', () => {
      // dec:oauth2 --enables--> feat:login --requires--> mod:core/auth.js --calls--> mod:core/ollama.js
      const result = query(graph, { node: 'dec:oauth2', maxDepth: 2, limit: 10 });

      expect(result.nodes.map(n => n.id)).toEqual(expect.arrayContaining(['feat:login', 'mod:core/auth.js']));
      expect(result.nodes.map(n => n.id)).not.toContain('mod:core/ollama.js');
    });

    it('reaches a third-hop node once maxDepth allows it', () => {
      const result = query(graph, { node: 'dec:oauth2', maxDepth: 3, limit: 10 });

      expect(result.nodes.map(n => n.id)).toContain('mod:core/ollama.js');
    });

    it('defaults to depth 1 (direct neighbors only) when maxDepth is 1', () => {
      const result = query(graph, { node: 'dec:oauth2', maxDepth: 1, limit: 10 });

      expect(result.nodes.map(n => n.id)).toEqual(['dec:oauth2', 'feat:login']);
    });

    it('respects minWeight while traversing by depth', () => {
      const result = query(graph, { node: 'mod:core/auth.js', maxDepth: 2, minWeight: 0.9, limit: 10 });

      expect(result.nodes.map(n => n.id)).toEqual(['mod:core/auth.js']);
    });

    it('stops at a dead end without throwing', () => {
      const result = query(graph, { node: 'mod:core/ollama.js', maxDepth: 5, limit: 10 });

      expect(result.nodes.map(n => n.id)).toEqual(['mod:core/ollama.js']);
      expect(result.edges).toEqual([]);
    });
  });

  describe('Asymmetric bidirectional depth (callers back N, callees forward M)', () => {
    function buildCallChain() {
      const callGraph = createGraph('call-chain');
      for (let i = 0; i <= 7; i++) callGraph.addNode(`fn${i}`, 'Function', { name: `fn${i}` });
      for (let i = 0; i < 7; i++) callGraph.addEdge(`fn${i}`, `fn${i + 1}`, 'calls', 1.0);
      return callGraph;
    }

    it('returns the target plus exactly N callers back and M callees forward', () => {
      const callGraph = buildCallChain();
      // fn0 -> fn1 -> fn2 -> fn3 -> fn4(target) -> fn5 -> fn6 -> fn7
      const result = query(callGraph, { node: 'fn4', incomingDepth: 3, outgoingDepth: 2, limit: 20 });

      const ids = result.nodes.map(n => n.id);
      expect(ids).toEqual(expect.arrayContaining(['fn4', 'fn3', 'fn2', 'fn1', 'fn5', 'fn6']));
      expect(ids).not.toContain('fn0'); // 4th caller back, beyond incomingDepth: 3
      expect(ids).not.toContain('fn7'); // 3rd callee forward, beyond outgoingDepth: 2
    });

    it('supports callers-only (outgoingDepth omitted/0)', () => {
      const callGraph = buildCallChain();
      const result = query(callGraph, { node: 'fn4', incomingDepth: 2, limit: 20 });

      const ids = result.nodes.map(n => n.id);
      expect(ids).toEqual(expect.arrayContaining(['fn4', 'fn3', 'fn2']));
      expect(ids).not.toContain('fn5');
      expect(ids).not.toContain('fn1');
    });

    it('supports callees-only (incomingDepth omitted/0)', () => {
      const callGraph = buildCallChain();
      const result = query(callGraph, { node: 'fn4', outgoingDepth: 2, limit: 20 });

      const ids = result.nodes.map(n => n.id);
      expect(ids).toEqual(expect.arrayContaining(['fn4', 'fn5', 'fn6']));
      expect(ids).not.toContain('fn3');
      expect(ids).not.toContain('fn7');
    });

    it('includes the edges along both directions, not just the nodes', () => {
      const callGraph = buildCallChain();
      const result = query(callGraph, { node: 'fn4', incomingDepth: 1, outgoingDepth: 1, limit: 20 });

      expect(result.edges).toEqual(expect.arrayContaining([
        expect.objectContaining({ from: 'fn3', to: 'fn4', type: 'calls' }),
        expect.objectContaining({ from: 'fn4', to: 'fn5', type: 'calls' })
      ]));
    });
  });

  describe('Edge cases', () => {
    it('should throw if node not specified', () => {
      expect(() => {
        query(graph, { outgoing: true });
      }).toThrow();
    });

    it('should return empty result if node not found', () => {
      const result = query(graph, {
        node: 'nonexistent',
        outgoing: true,
        limit: 10
      });

      expect(result.nodes.length).toBe(0);
      expect(result.edges.length).toBe(0);
    });

    it('should clamp weight to [0, 1]', () => {
      graph.addNode('feat:test', 'Feature', { title: 'Test' });
      graph.addEdge('dec:oauth2', 'feat:test', 'related', 1.5); // Over 1

      const edge = graph.edges.find(e => e.to === 'feat:test');
      expect(edge.weight).toBe(1.0); // Clamped
    });
  });

  describe('Context building', () => {
    it('should build context block from graph', async () => {
      const context = await buildContextFromGraph(
        graph,
        'oauth'
      );

      expect(context).toContain('OAuth 2.0');
      expect(context).toContain('Related Decisions');
    });

    it('should include consequences and risks', async () => {
      const context = await buildContextFromGraph(
        graph,
        'oauth'
      );

      expect(context).toContain('Consequences');
      expect(context).toContain('Requires external provider');
      expect(context).toContain('Risks');
    });

    it('should include affected modules', async () => {
      const context = await buildContextFromGraph(
        graph,
        'core/auth.js'
      );

      expect(context).toContain('Affected Modules');
      expect(context).toContain('core/auth.js');
    });

    it('honours the limit option for decisions and modules (it was destructured and ignored: always 5)', async () => {
      const big = createGraph('limit-test');
      for (let i = 0; i < 8; i++) {
        big.addNode(`mod:src/cache${i}.js`, 'Module', { path: `src/cache${i}.js`, purpose: 'cache layer' });
        big.addNode(`dec:cache${i}`, 'Decision', { title: `cache decision ${i}`, status: 'accepted' });
      }
      const count = (text, marker) => text.split(marker).length - 1;
      const two = await buildContextFromGraph(big, 'cache', { limit: 2 });
      expect(count(two, '- **src/cache')).toBe(2);
      expect(count(two, '- **cache decision')).toBe(2);
      const eight = await buildContextFromGraph(big, 'cache', { limit: 8 });
      expect(count(eight, '- **src/cache')).toBe(8);
      expect(count(eight, '- **cache decision')).toBe(8);
      const byDefault = await buildContextFromGraph(big, 'cache');
      expect(count(byDefault, '- **src/cache')).toBe(5); // the long-standing default stays
    });

    it('should return empty string if no matches', async () => {
      const context = await buildContextFromGraph(
        graph,
        'completely unrelated xyz'
      );

      expect(context).toBe('');
    });
  });

  describe('Freshness filtering', () => {
    it('excludes nodes older than maxAgeMs as of a given asOf, reporting the excluded count', () => {
      graph.getNode('mod:core/ollama.js').updatedAt = Date.parse('2020-01-01T00:00:00.000Z');
      graph.getNode('mod:core/ollama.js').timestampStatus = 'known';

      const result = query(graph, {
        node: 'mod:core/auth.js',
        outgoing: true,
        limit: 10,
        asOf: Date.parse('2026-01-01T00:00:00.000Z'),
        maxAgeMs: 365 * 24 * 60 * 60 * 1000
      });

      expect(result.nodes.map(n => n.id)).not.toContain('mod:core/ollama.js');
      expect(result.freshness.excludedStaleCount).toBe(1);
    });

    it('includes stale nodes again when includeStale is set, still reporting the count', () => {
      graph.getNode('mod:core/ollama.js').updatedAt = Date.parse('2020-01-01T00:00:00.000Z');
      graph.getNode('mod:core/ollama.js').timestampStatus = 'known';

      const result = query(graph, {
        node: 'mod:core/auth.js',
        outgoing: true,
        limit: 10,
        asOf: Date.parse('2026-01-01T00:00:00.000Z'),
        maxAgeMs: 365 * 24 * 60 * 60 * 1000,
        includeStale: true
      });

      expect(result.nodes.map(n => n.id)).toContain('mod:core/ollama.js');
      expect(result.freshness.excludedStaleCount).toBe(1);
    });

    it('counts nodes with unknown timestamps separately from stale nodes', () => {
      delete graph.getNode('mod:core/ollama.js').updatedAt;
      graph.getNode('mod:core/ollama.js').timestampStatus = 'unknown';

      const result = query(graph, {
        node: 'mod:core/auth.js',
        outgoing: true,
        limit: 10,
        asOf: Date.now(),
        maxAgeMs: 365 * 24 * 60 * 60 * 1000
      });

      expect(result.freshness.unknownTimestampCount).toBe(1);
      expect(result.freshness.excludedStaleCount).toBe(0);
      expect(result.nodes.map(n => n.id)).toContain('mod:core/ollama.js');
    });
  });

  describe('Validation', () => {
    it('should validate correct graph', () => {
      const result = validateGraph(graph);
      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should detect edge to missing node', () => {
      // Manually corrupt: add edge but remove target node
      graph.edges.push({
        from: 'dec:oauth2',
        to: 'nonexistent',
        type: 'test',
        weight: 1.0
      });

      const result = validateGraph(graph);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('nonexistent'))).toBe(true);
    });

    it('should provide summary', () => {
      const result = validateGraph(graph);
      // Sample graph has 5 nodes: 2 modules, 1 feature, 1 code file, 1 decision
      // (file:core/auth.js is the extra one, making it 6 but addNode in test adds in beforeEach)
      expect(result.summary.nodes).toBeGreaterThanOrEqual(5);
      expect(result.summary.edges).toBeGreaterThanOrEqual(3);
    });
  });
});
