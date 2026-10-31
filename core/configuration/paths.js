/**
 * Where things are: the repository the graph is about, and safe repo-relative paths.
 * TODO(coverage): Current line coverage is 84.21% (< 85% target). Raise to >= 85%.
 * @module core/configuration/paths
 */
import path from 'path';
import { fileURLToPath } from 'url';

// The repository: LENS_REPO_ROOT when set; installed as a dependency (inside node_modules) the working directory of the
// process; stand-alone, this checkout. A host application sets its own with configureLensRoot().
const HERE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOT_FROM_ENV = process.env.LENS_REPO_ROOT;
export let REPO_ROOT = ROOT_FROM_ENV
    ? path.resolve(ROOT_FROM_ENV)
    : HERE_ROOT.split(path.sep).includes('node_modules') ? process.cwd() : HERE_ROOT;

/** `.memory/` under the repository: the default home of the graph database (`.memory/graph/project.lbdb`). */
export let MEMORY_DIR = path.join(REPO_ROOT, '.memory');

/**
 * A host application tells lady-lens which repository it works on (its own root), instead of the working directory.
 * Everything that derives from the root follows (live ESM bindings; derived paths are computed at call time).
 */
export function configureLensRoot(root) {
    REPO_ROOT = path.resolve(root);
    MEMORY_DIR = path.join(REPO_ROOT, '.memory');
}

const FORBIDDEN_DIRS = ['.git', '.memory', 'node_modules'];

/** Inside the repository and not under .git, .memory or node_modules. */
export function isSafePath(candidatePath) {
    const resolved = path.isAbsolute(candidatePath) ? candidatePath : path.join(REPO_ROOT, candidatePath);
    const normalized = path.normalize(resolved);
    const rootWithSep = REPO_ROOT.endsWith(path.sep) ? REPO_ROOT : REPO_ROOT + path.sep;
    if (!normalized.startsWith(rootWithSep)) return false;
    const relative = normalized.slice(rootWithSep.length).split(path.sep);
    return !FORBIDDEN_DIRS.includes(relative[0]);
}

/** An absolute path inside the repository as `core/x.js`; anything else unchanged. */
export function toRepoRelative(filePath, root = REPO_ROOT) {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) return filePath;
    const relative = path.relative(root, filePath);
    return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative.split(path.sep).join('/') : filePath;
}

/** `core/x.js` -> `<root>/core/x.js` when it is safe to read, else null. */
export function resolveInRepo(candidate) {
    const abs = path.isAbsolute(candidate) ? candidate : path.join(REPO_ROOT, candidate);
    return isSafePath(abs) ? abs : null;
}

/** `<root>/core/x.js` -> `core/x.js` (forward slashes; a path outside `root` keeps its `../`). */
export function relativeToRepo(absPath, root = REPO_ROOT) {
    return path.relative(root, absPath).split(path.sep).join('/');
}
