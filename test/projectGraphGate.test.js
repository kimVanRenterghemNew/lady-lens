import { describe, it, expect, vi } from 'vitest';
import { ensureProjectGraph, touchProjectGraph, runGraphCommand } from '../core/graph/index.js';

const syncResult = (overrides = {}) => ({ mode: 'incremental', added: 3, updated: 1, removed: 0, unchanged: 10, nodes: 14, edges: 20, durationMs: 12, wrote: true, ...overrides });

describe('project graph gate', () => {
    it('Given graph sync is disabled, Then it does nothing and says nothing', async () => {
        const sync = { sync: vi.fn() };
        const log = vi.fn();

        const result = await ensureProjectGraph({ sync, enabled: false, log });

        expect(result).toEqual({ ok: true, skipped: true });
        expect(sync.sync).not.toHaveBeenCalled();
        expect(log).not.toHaveBeenCalled();
    });

    it('Given a repo with sources, When planning starts, Then it syncs, logs the counts and records a graph_sync event', async () => {
        const record = vi.fn();
        const log = vi.fn();

        const result = await ensureProjectGraph({ sync: { sync: async () => syncResult() }, enabled: true, log, record });

        expect(result.ok).toBe(true);
        expect(log.mock.calls[0][0]).toContain('14 nodes, 20 edges (3 new, 1 changed, 0 removed, 10 unchanged');
        expect(record).toHaveBeenCalledWith(expect.objectContaining({ event: 'graph_sync', trigger: 'plan', node_count: 14, edge_count: 20, added: 3 }));
    });

    it('Given the sync produced an EMPTY graph, Then planning is refused (never a silent "0 matches")', async () => {
        const result = await ensureProjectGraph({ sync: { sync: async () => syncResult({ nodes: 0, edges: 0, added: 0 }) }, enabled: true });

        expect(result).toMatchObject({ ok: false, reason: 'empty' });
    });

    it('Given the sync throws, Then planning is refused with the reason', async () => {
        const result = await ensureProjectGraph({ sync: { sync: async () => { throw new Error('EACCES'); } }, enabled: true });

        expect(result).toEqual({ ok: false, reason: 'error', error: 'EACCES' });
    });

    it('Given /code wrote files, Then only those are touched, and a failure never throws', async () => {
        const touch = vi.fn().mockResolvedValue({ added: 1, updated: 0, removed: 0, nodes: 5, edges: 4, wrote: true });
        const log = vi.fn();

        await touchProjectGraph({ paths: ['core/hello.js'], sync: { touch }, enabled: true, log });
        expect(touch).toHaveBeenCalledWith(['core/hello.js']);
        expect(log.mock.calls[0][0]).toContain('+1 ~0 -0');

        const failing = await touchProjectGraph({ paths: ['x.js'], sync: { touch: async () => { throw new Error('disk full'); } }, enabled: true, log });
        expect(failing).toBeNull();
        expect(log.mock.calls.at(-1)[0]).toContain('/graph sync');
    });

    it('does not touch when no file was written', async () => {
        const touch = vi.fn();

        expect(await touchProjectGraph({ paths: [], sync: { touch }, enabled: true })).toBeNull();
        expect(touch).not.toHaveBeenCalled();
    });

    it('/graph status reports staleness; /graph sync --full rebuilds', async () => {
        const sync = {
            reset: vi.fn().mockResolvedValue({ removed: 3 }),
            status: async () => ({ exists: true, databasePath: '/x/project.lbdb', nodes: 9, stale: true, newFiles: ['a'], changedFiles: [], removedFiles: ['b'] }),
            sync: vi.fn().mockResolvedValue(syncResult({ mode: 'full' }))
        };
        const log = vi.fn();

        await runGraphCommand('status', { sync, log });
        await runGraphCommand('sync --full', { sync, log });

        expect(log.mock.calls.map(call => call[0]).join('\n')).toContain('stale: 1 new, 0 changed, 1 removed');
        expect(sync.sync).toHaveBeenCalledWith({ mode: 'full' });
    });

    it('an inherited name like toString or constructor is no /graph action: it prints the usage', async () => {
        const log = vi.fn();
        for (const action of ['toString', 'constructor']) {
            expect(await runGraphCommand(action, { sync: {}, log })).toBeNull();
        }
        expect(log).toHaveBeenCalledWith('Usage: /graph [status|sync [--full]|reset]');
    });
});
