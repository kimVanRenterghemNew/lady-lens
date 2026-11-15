/**
 * What changes together, from git history: files that change in the same commit at least `minCount` times get a
 * CO_CHANGES relation (weight = number of commits). Bulk commits (more than `maxFilesPerCommit` files: moves, formatting)
 * do not count; per file only its `perFile` strongest partners. No git, or git fails: no relations.
 */
import fs from 'fs';
import { fileNodeId } from '../adapters/ladybug/index.js';

function recordPairs(known, pairs) {
    for (let i = 0; i < known.length; i++) {
        for (let j = i + 1; j < known.length; j++) {
            const key = `${known[i]}\u0000${known[j]}`;
            pairs.set(key, (pairs.get(key) || 0) + 1);
        }
    }
}

function processCommitFiles(files, maxFilesPerCommit, knownPaths, pairs) {
    if (files.length > maxFilesPerCommit) return;
    const known = [...new Set(files.filter(file => knownPaths.has(file)))].sort();
    if (known.length >= 2) recordPairs(known, pairs);
}

const readCache = (file) => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
};
const writeCache = (file, history) => {
    try { fs.writeFileSync(file, JSON.stringify(history)); } catch { /* a cache that cannot be written is only slower */ }
};
// the new HEAD descends from the cached one: only the commits in between are asked from git
const extends_ = (git, cached, head) => Boolean(cached?.head && Array.isArray(cached.files) && git.mergeBase(cached.head, head) === cached.head);

/**
 * The files per commit of the newest `max` commits, kept in `cacheFile` with their HEAD: `git log` over all of them took
 * 1.25 s on 714 commits, on every sync after a commit and in every new process (trace 2026-11-15).
 * shortcut: new commits go in front of the cached list; with merges of older-dated commits git's date order can differ
 * near the end of the window of `max` commits. Upgrade to a full `git log` when CO_CHANGES must match it exactly.
 */
export function commitFilesCached(git, max, cacheFile) {
    const head = cacheFile && git.resolveCommit('HEAD');
    if (!head) return git.commitFiles(max);
    const cached = readCache(cacheFile);
    if (isCurrent(cached, head, max)) return cached.files;
    const files = updatedFiles(git, cached, head, max);
    writeCache(cacheFile, { head, max, files });
    return files;
}

const isCurrent = (cached, head, max) => cached?.head === head && cached?.max === max;

function updatedFiles(git, cached, head, max) {
    if (cached?.max !== max || !extends_(git, cached, head)) return git.commitFiles(max);
    return [...git.commitFiles(max, { since: cached.head }), ...cached.files].slice(0, max);
}

/** Where the history of a graph database is kept: next to the database; none for a graph in memory. */
export const historyFile = (repository) => (repository.databasePath() === ':memory:' ? null : `${repository.databasePath()}.history.json`);

/** `git` is the git port (core/git); `cacheFile` keeps the history between syncs (none: git is asked every time). */
export function coChangeRelations(git, knownPaths, { maxCommits = 1000, maxFilesPerCommit = 30, minCount = 3, perFile = 5, now = new Date().toISOString(), cacheFile } = {}) {
    const pairs = new Map();
    for (const files of commitFilesCached(git, maxCommits, cacheFile)) {
        processCommitFiles(files, maxFilesPerCommit, knownPaths, pairs);
    }
    const strong = [...pairs.entries()].filter(([, count]) => count >= minCount).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const partners = new Map();
    const relations = [];
    for (const [key, count] of strong) {
        const [a, b] = key.split('\u0000');
        const canLink = (partners.get(a) || 0) < perFile && (partners.get(b) || 0) < perFile;
        if (canLink) {
            partners.set(a, (partners.get(a) || 0) + 1);
            partners.set(b, (partners.get(b) || 0) + 1);
            relations.push({ from: fileNodeId(a), to: fileNodeId(b), relation: 'CO_CHANGES', confidence: 'INFERRED', weight: count, createdAt: now });
        }
    }
    return relations;
}
