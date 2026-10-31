/**
 * A host adds knowledge the graph cannot read from files by itself (for example its composition: which variant of a
 * type is chosen and which module registers it). A contributor gets the project files at every sync and returns extra
 * nodes and relations; they are written with the files and survive the next sync.
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createGraphSync, createGraphRepository, configureLensContributors, PROJECT_SCOPE } from '../core/graph/index.js';

const SETTINGS = { project: { graph_roots: ['.'], exclude_dirs: ['.git', '.memory'], graph_extensions: ['.js', '.md'] }, graph: { ast: { enabled: false } } };
let root;
afterEach(() => { configureLensContributors([]); fs.rmSync(root, { recursive: true, force: true }); });

describe('graph contributors', () => {
    it('MUST write the nodes and relations a host contributes, and keep them on the next sync', async () => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-contrib-'));
        fs.mkdirSync(path.join(root, 'core'));
        fs.writeFileSync(path.join(root, 'core/store.js'), 'export const store = 1;\n');
        configureLensContributors([async ({ files }) => ({
            nodes: [{ id: 'ioc:graph.store', type: 'IocType', kind: 'composition', name: 'graph.store', documentation: 'the graph storage', metadata: { selected: 'ladybug', variants: ['ladybug', 'memory'], seen: [...files.keys()].length } }],
            relations: [{ from: 'ioc:graph.store', to: 'file:core/store.js', relation: 'REGISTERED_IN', confidence: 'EXTRACTED' }]
        })]);
        const repository = createGraphRepository({ databasePath: path.join(root, '.memory', 'graph.lbdb') });
        const sync = createGraphSync({ root, repository, settings: SETTINGS });
        await sync.sync();
        fs.writeFileSync(path.join(root, 'core/store.js'), 'export const store = 2;\n');
        await sync.sync();
        const graph = await repository.loadGraph({ scopes: [PROJECT_SCOPE] });
        const node = graph.nodes.find(n => n.id === 'ioc:graph.store');
        expect(node).toMatchObject({ type: 'IocType', kind: 'composition', name: 'graph.store', selected: 'ladybug', seen: 1 });
        expect(graph.edges.filter(e => e.type === 'REGISTERED_IN').map(e => [e.from, e.to])).toEqual([['ioc:graph.store', 'file:core/store.js']]);
    });

    it('a failing contributor is skipped; the files are still written', async () => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-contrib-'));
        fs.writeFileSync(path.join(root, 'a.js'), 'export const a = 1;\n');
        configureLensContributors([() => { throw new Error('host broke'); }]);
        const repository = createGraphRepository({ databasePath: path.join(root, '.memory', 'graph.lbdb') });
        const result = await createGraphSync({ root, repository, settings: SETTINGS }).sync();
        expect(result.nodes).toBe(1);
    });
});
