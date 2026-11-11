/**
 * The text before and after of each changed file, read in batches (`cat-file --batch`). One `git show` per file and side
 * kept the daemon busy for minutes on a branch with 160 changed files: every other agent waited (spawnSync blocks the loop).
 */
const sideOf = (read, paths) => (paths.length ? read(paths) : new Map());
const beforePath = file => file.oldPath || file.path;

/**
 * @param {Array<{status: string, path: string, oldPath?: string}>} files
 * @param {{before: (paths: string[]) => Map<string, string|null>, after: (paths: string[]) => Map<string, string|null>}} readers
 */
export function readSources(files, { before, after }) {
    const olds = sideOf(before, files.filter(file => file.status !== 'A').map(beforePath));
    const news = sideOf(after, files.filter(file => file.status !== 'D').map(file => file.path));
    return files.map(file => ({
        file,
        beforeSource: olds.get(beforePath(file)) ?? null,
        afterSource: news.get(file.path) ?? null
    }));
}

/** A batch reader of `ref`; the paths are relative to the repository top, as `git diff` gives them. */
export const blobsAt = (git, ref) => paths => git.readBlobs(ref, paths, { fromTop: true });
