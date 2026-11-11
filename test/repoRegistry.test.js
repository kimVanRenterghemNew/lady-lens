import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
    registerRepo,
    unregisterRepo,
    listRegisteredRepos,
    resolveRepoTarget,
    idOfRepo,
    currentGitBranch
} from '../core/repository/index.js';

describe('repository registry', () => {
    it('registers, lists and unregisters repositories', () => {
        const tmpDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'lens-reg-test-'))); // the long path (os.tmpdir() can be 8.3)
        const regFile = path.join(tmpDir, 'repos.json');

        const repoA = path.join(tmpDir, 'repoA');
        fs.mkdirSync(repoA, { recursive: true });

        const entryA = registerRepo(repoA, { extra: 'info' }, regFile);
        expect(entryA.id).toBe(idOfRepo(repoA));
        expect(entryA.path).toBe(repoA);
        expect(entryA.database).toContain(entryA.id);

        const list = listRegisteredRepos(regFile);
        expect(list.length).toBe(1);
        expect(list[0].id).toBe(entryA.id);

        const resolved = resolveRepoTarget(entryA.id, regFile);
        expect(resolved.path).toBe(repoA);

        // Story 23.14: Multiple checkouts sharing one database
        const repoB = path.join(tmpDir, 'repoB');
        fs.mkdirSync(repoB, { recursive: true });
        const entryB = registerRepo(repoB, { db: entryA.id }, regFile);
        expect(entryB.database).toBe(entryA.database);

        const resolvedB = resolveRepoTarget(entryB.id, regFile);
        expect(resolvedB.database).toBe(entryA.database);

        const removed = unregisterRepo(entryA.id, regFile);
        expect(removed.id).toBe(entryA.id);
        expect(listRegisteredRepos(regFile).length).toBe(1); // repoB remains

        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('detects git branch from .git/HEAD', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-git-test-'));
        const gitDir = path.join(tmpDir, '.git');
        fs.mkdirSync(gitDir, { recursive: true });
        fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/feature-branch\n', 'utf8');

        expect(currentGitBranch(tmpDir)).toBe('feature-branch');

        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    // Kura (2026-11-11): `lens add` from the 8.3 short path (KIM~1.VAN) and `lens sync` from the long path made two repos
    it('a Windows 8.3 short path and the long path of one folder are the same repo', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-reg-short-'));
        const regFile = path.join(tmpDir, 'repos.json');
        const repo = path.join(tmpDir, 'repo');
        fs.mkdirSync(repo);
        const long = fs.realpathSync.native(repo);
        try {
            if (!repo.includes('~')) return; // no 8.3 name in the temp folder (Linux, macOS, 8.3 names off): nothing to compare
            expect(idOfRepo(repo)).toBe(idOfRepo(long));
            registerRepo(repo, {}, regFile);
            registerRepo(long, {}, regFile);
            expect(listRegisteredRepos(regFile).map(entry => entry.path)).toEqual([long]);
            expect(resolveRepoTarget(repo, regFile).path).toBe(long);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});
