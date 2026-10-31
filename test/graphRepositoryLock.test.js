/**
 * Windows, 2026-10-05: "Could not set lock on file ... (Error: 33)" in test/adr.test.js. Overlapping opens of the same
 * Ladybug file in one process, or an open right after a close, hit the file lock. Operations on one file now queue up
 * and a held lock is retried briefly.
 */
import { describe, it, expect } from 'vitest';
import { createGraphRepository, openWithLockRetry } from '../core/graph/index.js';

function fakeOpen({ failFirst = 0 } = {}) {
    const state = { open: 0, maxOpen: 0, calls: 0 };
    const open = async () => {
        state.calls += 1;
        if (state.calls <= failFirst) throw new Error('IO exception: Could not set lock on file : C:\\x.lbdb (Error: 33)');
        state.open += 1;
        state.maxOpen = Math.max(state.maxOpen, state.open);
        return {
            query: async () => { await new Promise(r => setTimeout(r, 5)); return []; },
            close: async () => { state.open -= 1; }
        };
    };
    return { open, state };
}

describe('graph repository: one open per database file, lock retried', () => {
    it('never has two opens of the same file at once, even for parallel operations', async () => {
        const { open, state } = fakeOpen();
        const repository = createGraphRepository({ databasePath: __filename, open });

        await Promise.all(Array.from({ length: 6 }, () => repository.loadNodes({ kinds: ['knowledge'] })));

        expect(state.calls).toBe(6);
        expect(state.maxOpen).toBe(1);
    });

    it('retries an open that hits a held lock, then succeeds', async () => {
        const { open, state } = fakeOpen({ failFirst: 2 });
        const graph = await openWithLockRetry(open, 'x.lbdb', { delayMs: 1 });
        expect(state.calls).toBe(3);
        await graph.close();
    });

    it('does not retry other errors, and gives up after the attempts', async () => {
        await expect(openWithLockRetry(async () => { throw new Error('corrupt database'); }, 'x', { delayMs: 1 })).rejects.toThrow('corrupt');
        const { open } = fakeOpen({ failFirst: 99 });
        await expect(openWithLockRetry(open, 'x', { attempts: 3, delayMs: 1 })).rejects.toThrow(/Error: 33/);
    });
});
