/**
 * Commits that changed one function: every commit that touched the file is compared with its first parent
 * and kept when the function was added, modified or removed there. Name-based, so a rename starts a new history.
 */
import { createGit } from '../git/index.js';
import { compareFunctions } from './branchDiff.js';

export function functionHistory({ name, file, ref = 'HEAD', max = 20, root = process.cwd(), git = createGit({ root }) } = {}) {
    if (!file) return { error: 'file is required' };
    if (!git.resolveCommit(ref)) return { error: `unknown branch or commit: ${ref}` };
    const prefix = git.prefix() || '';
    const filePath = file.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!name) {
        const entries = git.fileLog(ref, prefix + filePath, { max });
        return { file: filePath, ref, commits: entries.map(entry => ({ sha: entry.sha.slice(0, 7), date: entry.date, author: entry.author, subject: entry.subject })) };
    }
    const commits = [];
    for (const entry of git.fileLog(ref, filePath, { max: 200 })) {
        const parent = entry.parents[0];
        const before = parent ? git.readBlob(parent, prefix + filePath) : null;
        const after = git.readBlob(entry.sha, prefix + filePath);
        const change = compareFunctions(before, after, { path: filePath }).find(item => item.name === name);
        if (change) commits.push({ sha: entry.sha.slice(0, 7), date: entry.date, author: entry.author, subject: entry.subject, change: change.change });
        if (commits.length >= max) break;
    }
    return { name, file: filePath, ref, commits };
}
