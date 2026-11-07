/**
 * What one commit changed, without checking anything out: files and functions against its first parent
 * (for a merge commit that is what the merge brought in). A root commit lists its files only.
 */
import { createGit } from '../git/index.js';
import { branchDiff } from './branchDiff.js';

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const STATUS_NAMES = { A: 'added', D: 'removed', M: 'modified', R: 'renamed' };

export function commitShow({ commit, root = process.cwd(), git = createGit({ root }) } = {}) {
    if (!commit) return { error: 'commit is required' };
    const info = git.commitInfo(commit);
    if (!info) return { error: `unknown commit: ${commit}` };
    const header = { sha: info.sha.slice(0, 7), date: info.date, author: info.author, subject: info.subject, parents: info.parents.map(sha => sha.slice(0, 7)) };
    if (!info.parents.length) {
        const files = git.diffNameStatus(EMPTY_TREE, info.sha).map(file => ({ ...file, status: STATUS_NAMES[file.status] || file.status }));
        return { commit: header, files, functions: [] };
    }
    const { files, functions, error } = branchDiff({ from: info.parents[0], to: info.sha, git });
    return error ? { error } : { commit: header, files, functions };
}
