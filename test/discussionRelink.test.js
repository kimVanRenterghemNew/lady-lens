import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createGraphSync, createGraphRepository, createMemoryRepositoryStore } from '../core/graph/index.js';
import { saveDiscussion } from '../core/discussions/index.js';

const SETTINGS = { project: { graph_roots: ['.'], exclude_dirs: ['.git', '.memory'], graph_extensions: ['.js'] }, graph: { ast: { enabled: false } } };
let root, repository, sync;

const discussedIn = async () => (await repository.loadGraph({ scopes: ['project', 'session:default'] })).edges
    .filter(edge => edge.type === 'DISCUSSED_IN' && edge.from === 'file:core/a.js').map(edge => edge.to);

const STORES = {
    memory: () => createGraphRepository({ store: createMemoryRepositoryStore() }),
    ladybug: () => createGraphRepository({ databasePath: path.join(root, '.memory', 'graph.lbdb') })
};

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe.each(Object.keys(STORES))('discussions survive a file disappearing and coming back (%s)', (store) => {
    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-relink-'));
        fs.mkdirSync(path.join(root, 'core'));
        repository = STORES[store]();
        sync = createGraphSync({ root, repository, settings: SETTINGS });
    });

    it('keeps the discussion and restores DISCUSSED_IN after the file returns', async () => {
        const file = path.join(root, 'core', 'a.js');
        fs.writeFileSync(file, 'export const a = 1;\n');
        await sync.sync();
        await saveDiscussion({ key: 'why-a', question: 'Why a?', sources: ['core/a.js'], repository });
        expect(await discussedIn()).toEqual(['discussion:why-a']);

        fs.rmSync(file);
        await sync.sync();
        const mid = await repository.loadGraph({ scopes: ['project', 'session:default'] });
        expect(mid.nodes.some(node => node.id === 'discussion:why-a')).toBe(true);

        fs.writeFileSync(file, 'export const a = 1;\n');
        await sync.sync();
        expect(await discussedIn()).toEqual(['discussion:why-a']);
    });
});
