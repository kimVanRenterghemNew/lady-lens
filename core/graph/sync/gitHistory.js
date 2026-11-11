/**
 * What changes together, from git history: files that change in the same commit at least `minCount` times get a
 * CO_CHANGES relation (weight = number of commits). Bulk commits (more than `maxFilesPerCommit` files: moves, formatting)
 * do not count; per file only its `perFile` strongest partners. No git, or git fails: no relations.
 */
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

/** `git` is the git port (core/git). */
export function coChangeRelations(git, knownPaths, { maxCommits = 1000, maxFilesPerCommit = 30, minCount = 3, perFile = 5, now = new Date().toISOString() } = {}) {
    const pairs = new Map();
    for (const files of git.commitFiles(maxCommits)) {
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
