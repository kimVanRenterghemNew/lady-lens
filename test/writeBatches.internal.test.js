/** Ladybug writes bounded by rows and size, and a batch that overflows the buffer pool is split instead of failing the sync. */
import { describe, it, expect } from 'vitest';
import { batchesOf, writeInBatches, buildCodeEntity, MAX_AST_SOURCE } from '../core/graph/adapters/ladybug/index.js';

const row = (id, chars = 10) => ({ id: String(id), text: 'x'.repeat(chars) });
const FULL = 'Buffer manager exception: Unable to allocate memory! The buffer pool is full and no memory could be freed!';

describe('Ladybug write batches', () => {
    it('cuts at the row limit and at the size limit; a row larger than the limit goes alone', () => {
        expect(batchesOf([1, 2, 3, 4, 5].map(id => row(id)), { maxRows: 2, maxSize: 1e9 }).map(batch => batch.length)).toEqual([2, 2, 1]);
        expect(batchesOf([row(1, 40), row(2, 40), row(3, 500), row(4, 40)], { maxRows: 100, maxSize: 100 }).map(batch => batch.map(r => r.id))).toEqual([['1', '2'], ['3'], ['4']]);
        expect(batchesOf([], { maxRows: 5 })).toEqual([]);
    });

    it('splits a batch that fills the buffer pool until it fits, and writes every row once', async () => {
        const written = [];
        const write = async batch => {
            if (batch.length > 2) throw new Error(FULL);
            written.push(...batch.map(r => r.id));
        };
        expect(await writeInBatches([1, 2, 3, 4, 5, 6, 7].map(id => row(id)), write, { maxRows: 100 })).toBe(7);
        expect(written).toEqual(['1', '2', '3', '4', '5', '6', '7']);
    });

    it('rethrows any other error, and a buffer error on a single row', async () => {
        await expect(writeInBatches([row(1), row(2)], async () => { throw new Error('syntax error'); }, { maxRows: 10 })).rejects.toThrow('syntax error');
        await expect(writeInBatches([row(1)], async () => { throw new Error(FULL); }, { maxRows: 10 })).rejects.toThrow(/buffer pool is full[\s\S]*LENS_GRAPH_BUFFER_BYTES/);
    });

    it('stores no syntax tree for a JavaScript file over the size limit, even with AST on', () => {
        const small = buildCodeEntity('a.js', 'export const a = 1;', { includeAst: true });
        const big = buildCodeEntity('b.js', `export const b = 1;\n//${'x'.repeat(MAX_AST_SOURCE)}`, { includeAst: true });
        expect(small.ast).toBeDefined();
        expect(big.ast).toBeUndefined();
        expect(big.metadata.exports).toEqual(['b']);
    });
});
