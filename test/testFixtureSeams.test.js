/**
 * Tests for testFixtureSeams: mock statements and fixture extraction for functionView.
 */
import { describe, it, expect } from 'vitest';
import { createGraph, functionView, extractTestMocks, extractTestFixture } from '../core/graph/index.js';

const SAMPLE_TEST = `
import { describe, it, expect, vi } from 'vitest';

vi.mock('../core/agents/index.js', async (importOriginal) => ({
    ...(await importOriginal()), selectPersonasForQuestion: vi.fn(async () => ['architect'])
}));
vi.mock('../core/memory/index.js', async () => ({
    buildContextFromHistory: vi.fn(() => '')
}));

const QUEUE = [
    { id: 'WQ-3', status: 'needs_review', description: 'Task 3' }
];
const ctx = () => ({ out: { log: () => {} }, workQueue: { list: vi.fn(async () => QUEUE) } });

describe('Discuss pipeline', () => {
    it('runs pipeline', async () => {
        await runDiscussPipeline(ctx(), 'test question');
    });
});
`;

describe('testFixtureSeams', () => {
    it('extracts module mocks (vi.mock / jest.mock)', () => {
        const mocks = extractTestMocks(SAMPLE_TEST);
        expect(mocks).toHaveLength(2);
        expect(mocks[0]).toContain("vi.mock('../core/agents/index.js'");
        expect(mocks[0]).toContain("selectPersonasForQuestion");
        expect(mocks[1]).toContain("vi.mock('../core/memory/index.js'");
    });

    it('extracts test fixture and referenced QUEUE declaration', () => {
        const fixture = extractTestFixture(SAMPLE_TEST);
        expect(fixture).toContain('const QUEUE = [');
        expect(fixture).toContain('const ctx = () => ({ out: { log: () => {} }, workQueue: { list: vi.fn(async () => QUEUE) } });');
    });

    it('functionView integrates mocks and fixture into tests entries', () => {
        const graph = createGraph('t');
        graph.addNode('file:core/pipeline.js', 'CodeFile', {
            path: 'core/pipeline.js',
            symbols: ['runDiscussPipeline'],
            symbolRanges: { runDiscussPipeline: [1, 5] },
            calls: []
        });
        graph.addNode('file:test/pipeline.test.js', 'CodeFile', {
            path: 'test/pipeline.test.js',
            kind: 'test',
            calls: [['runDiscussPipeline', 'runDiscussPipeline', 17, 'core/pipeline.js']]
        });
        graph.addEdge('file:test/pipeline.test.js', 'file:core/pipeline.js', 'TESTS', 1);

        const files = {
            'core/pipeline.js': 'export async function runDiscussPipeline(ctx, q) { return q; }',
            'test/pipeline.test.js': SAMPLE_TEST
        };
        const view = functionView(graph, 'runDiscussPipeline', { readFile: (p) => files[p] });
        expect(view.tests).toHaveLength(1);
        const testEntry = view.tests[0];
        expect(testEntry.path).toBe('test/pipeline.test.js');
        expect(testEntry.mocks).toHaveLength(2);
        expect(testEntry.fixture).toContain('const ctx = () =>');
    });
});
