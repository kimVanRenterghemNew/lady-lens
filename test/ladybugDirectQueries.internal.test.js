import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDirectQueries } from '../core/graph/adapters/ladybug/directQueries.js';

const tempRoots = [];
const row = (id, type, file, name, metadata = {}) => ({ id, type, path: file, name, kind: 'source', scope: 'project', metadata_json: JSON.stringify(metadata) });

function fakeGraph() {
    return {
        async query(queryText) {
            if (queryText.includes("n.type = 'CodeFile'") && queryText.includes('n.metadata_json CONTAINS $symbol') && queryText.includes('RETURN n AS')) {
                return [row('file:a.js', 'CodeFile', 'a.js', 'a.js', { exports: ['run'], symbolRanges: { run: [1, 2] } })];
            }
            if (queryText.includes("n.type = 'CodeFile'") && queryText.includes('n.metadata_json CONTAINS $symbol')) {
                return [
                    { path: 'a.js', metadata_json: JSON.stringify({ symbolRanges: { run: [1, 2] } }) },
                    { path: 'b.js', metadata_json: JSON.stringify({ exports: ['run'] }) }
                ];
            }
            if (queryText.includes('n.name IS NOT NULL') && queryText.includes('metadata_json')) {
                return [
                    row('file:a.js', 'CodeFile', 'a.js', 'a.js', { exports: ['run'] }),
                    row('file:other/a.js', 'CodeFile', 'other/a.js', 'a.js', { exports: ['other'] })
                ];
            }
            if (queryText.includes("n.type = 'CodeFile' OR n.type = 'Document'")) return [row('file:a.js', 'CodeFile', 'a.js', 'a.js')];
            if (queryText.includes('RETURN a.id AS id')) return [row('file:a.js', 'CodeFile', 'a.js', 'a.js')];
            if (queryText.includes('MATCH (b:Entity)-[e:RELATES]->(a:Entity)')) return [{ path: 'caller.js' }];
            if (queryText.includes("e.relation = 'IMPORTS'")) return [{ path: 'target.js' }];
            if (queryText.includes('n.id IN $defIds')) return [row('file:index.js', 'CodeFile', 'index.js', 'index.js')];
            if (queryText.includes('caller.id')) return [{ from_id: 'file:caller.js', to_id: 'file:a.js', relation: 'CALLS', confidence: 'EXTRACTED', weight: 1 }];
            if (queryText.includes('n.id IN $callerIds')) return [row('file:caller.js', 'CodeFile', 'caller.js', 'caller.js')];
            if (queryText.includes("n.type = 'Document'")) return [row('doc:notes.md', 'Document', 'notes.md', 'notes.md', {}, 'doc')];
            return [];
        }
    };
}

afterEach(() => {
    for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('Ladybug direct query branches', () => {
    it('handles missing databases', async () => {
        const queries = createDirectQueries(async callback => callback(fakeGraph()), () => path.join(os.tmpdir(), 'missing-ladybug.db'), 'n');
        expect(await queries.directDefinedIn('run')).toEqual([]);
        expect((await queries.directExports('a.js')).found).toBe(false);
        expect((await queries.directExists('a.js')).exists).toBe(false);
        expect((await queries.directImports('a.js')).found).toBe(false);
        expect((await queries.directImportedBy('a.js')).found).toBe(false);
        expect(await queries.directFunctionViewGraph('run')).toEqual({ nodes: [], edges: [] });
    });

    it('covers direct query matches, ambiguity, candidates, and function graph', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-direct-'));
        tempRoots.push(root);
        const queries = createDirectQueries(async callback => callback(fakeGraph()), () => root, 'n');

        expect(await queries.directDefinedIn('run')).toEqual(expect.arrayContaining([{ path: 'a.js', startLine: 1, endLine: 2 }, { path: 'b.js' }]));
        expect((await queries.directExports('a.js')).found).toBe(true);
        expect((await queries.directExports('missing.js')).found).toBe(false);
        expect((await queries.directExists('a.js')).exists).toBe(true);
        expect((await queries.directImports('a.js')).files).toContain('target.js');
        expect((await queries.directImportedBy('a.js')).files).toContain('caller.js');
        expect((await queries.directFunctionViewGraph('run')).nodes.length).toBeGreaterThan(0);
    });
});
