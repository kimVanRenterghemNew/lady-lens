/**
 * Repository groups and branch/folder resolution for multi-folder Mendix repos.
 * @module core/repository/groups
 */
import fs from 'fs';
import { canonicalRepoPath, currentGitBranch, readRegistry, samePath } from './registry.js';
import { createGit } from '../git/index.js';

export function rootCommitOf(dir) {
    try {
        return createGit({ root: dir }).rootCommit();
    } catch {
        return null;
    }
}

export function originUrlOf(dir) {
    try {
        return createGit({ root: dir }).originUrl();
    } catch {
        return null;
    }
}

function diskKeyOf(p) {
    return p ? (rootCommitOf(p) || originUrlOf(p)) : null;
}

function repoKeyOf(repo) {
    return repo.rootCommit || repo.originUrl || diskKeyOf(repo.path) || repo.id;
}

function addRepoToGroup(groupMap, repo) {
    const key = repoKeyOf(repo);
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key).push({ id: repo.id, path: repo.path, branch: repo.branch || currentGitBranch(repo.path) || null });
}

function enrichRepoWithGroup(repo, groupMap) {
    const key = repoKeyOf(repo);
    const fallback = [{ id: repo.id, path: repo.path, branch: repo.branch || null }];
    return {
        ...repo,
        branch: repo.branch || currentGitBranch(repo.path) || null,
        groupId: key,
        groupFolders: groupMap.get(key) || fallback
    };
}

export function groupRegisteredRepos(repos = []) {
    const groupMap = new Map();
    for (const repo of repos) addRepoToGroup(groupMap, repo);
    const result = repos.map(repo => enrichRepoWithGroup(repo, groupMap));
    result.groups = [...groupMap.entries()].map(([id, folders]) => ({ id, folders }));
    return result;
}

const isDirectory = (pathStr) => { try { return fs.statSync(pathStr).isDirectory(); } catch { return false; } };

function isDirty(git) {
    const changes = git.worktreeChanges?.();
    return Boolean(changes && changes.length);
}

function resolveDiskFolder({ ref }) {
    if (!fs.existsSync(ref)) return null;
    if (!isDirectory(ref)) return null;
    const folder = canonicalRepoPath(ref);
    const git = createGit({ root: folder });
    const commit = git.resolveCommit('HEAD') || 'unknown';
    return { ref, folder, branch: currentGitBranch(folder), commit, dirty: isDirty(git), isFolder: true, isWorktree: true };
}

function resolveWorkingTree({ ref, root, git }) {
    if (ref !== 'working-tree' && ref !== 'worktree') return null;
    const folder = canonicalRepoPath(root);
    const commit = git.resolveCommit('HEAD') || 'working-tree';
    return { ref, folder, branch: currentGitBranch(folder), commit, dirty: isDirty(git), isWorktree: true };
}

function matchFolderBranch(ref, f) {
    if (f.branch !== ref) return null;
    const folder = canonicalRepoPath(f.path);
    const git = createGit({ root: folder });
    const commit = git.resolveCommit('HEAD') || 'unknown';
    return { ref, folder, branch: ref, commit, dirty: isDirty(git), isFolder: true, isWorktree: true };
}

function matchFolderCommit(ref, f) {
    try {
        const folder = canonicalRepoPath(f.path);
        const git = createGit({ root: folder });
        const commit = git.resolveCommit(ref);
        if (commit) return { ref, folder, branch: currentGitBranch(folder) || ref, commit, dirty: false, isFolder: true };
    } catch { /* ignore */ }
    return null;
}

function findInOtherFolders(ref, otherFolders) {
    for (const f of otherFolders) {
        const branchMatch = matchFolderBranch(ref, f);
        if (branchMatch) return branchMatch;
        const commitMatch = matchFolderCommit(ref, f);
        if (commitMatch) return commitMatch;
    }
    return null;
}

function checkRootCommit({ ref, root, git }) {
    const inRoot = git.resolveCommit(ref);
    if (!inRoot) return null;
    const isCurrent = currentGitBranch(root) === ref;
    const dirty = isCurrent ? isDirty(git) : false;
    return { ref, folder: canonicalRepoPath(root), branch: isCurrent ? ref : currentGitBranch(root), commit: inRoot, dirty };
}

function checkOriginRef({ ref, root, git }) {
    const originRef = `origin/${ref}`;
    const commit = git.resolveCommit(originRef);
    return commit ? { ref: originRef, folder: canonicalRepoPath(root), branch: ref, commit, dirty: false } : null;
}

function getOtherGroupFolders(root, registryFile) {
    const repos = Object.values(readRegistry(registryFile).repos || {});
    const thisRepo = groupRegisteredRepos(repos).find(r => samePath(r.path, root));
    const folders = thisRepo?.groupFolders || [];
    return { groupFolders: folders, otherFolders: folders.filter(f => !samePath(f.path, root)) };
}

function checkGroupFolders({ ref, root, registryFile }) {
    const { otherFolders } = getOtherGroupFolders(root, registryFile);
    return findInOtherFolders(ref, otherFolders);
}

function notFoundError({ ref, root, registryFile }) {
    const { groupFolders } = getOtherGroupFolders(root, registryFile);
    const list = groupFolders.length ? groupFolders.map(f => `${f.path} (${f.branch || 'unknown'})`).join(', ') : `${canonicalRepoPath(root)} (${currentGitBranch(root) || 'unknown'})`;
    return { error: `branch "${ref}" not found in group folders: ${list}. Register the folder with "${ref}" with "lens add <map>", or pass from: "<map>"` };
}

const RESOLVERS = [
    resolveDiskFolder,
    resolveWorkingTree,
    checkRootCommit,
    checkGroupFolders,
    checkOriginRef
];

function getFullOpts(opts) {
    const git = opts.git || createGit({ root: opts.root });
    return { ...opts, git };
}

export function resolveRefTarget(opts) {
    if (!opts || !opts.ref) return { error: 'ref is required' };
    const fullOpts = getFullOpts(opts);
    for (const resolver of RESOLVERS) {
        const found = resolver(fullOpts);
        if (found) return found;
    }
    return notFoundError(fullOpts);
}
