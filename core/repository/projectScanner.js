import fs from 'fs/promises';
import path from 'path';
import { REPO_ROOT } from '../configuration/index.js';
import { isGraphExtension, normalizeRelativePath, shouldExcludePath } from './projectSettings.js';

/**
 * Walk configured graph roots and yield files that are eligible for indexing.
 * @param {{rootDir?: string, settings: object, onFile?: (filePath: string, relativePath: string) => Promise<void>|void}} options
 * @returns {Promise<string[]>} Absolute paths when no onFile callback is supplied.
 */
export async function scanGraphFiles(options = {}) {
    const rootDir = options.rootDir || REPO_ROOT;
    const settings = options.settings || {};
    const excludeDirs = settings.project?.exclude_dirs || [];
    const extensions = settings.project?.graph_extensions || [];
    const roots = settings.project?.graph_roots || [];
    const found = [];

    async function walk(directory) {
        let entries;
        try {
            entries = await fs.readdir(directory, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            const absolutePath = path.join(directory, entry.name);
            const relativePath = normalizeRelativePath(path.relative(rootDir, absolutePath));
            if (shouldExcludePath(relativePath, excludeDirs)) continue;
            if (entry.isDirectory()) {
                await walk(absolutePath);
                continue;
            }
            if (!isGraphExtension(relativePath, extensions)) continue;
            found.push(absolutePath);
            await options.onFile?.(absolutePath, relativePath);
        }
    }

    for (const root of roots) {
        const absoluteRoot = path.join(rootDir, root);
        if (!shouldExcludePath(root, excludeDirs)) await walk(absoluteRoot);
    }

    return found;
}
