/**
 * Records where the project graph was synced: a `Commit` node (`commit:<sha>`), a `Branch` node (`branch:<name>`) and
 * one `Branch -HEAD_AT-> Commit` relation per branch. The nodes have no `path`, so the file sync never removes or
 * re-indexes them. Outside a git repository nothing is recorded.
 */
import { PROJECT_SCOPE } from '../model/index.js';

export const commitNodeId = sha => `commit:${sha}`;
export const branchNodeId = name => `branch:${name}`;

/**
 * `{ sha, branch, commit, previous, commitsSince }`, or null without git. `previous` is the commit of the last sync on this
 * branch. Nothing is written when the file sync wrote nothing and HEAD did not move (a sync that changes nothing stays cheap).
 */
export async function recordHead({ repository, git, wrote = true, now = new Date().toISOString() }) {
    const head = git?.headInfo();
    const branch = head && git.currentBranch();
    if (!head || !branch || branch === 'HEAD') return null;

    const branches = await repository.loadNodes({ types: ['Branch'], scopes: [PROJECT_SCOPE] });
    const previous = branches.find(node => node.id === branchNodeId(branch))?.metadata?.head || null;
    const commitsSince = previous && git.resolveCommit(previous) ? git.countRange(previous, head.sha) : null;
    const result = { sha: head.sha, branch, commit: head.sha.slice(0, 7), previous: previous ? previous.slice(0, 7) : null, commitsSince };
    if (!wrote && previous === head.sha) return result;

    const base = { scope: PROJECT_SCOPE, path: '', contentHash: '', createdAt: now, updatedAt: now, observedAt: now };
    const current = { ...base, id: branchNodeId(branch), type: 'Branch', kind: 'branch', name: branch, metadata: { head: head.sha } };
    await repository.upsertNodes(PROJECT_SCOPE, [
        { ...base, id: commitNodeId(head.sha), type: 'Commit', kind: 'commit', name: head.sha.slice(0, 7), documentation: head.message, metadata: { sha: head.sha, date: head.date, message: head.message, branch } },
        current
    ]);
    // a project write replaces every relation between project nodes, so the HEAD_AT of the other branches is restored from their `head`
    const others = branches.filter(node => node.id !== current.id && node.metadata?.head);
    await repository.relate([current, ...others].map(node => ({ from: node.id, to: commitNodeId(node.metadata.head), type: 'HEAD_AT', confidence: 'EXTRACTED', weight: 1 })), { replaceFrom: [current.id, ...others.map(node => node.id)] });
    return result;
}
