/**
 * The history behind CO_CHANGES is kept next to the graph database with its HEAD (backlog/snelheid-en-hooks.md): `git log`
 * over every commit took 1.25 s on 714 commits, after each commit and in every new process. After a commit only the new
 * commits are asked; after a switch to a branch that does not descend from the cached HEAD, the whole log again.
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { commitFilesCached } from '../core/graph/index.js';
import { createFakeGit } from '../core/git/index.js';

const COMMITS = [
    { name: 'c1', parents: [], files: { 'a.js': '1', 'b.js': '1' } },
    { name: 'c2', parents: ['c1'], files: { 'a.js': '2', 'b.js': '2' } },
    { name: 'c3', parents: ['c2'], files: { 'a.js': '3', 'c.js': '1' } },
    { name: 'x1', parents: ['c1'], files: { 'x.js': '1' } }
];
const at = (head, commits = COMMITS) => createFakeGit({ commits, branches: { main: head, other: 'x1' }, head: 'main' });

/** The fake git, with the calls to `commitFiles` recorded. */
function watched(git) {
    const calls = [];
    return { calls, git: { ...git, commitFiles: (max, options) => { calls.push(options?.since ? 'since' : 'full'); return git.commitFiles(max, options); } } };
}

let dir;
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('the history of co-changes between syncs', () => {
    it('asks git once per HEAD, only the new commits after a commit, and everything after a switch to another branch', () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-history-'));
        const file = path.join(dir, 'graph.lbdb.history.json');

        const first = watched(at('c2'));
        expect(commitFilesCached(first.git, 1000, file)).toEqual(at('c2').commitFiles(1000));
        expect(commitFilesCached(first.git, 1000, file)).toEqual(at('c2').commitFiles(1000));
        expect(first.calls).toEqual(['full']);

        const afterCommit = watched(at('c3'));
        expect(commitFilesCached(afterCommit.git, 1000, file)).toEqual(at('c3').commitFiles(1000));
        expect(afterCommit.calls).toEqual(['since']);

        const otherBranch = watched(createFakeGit({ commits: COMMITS, branches: { main: 'c3', other: 'x1' }, head: 'other' }));
        expect(commitFilesCached(otherBranch.git, 1000, file)).toEqual([['x.js'], ['a.js', 'b.js']]);
        expect(otherBranch.calls).toEqual(['full']);
    });

    it('keeps the window at `max` commits, and without a cache file asks git every time', () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-history-'));
        const file = path.join(dir, 'graph.lbdb.history.json');
        commitFilesCached(at('c2'), 2, file);
        expect(commitFilesCached(at('c3'), 2, file)).toEqual(at('c3').commitFiles(2));

        const uncached = watched(at('c3'));
        commitFilesCached(uncached.git, 1000, null);
        commitFilesCached(uncached.git, 1000, null);
        expect(uncached.calls).toEqual(['full', 'full']);
    });
});
