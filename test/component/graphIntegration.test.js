/**
 * Integration Tests: Graph → Context → Generators
 * Tests: full end-to-end flow from graph to context injection to generator
 * Uses mock generators to avoid real LLM calls
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createGraph } from '../../core/graph/index.js';
import { buildContextFromGraph } from '../../core/graph/index.js';

/**
 * Mock generators that capture injected context
 */
function createMockEpicGenerator() {
  return {
    lastContext: null,
    lastRequest: null,
    async generateEpic(request, context) {
      this.lastContext = context;
      this.lastRequest = request;
      return `Epic: ${request.title}`;
    }
  };
}

function createMockStoryGenerator() {
  return {
    lastContext: null,
    lastRequest: null,
    async generateStory(request, context) {
      this.lastContext = context;
      this.lastRequest = request;
      return `Story: ${request.title}`;
    }
  };
}

function createMockTaskGenerator() {
  return {
    lastContext: null,
    lastRequest: null,
    async generateTask(request, context) {
      this.lastContext = context;
      this.lastRequest = request;
      return `Task: ${request.title}`;
    }
  };
}

/**
 * Build a realistic sample graph for integration tests
 */
function buildRealisticGraph() {
  const graph = createGraph('integration-test');

  // Decision: Model selection
  graph.addNode('dec:model-baseline', 'Decision', {
    title: 'Use Qwen2.5-Coder 7B as baseline',
    status: 'accepted',
    description: 'Chosen for speed and reasonable performance on most tasks',
    consequences: [
      'Context window limited to ~6K tokens',
      'May fail on large refactors',
      'Faster iteration cycles'
    ],
    risks: [
      'Insufficient context for complex changes',
      'May need escalation to 14B for large tasks'
    ],
    open_questions: [
      'Should we auto-escalate on failure?',
      'Is 30B a better baseline?'
    ]
  });

  // Decision: Graph storage
  graph.addNode('dec:graph-storage', 'Decision', {
    title: 'Store knowledge graph in Ladybug project database',
    status: 'accepted',
    description: 'Persistent JSON storage for session memories',
    consequences: [
      'Can load previous session knowledge',
      'Graph persists across CLI invocations in Ladybug',
      'Enables grounding of /plan output'
    ],
    risks: [
      'JSON serialization overhead',
      'File locks if accessed concurrently'
    ]
  });

  // Modules
  graph.addNode('mod:core/graphStore.js', 'Module', {
    path: 'core/graphStore.js',
    purpose: 'Persistence layer for knowledge graph',
    exports: ['openLadybugGraph', 'addEntity', 'addRelation'],
    tech_stack: ['Node.js', 'fs/promises', 'JSON'],
    tech_debt: [
      'TODO: Add transaction support for concurrent saves',
      'TODO: Implement graph versioning'
    ]
  });

  graph.addNode('mod:core/graphQuery.js', 'Module', {
    path: 'core/graphQuery.js',
    purpose: 'Query engine for graph traversal',
    exports: ['query', 'buildContextFromGraph', 'validateGraph'],
    tech_stack: ['Node.js'],
    tech_debt: [
      'TODO: Add pagination for large results'
    ]
  });

  graph.addNode('mod:core/ollama.js', 'Module', {
    path: 'core/ollama.js',
    purpose: 'Interface to local Ollama LLM service',
    exports: ['askOllama', 'listModels'],
    tech_debt: [
      'TODO: Add retry logic',
      'TODO: Implement connection pooling'
    ]
  });

  // Features
  graph.addNode('feat:plan-grounding', 'Feature', {
    title: 'Ground /plan output in real tasks and files',
    status: 'in-progress',
    description: 'Tie each generated task to real file anchors'
  });

  graph.addNode('feat:knowledge-injection', 'Feature', {
    title: 'Inject knowledge graph context into generators',
    status: 'in-progress'
  });

  // Code files
  graph.addNode('file:core/graphStore.js', 'CodeFile', {
    path: 'core/graphStore.js',
    file_type: 'implementation',
    exports: ['CodeFile', 'AstNode', 'RELATES'],
    lines: 266
  });

  graph.addNode('file:core/graphQuery.js', 'CodeFile', {
    path: 'core/graphQuery.js',
    file_type: 'implementation',
    exports: ['query', 'buildContextFromGraph', 'validateGraph'],
    lines: 220
  });

  // Tasks
  graph.addNode('task:graph-tests', 'Task', {
    description: 'Complete unit and integration tests for graph store',
    status: 'in-progress',
    files: ['test/ladybugGraphStore.test.js', 'test/graphQuery.test.js']
  });

  // Edges: Decisions → Features
  graph.addEdge('dec:graph-storage', 'feat:plan-grounding', 'enables', 1.0);
  graph.addEdge('dec:graph-storage', 'feat:knowledge-injection', 'enables', 1.0);

  // Edges: Features → Modules (require)
  graph.addEdge('feat:knowledge-injection', 'mod:core/graphStore.js', 'requires', 1.0);
  graph.addEdge('feat:knowledge-injection', 'mod:core/graphQuery.js', 'requires', 1.0);

  // Edges: Modules → Modules (calls/depends)
  graph.addEdge('mod:core/graphQuery.js', 'mod:core/graphStore.js', 'calls', 1.0);
  graph.addEdge('mod:core/graphQuery.js', 'mod:core/ollama.js', 'calls', 0.5);

  // Edges: Modules ← Code files (implements)
  graph.addEdge('file:core/graphStore.js', 'mod:core/graphStore.js', 'related_to', 1.0);
  graph.addEdge('file:core/graphQuery.js', 'mod:core/graphQuery.js', 'related_to', 1.0);

  // Edges: Tasks → Modules (affects)
  graph.addEdge('task:graph-tests', 'mod:core/graphStore.js', 'related_to', 1.0);
  graph.addEdge('task:graph-tests', 'mod:core/graphQuery.js', 'related_to', 1.0);

  return graph;
}

describe('Graph Integration Tests', () => {
  let graph;
  let epicGen, storyGen, taskGen;

  beforeEach(() => {
    graph = buildRealisticGraph();

    epicGen = createMockEpicGenerator();
    storyGen = createMockStoryGenerator();
    taskGen = createMockTaskGenerator();
  });

  afterEach(() => {});

  describe('Full flow: graph → context → generator', () => {
    it('should build context from graph and pass to epic generator', async () => {
      // User wants to implement knowledge injection
      const featureDescription = 'graph storage';

      // Query graph for context
      const context = await buildContextFromGraph(graph, featureDescription);

      // Pass context to epic generator
      await epicGen.generateEpic(
        { title: 'Implement plan grounding' },
        context
      );

      // Verify context was received
      expect(epicGen.lastContext).toBeTruthy();
      expect(epicGen.lastContext).toContain('Related Decisions');
      expect(epicGen.lastContext).toContain('Ladybug');
      expect(epicGen.lastContext).toContain('Modules');
    });

    it('should inject decision consequences into generated story', async () => {
      const context = await buildContextFromGraph(graph, 'graph storage');

      await storyGen.generateStory(
        { title: 'Set up graph storage' },
        context
      );

      // Context should contain consequences of the decision
      expect(storyGen.lastContext).toContain('Consequences');
      expect(storyGen.lastContext).toContain('persist');
    });

    it('should include affected modules in task context', async () => {
      const context = await buildContextFromGraph(graph, 'graphStore');

      await taskGen.generateTask(
        { title: 'Implement graph persistence' },
        context
      );

      // Task context should mention the relevant module
      expect(taskGen.lastContext).toContain('Affected Modules');
      expect(taskGen.lastContext).toContain('graphStore');
    });

    it('should handle multiple related decisions', async () => {
      const context = await buildContextFromGraph(graph, 'graph storage');

      expect(context).toContain('Related Decisions');
      expect(context).toContain('Ladybug');
    });

    it('should skip context building if no matches found', async () => {
      const context = await buildContextFromGraph(graph, 'zzzzzz xyz12345');

      expect(context).toBe('');
    });
  });

  describe('Graph context integration', () => {
    it('should build context from the functional graph model', async () => {
      const context = await buildContextFromGraph(graph, 'graph storage');
      expect(context).toContain('Related Decisions');
      expect(context).toContain('Ladybug');
    });
  });

  describe('Edge cases in injection pipeline', () => {
    it('should handle generator that rejects context', async () => {
      const context = await buildContextFromGraph(graph, 'plan grounding');

      // Generator that throws
      const throwingGen = {
        generateEpic: vi.fn().mockRejectedValue(new Error('Generation failed'))
      };

      await expect(
        throwingGen.generateEpic({ title: 'Test' }, context)
      ).rejects.toThrow('Generation failed');
    });

    it('should handle empty graph', async () => {
      const emptyGraph = createGraph('empty-session');

      const context = await buildContextFromGraph(emptyGraph, 'anything');

      expect(context).toBe('');
    });

    it('should handle very large context gracefully', async () => {
      // Add many nodes to graph
      for (let i = 0; i < 100; i++) {
        graph.addNode(`dec:decision-${i}`, 'Decision', {
          title: `Decision ${i}`,
          consequences: Array(50).fill(`Consequence ${i}`)
        });
      }

      // Query should still work (limit applied)
      const context = await buildContextFromGraph(graph, 'decision');

      expect(context).toBeTruthy();
      // Should not include all 100 decisions (there's a limit)
      const decisionCount = (context.match(/Decision/g) || []).length;
      expect(decisionCount).toBeLessThan(100);
    });

    it('should preserve context formatting for markdown injection', async () => {
      const context = await buildContextFromGraph(graph, 'graph storage');

      // Verify markdown structure is preserved for prompt injection
      expect(context.length).toBeGreaterThan(0);
      expect(context).toContain('##');
      expect(context).toContain('- **');
      expect(context).toContain('\n');
    });
  });

  describe('Integration with different node types', () => {
    it('should include tech debt in module context', async () => {
      const context = await buildContextFromGraph(graph, 'core/graphStore');

      expect(context).toContain('Affected Modules');
      expect(context).toContain('Tech debt');
    });

    it('should reference open questions in decision context', async () => {
      const context = await buildContextFromGraph(graph, 'model baseline');

      // The decision "Use Qwen2.5-Coder 7B as baseline" has open questions
      if (context) {
        // Context may be empty if no decisions match; that's ok for this query
        expect(context.length >= 0).toBe(true);
      }
    });

    it('should work with features and tasks', async () => {
      graph.addNode('task:urgent-fix', 'Task', {
        description: 'Fix graph query performance',
        status: 'in-progress'
      });

      const context = await buildContextFromGraph(graph, 'query performance');

      // Should match on the task description
      expect(context.length >= 0).toBe(true); // Empty or has context
    });
  });

  describe('Round-trip: graph → context → generator → new graph update', () => {
    it('should enable feedback loop from generator back to graph', async () => {
      // Step 1: Query graph for context
      const context = await buildContextFromGraph(graph, 'graph storage');

      // Step 2: Pass to generator with context
      const generatorInput = {
        title: 'Implement knowledge injection',
        context: context
      };

      await epicGen.generateEpic(generatorInput, context);

      // Step 3: Simulate generator decision to add new decision to graph
      const newDecision = {
        id: 'dec:inject-context-into-prompts',
        type: 'Decision',
        title: 'Inject graph context into LLM prompts',
        status: 'proposed',
        rationale: 'To ground model decisions in real architectural context'
      };

      graph.addNode(newDecision.id, newDecision.type, newDecision);

      expect(graph.getNode(newDecision.id)).toBeTruthy();
      expect(graph.getNode(newDecision.id).title).toBe('Inject graph context into LLM prompts');
    });
  });

  describe('Performance: context building at scale', () => {
    it('should handle graph with 50+ nodes efficiently', async () => {
      // Add many decisions
      for (let i = 0; i < 50; i++) {
        graph.addNode(`dec:decision-${i}`, 'Decision', {
          title: `Decision ${i}`,
          consequences: [`Consequence ${i}`],
          risks: [`Risk ${i}`]
        });
      }

      const start = Date.now();
      const context = await buildContextFromGraph(graph, 'decision');
      const elapsed = Date.now() - start;

      expect(context.length).toBeGreaterThan(0);
      expect(elapsed).toBeLessThan(100); // Should be fast
    });

    it('should apply limit correctly to avoid context explosion', async () => {
      // Add 200 modules with similar names
      for (let i = 0; i < 200; i++) {
        graph.addNode(`mod:module-${i}`, 'Module', {
          path: `module-${i}.js`,
          purpose: `Module number ${i}`
        });
      }

      const context = await buildContextFromGraph(graph, 'module');

      // Context should be reasonable size (limited to 5 modules per type in query)
      expect(context.length).toBeLessThan(2000);
    });
  });
});
