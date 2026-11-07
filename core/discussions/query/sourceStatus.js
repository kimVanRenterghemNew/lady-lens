/**
 * Where the sources of a discussion stand on the current branch: a source file that is gone from the working copy is
 * "niet op deze branch", with the (local) branches that still have it. No git: only the missing flag.
 */
import fs from 'fs';
import path from 'path';

const sourcePath = source => {
    const raw = typeof source === 'string' ? source : (source?.file || source?.target || source?.id || source?.node);
    return typeof raw === 'string' && !/^(discussion|decision):/.test(raw) ? raw.replace(/^(file|doc):/, '') : null;
};

/** `[{ path, onThisBranch, otherBranches }]` for the file sources of one discussion. */
export function sourceStatuses(discussion, { root, git = null, maxBranches = 20 } = {}) {
    const current = git?.currentBranch();
    const branches = git ? git.listBranches().filter(name => name !== current).slice(0, maxBranches) : [];
    const statuses = [];
    for (const source of discussion.sources || []) {
        const file = sourcePath(source);
        if (!file) continue;
        const onThisBranch = fs.existsSync(path.join(root, file));
        statuses.push({ path: file, onThisBranch, otherBranches: onThisBranch ? [] : branches.filter(name => git.existsAt(name, file)) });
    }
    return statuses;
}

/** Adds `sourceStatus` to each discussion; `branch` and `commit` are already in its metadata (set when saved in a git repo). */
export function withProvenance(discussions, options) {
    return discussions.map(discussion => ({
        ...discussion,
        sourceStatus: sourceStatuses(discussion, options).map(status => (status.onThisBranch ? status : { ...status, note: 'niet op deze branch' }))
    }));
}
