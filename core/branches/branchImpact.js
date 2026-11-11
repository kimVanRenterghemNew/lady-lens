/**
 * Impact of what `change` (e.g. a release bugfix) modifies on `against` (e.g. a feature): the functions `change` modified
 * or removed since the merge-base, the places in `against` that still use them (`git grep`, no checkout), and the
 * functions and files that `against` changes itself (overlap). Names are matched as whole words: a common name gives
 * extra hits, so each function is capped at `maxReferences` and the first hits are listed.
 */
import { createGit } from '../git/index.js';
import { isCodeFile } from '../graph/index.js';
import { branchDiff } from './branchDiff.js';

export function branchImpact({ change, against, root = process.cwd(), git = createGit({ root }), maxReferences = 20 } = {}) {
    if (!change || !against) return { error: 'change and against are required' };
    const mine = branchDiff({ from: against, to: change, git });
    if (mine.error) return mine;
    const theirs = branchDiff({ from: change, to: against, git, onlyFiles: new Set(mine.files.flatMap(file => [file.path, file.oldPath].filter(Boolean))) });
    const base = git.mergeBase(change, against);

    const againstFunctions = new Set(theirs.functions.flatMap(fn => [`${fn.file}\u0000${fn.name}`, ...(fn.oldName ? [`${fn.oldFile}\u0000${fn.oldName}`] : [])]));
    const againstFiles = new Set(theirs.files.flatMap(file => [file.path, file.oldPath].filter(Boolean)));
    const risks = [];
    const touched = mine.functions.filter(entry => entry.change !== 'added');
    // callers on `against` still use the old name of a renamed function; one batched grep, one log per file
    const bareName = fn => (fn.oldName || fn.name).replace(/#\d+$/, '');
    const hitsByName = git.grepRefs(against, [...new Set(touched.map(bareName))]);
    const lastCommits = new Map();
    const lastCommit = file => { if (!lastCommits.has(file)) lastCommits.set(file, git.lastCommitFor(base, change, file)); return lastCommits.get(file); };
    for (const fn of touched) {
        const original = fn.oldName || fn.name;
        const originalFile = fn.oldFile || fn.file;
        const references = hitsByName.get(bareName(fn)).filter(hit => isCodeFile(hit.file));
        const overlap = againstFunctions.has(`${originalFile}\u0000${original}`);
        if (!references.length && !overlap) continue;
        risks.push({
            function: original, file: originalFile, change: fn.change, ...(fn.oldName ? { renamedTo: fn.name, renamedInFile: fn.file } : {}),
            commit: lastCommit(fn.file), overlap,
            references: references.slice(0, maxReferences).map(({ file, line }) => ({ file, line })),
            referenceCount: references.length
        });
    }
    const sharedFiles = mine.files.map(file => file.path).filter(file => againstFiles.has(file));
    return {
        change, against, mergeBase: mine.mergeBase,
        risks: risks.sort((a, b) => Number(b.overlap) - Number(a.overlap) || b.referenceCount - a.referenceCount),
        sharedFiles,
        conflicts: sharedFiles.length ? git.conflicts(change, against) : []
    };
}
