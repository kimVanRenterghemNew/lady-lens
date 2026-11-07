import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { createGraphRepository, createMemoryRepositoryStore } from '../core/graph/index.js';
import { createGit } from '../core/git/index.js';
import { handleDiscussionSave, handleDiscussionQuery } from '../core/discussions/index.js';

let root;
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root, encoding: 'utf8', stdio: 'pipe' });

describe('discussion origin', () => {
    it('stores branch and commit, and flags a source missing on another branch', async () => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-origin-'));
        git('init', '-q', '-b', 'main');
        fs.writeFileSync(path.join(root, 'readme.js'), 'export const r = 1;\n');
        git('add', '-A'); git('commit', '-qm', 'base');
        git('checkout', '-qb', 'feature');
        fs.writeFileSync(path.join(root, 'a.js'), 'export const a = 1;\n');
        git('add', '-A'); git('commit', '-qm', 'add a');
        const sha = git('rev-parse', 'HEAD').trim();

        const repository = createGraphRepository({ store: createMemoryRepositoryStore() });
        const port = createGit({ root });
        const saved = await handleDiscussionSave({ key: 'why-a', question: 'Why a?', sources: ['a.js'], repository }, { git: port });
        expect(saved.edges.map(edge => edge.type)).toEqual(expect.arrayContaining(['CREATED_AT', 'ON_BRANCH']));
        const graph = await repository.loadGraph({ scopes: ['project', 'session:default'] });
        expect(graph.edges.filter(edge => edge.from === 'discussion:why-a' && ['CREATED_AT', 'ON_BRANCH'].includes(edge.type)).map(edge => edge.to).sort())
            .toEqual(['branch:feature', `commit:${sha}`]);

        git('checkout', '-q', 'main');
        const { discussions } = await handleDiscussionQuery({ topic: 'why' }, { repository, git: port, root });
        expect(discussions[0]).toMatchObject({ branch: 'feature', commit: sha.slice(0, 7) });
        expect(discussions[0].sourceStatus).toEqual([{ path: 'a.js', onThisBranch: false, otherBranches: ['feature'], note: 'niet op deze branch' }]);
    });

    it('saves without git origin outside a repository', async () => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-origin-none-'));
        const repository = createGraphRepository({ store: createMemoryRepositoryStore() });
        const saved = await handleDiscussionSave({ key: 'k', question: 'Q?', sources: [], repository }, { git: createGit({ root }) });
        expect(saved.edges).toEqual([]);
    });
});
