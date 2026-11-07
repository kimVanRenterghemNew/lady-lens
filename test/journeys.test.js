import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { createGraphSync, createGraphRepository, createMemoryRepositoryStore } from '../core/graph/index.js';
import { createGit } from '../core/git/index.js';
import { handleDiscussionSave, handleDiscussionQuery } from '../core/discussions/index.js';

const SETTINGS = { project: { graph_roots: ['.'], exclude_dirs: ['.git', '.memory'], graph_extensions: ['.js'] }, graph: { ast: { enabled: false } } };
const roots = [];
afterEach(() => { for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

const makeRepo = (branch = 'main') => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-journey-'));
    roots.push(root);
    const run = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root, encoding: 'utf8', stdio: 'pipe' });
    run('init', '-q', '-b', branch);
    const commit = (name, text, message) => { fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); fs.writeFileSync(path.join(root, name), text); run('add', '-A'); run('commit', '-qm', message); };
    return { root, run, commit, git: createGit({ root }), repository: createGraphRepository({ store: createMemoryRepositoryStore() }) };
};
const fileIds = async repository => (await repository.loadGraph({ scopes: ['project'] })).nodes.filter(node => node.path).map(node => node.path);
const discussedIn = async repository => (await repository.loadGraph({ scopes: ['project', 'session:default'] })).edges.filter(edge => edge.type === 'DISCUSSED_IN').map(edge => `${edge.from}>${edge.to}`);

describe('journeys', () => {
    it('J1: one discussion, two branches', async () => {
        const { root, run, commit, git, repository } = makeRepo();
        commit('base.js', 'export const base = 1;\n', 'base');
        run('checkout', '-qb', 'feature');
        commit('core/a.js', 'export const a = 1;\n', 'add a');
        const sync = createGraphSync({ root, repository, settings: SETTINGS, git });
        await sync.sync();
        await handleDiscussionSave({ key: 'why-a', question: 'Why a?', sources: ['core/a.js'], repository }, { git });
        expect(await discussedIn(repository)).toEqual(['file:core/a.js>discussion:why-a']);

        run('checkout', '-q', 'main');
        await sync.sync();
        expect(await fileIds(repository)).not.toContain('core/a.js');
        const { discussions } = await handleDiscussionQuery({ topic: 'why' }, { repository, git, root });
        expect(discussions).toHaveLength(1);
        expect(discussions[0].sourceStatus).toEqual([expect.objectContaining({ path: 'core/a.js', onThisBranch: false, note: 'niet op deze branch' })]);

        run('checkout', '-q', 'feature');
        await sync.sync();
        expect(await discussedIn(repository)).toEqual(['file:core/a.js>discussion:why-a']);
    });

    it('J8: a sync of repository A leaves the branch and commit of repository B alone', async () => {
        const a = makeRepo('alpha');
        const b = makeRepo('beta');
        a.commit('a.js', 'export const a = 1;\n', 'a1');
        b.commit('b.js', 'export const b = 1;\n', 'b1');
        const syncA = createGraphSync({ root: a.root, repository: a.repository, settings: SETTINGS, git: a.git });
        const syncB = createGraphSync({ root: b.root, repository: b.repository, settings: SETTINGS, git: b.git });
        await syncB.sync();
        const before = (await b.repository.loadGraph({ scopes: ['project'] })).edges.filter(edge => edge.type === 'HEAD_AT');
        a.commit('a2.js', 'export const a2 = 1;\n', 'a2');
        await syncA.sync();
        const after = (await b.repository.loadGraph({ scopes: ['project'] })).edges.filter(edge => edge.type === 'HEAD_AT');
        expect(after).toEqual(before);
        expect(after.map(edge => edge.from)).toEqual(['branch:beta']);
        expect((await a.repository.loadGraph({ scopes: ['project'] })).edges.filter(edge => edge.type === 'HEAD_AT').map(edge => edge.from)).toEqual(['branch:alpha']);
    });
});
