/**
 * Ladybug storage through the ONE access path (graphRepository). the raw
 * addEntity/addRelation API is gone, so these tests exercise what production actually calls.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { createGraphRepository, PROJECT_SCOPE, sessionScope } from '../core/graph/index.js';

let dir;
let databasePath;
let repository;

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ladybug-store-'));
    databasePath = path.join(dir, 'graph.lbdb');
    repository = createGraphRepository({ databasePath });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const project = {
    nodes: [
        { id: 'file:core/a.js', type: 'CodeFile', path: 'core/a.js', purpose: 'A module' },
        { id: 'file:core/b.js', type: 'CodeFile', path: 'core/b.js' }
    ],
    edges: [{ from: 'file:core/a.js', to: 'file:core/b.js', type: 'IMPORTS', confidence: 'EXTRACTED' }]
};

describe('Ladybug graph storage (via graphRepository)', () => {
    it('treats a missing database as an empty graph, never as an error', async () => {
        expect(repository.exists()).toBe(false);
        expect(await repository.loadGraph({ scopes: [PROJECT_SCOPE] })).toEqual({ nodes: [], edges: [], exists: false });
    });

    it('persists nodes and typed relations, readable by a SEPARATE process after close (no lingering lock)', async () => {
        await repository.replaceScope(PROJECT_SCOPE, project);

        const moduleUrl = new URL('../core/graph/repository/graphRepository.js', import.meta.url).href;
        const reader = `
            import { createGraphRepository } from ${JSON.stringify(moduleUrl)};
            const graph = await createGraphRepository({ databasePath: ${JSON.stringify(databasePath)} }).loadGraph({ scopes: ['project'] });
            process.stdout.write(JSON.stringify(graph));
        `;
        const graph = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', reader], { encoding: 'utf8' }));

        expect(graph.nodes.map(node => node.id).sort()).toEqual(['file:core/a.js', 'file:core/b.js']);
        expect(graph.edges).toEqual([expect.objectContaining({ from: 'file:core/a.js', to: 'file:core/b.js', type: 'IMPORTS', confidence: 'EXTRACTED' })]);
    });

    it('keeps scopes apart: replacing a session never touches the project scope', async () => {
        await repository.replaceScope(PROJECT_SCOPE, project);
        await repository.replaceScope(sessionScope('s1'), { nodes: [{ id: 'decision:s1/dec-1', type: 'Decision', title: 'Use OAuth' }], edges: [] });
        await repository.replaceScope(sessionScope('s1'), { nodes: [{ id: 'decision:s1/dec-2', type: 'Decision', title: 'Use JWT' }], edges: [] });

        const stats = await repository.stats();
        expect(stats.scopes).toEqual({ project: 2, 'session:s1': 1 });
        const session = await repository.loadGraph({ scopes: [sessionScope('s1')] });
        expect(session.nodes).toEqual([expect.objectContaining({ id: 'decision:s1/dec-2', title: 'Use JWT' })]);
    });

    it('is idempotent: writing the same scope twice leaves one copy of every node and edge', async () => {
        await repository.replaceScope(PROJECT_SCOPE, project);
        await repository.replaceScope(PROJECT_SCOPE, project);

        const graph = await repository.loadGraph({ scopes: [PROJECT_SCOPE] });
        expect(graph.nodes).toHaveLength(2);
        expect(graph.edges).toHaveLength(1);
    });

    it('rejects an invalid confidence BEFORE writing, so a scope is never left half-replaced', async () => {
        await repository.replaceScope(PROJECT_SCOPE, project);
        const bad = { ...project, edges: [{ ...project.edges[0], confidence: 'PROBABLY' }] };

        await expect(repository.replaceScope(PROJECT_SCOPE, bad)).rejects.toThrow(/invalid confidence/);
        expect((await repository.loadGraph({ scopes: [PROJECT_SCOPE] })).nodes).toHaveLength(2);
    });

    it('deleteScopes removes every session but keeps the project scope (/clear-f)', async () => {
        await repository.replaceScope(PROJECT_SCOPE, project);
        await repository.replaceScope(sessionScope('s1'), { nodes: [{ id: 'decision:s1/a', type: 'Decision' }], edges: [] });
        await repository.replaceScope(sessionScope('s2'), { nodes: [{ id: 'decision:s2/b', type: 'Decision' }], edges: [] });

        expect(await repository.deleteScopes('session:')).toBe(2);
        expect((await repository.stats()).scopes).toEqual({ project: 2 });
    });
});
