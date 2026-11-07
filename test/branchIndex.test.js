import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { createGraphSync, createGraphRepository, createMemoryRepositoryStore, indexBranch } from '../core/graph/index.js';
import { createGit } from '../core/git/index.js';

const SETTINGS = { project: { graph_roots: ['.'], exclude_dirs: ['.git', '.memory'], graph_extensions: ['.js'] }, graph: { ast: { enabled: false } } };
let root;
let other;
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(other || root, { recursive: true, force: true }); other = null; });

const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root, encoding: 'utf8', stdio: 'pipe' });
const write = (name, text) => { fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); fs.writeFileSync(path.join(root, name), text); };
const commit = message => { git('add', '-A'); git('commit', '-qm', message); };

/** Nodes and relations of a scope, without the scope prefix of the ids. */
async function snapshot(repository, scope) {
    const graph = await repository.loadGraph({ scopes: [scope] });
    const strip = id => id.replace(/^[^|]*\|/, '');
    return {
        files: graph.nodes.filter(node => node.path).map(node => strip(node.id)).sort(),
        edges: graph.edges.map(edge => `${strip(edge.from)} ${edge.type} ${strip(edge.to)}`).sort()
    };
}

async function scanOfCheckout(branch) {
    other = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-branchscan-'));
    git('worktree', 'add', '-q', '--detach', other, branch);
    const repository = createGraphRepository({ store: createMemoryRepositoryStore() });
    await createGraphSync({ root: other, repository, settings: SETTINGS }).syncFiles({ mode: 'full' });
    return snapshot(repository, 'project');
}

describe('index a branch without checkout', () => {
    it('fills only branch:<name>, leaves the working copy alone, and equals a scan of that branch (J9)', async () => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-branchindex-'));
        git('init', '-q', '-b', 'main');
        write('a.js', 'import { b } from "./b.js";\nexport const a = b;\n');
        write('b.js', 'export const b = 1;\n');
        write('package.json', '{ "name": "x", "main": "a.js" }\n');
        commit('base');
        git('checkout', '-qb', 'feature-x');
        write('c.js', 'import { a } from "./a.js";\nexport const c = a;\n');
        fs.rmSync(path.join(root, 'b.js'));
        write('a.js', 'export const a = 2;\n');
        commit('feature');
        git('checkout', '-q', 'main');

        const repository = createGraphRepository({ store: createMemoryRepositoryStore() });
        const headBefore = git('rev-parse', 'HEAD');
        const result = await indexBranch({ repository, git: createGit({ root }), branch: 'feature-x', settings: SETTINGS });

        expect(result).toMatchObject({ scope: 'branch:feature-x', mode: 'full', added: 2, removed: 0 });
        expect(git('status', '--porcelain')).toBe('');
        expect(git('rev-parse', 'HEAD')).toBe(headBefore);
        expect((await repository.stats()).scopes).toEqual({ 'branch:feature-x': expect.any(Number) });
        expect(await snapshot(repository, 'branch:feature-x')).toEqual(await scanOfCheckout('feature-x'));
    });

    it('re-reads only what changed the second time', async () => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-branchindex-'));
        git('init', '-q', '-b', 'main');
        write('a.js', 'export const a = 1;\n');
        write('b.js', 'export const b = 1;\n');
        commit('base');
        const repository = createGraphRepository({ store: createMemoryRepositoryStore() });
        const lens = createGit({ root });
        await indexBranch({ repository, git: lens, branch: 'main', settings: SETTINGS });
        expect(await indexBranch({ repository, git: lens, branch: 'main', settings: SETTINGS })).toMatchObject({ wrote: false, added: 0 });

        write('a.js', 'export const a = 2;\n');
        write('d.js', 'export const d = 1;\n');
        fs.rmSync(path.join(root, 'b.js'));
        commit('change');
        const second = await indexBranch({ repository, git: lens, branch: 'main', settings: SETTINGS });
        expect(second).toMatchObject({ mode: 'incremental', added: 1, updated: 1, removed: 1 });
        expect(await snapshot(repository, 'branch:main')).toEqual(await scanOfCheckout('main'));
    });

    it('refuses an unknown branch', async () => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-branchindex-'));
        git('init', '-q', '-b', 'main');
        write('a.js', 'export const a = 1;\n');
        commit('base');
        await expect(indexBranch({ repository: createGraphRepository({ store: createMemoryRepositoryStore() }), git: createGit({ root }), branch: 'nope', settings: SETTINGS })).rejects.toThrow(/Onbekende branch/);
    });
});
