/**
 * Git access in one place: `run` is the only caller of the git binary. `createGit({ root, run })` takes a replaceable `run`
 * so callers can be tested without starting a process.
 * @module core/git
 */
import { execFileSync } from 'child_process';
export { createFakeGit, fakeSha } from './fakeGit.js';

// windowsHide: in the detached daemon (no console) every git call without it opened a console and took ~1 s, not ~75 ms
const defaultRun = (root, args, { input, encoding = 'utf8' } = {}) => execFileSync('git', args, { cwd: root, encoding, input, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024, windowsHide: true });

/** `cat-file --batch` output (`<sha> blob <size>\n<bytes>\n` or `<name> missing\n` per request) to the text of each requested path, null when missing. */
export function parseBatch(buffer, paths) {
    const result = new Map();
    let offset = 0;
    for (const file of paths) {
        const end = buffer.indexOf(10, offset);
        const header = buffer.toString('utf8', offset, end).split(' ');
        offset = end + 1;
        if (header[1] !== 'blob') { result.set(file, null); continue; }
        const size = Number(header[2]);
        result.set(file, buffer.toString('utf8', offset, offset + size));
        offset += size + 1;
    }
    return result;
}

/** `diff --name-status` lines to `{ status: 'A'|'D'|'M'|'R', path, oldPath? }`. */
export function parseNameStatus(output) {
    return output.split(/\r?\n/).filter(Boolean).map(line => {
        const [code, first, second] = line.split('\t');
        const status = code[0] === 'C' ? 'A' : code[0];
        return status === 'R' ? { status, oldPath: first, path: second } : { status, path: second || first };
    });
}

const COMMIT_FORMAT = '%H%x09%P%x09%cI%x09%an%x09%s';
// git 2.54 writes UTC in %cI as "Z", older git as "+00:00": one spelling, whatever git is installed
const isoDate = date => date && date.replace(/\+00:00$/, 'Z');

/** One `COMMIT_FORMAT` line to `{ sha, parents, date, author, subject }`, null for an empty line. */
function commitFrom(output) {
    const [sha, parents, date, author, ...subject] = (output || '').trim().split('\t');
    return sha ? { sha, parents: parents ? parents.split(' ') : [], date: isoDate(date), author, subject: subject.join('\t') } : null;
}

/** `git grep -n <ref>` output (`ref:file:line:text`) to hits. */
const grepHits = (output, ref) => (output || '').split(/\r?\n/).filter(Boolean).map(line => {
    const match = line.slice(ref.length + 1).match(/^(.+?):(\d+):(.*)$/);
    return match ? { file: match[1], line: Number(match[2]), text: match[3].trim() } : null;
}).filter(Boolean);

/** `name` as a whole word in `text`, as `git grep -w` matches it. */
export const hasWord = (text, name) => new RegExp(`(?<!\\w)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\w)`).test(text);

const GREP_CHUNK = 100; // names per `git grep`: stays far below the Windows command-line limit
const HISTORY = new Map(); // root -> { key: 'HEAD sha|max', files }: the last commitFiles answer per repository

export function createGit({ root, run = defaultRun } = {}) {
    const git = (...args) => run(root, args);
    const tryGit = (...args) => { try { return git(...args); } catch { return null; } };
    return {
        currentBranch: () => tryGit('rev-parse', '--abbrev-ref', 'HEAD')?.trim() || null,
        resolveCommit: ref => tryGit('rev-parse', '--verify', '--quiet', `${ref}^{commit}`)?.trim() || null,
        mergeBase: (a, b) => tryGit('merge-base', a, b)?.trim() || null,
        diffNameStatus: (from, to) => parseNameStatus(git('diff', '--name-status', '-M', from, to)),
        // what .gitignore leaves out, relative to `root`: a folder ends in '/' and stands for everything in it; [] outside a repository
        ignoredPaths: () => (tryGit('ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory') || '').split('\0').filter(Boolean).sort(),
        // the work not committed yet (staged or not) against HEAD, untracked files as added; [] outside a repository
        worktreeChanges: () => [
            ...parseNameStatus(tryGit('diff', '--name-status', '-M', 'HEAD') || ''),
            ...(tryGit('ls-files', '--others', '--exclude-standard', '-z') || '').split('\0').filter(Boolean).map(file => ({ status: 'A', path: file }))
        ].sort((a, b) => a.path.localeCompare(b.path)),
        readBlob: (ref, filePath) => tryGit('show', `${ref}:${filePath}`),
        // a binary file (a Mendix .mpr or .mxunit), relative to `root` like readBlobs, as a Buffer; null when it is not there
        readBlobBytes: (ref, filePath) => { try { return run(root, ['show', `${ref}:./${filePath}`], { encoding: null }); } catch { return null; } },
        logRange: (from, to, { max = 50 } = {}) => (tryGit('log', `-n${max}`, '--format=%h %s', `${from}..${to}`) || '').split(/\r?\n/).filter(Boolean),
        // the commits in `to` and not in `from`, newest first: sha, parents, date, author, subject
        commitList: (from, to, { max = 200 } = {}) => (tryGit('log', `-n${max}`, `--format=${COMMIT_FORMAT}`, `${from}..${to}`) || '').split(/\r?\n/).map(commitFrom).filter(Boolean),
        countRange: (from, to) => {
            const out = tryGit('rev-list', '--count', `${from}..${to}`);
            return out == null ? null : Number(out.trim());
        },
        headInfo: () => {
            const [sha, date, ...subject] = (tryGit('log', '-1', '--format=%H%x09%cI%x09%s') || '').trim().split('\t');
            return sha ? { sha, date: isoDate(date), message: subject.join('\t') } : null;
        },
        // one commit: sha, parents, date, author, subject; null when `ref` is unknown
        commitInfo: ref => commitFrom(tryGit('log', '-1', `--format=${COMMIT_FORMAT}`, `${ref}^{commit}`, '--')),
        // commits that touched `filePath`, newest first (history is not followed across renames)
        fileLog: (ref, filePath, { max = 30 } = {}) => (tryGit('log', `-n${max}`, `--format=${COMMIT_FORMAT}`, ref, '--', filePath) || '').split(/\r?\n/).map(commitFrom).filter(Boolean),
        // the files of the last `max` commits of HEAD, one array per commit (merge commits list none); [] without git
        // cached per root until HEAD moves: every sync with a change and every `health` call asked again (~0.5 s on 1000 commits)
        commitFiles: (max = 1000) => {
            const head = tryGit('rev-parse', 'HEAD')?.trim(), key = `${head}|${max}`, cached = HISTORY.get(root);
            if (head && cached?.key === key) return cached.files;
            const files = (tryGit('log', `-n${max}`, '--name-only', '--no-renames', '--format=format:@@') || '').split('@@').slice(1).map(block => block.split(/\r?\n/).map(line => line.trim()).filter(Boolean));
            if (head) HISTORY.set(root, { key, files });
            return files;
        },
        listBranches: () => (tryGit('for-each-ref', '--format=%(refname:short)', 'refs/heads') || '').split(/\r?\n/).filter(Boolean),
        // every file in the tree of `ref`, relative to `root` (paths outside it are not listed)
        listTree: ref => tryGit('ls-tree', '-r', '--name-only', '-z', ref)?.split('\0').filter(Boolean) ?? null,
        // text of many files at `ref` in a few processes (`cat-file --batch`); missing or non-file paths map to null
        // fromTop: the paths are relative to the repository top (as `git diff` lists them), not to `root`
        readBlobs: (ref, paths, { chunk = 500, fromTop = false } = {}) => {
            const result = new Map();
            const at = fromTop ? '' : './';
            for (let i = 0; i < paths.length; i += chunk) {
                const part = paths.slice(i, i + chunk);
                let out;
                try { out = run(root, ['cat-file', '--batch'], { input: part.map(file => `${ref}:${at}${file}\n`).join(''), encoding: null }); } catch { out = null; }
                for (const [file, text] of out ? parseBatch(out, part) : part.map(file => [file, null])) result.set(file, text);
            }
            return result;
        },
        existsAt: (ref, filePath) => tryGit('cat-file', '-e', `${ref}:${filePath}`) !== null,
        // paths are relative to the repository top; `prefix` is '' when `root` is that top
        prefix: () => tryGit('rev-parse', '--show-prefix')?.trim() ?? null,
        changedSince: (from, to) => tryGit('diff', '--name-only', '-z', '--no-renames', from, to)?.split('\0').filter(Boolean) ?? null,
        grepRef: (ref, name, { max = 200 } = {}) => grepHits(tryGit('grep', '-n', '-w', '-F', '-I', '--no-color', '-e', name, ref, '--'), ref).slice(0, max),
        // grepRef for many names in one `git grep` per chunk (one process per name took branch_impact past 2 minutes)
        grepRefs: (ref, names, { max = 200 } = {}) => {
            const result = new Map(names.map(name => [name, []]));
            for (let i = 0; i < names.length; i += GREP_CHUNK) {
                const part = names.slice(i, i + GREP_CHUNK);
                const hits = grepHits(tryGit('grep', '-n', '-w', '-F', '-I', '--no-color', ...part.flatMap(name => ['-e', name]), ref, '--'), ref);
                for (const name of part) result.set(name, hits.filter(hit => hasWord(hit.text, name)).slice(0, max));
            }
            return result;
        },
        lastCommitFor: (from, to, filePath) => (tryGit('log', '-n1', '--format=%h %s', `${from}..${to}`, '--', filePath) || '').trim() || null,
        // `merge-tree --write-tree` exits 1 on conflicts and still prints them on stdout; older git: null
        conflicts: (a, b) => {
            let out;
            try { out = run(root, ['merge-tree', '--write-tree', '--name-only', a, b]); } catch (error) { out = error.stdout ? String(error.stdout) : null; }
            return out == null ? null : [...out.matchAll(/Merge conflict in (.+)/g)].map(match => match[1].trim());
        }
    };
}
