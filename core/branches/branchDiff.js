/**
 * Difference between two branches without checking either out: files from `git diff --name-status`, functions (added,
 * removed, modified, renamed) and changed import and call relations by parsing each file at the merge-base and at `to`.
 * Unchanged functions are not listed.
 */
import { createGit } from '../git/index.js';
import { isCodeFile } from '../graph/index.js';
import { compareFiles } from './compare.js';

export { compareFunctions } from './compare.js';

const STATUS_NAMES = { A: 'added', D: 'removed', M: 'modified', R: 'renamed' };

export function branchDiff({ from, to, root = process.cwd(), git = createGit({ root }), onlyFiles = null } = {}) {
    if (!from || !to) return { error: 'from and to are required' };
    for (const ref of [from, to]) if (!git.resolveCommit(ref)) return { error: `unknown branch or commit: ${ref}` };
    const base = git.mergeBase(from, to);
    if (!base) return { error: `no common history between ${from} and ${to}` };

    const files = git.diffNameStatus(base, to);
    const entries = [];
    for (const file of files) {
        if (!isCodeFile(file.path) && !isCodeFile(file.oldPath || file.path)) continue;
        if (onlyFiles && !onlyFiles.has(file.path) && !onlyFiles.has(file.oldPath)) continue;
        entries.push({
            file,
            beforeSource: file.status === 'A' ? null : git.readBlob(base, file.oldPath || file.path),
            afterSource: file.status === 'D' ? null : git.readBlob(to, file.path)
        });
    }
    const { functions, relations } = compareFiles(entries);
    return {
        from, to, mergeBase: base.slice(0, 7),
        commits: git.logRange(base, to),
        files: files.map(file => ({ ...file, status: STATUS_NAMES[file.status] || file.status })),
        functions, relations
    };
}
