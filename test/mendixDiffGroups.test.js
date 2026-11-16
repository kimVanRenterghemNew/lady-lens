/**
 * Acceptance tests for multi-folder repo groups and cross-folder branch resolution in mendix_diff (AC 1, 2, 3, 4, 7, 10).
 */
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { mendixDiff } from '../core/mendix/index.js';
import { groupRegisteredRepos, writeRegistry, canonicalRepoPath } from '../core/repository/index.js';
import { createGit } from '../core/git/index.js';
import { mendixRepo, unitId } from './helpers/mendixProject.js';

const hasSqlite = await import('node:sqlite').then(() => true, () => false);
const cleanups = [];
afterAll(() => cleanups.forEach(fn => fn()));

describe('repo groups (AC 1)', () => {
    it('groups registered folders sharing the same root commit with their checked out branch', () => {
        const repos = [
            { id: 'r1', path: '/app/ere', rootCommit: 'c0ffee', branch: 'ere' },
            { id: 'r2', path: '/app/bugfix', rootCommit: 'c0ffee', branch: 'bugfix_59549' },
            { id: 'r3', path: '/other/shop', rootCommit: 'deadbeef', branch: 'main' }
        ];
        const grouped = groupRegisteredRepos(repos);
        expect(grouped).toHaveLength(3);
        expect(grouped.groups).toHaveLength(2);
        const groupCoffee = grouped.groups.find(g => g.id === 'c0ffee');
        expect(groupCoffee.folders).toEqual([
            { id: 'r1', path: '/app/ere', branch: 'ere' },
            { id: 'r2', path: '/app/bugfix', branch: 'bugfix_59549' }
        ]);
        expect(grouped[0].groupFolders).toHaveLength(2);
        expect(grouped[1].groupFolders).toHaveLength(2);
        expect(grouped[2].groupFolders).toHaveLength(1);
    });
});

describe.skipIf(!hasSqlite)('cross-folder mendix_diff resolution (AC 2, 3, 4, 7, 10)', () => {
    it('resolves a branch in another folder of the same group, and supports folder paths directly', async () => {
        const repoA = await mendixRepo({ format: 'mpr-v1' });
        const repoB = await mendixRepo({ format: 'mpr-v1' });
        cleanups.push(() => repoA.remove(), () => repoB.remove());

        const projId = unitId(), modId = unitId(), docId = unitId();
        const baseDoc = [
            { id: projId, doc: { $ID: 'p', $Type: 'Projects$Project', Name: 'App' } },
            { id: modId, container: projId, doc: { $ID: 'm', $Type: 'Projects$ModuleImpl', Name: 'Core' } },
            { id: docId, container: modId, doc: { $ID: 'e1', $Type: 'DomainModels$Entity', Name: 'Product' } }
        ];
        repoA.commit(baseDoc, 'base commit', 'ere');
        const rootCommit = createGit({ root: repoA.root }).rootCommit();

        const branchDoc = [
            ...baseDoc.slice(0, 2),
            { id: docId, container: modId, doc: { $ID: 'e1', $Type: 'DomainModels$Entity', Name: 'ProductUpdated' } }
        ];
        repoB.commit(branchDoc, 'updated commit', 'bugfix');

        const regFile = path.join(os.tmpdir(), `lens-reg-test-${Date.now()}.json`);
        cleanups.push(() => fs.rmSync(regFile, { force: true }));
        writeRegistry({
            repos: {
                ere: { id: 'ere', path: repoA.root, rootCommit, branch: 'ere' },
                fix: { id: 'fix', path: repoB.root, rootCommit, branch: 'bugfix' }
            }
        }, regFile);

        const resBranch = await mendixDiff({ from: 'ere', to: 'bugfix', root: repoB.root, registryFile: regFile });
        expect(resBranch.error).toBeUndefined();
        expect(resBranch).toMatchObject({
            schemaVersion: 1,
            resolved: {
                from: { folder: canonicalRepoPath(repoA.root), branch: 'ere' },
                to: { folder: canonicalRepoPath(repoB.root), branch: 'bugfix' }
            }
        });
        expect(resBranch.documents[0].name).toBe('ProductUpdated');

        const resFolder = await mendixDiff({ from: repoA.root, to: 'bugfix', root: repoB.root, registryFile: regFile });
        expect(resFolder.resolved.from.folder).toBe(canonicalRepoPath(repoA.root));

        const resMissing = await mendixDiff({ from: 'ere-unknown', to: 'bugfix', root: repoB.root, registryFile: regFile });
        expect(resMissing.error).toMatch(/branch "ere-unknown" not found in group folders/i);
        expect(resMissing.error).toMatch(/lens add <map>/i);
    });

    it('to: working-tree reads uncommitted changes from disk .mpr', async () => {
        const repo = await mendixRepo({ format: 'mpr-v1' });
        cleanups.push(() => repo.remove());
        const projId = unitId(), modId = unitId(), docId = unitId();
        const baseDoc = [
            { id: projId, doc: { $ID: 'p', $Type: 'Projects$Project', Name: 'App' } },
            { id: modId, container: projId, doc: { $ID: 'm', $Type: 'Projects$ModuleImpl', Name: 'Sales' } },
            { id: docId, container: modId, doc: { $ID: 'e1', $Type: 'DomainModels$Entity', Name: 'Order' } }
        ];
        repo.commit(baseDoc, 'initial commit');

        const updatedDoc = [
            ...baseDoc.slice(0, 2),
            { id: docId, container: modId, doc: { $ID: 'e1', $Type: 'DomainModels$Entity', Name: 'OrderDirty' } }
        ];
        repo.writeWorkingTree(updatedDoc);

        const diff = await mendixDiff({ from: 'main', to: 'working-tree', root: repo.root });
        expect(diff).toMatchObject({ schemaVersion: 1, to: 'working-tree' });
        expect(diff.documents.find(d => d.name === 'OrderDirty')).toBeDefined();

        const repoV2 = await mendixRepo({ format: 'mpr-v2' });
        cleanups.push(() => repoV2.remove());
        repoV2.commit(baseDoc, 'initial v2');
        repoV2.writeWorkingTree(updatedDoc);
        const diffV2 = await mendixDiff({ from: 'main', to: 'working-tree', root: repoV2.root });
        expect(diffV2).toMatchObject({ schemaVersion: 1, to: 'working-tree' });
    });

    it('dubious ownership errors fail upfront before reading any files', async () => {
        const git = {
            resolveCommit: () => {
                throw Object.assign(new Error('fatal: detected dubious ownership in repository'), { code: 'GIT_UNSAFE_REPOSITORY' });
            }
        };
        await expect(mendixDiff({ from: 'main', to: 'feature', git })).rejects.toThrow(/dubious ownership/);
    });

    it('covers resolveRefTarget edge cases and non-git helpers', async () => {
        const { resolveRefTarget, rootCommitOf, originUrlOf, groupRegisteredRepos } = await import('../core/repository/index.js');
        expect(resolveRefTarget()).toEqual({ error: 'ref is required' });
        expect(rootCommitOf('/nonexistent-dir')).toBeNull();
        expect(originUrlOf('/nonexistent-dir')).toBeNull();

        const r1 = { id: 'r1', originUrl: 'https://github.com/test/repo.git' };
        const r2 = { id: 'r2', path: '.' };
        const r3 = { id: 'r3' };
        const grouped = groupRegisteredRepos([r1, r2, r3]);
        expect(grouped).toHaveLength(3);

        const fakeGit = {
            resolveCommit: ref => (ref === 'origin/feat' ? 'c1' : ref === 'HEAD' ? 'h1' : null),
            worktreeChanges: () => [{ status: 'M', path: 'file.txt' }]
        };
        const originTarget = resolveRefTarget({ ref: 'feat', root: '.', git: fakeGit });
        expect(originTarget.commit).toBe('c1');

        const wtTarget = resolveRefTarget({ ref: 'worktree', root: '.', git: fakeGit });
        expect(wtTarget.dirty).toBe(true);

        resolveRefTarget({ ref: 'package.json', root: '.', git: fakeGit });
    });
});
