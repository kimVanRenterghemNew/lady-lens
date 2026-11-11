/**
 * Ladybug keeps every page a write touches pinned until the statement ends: a statement that is too large fails with
 * "Buffer manager exception: ... The buffer pool is full". Writes therefore go in batches bounded by row count AND by size,
 * and a batch that still overflows the pool is split in two and written again (a failed statement is rolled back and
 * MERGE is idempotent). Only a single row larger than the pool can still fail.
 */
import { lensEnv } from '../../../configuration/index.js';
import { debug } from '../../../observability/index.js';

const BUFFER_FULL = /buffer pool is full|unable to allocate memory/i;
export const MAX_BATCH_SIZE = Number(lensEnv('GRAPH_WRITE_BATCH_BYTES')) || 64 * 1024 * 1024;

const rowSize = row => Object.values(row).reduce((sum, value) => sum + (typeof value === 'string' ? value.length : 16), 0);

/** Splits rows into consecutive batches of at most `maxRows` rows and about `maxSize` string units (a larger row goes alone). */
export function batchesOf(rows, { maxRows, maxSize = MAX_BATCH_SIZE }) {
    const batches = [];
    let batch = [];
    let total = 0;
    for (const row of rows) {
        const size = rowSize(row);
        if (batch.length && (batch.length >= maxRows || total + size > maxSize)) {
            batches.push(batch);
            batch = [];
            total = 0;
        }
        batch.push(row);
        total += size;
    }
    if (batch.length) batches.push(batch);
    return batches;
}

async function writeSplitting(batch, write) {
    try {
        await write(batch);
    } catch (error) {
        if (!BUFFER_FULL.test(String(error?.message))) throw error;
        if (batch.length < 2) {
            throw new Error(`${error.message}\nThe graph database needs more memory than its buffer pool (LENS_GRAPH_BUFFER_BYTES, default 1 GB): raise it, `
                + 'or turn off graph.ast.enabled in the project config, or exclude the folders with vendored bundles (project.exclude_dirs).', { cause: error });
        }
        debug(1, 'graph:write', `buffer pool full on ${batch.length} rows: writing them in two halves`);
        const half = Math.ceil(batch.length / 2);
        await writeSplitting(batch.slice(0, half), write);
        await writeSplitting(batch.slice(half), write);
    }
}

/** Runs `write(batch)` for every batch of `rows`, splitting a batch that overflows Ladybug's buffer pool. */
export async function writeInBatches(rows, write, options) {
    for (const batch of batchesOf(rows, options)) await writeSplitting(batch, write);
    return rows.length;
}
