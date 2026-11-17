/**
 * Tests for rankGrounding: path grounding and call-hierarchy seam priority (Story 32.59).
 */
import { describe, it, expect } from 'vitest';
import { createGraph, rankGraphNodes, pathGroundingBonus, routingSeamBonus } from '../core/graph/index.js';

describe('rankGrounding: Story 32.59 path grounding and router disambiguation', () => {
    it('pathGroundingBonus gives +100 for exact path in text, +50 for basename', () => {
        const node = { path: 'core/agents/routing/modeClassifier.js' };
        expect(pathGroundingBonus(node, 'wijzig in core/agents/routing/modeClassifier.js taak')).toBe(100);
        expect(pathGroundingBonus(node, 'pas modeClassifier.js aan')).toBe(50);
        expect(pathGroundingBonus(node, 'iets anders')).toBe(0);
    });

    it('routingSeamBonus awards +30 for classifyMode export when routing/mode is mentioned', () => {
        const routerNode = {
            path: 'core/agents/routing/modeClassifier.js',
            exports: ['classifyMode']
        };
        const utilNode = {
            path: 'core/domain/planning/tasks/taskReferences.js',
            exports: ['buildExecutePrompt', 'formatTaskReferences']
        };

        expect(routingSeamBonus(routerNode, 'execute verb Then execute stays discuss')).toBe(30);
        expect(routingSeamBonus(utilNode, 'execute verb Then execute stays discuss')).toBe(0);
    });

    it('Story 32.59: rankGraphNodes forces explicitly mentioned modeClassifier.js to rank #1 over taskReferences.js', () => {
        const graph = createGraph('t');
        graph.addNode('file:core/agents/routing/modeClassifier.js', 'CodeFile', {
            path: 'core/agents/routing/modeClassifier.js',
            purpose: 'Classifies incoming input into discuss plan execute validate-request',
            exports: ['classifyMode'],
            symbols: ['classifyMode', 'EXECUTE_VERB_RE', 'TASK_ID_RE']
        });
        graph.addNode('file:core/domain/planning/tasks/taskReferences.js', 'CodeFile', {
            path: 'core/domain/planning/tasks/taskReferences.js',
            purpose: 'Builds execute prompt and task reference formatting with task ids',
            exports: ['buildExecutePrompt', 'formatTaskReferences'],
            symbols: ['buildExecutePrompt', 'taskReference', 'taskId']
        });

        const query = 'Zorg dat modeClassifier.js taak-IDs herkent in core/agents/routing/modeClassifier.js: execute verb Then execute, stays discuss';
        const ranked = rankGraphNodes(graph, query, { minScore: 1 });

        expect(ranked.length).toBeGreaterThanOrEqual(2);
        expect(ranked[0].node.path).toBe('core/agents/routing/modeClassifier.js');
        expect(ranked[0].score).toBeGreaterThan(ranked[1].score + 50);
    });
});
