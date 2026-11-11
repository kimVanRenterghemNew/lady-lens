import { afterEach, describe, expect, it, vi } from 'vitest';

const sync = vi.fn();
const createGraphSync = vi.fn(() => ({ sync }));
const findMendixProject = vi.fn(() => false);
const registerRepo = vi.fn((repoPath, options) => ({ path: repoPath, ...options }));
const findRegisteredRepo = vi.fn(() => null);

vi.mock('../core/graph/index.js', () => ({ createGraphSync, findMendixProject }));
vi.mock('../core/repository/index.js', () => ({ registerRepo, findRegisteredRepo }));

const { repoAdd } = await import('../core/mcp/handlers/repoAdd.js');
const { repoSync } = await import('../core/mcp/handlers/repoSync.js');

afterEach(() => {
    sync.mockReset();
    createGraphSync.mockClear();
    findMendixProject.mockClear().mockReturnValue(false);
    registerRepo.mockClear().mockImplementation((repoPath, options) => ({ path: repoPath, ...options }));
    findRegisteredRepo.mockReset().mockReturnValue(null);
    delete process.env.LENS_REPO_ROOT;
    delete process.env.LENS_GRAPH_DB;
});

describe('MCP repository handlers', () => {
    it('adds without syncing and filters empty registration values', async () => {
        const activate = vi.fn();
        const result = await repoAdd({ path: '.', db: 'shared', branch: 'main', sync: false }, { activate });

        expect(result.sync).toBeNull();
        expect(result.registered).toMatchObject({ db: 'shared', branch: 'main' });
        expect(activate).not.toHaveBeenCalled();
        expect(createGraphSync).not.toHaveBeenCalled();
    });

    it('adds and syncs by default, preserving explicit database', async () => {
        sync.mockResolvedValue({ nodes: 7 });
        const activate = vi.fn();
        const result = await repoAdd({ path: '.', database: 'shared-db' }, { activate });

        expect(activate).toHaveBeenCalledWith(expect.objectContaining({ database: 'shared-db' }));
        expect(sync).toHaveBeenCalledWith({ mode: 'incremental' });
        expect(result.sync.nodes).toBe(7);
        expect(registerRepo).toHaveBeenCalledTimes(2);
    });

    it('syncs incremental (a Mendix project too: a changed model makes the sync write), and full on request', async () => {
        sync.mockResolvedValue({ nodes: 3 });
        process.env.LENS_REPO_ROOT = '/tmp/lady-lens-handler-test';
        process.env.LENS_GRAPH_DB = 'graph.db';

        await repoSync();
        expect(sync).toHaveBeenLastCalledWith({ mode: 'incremental' });
        await repoSync({ full: true });
        expect(sync).toHaveBeenLastCalledWith({ mode: 'full' });
        findMendixProject.mockReturnValue(true);
        await repoSync();
        expect(sync).toHaveBeenLastCalledWith({ mode: 'incremental' });
        expect(registerRepo).toHaveBeenCalledTimes(3);
    });

    // MCP smoke test (2026-11-11): a sync wrote the active database into the registry; after one context switch lady-lens
    // pointed at AgenticTeam's database for good, and every later sync of lady-lens overwrote that database
    it('a sync records the database of a new repo, and never changes the database of a registered one', async () => {
        sync.mockResolvedValue({ nodes: 3 });
        process.env.LENS_REPO_ROOT = '/tmp/lady-lens-handler-test';
        process.env.LENS_GRAPH_DB = 'other-repo.db';
        await repoSync();
        expect(registerRepo.mock.calls.at(-1)[1]).toMatchObject({ database: 'other-repo.db' });
        findRegisteredRepo.mockReturnValue({ id: 'x', path: '/tmp/lady-lens-handler-test', database: 'own.db' });
        await repoSync();
        expect(registerRepo.mock.calls.at(-1)[1]).not.toHaveProperty('database');
    });
});
