/**
 * An in-memory twin of `createGit` for tests: same functions, same answers, no process. `state` describes a repository:
 *   { commits: [{ name, parents: [name], files: { path: text | null }, subject?, author? }], branches: { name: commitName }, head: branchName }
 * Commits are listed in creation order (that is also their date order); `files` are the changes on top of the first parent
 * (`null` deletes). `createFakeGit(null)` behaves like a folder that is not a repository.
 * Differences from git: a rename is a deleted and an added file with identical text; `conflicts` flags a file that both
 * sides changed to different text. test/gitPort.contract.test.js runs both against the same scenario.
 */
import crypto from 'crypto';

export const fakeSha = name => crypto.createHash('sha1').update(name).digest('hex');

const NO_REPOSITORY = {
    currentBranch: () => null, resolveCommit: () => null, mergeBase: () => null, readBlob: () => null, logRange: () => [], countRange: () => null,
    headInfo: () => null, commitInfo: () => null, fileLog: () => [], commitFiles: () => [], listBranches: () => [], listTree: () => null,
    readBlobs: (ref, paths) => new Map(paths.map(file => [file, null])), existsAt: () => false, prefix: () => null, changedSince: () => null,
    grepRef: () => [], lastCommitFor: () => null, conflicts: () => null, worktreeChanges: () => [], ignoredPaths: () => [],
    diffNameStatus: () => { throw new Error('not a git repository'); }
};

/** name-status between two trees (path to text); a deleted and an added file with the same text are a rename. */
function treeDiff(before, after) {
    const added = [...after.keys()].filter(file => !before.has(file));
    const result = [];
    for (const file of [...before.keys()].filter(name => !after.has(name))) {
        const twin = added.find(name => after.get(name) === before.get(file));
        if (twin) { added.splice(added.indexOf(twin), 1); result.push({ status: 'R', oldPath: file, path: twin }); } else result.push({ status: 'D', path: file });
    }
    for (const file of added) result.push({ status: 'A', path: file });
    for (const [file, text] of after) if (before.has(file) && before.get(file) !== text) result.push({ status: 'M', path: file });
    return result.sort((a, b) => a.path.localeCompare(b.path));
}

export function createFakeGit(state = null) {
    if (!state) return { ...NO_REPOSITORY };
    const commits = new Map();
    state.commits.forEach((entry, index) => {
        const parents = entry.parents.map(fakeSha);
        const tree = new Map(parents.length ? commits.get(parents[0]).tree : []);
        for (const [file, text] of Object.entries(entry.files || {})) { if (text == null) tree.delete(file); else tree.set(file, text); }
        commits.set(fakeSha(entry.name), { sha: fakeSha(entry.name), parents, tree, index, date: `2024-01-01T00:00:${String(index).padStart(2, '0')}Z`, author: entry.author || 'Tess', subject: entry.subject || entry.name });
    });
    const heads = Object.fromEntries(Object.entries(state.branches).map(([branch, name]) => [branch, fakeSha(name)]));
    const headSha = heads[state.head] ?? null;

    const resolve = ref => {
        const [, base, steps] = String(ref).match(/^(.+?)(?:~(\d+))?$/);
        let sha = base === 'HEAD' ? headSha : heads[base] ?? (commits.has(base) ? base : [...commits.keys()].filter(key => base.length >= 4 && key.startsWith(base))[0]);
        for (let i = 0; sha && i < Number(steps || 0); i++) sha = commits.get(sha).parents[0];
        return sha ?? null;
    };
    const reachable = sha => {
        const seen = new Set();
        for (const stack = [sha]; stack.length;) { const next = stack.pop(); if (!seen.has(next)) { seen.add(next); stack.push(...commits.get(next).parents); } }
        return seen;
    };
    const newestFirst = shas => [...shas].map(sha => commits.get(sha)).sort((a, b) => b.index - a.index);
    const range = (from, to) => {
        const [a, b] = [resolve(from), resolve(to)];
        if (!a || !b) return null;
        const excluded = reachable(a);
        return newestFirst([...reachable(b)].filter(sha => !excluded.has(sha)));
    };
    const treeOf = ref => commits.get(resolve(ref))?.tree ?? null;
    const changedPaths = commit => {
        const before = commit.parents.length ? commits.get(commit.parents[0]).tree : new Map();
        return [...new Set([...before.keys(), ...commit.tree.keys()])].filter(file => before.get(file) !== commit.tree.get(file)).sort();
    };
    const info = commit => commit && { sha: commit.sha, parents: commit.parents, date: commit.date, author: commit.author, subject: commit.subject };
    const short = commit => `${commit.sha.slice(0, 7)} ${commit.subject}`;
    const touching = (commitList, file) => commitList.filter(commit => commit.parents.length < 2 && changedPaths(commit).includes(file));
    const sideChanges = (base, tip) => new Map([...new Set([...base.keys(), ...tip.keys()])].filter(file => base.get(file) !== tip.get(file)).map(file => [file, tip.get(file)]));

    const git = {
        currentBranch: () => state.head ?? null,
        resolveCommit: ref => resolve(ref),
        mergeBase: (a, b) => {
            const [x, y] = [resolve(a), resolve(b)];
            if (!x || !y) return null;
            const common = [...reachable(x)].filter(sha => reachable(y).has(sha));
            return newestFirst(common.filter(sha => !common.some(other => other !== sha && reachable(other).has(sha))))[0]?.sha ?? null;
        },
        diffNameStatus: (from, to) => {
            const [before, after] = [treeOf(from), treeOf(to)];
            if (!before || !after) throw new Error();
            return treeDiff(before, after);
        },
        // state.ignored: what .gitignore leaves out, as git lists it (a folder ends in '/')
        ignoredPaths: () => [...(state.ignored || [])].sort(),
        // state.worktree: { path: text | null } on top of HEAD, like files that are edited, added or deleted and not committed
        worktreeChanges: () => {
            const head = treeOf('HEAD') ?? new Map();
            const worktree = new Map(head);
            for (const [file, text] of Object.entries(state.worktree || {})) { if (text == null) worktree.delete(file); else worktree.set(file, text); }
            return treeDiff(head, worktree);
        },
        readBlob: (ref, file) => treeOf(ref)?.get(file) ?? null,
        logRange: (from, to, { max = 50 } = {}) => (range(from, to) || []).slice(0, max).map(short),
        countRange: (from, to) => range(from, to)?.length ?? null,
        headInfo: () => { const head = commits.get(headSha); return head ? { sha: head.sha, date: head.date, message: head.subject } : null; },
        commitInfo: ref => info(commits.get(resolve(ref))),
        fileLog: (ref, file, { max = 30 } = {}) => { const sha = resolve(ref); return sha ? touching(newestFirst(reachable(sha)), file).slice(0, max).map(info) : []; },
        commitFiles: (max = 1000) => (headSha ? newestFirst(reachable(headSha)).slice(0, max).map(commit => (commit.parents.length > 1 ? [] : changedPaths(commit))) : []),
        listBranches: () => Object.keys(state.branches).sort(),
        listTree: ref => { const tree = treeOf(ref); return tree ? [...tree.keys()].sort() : null; },
        readBlobs: (ref, paths) => new Map(paths.map(file => [file, treeOf(ref)?.get(file) ?? null])),
        existsAt: (ref, file) => treeOf(ref)?.has(file) ?? false,
        prefix: () => '',
        changedSince: (from, to) => {
            const [before, after] = [treeOf(from), treeOf(to)];
            return before && after ? [...sideChanges(before, after).keys()].sort() : null;
        },
        grepRef: (ref, name, { max = 200 } = {}) => {
            const tree = treeOf(ref);
            const word = new RegExp(`(?<!\\w)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\w)`);
            const found = [];
            for (const file of tree ? [...tree.keys()].sort() : []) tree.get(file).split(/\r?\n/).forEach((text, index) => { if (word.test(text)) found.push({ file, line: index + 1, text: text.trim() }); });
            return found.slice(0, max);
        },
        lastCommitFor: (from, to, file) => { const list = range(from, to); return list ? (touching(list, file).map(short)[0] ?? null) : null; },
        conflicts: (a, b) => {
            const base = treeOf(git.mergeBase(a, b));
            const [x, y] = [treeOf(a), treeOf(b)];
            if (!base || !x || !y) return null;
            const mine = sideChanges(base, x);
            return [...sideChanges(base, y)].filter(([file, text]) => mine.has(file) && mine.get(file) !== text).map(([file]) => file).sort();
        }
    };
    return git;
}
