/**
 * The functions a diff changes: the work not committed yet (staged, unstaged and untracked files against HEAD), or the
 * range `from`..`to` (`to` defaults to HEAD; a branch counts from its merge-base, like branch_diff). The comparison is the
 * one of branch_diff (`compareFiles`): a function changed when the hash of its body changed, so a hunk touching one function
 * gives that function, a hunk over two gives both, a new file gives all its functions as added, a deleted file as removed.
 */
import { createGit } from '../git/index.js';
import { isCodeFile, analyzeSource, analyzeSourceForLanguage } from '../graph/index.js';
import { compareFiles } from './compare.js';

const analyze = (source, file) => (/\.[cm]?jsx?$/i.test(file) ? analyzeSource(source) : analyzeSourceForLanguage(source, file));

/** Cyclomatic complexity per function name of one source; empty when the source is missing or does not parse. */
function complexities(source, file) {
    if (source == null) return new Map();
    try {
        return new Map((analyze(source, file).functions || []).map(fn => [fn.name, fn.cyclomaticComplexity ?? fn.cc ?? null]).reverse());
    } catch {
        return new Map();
    }
}

function readEntries(files, { before, after }) {
    return files.filter(file => isCodeFile(file.path) || isCodeFile(file.oldPath || file.path)).map(file => ({
        file,
        beforeSource: file.status === 'A' ? null : before(file.oldPath || file.path),
        afterSource: file.status === 'D' ? null : after(file.path)
    }));
}

function withComplexity(entries, functions) {
    const sources = new Map(entries.flatMap(({ file, beforeSource, afterSource }) => [[`after\u0000${file.path}`, afterSource], [`before\u0000${file.oldPath || file.path}`, beforeSource]]));
    const cache = new Map();
    const of = (side, file) => {
        const key = `${side}\u0000${file}`;
        if (!cache.has(key)) cache.set(key, complexities(sources.get(key), file));
        return cache.get(key);
    };
    return functions.map(fn => {
        const table = fn.change === 'removed' ? of('before', fn.file) : of('after', fn.file);
        return { ...fn, complexity: table.get(fn.name.replace(/#\d+$/, '')) ?? null };
    });
}

/**
 * @param {{from?: string, to?: string, root?: string, git?: object, readFile?: (path: string) => string|null}} options
 *   `readFile` reads the working copy (repo-relative path); only used without `from`.
 */
export function changedFunctions({ from, to = 'HEAD', root = process.cwd(), git = createGit({ root }), readFile = () => null } = {}) {
    let source, readers, files;
    if (from) {
        for (const ref of [from, to]) if (!git.resolveCommit(ref)) return { error: `unknown branch or commit: ${ref}` };
        const base = git.mergeBase(from, to);
        if (!base) return { error: `no common history between ${from} and ${to}` };
        source = { source: 'range', from, to, mergeBase: base.slice(0, 7) };
        files = git.diffNameStatus(base, to);
        readers = { before: file => git.readBlob(base, file), after: file => git.readBlob(to, file) };
    } else {
        source = { source: 'worktree' };
        files = git.worktreeChanges();
        readers = { before: file => git.readBlob('HEAD', file), after: readFile };
    }
    const entries = readEntries(files, readers);
    return { ...source, files: files.map(file => file.path), functions: withComplexity(entries, compareFiles(entries).functions) };
}
