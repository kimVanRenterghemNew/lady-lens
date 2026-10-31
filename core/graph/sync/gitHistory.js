/**
 * What changes together, from git history: files that change in the same commit at least `minCount` times get a
 * CO_CHANGES relation (weight = number of commits). Bulk commits (more than `maxFilesPerCommit` files: moves, formatting)
 * do not count; per file only its `perFile` strongest partners. No git, or git fails: no relations.
 */
import { execFileSync } from 'child_process';
import { fileNodeId } from '../adapters/ladybug/index.js';

/** The files of the last `maxCommits` commits, one array per commit (repo-relative, forward slashes). */
export function commitFiles(root, { maxCommits = 1000 } = {}) {
    let out;
    try {
        out = execFileSync('git', ['log', `-n${maxCommits}`, '--name-only', '--no-renames', '--format=format:@@'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
    } catch {
        return [];
    }
    return out.split('@@').map(block => block.split(/\r?\n/).map(line => line.trim()).filter(Boolean));
}

export function coChangeRelations(root, knownPaths, { maxCommits = 1000, maxFilesPerCommit = 30, minCount = 3, perFile = 5, now = new Date().toISOString() } = {}) {
    const pairs = new Map();
    for (const files of commitFiles(root, { maxCommits })) {
        const known = [...new Set(files.filter(file => knownPaths.has(file)))].sort();
        if (known.length < 2 || files.length > maxFilesPerCommit) continue;
        for (let i = 0; i < known.length; i++) for (let j = i + 1; j < known.length; j++) {
            const key = `${known[i]}\u0000${known[j]}`;
            pairs.set(key, (pairs.get(key) || 0) + 1);
        }
    }
    const strong = [...pairs.entries()].filter(([, count]) => count >= minCount).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const partners = new Map();
    const relations = [];
    for (const [key, count] of strong) {
        const [a, b] = key.split('\u0000');
        if ((partners.get(a) || 0) >= perFile || (partners.get(b) || 0) >= perFile) continue;
        partners.set(a, (partners.get(a) || 0) + 1);
        partners.set(b, (partners.get(b) || 0) + 1);
        relations.push({ from: fileNodeId(a), to: fileNodeId(b), relation: 'CO_CHANGES', confidence: 'INFERRED', weight: count, createdAt: now });
    }
    return relations;
}
