/**
 * Pure: which file defines the function a call names. A call records the name as its file imported it and the import
 * specifier; the specifier gives a file, and a barrel (index.js) is followed through its re-exports to the file that
 * declares the name. The sync (CALLS relations) and the function view (callees, callers) use the same resolution.
 */
import path from 'path';

export const isBarrelPath = (file) => /(^|\/)index\.[cm]?js$/.test(String(file));

/** The repo-relative file a relative specifier points at, or null. */
export function resolveImportPath(fromFile, specifier, has) {
    if (!String(specifier).startsWith('.')) return null;
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier));
    return [base, `${base}.js`, `${base}.mjs`, `${base}/index.js`].find(candidate => has(candidate)) ?? null;
}

const MAX_DEPTH = 6;

/**
 * @param {{from: string, name: string, specifier: string}} call
 * @param {{has: (file: string) => boolean, declares: (file: string, name: string) => boolean, reexports: (file: string) => string[]}} lookup
 *   `reexports(file)` lists the files a barrel re-exports from (already resolved).
 * @returns {string|null} the declaring file; the imported file when no declaration is found; null for a non-relative import
 */
export function resolveCallee({ from, name, specifier }, lookup) {
    const target = resolveImportPath(from, specifier, lookup.has);
    if (!target || name === 'default') return target;
    const seen = new Set();
    const find = (file, depth) => {
        if (seen.has(file) || depth > MAX_DEPTH) return null;
        seen.add(file);
        if (lookup.declares(file, name)) return file;
        if (!isBarrelPath(file)) return null;
        for (const next of lookup.reexports(file)) {
            const found = find(next, depth + 1);
            if (found) return found;
        }
        return null;
    };
    return find(target, 0) ?? target;
}
