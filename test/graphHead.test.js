import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { createGraphSync, createGraphRepository, createMemoryRepositoryStore } from '../core/graph/index.js';
import { createGit } from '../core/git/index.js';

const SETTINGS = { project: { graph_roots: ['.'], exclude_dirs: ['.git', '.memory'], graph_extensions: ['.js'] }, graph: { ast: { enabled: false } } };
let root;
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root, encoding: 'utf8', stdio: 'pipe' });
const commit = (name, text, message) => { fs.writeFileSync(path.join(root, name), text); git('add', '-A'); git('commit', '-qm', message); };
const edgesOf = async repository => (await repository.loadGraph({ scopes: ['project'] })).edges.filter(edge => edge.type === 'HEAD_AT');

describe('sync records branch and commit', () => {
    it('keeps one HEAD_AT per branch and reports commits since the last sync', async () => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-head-'));
        git('init', '-q', '-b', 'feature-x');
        commit('a.js', 'export const a = 1;\n', 'one');
        const repository = createGraphRepository({ store: createMemoryRepositoryStore() });
        const sync = createGraphSync({ root, repository, settings: SETTINGS, git: createGit({ root }) });

        const first = await sync.sync();
        expect(first).toMatchObject({ branch: 'feature-x', commitsSince: null });
        const sha1 = git('rev-parse', 'HEAD').trim();
        expect(await edgesOf(repository)).toEqual([expect.objectContaining({ from: 'branch:feature-x', to: `commit:${sha1}` })]);

        commit('b.js', 'export const b = 1;\n', 'two');
        commit('a.js', 'export const a = 2;\n', 'three');
        const second = await sync.sync();
        expect(second.commitsSince).toBe(2);
        const sha2 = git('rev-parse', 'HEAD').trim();
        expect(await edgesOf(repository)).toEqual([expect.objectContaining({ to: `commit:${sha2}` })]);

        const files = await repository.projectFiles();
        expect([...files.keys()].sort()).toEqual(['a.js', 'b.js']);
    });

    it('keeps the HEAD_AT of other branches, also after a sync that changes nothing', async () => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-head-'));
        git('init', '-q', '-b', 'main');
        commit('a.js', 'export const a = 1;\n', 'one');
        const repository = createGraphRepository({ store: createMemoryRepositoryStore() });
        const sync = createGraphSync({ root, repository, settings: SETTINGS, git: createGit({ root }) });
        await sync.sync();
        git('checkout', '-qb', 'feature');
        commit('b.js', 'export const b = 1;\n', 'two');
        await sync.sync();
        const again = await sync.sync();
        expect(again).toMatchObject({ wrote: false, branch: 'feature', commitsSince: 0 });
        expect((await edgesOf(repository)).map(edge => edge.from).sort()).toEqual(['branch:feature', 'branch:main']);
    });

    it('sees commits that change no indexed file (empty commit, doc-less change)', async () => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-head-'));
        git('init', '-q', '-b', 'main');
        commit('a.js', 'export const a = 1;\n', 'one');
        const repository = createGraphRepository({ store: createMemoryRepositoryStore() });
        const sync = createGraphSync({ root, repository, settings: SETTINGS, git: createGit({ root }) });
        await sync.sync();
        git('commit', '-q', '--allow-empty', '-m', 'empty one');
        git('commit', '-q', '--allow-empty', '-m', 'empty two');
        const result = await sync.sync();
        expect(result).toMatchObject({ wrote: false, commitsSince: 2 });
        const sha = git('rev-parse', 'HEAD').trim();
        expect(await edgesOf(repository)).toEqual([expect.objectContaining({ from: 'branch:main', to: `commit:${sha}` })]);
        expect((await sync.sync()).commitsSince).toBe(0);
    });

    it('records nothing outside a git repository', async () => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-nohead-'));
        fs.writeFileSync(path.join(root, 'a.js'), 'export const a = 1;\n');
        const repository = createGraphRepository({ store: createMemoryRepositoryStore() });
        const result = await createGraphSync({ root, repository, settings: SETTINGS, git: createGit({ root }) }).sync();
        expect(result.branch).toBeUndefined();
        expect(await edgesOf(repository)).toEqual([]);
    });
});
