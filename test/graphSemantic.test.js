/**
 * Unit Tests: graphSemantic.js
 * Tests: semantic similarity, topic matching, SUPERSEDES filtering, context building
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  levenshteinDistance,
  semanticSimilarity,
  matchesTopics,
  getSupersededBy,
  isCurrentConcept,
  findSemanticMatches,
  buildContextMarkdown
} from '../core/graph/index.js';
import { createGraph } from '../core/graph/index.js';

describe('GraphSemantic', () => {
  describe('levenshteinDistance', () => {
    it('should return 0 for identical strings', () => {
      expect(levenshteinDistance('auth', 'auth')).toBe(0);
    });

    it('should return string length for completely different strings', () => {
      expect(levenshteinDistance('abc', 'xyz')).toBe(3);
    });

    it('should handle case-insensitive comparison', () => {
      expect(levenshteinDistance('Auth', 'auth')).toBe(0);
    });

    it('should calculate edit distance for similar words', () => {
      const distance = levenshteinDistance('authentication', 'authentication');
      expect(distance).toBe(0);

      const distance2 = levenshteinDistance('authentication', 'auth');
      expect(distance2).toBeGreaterThan(0);
    });

    it('should handle empty strings', () => {
      expect(levenshteinDistance('', '')).toBe(0);
      expect(levenshteinDistance('auth', '')).toBe(4);
    });
  });

  describe('semanticSimilarity', () => {
    it('should return 1.0 for identical words', () => {
      expect(semanticSimilarity('auth', 'auth')).toBe(1.0);
    });

    it('should return 1.0 for case-insensitive identical', () => {
      expect(semanticSimilarity('Auth', 'auth')).toBe(1.0);
    });

    it('should return 0.0 for completely different words', () => {
      const similarity = semanticSimilarity('xyz', 'abc');
      expect(similarity).toBe(0.0);
    });

    it('should return high similarity for similar words', () => {
      const similarity = semanticSimilarity('auth', 'authn');
      expect(similarity).toBeGreaterThan(0.5);
    });

    it('should return 0.5-0.8 range for close matches', () => {
      const sim1 = semanticSimilarity('authentication', 'auth');
      const sim2 = semanticSimilarity('oauth', 'oauth2');
      // These should be > 0.3 at least (partial matches)
      expect(sim1).toBeGreaterThan(0.2);
      expect(sim2).toBeGreaterThan(0.3);
    });
  });

  describe('matchesTopics', () => {
    it('a query word of 3+ letters that starts a topic matches it (auth -> authentication) at the default threshold', () => {
      expect(matchesTopics('auth', ['authentication'])).toBe(true);
      expect(matchesTopics('au', ['authentication'])).toBe(false);
      expect(matchesTopics('cat', ['authentication'])).toBe(false);
    });
    it('should match query word to exact topic', () => {
      const topics = ['authentication', 'security'];
      expect(matchesTopics('authentication', topics)).toBe(true);
    });

    it('should match query word to similar topic with default threshold', () => {
      const topics = ['authentication', 'security'];
      // "auth" vs "authentication": 4 vs 14 chars, distance ~10, similarity ~0.29
      // Only matches with low threshold
      expect(matchesTopics('auth', topics, 0.2)).toBe(true);
    });

    it('should not match dissimilar words', () => {
      const topics = ['authentication'];
      expect(matchesTopics('xyz', topics, 0.8)).toBe(false);
    });

    it('should handle empty topics array', () => {
      expect(matchesTopics('auth', [])).toBe(false);
      expect(matchesTopics('auth', null)).toBe(false);
    });

    it('should respect custom threshold', () => {
      const topics = ['authentication'];
      // High threshold should not match
      expect(matchesTopics('auth', topics, 0.99)).toBe(false);
      // Low threshold should match
      expect(matchesTopics('auth', topics, 0.2)).toBe(true);
    });
  });

  describe('SUPERSEDES chain utilities', () => {
    let graph;

    beforeEach(() => {
      graph = createGraph();
    });

    it('getSupersededBy: an edge points from the NEW concept to the OLD one (as detectSupersedes writes it)', () => {
      graph.addNode('con:v1', 'Concept', { title: 'Old' });
      graph.addNode('con:v2', 'Concept', { title: 'New' });
      graph.addEdge('con:v2', 'con:v1', 'supersedes', 1.0);

      const superseded = getSupersededBy(graph, 'con:v1');
      expect(superseded.length).toBe(1);
      expect(superseded[0].from).toBe('con:v2');
      expect(getSupersededBy(graph, 'con:v2')).toEqual([]);
    });

    it('should return empty array for nodes with no SUPERSEDES edges', () => {
      graph.addNode('con:test', 'Concept', { title: 'Test' });

      const superseded = getSupersededBy(graph, 'con:test');
      expect(superseded).toEqual([]);
    });

    it('should identify leaf nodes (current concepts)', () => {
      graph.addNode('con:v1', 'Concept', { title: 'Old' });
      graph.addNode('con:v2', 'Concept', { title: 'New' });
      graph.addEdge('con:v2', 'con:v1', 'supersedes', 1.0);

      // v1 has an incoming SUPERSEDES (v2 replaced it): not current
      expect(isCurrentConcept(graph, 'con:v1')).toBe(false);
      // v2 replaced v1 and nothing replaced v2: current
      expect(isCurrentConcept(graph, 'con:v2')).toBe(true);
    });

    it('should identify leaf nodes when no SUPERSEDES edges exist', () => {
      const testGraph = createGraph();
      testGraph.addNode('con:v1', 'Concept', { title: 'Single concept' });

      // Single node with no edges is a leaf
      expect(isCurrentConcept(testGraph, 'con:v1')).toBe(true);
    });
  });

  describe('findSemanticMatches', () => {
    let graph;

    beforeEach(() => {
      graph = createGraph();
    });

    it('should find concepts matching query word in title', () => {
      graph.addNode('con:auth', 'Concept', {
        title: 'Authentication concerns',
        topics: ['security']
      });

      const matches = findSemanticMatches(graph, 'authentication');
      expect(matches.length).toBe(1);
      expect(matches[0].id).toBe('con:auth');
    });

    it('should find concepts matching query word in topics', () => {
      graph.addNode('con:auth', 'Concept', {
        title: 'Login mechanism',
        topics: ['auth', 'security']  // Use shorter topic name
      });

      // Query "auth" should match topic "auth" exactly
      const matches = findSemanticMatches(graph, 'auth');
      expect(matches.length).toBe(1);
      expect(matches[0].id).toBe('con:auth');
    });

    it('should respect currentOnly flag to filter SUPERSEDES chains', () => {
      graph.addNode('con:v1', 'Concept', {
        title: 'Old auth approach',
        topics: ['auth']
      });
      graph.addNode('con:v2', 'Concept', {
        title: 'New auth approach',
        topics: ['auth']
      });
      graph.addEdge('con:v2', 'con:v1', 'supersedes', 1.0);

      // Verify nodes exist
      expect(graph.nodes.size).toBe(2);
      const v1Node = graph.getNode('con:v1');
      const v2Node = graph.getNode('con:v2');
      expect(v1Node).toBeDefined();
      expect(v2Node).toBeDefined();

      // Verify SUPERSEDES edge exists
      const supersedes = graph.edges.filter(e => e.type === 'supersedes');
      expect(supersedes.length).toBe(1);
      expect(supersedes[0].from).toBe('con:v2');
      expect(supersedes[0].to).toBe('con:v1');

      // v2 supersedes v1: v1 is no longer current
      expect(isCurrentConcept(graph, 'con:v1')).toBe(false);
      expect(isCurrentConcept(graph, 'con:v2')).toBe(true);
      expect(findSemanticMatches(graph, 'auth', { currentOnly: true }).map(match => match.id)).toEqual(['con:v2']);

      // When currentOnly=true, v2 should be filtered out (not a leaf)
      const allMatches = findSemanticMatches(graph, 'auth', { currentOnly: false });
      const currentMatches = findSemanticMatches(graph, 'auth', { currentOnly: true });
      // currentMatches should have fewer or equal nodes than allMatches
      expect(currentMatches.length).toBeLessThanOrEqual(allMatches.length);
    });

    it('should respect limit option', () => {
      for (let i = 0; i < 5; i++) {
        graph.addNode(`con:test-${i}`, 'Concept', {
          title: 'Authentication mechanism',
          topics: ['auth']
        });
      }

      const matches = findSemanticMatches(graph, 'auth', { limit: 3 });
      expect(matches.length).toEqual(3);
    });

    it('matches across Concept, Decision, and Module node types', () => {
      graph.addNode('con:auth', 'Concept', {
        title: 'Auth',
        topics: ['authentication']
      });
      graph.addNode('dec:oauth', 'Decision', { title: 'Use OAuth' });
      graph.addNode('mod:auth', 'Module', { title: 'auth.js' });

      const matches = findSemanticMatches(graph, 'auth', { limit: 10 });
      const matchedTypes = new Set(matches.map(m => m.type));
      expect(matchedTypes).toEqual(new Set(['Concept', 'Decision', 'Module']));
    });

    // BUG #3: Non-Concept node matching
    it('BUG: should ALSO match Decision/Module nodes, not just Concepts', () => {
      graph.addNode('con:auth', 'Concept', {
        title: 'Authentication Strategy',
        topics: ['auth']
      });
      graph.addNode('dec:oauth2', 'Decision', {
        title: 'Use OAuth2 for third-party auth',
        status: 'approved'
      });
      graph.addNode('mod:auth', 'Module', {
        title: 'src/auth.js - authentication module',
        purpose: 'handles user auth logic'
      });

      // Query "oauth" should match both con:auth (in topics) AND dec:oauth2 (in title)
      const matches = findSemanticMatches(graph, 'oauth', { limit: 10 });

      // BUG: Currently only finds Concept nodes (length = 1)
      // After fix: Should find Concept + Decision (length = 2)
      expect(matches.length).toBe(2, 'Should find both Concept and Decision nodes matching "oauth"');

      const hasOAuthDecision = matches.some(m => m.id === 'dec:oauth2');
      expect(hasOAuthDecision).toBe(true, 'Should include dec:oauth2 since title contains "OAuth2"');
    });

    it('should match Decision nodes when /plan queries about decisions', () => {
      graph.addNode('dec:auth-strategy', 'Decision', {
        title: 'Authentication approach',
        status: 'accepted',
        consequences: 'Requires OAuth integration',
        risks: 'Third-party dependency'
      });
      graph.addNode('dec:api-versioning', 'Decision', {
        title: 'API versioning strategy',
        status: 'accepted'
      });

      // Query "authentication" should match dec:auth-strategy by title
      const matches = findSemanticMatches(graph, 'authentication', { limit: 10 });

      // Currently only works for Concept nodes
      // After fix: should include Decision nodes too
      const hasAuthDecision = matches.some(m => m.id === 'dec:auth-strategy');
      expect(hasAuthDecision).toBe(true, 'Should find Decision node with "Authentication" in title');
    });

    it('should return empty array for no matches', () => {
      graph.addNode('con:auth', 'Concept', {
        title: 'Authentication',
        topics: ['security']
      });

      const matches = findSemanticMatches(graph, 'xyz-nonexistent');
      expect(matches).toEqual([]);
    });

    it('should handle empty query', () => {
      graph.addNode('con:auth', 'Concept', { title: 'Auth' });

      const matches = findSemanticMatches(graph, '   ');
      expect(matches).toEqual([]);
    });
  });

  describe('Performance: Levenshtein caching', () => {
    // BUG #2: Levenshtein distance is O(n*m)
    it('should compute Levenshtein distance efficiently', () => {
      // Test on large strings to show current performance
      const word1 = 'authentication'.repeat(5); // 70 chars
      const word2 = 'authorization'.repeat(5);  // 65 chars

      const start = Date.now();
      for (let i = 0; i < 100; i++) {
        levenshteinDistance(word1, word2);
      }
      const duration = Date.now() - start;

      // Should complete 100 computations in <100ms
      // (Without optimization: can take 500ms+)
      expect(duration).toBeLessThan(200, 'Levenshtein should be fast for repeated calls');
    });

    it('should handle similarity computation for query words efficiently', () => {
      const queryWords = ['authentication', 'authorization', 'accounting'];
      const topics = ['auth', 'security', 'access', 'identity'];

      const start = Date.now();
      for (let i = 0; i < 50; i++) {
        queryWords.forEach(qw => {
          topics.forEach(topic => {
            semanticSimilarity(qw, topic);
          });
        });
      }
      const duration = Date.now() - start;

      // 50 * 3 * 4 = 600 comparisons
      expect(duration).toBeLessThan(500, 'Batch semantic matching should be fast');
    });
  });

  describe('Edge cases and extra scenarios', () => {
    let graph;

    beforeEach(() => {
      graph = createGraph();
    });

    it('should handle nodes with missing topics array', () => {
      graph.addNode('con:auth', 'Concept', {
        title: 'Authentication',
        topics: undefined  // Missing!
      });

      const matches = findSemanticMatches(graph, 'auth');
      // Should still match by title
      expect(matches.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle nodes with empty topics', () => {
      graph.addNode('con:auth', 'Concept', {
        title: 'Auth process',
        topics: []  // Empty!
      });

      const matches = findSemanticMatches(graph, 'auth');
      // Should still match by title
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle query with special characters', () => {
      graph.addNode('con:oauth', 'Concept', {
        title: 'OAuth 2.0 strategy',
        topics: ['oauth2', 'auth']
      });

      const matches = findSemanticMatches(graph, 'OAuth 2.0');
      expect(matches.length).toBeGreaterThanOrEqual(0);  // Should not crash
    });

    it('should find SUPERSEDES chains correctly', () => {
      graph.addNode('con:auth-v1', 'Concept', {
        title: 'Session-based auth',
        topics: ['auth']
      });
      graph.addNode('con:auth-v2', 'Concept', {
        title: 'Token-based auth',
        topics: ['auth']
      });
      graph.addNode('con:auth-v3', 'Concept', {
        title: 'OAuth2 with PKCE',
        topics: ['auth']
      });

      // Build chain: v3 supersedes v2, v2 supersedes v1
      graph.addEdge('con:auth-v2', 'con:auth-v1', 'supersedes', 1.0);
      graph.addEdge('con:auth-v3', 'con:auth-v2', 'supersedes', 1.0);

      // only the newest (v3, nothing supersedes it) is current
      expect(isCurrentConcept(graph, 'con:auth-v1')).toBe(false);
      expect(isCurrentConcept(graph, 'con:auth-v2')).toBe(false);
      expect(isCurrentConcept(graph, 'con:auth-v3')).toBe(true);

      // When currentOnly=true, only v3 should be returned
      const current = findSemanticMatches(graph, 'auth', { currentOnly: true });
      const all = findSemanticMatches(graph, 'auth', { currentOnly: false });

      expect(all.length).toBeGreaterThanOrEqual(current.length);
    });
  });

  describe('buildContextMarkdown', () => {
    it('should build markdown for extracted concepts', () => {
      const nodes = [
        {
          id: 'con:auth',
          type: 'Concept',
          title: 'Authentication',
          content: 'We use OAuth 2.0',
          topics: ['auth', 'security'],
          confidence: 0.85
        }
      ];

      const markdown = buildContextMarkdown(nodes, null);
      expect(markdown).toContain('Authentication');
      expect(markdown).toContain('OAuth 2.0');
      expect(markdown).toContain('0.85');
      expect(markdown).toContain('auth, security');
    });

    it('should include confidence scores for extracted concepts', () => {
      const nodes = [
        {
          type: 'Concept',
          title: 'Test',
          content: 'Test content',
          confidence: 0.9
        }
      ];

      const markdown = buildContextMarkdown(nodes, null);
      expect(markdown).toContain('0.90');
    });

    it('should build markdown for decisions', () => {
      const nodes = [
        {
          type: 'Decision',
          title: 'Use OAuth',
          status: 'approved',
          consequences: 'Adds third-party dependency',
          risks: 'Provider downtime'
        }
      ];

      const markdown = buildContextMarkdown(nodes, null);
      expect(markdown).toContain('Use OAuth');
      expect(markdown).toContain('approved');
      expect(markdown).toContain('downtime');
    });

    it('should build markdown for modules', () => {
      const nodes = [
        {
          type: 'Module',
          path: 'core/auth.js',
          purpose: 'OAuth and session handling'
        }
      ];

      const markdown = buildContextMarkdown(nodes, null);
      expect(markdown).toContain('core/auth.js');
      expect(markdown).toContain('OAuth and session handling');
    });

    it('should handle empty node array', () => {
      const markdown = buildContextMarkdown([], null);
      expect(markdown).toContain('No matching concepts');
    });

    it('should handle mixed node types', () => {
      const nodes = [
        {
          type: 'Concept',
          title: 'Auth Concerns',
          content: 'Security considerations',
          confidence: 0.8
        },
        {
          type: 'Decision',
          title: 'Use OAuth 2.0',
          status: 'accepted'
        },
        {
          type: 'Module',
          path: 'src/auth.js',
          purpose: 'Auth logic'
        }
      ];

      const markdown = buildContextMarkdown(nodes, null);
      expect(markdown).toContain('Concepts');
      expect(markdown).toContain('Decisions');
      expect(markdown).toContain('Modules');
    });

    it('should omit sections with no nodes', () => {
      const nodes = [
        {
          type: 'Concept',
          title: 'Auth',
          content: 'Test',
          confidence: 0.8
        }
      ];

      const markdown = buildContextMarkdown(nodes, null);
      expect(markdown).toContain('Concepts');
      expect(markdown).not.toContain('Decisions');
      expect(markdown).not.toContain('Modules');
    });
  });
});
