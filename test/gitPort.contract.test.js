/**
 * One contract, two implementations: the same calls on a real repository (`createGit`) and on `createFakeGit` must give
 * the same answers, with every commit hash replaced by its scenario name. Without this the fake could drift from git.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { createGit, createFakeGit, fakeSha } from '../core/git/index.js';
import { SCENARIO, buildRealRepo } from './helpers/gitScenario.js';

const byPath = list => [...list].sort((a, b) => a.path.localeCompare(b.path));

const calls = git => ({
    currentBranch: git.currentBranch(),
    resolve: ['main', 'feature', 'HEAD', 'main~1', 'nope'].map(ref => git.resolveCommit(ref)),
    mergeBase: [git.mergeBase('main', 'feature'), git.mergeBase('feature', 'main'), git.mergeBase('main', 'nope')],
    diff: [byPath(git.diffNameStatus('main~2', 'main~1')), byPath(git.diffNameStatus('feature', 'main'))],
    readBlob: [git.readBlob('main', 'a.js'), git.readBlob('main', 'zzz.js'), git.readBlob('feature', 'c.js'), git.readBlob('nope', 'a.js')],
    readBlobBytes: [git.readBlobBytes('main', 'a.js')?.toString('utf8'), git.readBlobBytes('main', 'zzz.js'), git.readBlobBytes('nope', 'a.js')],
    commitList: [git.commitList('feature', 'main'), git.commitList('main', 'feature', { max: 1 }), git.commitList('main', 'nope')],
    logRange: [git.logRange('feature', 'main'), git.logRange('main', 'feature'), git.logRange('main', 'feature', { max: 1 }), git.logRange('main', 'nope')],
    countRange: [git.countRange('feature', 'main'), git.countRange('main', 'feature'), git.countRange('main', 'nope')],
    headInfo: git.headInfo(),
    commitInfo: [git.commitInfo('main'), git.commitInfo('f1'), git.commitInfo('nope')],
    fileLog: [git.fileLog('main', 'a.js'), git.fileLog('feature', 'c.js'), git.fileLog('main', 'nope.js'), git.fileLog('main', 'a.js', { max: 1 })],
    commitFiles: [git.commitFiles(), git.commitFiles(2)],
    branches: git.listBranches(),
    tree: [git.listTree('main'), git.listTree('feature'), git.listTree('nope')],
    blobs: [...git.readBlobs('feature', ['a.js', 'c.js', 'nope.js'])],
    existsAt: [git.existsAt('main', 'new.js'), git.existsAt('main', 'old.js'), git.existsAt('nope', 'a.js')],
    prefix: git.prefix(),
    changedSince: [git.changedSince('main~2', 'main'), git.changedSince('feature', 'main'), git.changedSince('main', 'nope')],
    grep: [git.grepRef('feature', 'f'), git.grepRef('feature', 'f', { max: 1 }), git.grepRef('main', 'nothing-here')],
    grepRefs: [...git.grepRefs('feature', ['f', 'nothing-here', 'g'])], grepRefsMax: [...git.grepRefs('feature', ['f'], { max: 1 })],
    blobsFromTop: [...git.readBlobs('feature', ['a.js', 'nope.js'], { fromTop: true })],
    lastCommitFor: [git.lastCommitFor('main~3', 'main', 'a.js'), git.lastCommitFor('main~3', 'main', 'docs/readme.md'), git.lastCommitFor('main', 'nope', 'a.js')],
    conflicts: [git.conflicts('main', 'feature'), git.conflicts('c3', 'feature'), git.conflicts('main', 'nope')]
});

/** JSON with every known commit hash (full or 7 characters) replaced by its scenario name. */
function named(value, shas) {
    return JSON.parse(JSON.stringify(value, (key, item) => (item instanceof Map ? [...item] : item)).replace(/\b[0-9a-f]{7,40}\b/g, token => {
        const found = [...shas].find(([, sha]) => sha.startsWith(token));
        return found ? `<${found[0]}>` : token;
    }));
}

describe('git port contract', () => {
    let root; let shas;
    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-gitcontract-'));
        shas = buildRealRepo(root, SCENARIO);
    });
    afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

    it('the fake has exactly the functions of the real port', () => {
        expect(Object.keys(createFakeGit(SCENARIO)).sort()).toEqual(Object.keys(createGit({ root })).sort());
    });

    it('answers every call like real git, commit hashes aside', () => {
        const fakeShas = new Map(SCENARIO.commits.map(commit => [commit.name, fakeSha(commit.name)]));
        const real = named(calls(createGit({ root })), shas);
        const fake = named(calls(createFakeGit(SCENARIO)), fakeShas);
        expect(fake).toEqual(real);
        expect(real.mergeBase[0]).toBe('<c2>');
        expect(real.conflicts[0]).toEqual(['a.js']);
    });

    it('throws for a diff of an unknown revision, like git', () => {
        expect(() => createGit({ root }).diffNameStatus('nope', 'main')).toThrow();
        expect(() => createFakeGit(SCENARIO).diffNameStatus('nope', 'main')).toThrow();
    });

    it('lists the work not committed yet like git: edited, added (untracked) and deleted files', () => {
        expect(createGit({ root }).worktreeChanges()).toEqual([]);
        const worktree = { 'a.js': 'export function f() {\n  return 5;\n}\n', 'n.js': 'export const n = 1;\n', 'b.js': null };
        try {
            for (const [file, text] of Object.entries(worktree)) { if (text == null) fs.rmSync(path.join(root, file)); else fs.writeFileSync(path.join(root, file), text); }
            expect(createFakeGit({ ...SCENARIO, worktree }).worktreeChanges()).toEqual(createGit({ root }).worktreeChanges());
            expect(createGit({ root }).worktreeChanges().map(change => change.status + change.path)).toEqual(['Ma.js', 'Db.js', 'An.js']);
        } finally { execFileSync('git', ['checkout', '--', '.'], { cwd: root }); fs.rmSync(path.join(root, 'n.js'), { force: true }); }
    });

    it('lists what .gitignore leaves out like git: a folder with a trailing slash, a file by its path', () => {
        try {
            fs.writeFileSync(path.join(root, '.gitignore'), 'build/\n*.log\n');
            fs.mkdirSync(path.join(root, 'build'), { recursive: true });
            fs.writeFileSync(path.join(root, 'build', 'out.js'), 'x');
            fs.writeFileSync(path.join(root, 'run.log'), 'x');
            const real = createGit({ root }).ignoredPaths();
            expect(real).toEqual(['build/', 'run.log']);
            expect(createFakeGit({ ...SCENARIO, ignored: ['run.log', 'build/'] }).ignoredPaths()).toEqual(real);
        } finally { for (const file of ['.gitignore', 'build', 'run.log']) fs.rmSync(path.join(root, file), { recursive: true, force: true }); }
    });

    it('a folder that is not a repository gives the same empty answers', () => {
        const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-gitcontract-empty-'));
        try {
            const probe = git => [git.currentBranch(), git.resolveCommit('HEAD'), git.headInfo(), git.listBranches(), git.listTree('HEAD'), git.commitFiles(), git.changedSince('a', 'b'),
                git.prefix(), git.grepRef('HEAD', 'x'), [...git.grepRefs('HEAD', ['x'])], git.logRange('a', 'b'), git.countRange('a', 'b'), git.commitInfo('HEAD'), git.fileLog('HEAD', 'a.js'), git.conflicts('a', 'b'),
                git.readBlob('HEAD', 'a.js'), git.existsAt('HEAD', 'a.js'), [...git.readBlobs('HEAD', ['a.js'])], git.lastCommitFor('a', 'b', 'a.js'), git.mergeBase('a', 'b'), git.worktreeChanges(), git.ignoredPaths()];
            expect(probe(createFakeGit(null))).toEqual(probe(createGit({ root: empty })));
        } finally { fs.rmSync(empty, { recursive: true, force: true }); }
    });
});
