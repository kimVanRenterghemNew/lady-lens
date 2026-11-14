/**
 * A folder git refuses ("dubious ownership", it belongs to another Windows user) is no unknown branch: branch_diff
 * said "unknown branch or commit: main" on such a Mendix checkout, and the agent went looking for another branch.
 */
import { describe, it, expect } from 'vitest';
import { createGit, GIT_UNSAFE_REPOSITORY } from '../core/git/index.js';
import { branchDiff } from '../core/branches/index.js';

const refused = () => {
    throw Object.assign(new Error('Command failed: git rev-parse'), { status: 128, stderr: "fatal: detected dubious ownership in repository at 'C:/Projects/Mendix/shop'\n" });
};

describe('a repository git refuses', () => {
    it('MUST say why and how to fix it, instead of "unknown branch"', () => {
        const git = createGit({ root: 'C:\\Projects\\Mendix\\shop', run: refused });
        expect(() => git.resolveCommit('main')).toThrow(expect.objectContaining({ code: GIT_UNSAFE_REPOSITORY, message: expect.stringContaining('safe.directory "C:/Projects/Mendix/shop"') }));
        expect(() => branchDiff({ from: 'main', to: 'bugfix/1234', git })).toThrow(/dubious ownership/);
    });

    it('still answers null for a ref that does not exist', () => {
        const unknown = () => { throw Object.assign(new Error('Command failed: git rev-parse'), { status: 1, stderr: '' }); };
        expect(createGit({ root: '.', run: unknown }).resolveCommit('nope')).toBeNull();
    });
});

describe('a sync in a repository git refuses', () => {
    it('says why there is no branch, commit or co-change', async () => {
        const { recordHead } = await import('../core/graph/index.js');
        const git = createGit({ root: 'C:/Projects/Mendix/shop', run: refused });
        expect(await recordHead({ repository: {}, git })).toEqual({ warning: expect.stringContaining('dubious ownership') });
        expect(await recordHead({ repository: {}, git: createGit({ root: '.', run: () => { throw Object.assign(new Error('no repo'), { status: 128, stderr: 'fatal: not a git repository' }); } }) })).toBeNull();
    });
});
