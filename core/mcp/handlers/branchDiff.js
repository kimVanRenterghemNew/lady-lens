import { branchDiff as diffBranches, branchImpact as impactOfBranch, commitShow as showCommit, functionHistory as historyOfFunction } from '../../branches/index.js';
import { REPO_ROOT } from '../../configuration/index.js';

const rootOf = () => process.env.LENS_REPO_ROOT || REPO_ROOT;

/** What `to` changes relative to the merge-base with `from`: files and functions added, removed, modified, renamed. */
export function branchDiff({ from, to } = {}) {
    return diffBranches({ from, to, root: rootOf() });
}

/** What `change` modifies that `against` uses or also modifies: risk list per function, shared files, text conflicts. */
export function branchImpact({ change, against } = {}) {
    return impactOfBranch({ change, against, root: rootOf() });
}

/** Files and functions one commit changed against its first parent. */
export function commitShow({ commit } = {}) {
    return showCommit({ commit, root: rootOf() });
}

/** Commits that added, modified or removed one function of one file. */
export function functionHistory({ name, file, ref, max } = {}) {
    return historyOfFunction({ name, file, ref, max, root: rootOf() });
}
