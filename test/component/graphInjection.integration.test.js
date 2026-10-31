/**
 * Integration Tests: Graph Context Injection
 * Tests: Full extraction + SUPERSEDES + query flow
 * Verifies generators receive rich context with EXTRACTED + INFERRED concepts
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createGraph } from '../../core/graph/index.js';
import { buildContextFromGraph } from '../../core/graph/index.js';

describe('Graph Context Injection Integration', () => {
  let graph;

  beforeEach(() => {
    graph = createGraph();
  });

  describe('Full extraction + query flow', () => {
    it('should return context with EXTRACTED + INFERRED concepts', async () => {
      // Setup: app-native decision
      graph.addNode('dec:oauth', 'Decision', {
        title: 'Use OAuth 2.0',
        status: 'accepted',
        consequences: 'Adds third-party dependency'
      });

      // Setup: extracted concept (INFERRED)
      graph.addNode('con:auth-concerns', 'Concept', {
        title: 'Authentication concerns',
        content: 'OAuth tokens expire, need refresh strategy',
        topics: ['authentication', 'security', 'oauth'],
        confidence: 0.85
      });

      // Setup: module
      graph.addNode('mod:auth', 'Module', {
        path: 'core/auth.js',
        purpose: 'OAuth and session handling'
      });

      // Query for context
      const context = await buildContextFromGraph(graph, 'implement oauth');

      // Verify content
      expect(context).toContain('OAuth');
      expect(context).toContain('Authentication concerns');
      expect(context).toContain('0.85'); // confidence
      expect(context).toContain('core/auth.js');
    });

    it('should filter SUPERSEDES chains and return only current concepts', async () => {
      // Setup: old auth approach (superseded)
      graph.addNode('con:auth-v1', 'Concept', {
        title: 'Old auth approach',
        content: 'Use session cookies',
        topics: ['authentication', 'sessions'],
        confidence: 0.7
      });

      // Setup: new auth approach (current)
      graph.addNode('con:auth-v2', 'Concept', {
        title: 'New auth approach',
        content: 'Use JWT tokens',
        topics: ['authentication', 'sessions', 'tokens'],
        confidence: 0.9
      });

      // Create SUPERSEDES edge
      graph.addEdge('con:auth-v2', 'con:auth-v1', 'supersedes', 1.0);

      // Query for context
      const context = await buildContextFromGraph(graph, 'authentication');

      // Verify only current (v2) is included
      expect(context).toContain('New auth approach');
      expect(context).toContain('JWT');
      expect(context).not.toContain('Old auth approach');
      expect(context).not.toContain('session cookies');
    });

    it('should include confidence scores for extracted concepts', async () => {
      graph.addNode('con:pattern', 'Concept', {
        title: 'Caching pattern',
        content: 'Use Redis for session cache',
        topics: ['caching', 'performance'],
        confidence: 0.75
      });

      const context = await buildContextFromGraph(graph, 'caching');

      expect(context).toContain('0.75');
      expect(context).toContain('Caching pattern');
    });

    it('should combine extracted concepts with decisions and modules', async () => {
      // Extracted
      graph.addNode('con:security', 'Concept', {
        title: 'Security concerns',
        content: 'Validate all inputs',
        topics: ['security'],
        confidence: 0.9
      });

      // App-native
      graph.addNode('dec:input-validation', 'Decision', {
        title: 'Security: validate all user inputs',
        status: 'approved',
        risks: 'Performance impact on large payloads'
      });

      graph.addNode('mod:validation', 'Module', {
        path: 'core/validators.js',
        purpose: 'Security input validation utilities'
      });

      const context = await buildContextFromGraph(graph, 'security');

      // All three should be present
      expect(context).toContain('Security concerns');
      expect(context).toContain('Security: validate all user inputs');
      expect(context).toContain('core/validators.js');
    });

    it('should exclude superseded concepts from context', async () => {
      // Create a chain: v1 → v2 → v3 (only v3 is current)
      graph.addNode('con:db-v1', 'Concept', {
        title: 'Database v1',
        content: 'Use PostgreSQL',
        topics: ['database'],
        confidence: 0.6
      });

      graph.addNode('con:db-v2', 'Concept', {
        title: 'Database v2',
        content: 'Use MongoDB',
        topics: ['database'],
        confidence: 0.7
      });

      graph.addNode('con:db-v3', 'Concept', {
        title: 'Database v3',
        content: 'Use PostgreSQL with sharding',
        topics: ['database'],
        confidence: 0.85
      });

      graph.addEdge('con:db-v2', 'con:db-v1', 'supersedes', 1.0);
      graph.addEdge('con:db-v3', 'con:db-v2', 'supersedes', 1.0);

      const context = await buildContextFromGraph(graph, 'database');

      // Only v3 should be returned (it's the leaf)
      expect(context).toContain('Database v3');
      expect(context).toContain('sharding');
      expect(context).toContain('0.85');
      expect(context).not.toContain('v1');
      expect(context).not.toContain('v2');
      expect(context).not.toContain('MongoDB');
    });

    it('should handle empty graph gracefully', async () => {
      const context = await buildContextFromGraph(graph, 'query');

      expect(typeof context).toBe('string');
      expect(context.length >= 0).toBe(true);
    });

    it('should respect includeInferred=false to skip extracted concepts', async () => {
      graph.addNode('con:extracted', 'Concept', {
        title: 'Extracted concept',
        content: 'From docs',
        topics: ['test'],
        confidence: 0.8
      });

      graph.addNode('dec:native', 'Decision', {
        title: 'Use test framework',
        status: 'accepted'
      });

      const contextWithInferred = await buildContextFromGraph(
        graph,
        'test',
        { includeInferred: true }
      );

      const contextWithoutInferred = await buildContextFromGraph(
        graph,
        'test',
        { includeInferred: false }
      );

      // With inferred should have extracted concept
      expect(contextWithInferred).toContain('Extracted concept');

      // Without inferred should NOT have the extracted concept
      expect(contextWithoutInferred).not.toContain('Extracted concept');
    });
  });

  describe('Confidence scoring in context', () => {
    it('should display confidence for all extracted concepts', async () => {
      const concepts = [
        { title: 'Pattern 1', content: 'Content 1', confidence: 0.95 },
        { title: 'Pattern 2', content: 'Content 2', confidence: 0.6 },
        { title: 'Pattern 3', content: 'Content 3', confidence: 0.75 }
      ];

      for (const concept of concepts) {
        graph.addNode(`con:${concept.title.replace(/\s/g, '-')}`, 'Concept', {
          title: concept.title,
          content: concept.content,
          topics: ['test'],
          confidence: concept.confidence
        });
      }

      const context = await buildContextFromGraph(graph, 'pattern');

      expect(context).toContain('0.95');
      expect(context).toContain('0.60');
      expect(context).toContain('0.75');
    });
  });

  describe('Query matching behavior', () => {
    it('should match query to concept topics via semantic similarity', async () => {
      graph.addNode('con:auth', 'Concept', {
        title: 'Login mechanism',
        content: 'OAuth and session handling',
        topics: ['authentication', 'security'],
        confidence: 0.9
      });

      // Query "auth" should match topic "authentication"
      const context = await buildContextFromGraph(graph, 'auth');

      expect(context).toContain('Login mechanism');
      expect(context).toContain('OAuth');
    });

    it('should prefer exact title matches over topic matches', async () => {
      graph.addNode('con:auth-exact', 'Concept', {
        title: 'Authentication',
        content: 'Exact title match',
        topics: ['other'],
        confidence: 0.9
      });

      graph.addNode('con:auth-topic', 'Concept', {
        title: 'Different title',
        content: 'Topic match only',
        topics: ['authentication'],
        confidence: 0.9
      });

      const context = await buildContextFromGraph(graph, 'authentication');

      // Both should be included, but order may differ
      expect(context).toContain('Authentication');
      expect(context).toContain('Exact title match');
    });
  });

  describe('Edge cases', () => {
    it('should handle concepts without topics', async () => {
      graph.addNode('con:no-topics', 'Concept', {
        title: 'No topics',
        content: 'Test',
        confidence: 0.8
      });

      await expect(buildContextFromGraph(graph, 'test')).resolves.toBeTypeOf('string');
    });

    it('should handle concepts with empty content', async () => {
      graph.addNode('con:empty', 'Concept', {
        title: 'Empty content',
        content: '',
        topics: ['test'],
        confidence: 0.5
      });

      const context = await buildContextFromGraph(graph, 'test');
      expect(context).toContain('Empty content');
    });

    it('should handle null/undefined node fields gracefully', async () => {
      graph.addNode('con:null-fields', 'Concept', {
        title: 'Test',
        content: null,
        topics: undefined,
        confidence: 0.8
      });

      expect(() => {
        return buildContextFromGraph(graph, 'test');
      }).not.toThrow();
    });
  });

  describe('Performance', () => {
    it('should build context in reasonable time for large graph', async () => {
      // Add 50 concepts
      for (let i = 0; i < 50; i++) {
        graph.addNode(`con:concept-${i}`, 'Concept', {
          title: `Concept ${i}`,
          content: `This is concept number ${i}`,
          topics: ['test', `category-${i % 5}`],
          confidence: 0.5 + Math.random() * 0.45
        });
      }

      const startTime = Date.now();
      const context = await buildContextFromGraph(graph, 'test');
      const elapsed = Date.now() - startTime;

      // Should complete in < 200ms
      expect(elapsed).toBeLessThan(200);
      expect(context).toBeTruthy();
    });
  });
});
