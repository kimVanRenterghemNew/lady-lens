import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { branchDiff, branchImpact, commitShow, functionHistory } from '../core/mcp/handlers/branchDiff.js';
import { contributed, configureLensContributors } from '../core/graph/sync/contributors.js';
import { sourceStatuses, withProvenance } from '../core/discussions/query/index.js';

let root;
const previousRoot = process.env.LENS_REPO_ROOT;
afterEach(() => {
    configureLensContributors([]);
    if (previousRoot === undefined) delete process.env.LENS_REPO_ROOT; else process.env.LENS_REPO_ROOT = previousRoot;
    if (root) fs.rmSync(root, { recursive: true, force: true });
    root = null;
});

const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root, encoding: 'utf8', stdio: 'pipe' });
const write = (name, text) => fs.writeFileSync(path.join(root, name), text);

function repoWithFeature() {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-handlers-'));
    git('init', '-q', '-b', 'main');
    write('a.js', 'export function a() { return 1; }\n');
    git('add', '-A'); git('commit', '-qm', 'base');
    git('checkout', '-qb', 'feature');
    write('a.js', 'export function a() { return 2; }\n');
    git('add', '-A'); git('commit', '-qm', 'feature');
    git('checkout', '-q', 'main');
    process.env.LENS_REPO_ROOT = root;
}

describe('branch tools through the MCP handlers', () => {
    it('branchDiff uses the active repository', () => {
        repoWithFeature();
        const result = branchDiff({ from: 'main', to: 'feature' });
        expect(JSON.stringify(result)).toContain('a.js');
    });

    it('branchImpact uses the active repository', () => {
        repoWithFeature();
        expect(branchImpact({ change: 'feature', against: 'main' })).toBeTypeOf('object');
    });

    it('commitShow and functionHistory use the active repository', () => {
        repoWithFeature();
        expect(commitShow({ commit: 'feature' }).commit.subject).toBe('feature');
        expect(functionHistory({ file: 'a.js', ref: 'feature', max: 5 }).commits.map(entry => entry.subject)).toEqual(['feature', 'base']);
        expect(functionHistory({ name: 'a', file: 'a.js' }).commits.map(entry => entry.change)).toEqual(['added']);
    });

    it('accept a call without arguments', () => {
        repoWithFeature();
        expect(() => branchDiff()).not.toThrow();
        expect(() => branchImpact()).not.toThrow();
        expect(commitShow().error).toMatch(/required/);
        expect(functionHistory().error).toMatch(/required/);
    });
});

describe('graph contributors', () => {
    it('adds nodes and relations with defaults, and keeps what the contributor sets itself', async () => {
        configureLensContributors([async () => ({ nodes: [{ id: 'x', type: 'T', metadata: { k: 1 } }], relations: [{ from: 'x', to: 'y', relation: 'R' }] })]);
        const { nodes, relations } = await contributed('.', new Map(), 'now');
        expect(nodes[0]).toMatchObject({ id: 'x', scope: 'project', path: '', metadata: { k: 1 }, createdAt: 'now' });
        expect(relations[0]).toMatchObject({ confidence: 'EXTRACTED', createdAt: 'now' });
    });

    it('accepts a contributor that returns nothing, and skips one that throws', async () => {
        configureLensContributors([async () => undefined, async () => { throw new Error('boom'); }, async () => ({ nodes: [{ id: 'ok', type: 'T' }] })]);
        const { nodes, relations } = await contributed('.', new Map(), 'now');
        expect(nodes.map(node => node.id)).toEqual(['ok']);
        expect(relations).toEqual([]);
    });
});

describe('source status of a discussion', () => {
    const fakeGit = { currentBranch: () => 'main', listBranches: () => ['main', 'feature', 'other'], existsAt: (branch, file) => branch === 'feature' && file === 'gone.js' };

    it('names the other branches that still have a missing file', () => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-status-'));
        write('here.js', '');
        const discussion = { sources: ['file:here.js', { file: 'gone.js' }, { target: 'doc:notes.md' }, { id: 'discussion:1' }, { node: 'decision:2' }, {}, 42] };
        const statuses = sourceStatuses(discussion, { root, git: fakeGit });
        expect(statuses).toEqual([
            { path: 'here.js', onThisBranch: true, otherBranches: [] },
            { path: 'gone.js', onThisBranch: false, otherBranches: ['feature'] },
            { path: 'notes.md', onThisBranch: false, otherBranches: [] }
        ]);
    });

    it('works without git and without sources', () => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-status-'));
        expect(sourceStatuses({ sources: ['gone.js'] }, { root })).toEqual([{ path: 'gone.js', onThisBranch: false, otherBranches: [] }]);
        expect(sourceStatuses({}, { root })).toEqual([]);
    });

    it('limits the branches it checks', () => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-status-'));
        const existsAt = vi.fn(() => true);
        sourceStatuses({ sources: ['gone.js'] }, { root, git: { ...fakeGit, existsAt }, maxBranches: 1 });
        expect(existsAt).toHaveBeenCalledTimes(1);
    });

    it('marks missing sources in withProvenance', () => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-status-'));
        write('here.js', '');
        const [result] = withProvenance([{ id: 1, sources: ['here.js', 'gone.js'] }], { root });
        expect(result.sourceStatus).toEqual([
            { path: 'here.js', onThisBranch: true, otherBranches: [] },
            { path: 'gone.js', onThisBranch: false, otherBranches: [], note: 'niet op deze branch' }
        ]);
    });
});
