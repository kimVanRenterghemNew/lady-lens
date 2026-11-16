/**
 * Unit tests for bundled background sync queue (backlog/snelheid-en-hooks.md AC6).
 */
import { describe, it, expect } from 'vitest';
import { createSyncQueue } from '../core/mcp/index.js';

describe('syncQueue bundling', () => {
    it('runs at most one sync at a time and bundles subsequent triggers into exactly one more sync (AC6)', async () => {
        let resolveFirst;
        const firstBarrier = new Promise(resolve => { resolveFirst = resolve; });
        const calls = [];

        const queue = createSyncQueue(async repo => {
            calls.push(repo);
            if (calls.length === 1) await firstBarrier;
        });

        // First trigger starts immediately
        const p1 = queue.trigger('repo-A');
        expect(queue.isRunning('repo-A')).toBe(true);

        // 5 triggers arrive in rapid succession while first is running
        const others = [
            queue.trigger('repo-A'),
            queue.trigger('repo-A'),
            queue.trigger('repo-A'),
            queue.trigger('repo-A'),
            queue.trigger('repo-A')
        ];
        expect(queue.isPending('repo-A')).toBe(true);

        // Release first sync
        resolveFirst();
        await p1;
        await Promise.all(others);

        // Exactly 2 syncs ran: the initial one, plus one bundled follow-up
        expect(calls).toEqual(['repo-A', 'repo-A']);
        expect(queue.isRunning('repo-A')).toBe(false);
        expect(queue.isPending('repo-A')).toBe(false);
    });

    it('sync failures do not crash the queue', async () => {
        const queue = createSyncQueue(async () => {
            throw new Error('Simulated sync error');
        });
        await expect(queue.trigger('repo-fail')).resolves.toBeUndefined();
        expect(queue.isRunning('repo-fail')).toBe(false);
    });
});
