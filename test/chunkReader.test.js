/**
 * Tests for Story 23.2: AST-Chunk Retrieval via read_chunk and graph_query.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { read_chunk, outlineOf, graph_query } from '../core/search/index.js';
import {
    createGraph,
    createChunkNode,
    chunkNodeId,
    createMemoryRepositoryStore,
    configureGraphStore
} from '../core/graph/index.js';

describe('Story 23.2: AST-Chunk Retrieval', () => {
    const fixtureDir = path.join(process.cwd(), 'scratch', 'test-chunks');
    const fixtureFile = path.join(fixtureDir, 'math.js');
    const relFixturePath = 'scratch/test-chunks/math.js';

    beforeEach(() => {
        fs.mkdirSync(fixtureDir, { recursive: true });
        const code = [
            'export function add(a, b) {',
            '    return a + b;',
            '}',
            '',
            'export function calculate(x, y) {',
            '    const sum = add(x, y);',
            '    return sum * 2;',
            '}',
            '',
            'export class Calculator {',
            '    compute(val) {',
            '        return calculate(val, 1);',
            '    }',
            '}'
        ].join('\n');
        fs.writeFileSync(fixtureFile, code, 'utf8');
    });

    afterEach(() => {
        try { fs.rmSync(fixtureDir, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    it('retrieves exact function body via chunkId without loading whole file', () => {
        const result = read_chunk({ chunkId: `chunk:${relFixturePath}#add` });
        expect(result.error).toBeUndefined();
        expect(result.chunkId).toBe(`chunk:${relFixturePath}#add`);
        expect(result.symbol).toBe('add');
        expect(result.startLine).toBe(1);
        expect(result.endLine).toBe(3);
        expect(result.content).toBe('export function add(a, b) {\n    return a + b;\n}');
    });

    it('retrieves exact function body using relative path and symbol without chunk: prefix', () => {
        const result = read_chunk({ chunkId: `${relFixturePath}#calculate` });
        expect(result.error).toBeUndefined();
        expect(result.symbol).toBe('calculate');
        expect(result.startLine).toBe(5);
        expect(result.endLine).toBe(8);
        expect(result.content).toContain('const sum = add(x, y);');
    });

    it('retrieves class declaration chunk via chunkId', () => {
        const result = read_chunk({ chunkId: `${relFixturePath}#Calculator` });
        expect(result.error).toBeUndefined();
        expect(result.symbol).toBe('Calculator');
        expect(result.startLine).toBe(10);
        expect(result.endLine).toBe(14);
        expect(result.content).toContain('class Calculator');
    });

    it('retrieves chunk when given a graph containing a CodeChunk node', () => {
        const graph = createGraph('chunk-test');
        const node = createChunkNode({
            path: relFixturePath,
            symbol: 'add',
            startLine: 1,
            endLine: 3
        });
        expect(node.id).toBe(chunkNodeId(relFixturePath, 'add'));
        graph.addNode(node.id, node.type, node);

        const result = read_chunk({ chunkId: node.id, graph });
        expect(result.error).toBeUndefined();
        expect(result.symbol).toBe('add');
        expect(result.content).toBe('export function add(a, b) {\n    return a + b;\n}');
    });

    it('returns a clear error when a chunk ID does not exist or symbol was removed', () => {
        const missingSymbol = read_chunk({ chunkId: `chunk:${relFixturePath}#nonExistentFunction` });
        expect(missingSymbol.error).toContain('chunk not found');

        const missingFile = read_chunk({ chunkId: 'chunk:scratch/nonexistent.js#someFunc' });
        expect(missingFile.error).toContain('chunk not found');

        const malformed = read_chunk({ chunkId: 'just-invalid-format' });
        expect(malformed.error).toContain('chunk not found');
    });

    it('graph_query traverses CodeChunk nodes and finds calls / imports edges', async () => {
        const memoryStore = createMemoryRepositoryStore();
        configureGraphStore(() => memoryStore);

        const addNode = createChunkNode({
            path: relFixturePath,
            symbol: 'add',
            startLine: 1,
            endLine: 3
        });
        const calcNode = createChunkNode({
            path: relFixturePath,
            symbol: 'calculate',
            startLine: 5,
            endLine: 8
        });

        const sessionId = `chunk-session-${Date.now()}`;
        const scope = `session:${sessionId}`;
        addNode.scope = scope;
        calcNode.scope = scope;

        await memoryStore.replaceScope(scope, [addNode, calcNode], [
            {
                from: calcNode.id,
                to: addNode.id,
                relation: 'CALLS',
                type: 'CALLS',
                weight: 1,
                confidence: 'EXTRACTED'
            }
        ]);

        // Query outgoing edges from calculate chunk
        const queryRes = await graph_query({
            sessionId,
            node: calcNode.id,
            outgoing: true
        });

        expect(queryRes.available).toBe(true);
        expect(queryRes.nodes.some(n => n.id === addNode.id)).toBe(true);
        expect(queryRes.edges.some(e => e.from === calcNode.id && e.to === addNode.id && e.type === 'CALLS')).toBe(true);
    });

    it('preserves existing line-range read_chunk behavior for files', () => {
        const res = read_chunk({ path: relFixturePath, startLine: 1, endLine: 3 });
        expect(res.error).toBeUndefined();
        expect(res.startLine).toBe(1);
        expect(res.endLine).toBe(3);
        expect(res.content).toBe('export function add(a, b) {\n    return a + b;\n}');
    });

    it('handles outlineOf and large file budgeting', () => {
        const lines = [
            '// A comment',
            'export function first() {',
            '    return 1;',
            '}',
            'export class Second {',
            '}'
        ];
        const outline = outlineOf(lines);
        expect(outline.length).toBe(2);
        expect(outline[0]).toContain('2: export function first()');
        expect(outline[1]).toContain('5: export class Second');
    });

    it('returns error on missing path, unsafe path, or non-existent file', () => {
        expect(read_chunk({}).error).toBe('path is required');
        expect(read_chunk({ path: '../outside.js' }).error).toContain('unsafe path');
        expect(read_chunk({ path: 'scratch/not-there.js' }).error).toContain('not found');
    });
});
