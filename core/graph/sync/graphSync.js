/**
 * Project graph sync: fills and maintains the project scope of the Ladybug graph.
 * Relations are derived data: every write rebuilds relations from entity metadata.
 * @module core/graph/graphSync
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { REPO_ROOT, lensEnv } from '../../configuration/index.js';
import { loadProjectSettings, scanGraphFiles } from '../../repository/index.js';
import { createGraphRepository, PROJECT_SCOPE } from '../repository/index.js';
import { coChangeRelations } from './gitHistory.js';
import { createGit } from '../../git/index.js';
import { recordHead } from './headCommit.js';
import { entityFor, entryPointsFrom, dependencyNodesOf } from './fileEntity.js';
import { deriveProjectRelations } from './projectRelations.js';
import { isCodeFile, isDocFile, isConfigFile } from './languages/index.js';
import { mendixContributor } from './mendix.js';
import { contributed } from './contributors.js';
const toPosix = (value) => String(value).replace(/\\/g, '/');
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
export function isProjectGraphEnabled(env = process.env) {
    return lensEnv('PROJECT_GRAPH', env) !== '0';
}
function isIndexable(file) {
    return isCodeFile(file) || isDocFile(file) || isConfigFile(file);
}
/** Bumped when the facts of a file gain a field: every file is then re-read once, also when its content did not change. */
export const FACTS_VERSION = 7;
/**
 * @param {{root?: string, repository?: object, settings?: object, now?: () => number, contribute?: boolean}} [options]
 *   contribute: false leaves out the host's contributors (a graph of another folder, e.g. a package, is not the host's)
 *   git: the host's git port (core/git); without it no branch or commit is recorded
 */
export function createGraphSync({ root = REPO_ROOT, repository = createGraphRepository(), settings, now = Date.now, contribute = true, git = null } = {}) {
    // with `known`, a file whose size and modification time match what was stored is not read again (every question
    // re-read and re-hashed all 25,000 files: 3.5 s). Without `known` (a full sync) every file is read.
    let resolvedSettings = settings;
    async function scan(known = null) {
        const resolved = settings || await loadProjectSettings();
        resolvedSettings = resolved;
        const found = new Map();
        await scanGraphFiles({
            rootDir: root,
            settings: resolved,
            onFile: (absolutePath, relativePath) => {
                if (!isIndexable(relativePath)) return;
                const file = toPosix(relativePath);
                try {
                    const info = fs.statSync(absolutePath);
                    const stat = `${info.size}:${Math.round(info.mtimeMs)}`;
                    const before = known?.get(file);
                    if (before?.hash && before.metadata?.stat === stat && before.metadata?.facts === FACTS_VERSION) { found.set(file, { source: null, hash: before.hash, stat }); return; }
                    const source = fs.readFileSync(absolutePath, 'utf8');
                    found.set(file, { source, hash: sha256(source), stat });
                } catch { /* unreadable file: treated as absent */ }
            }
        });
        return found;
    }

    function diff(known, current) {
        const added = [];
        const changed = [];
        for (const [file, { hash }] of current) {
            const before = known.get(file);
            if (!before) added.push(file);
            else if (before.hash !== hash || before.metadata?.facts !== FACTS_VERSION) changed.push(file);
        }
        const removed = [...known.keys()].filter(file => !current.has(file));
        return { added, changed, removed };
    }

    async function write(known, current, filesToIndex, removed) {
        const stamp = new Date(now()).toISOString();
        let packageJson = '';
        try { packageJson = fs.readFileSync(path.join(root, 'package.json'), 'utf8'); } catch { /* none */ }
        const entryPoints = entryPointsFrom(packageJson);
        const upserts = filesToIndex.map(file => {
            try {
                const entity = entityFor(file, current.get(file).source, { stamp, entryPoints, settings: resolvedSettings });
                entity.metadata = { ...entity.metadata, facts: FACTS_VERSION, ...(current.get(file).stat ? { stat: current.get(file).stat } : {}) };
                return entity;
            } catch (err) {
                const e = new Error(`Fout bij verwerken van '${file}': ${err.message}`);
                e.cause = err;
                throw e;
            }
        });
        const merged = new Map(known);
        for (const file of removed) merged.delete(file);
        for (const entity of upserts) merged.set(entity.path, { id: entity.id, type: entity.type, kind: entity.kind, hash: entity.contentHash, metadata: entity.metadata });
        // only the files that were read again can bring new dependency nodes; the rest are in the graph already
        const dependencyNodes = dependencyNodesOf(upserts, stamp);
        const extra = contribute ? await contributed(root, merged, stamp) : { nodes: [], relations: [] };
        const mendix = contribute ? await mendixContributor({ root }) : { nodes: [], relations: [] };
        const coChange = coChangeRelations(git ?? createGit({ root }), new Set([...merged.keys()].filter(file => merged.get(file).type === 'CodeFile')), { now: stamp });
        const totals = await repository.applyProjectChanges({ upserts: [...upserts, ...dependencyNodes, ...extra.nodes, ...mendix.nodes], removePaths: removed,
            relations: [...deriveProjectRelations(merged, stamp), ...coChange, ...extra.relations, ...mendix.relations] });
        return totals;
    }
    const api = {
        repository,

        /** Staleness report; writes nothing. */
        async status() {
            const known = await repository.projectFiles();
            const current = await scan(known);
            const delta = diff(known, current);
            const stats = await repository.stats();
            return {
                exists: known.size > 0,
                databasePath: repository.databasePath(),
                nodes: stats.scopes?.[PROJECT_SCOPE] || 0,
                newFiles: delta.added,
                changedFiles: delta.changed,
                removedFiles: delta.removed,
                stale: known.size === 0 || delta.added.length + delta.changed.length + delta.removed.length > 0
            };
        },

        /** Bring the project scope up to date and record branch and commit (`branch`, `commit`, `commitsSince`). */
        async sync(options = {}) {
            const result = await api.syncFiles(options);
            const head = await recordHead({ repository, git, wrote: result.wrote !== false, now: new Date(now()).toISOString() });
            return head ? { ...result, ...head } : result;
        },

        /** Bring the project scope up to date. `mode: 'full'` re-indexes every file. */
        async syncFiles({ mode = 'incremental' } = {}) {
            const started = Date.now();
            const stored = await repository.projectFiles();
            const current = await scan(mode === 'full' ? null : stored);
            const known = mode === 'full' ? new Map() : stored;
            const delta = diff(known, current);
            const removed = mode === 'full' ? [...stored.keys()].filter(file => !current.has(file)) : delta.removed;
            const unchanged = current.size - delta.added.length - delta.changed.length;

            if (stored.size && !delta.added.length && !delta.changed.length && !removed.length) {
                const stats = await repository.stats();
                return { mode, added: 0, updated: 0, removed: 0, unchanged, nodes: stats.scopes?.[PROJECT_SCOPE] || 0, edges: null, durationMs: Date.now() - started, databasePath: repository.databasePath(), wrote: false };
            }
            const totals = await write(known, current, [...delta.added, ...delta.changed], removed);
            const added = mode === 'full' ? [...current.keys()].filter(file => !stored.has(file)).length : delta.added.length;
            const updated = mode === 'full' ? current.size - added : delta.changed.length;
            return { mode, added, updated, removed: removed.length, unchanged: mode === 'full' ? 0 : unchanged, ...totals, durationMs: Date.now() - started, databasePath: repository.databasePath(), wrote: true };
        },

        /** Re-index only these repo-relative paths (e.g. the files `/code` just wrote). Missing files are removed. */
        async touch(paths = []) {
            const started = Date.now();
            const relevant = [...new Set(paths.map(p => toPosix(path.isAbsolute(p) ? path.relative(root, p) : p).replace(/^\.\//, '')))].filter(isIndexable);
            if (!relevant.length) return { added: 0, updated: 0, removed: 0, durationMs: 0, wrote: false };

            const known = await repository.projectFiles();
            const current = new Map();
            for (const file of relevant) {
                try {
                    const source = fs.readFileSync(path.join(root, file), 'utf8');
                    const info = fs.statSync(path.join(root, file));
                    current.set(file, { source, hash: sha256(source), stat: `${info.size}:${Math.round(info.mtimeMs)}` });
                } catch { /* gone */ }
            }
            const added = [...current.keys()].filter(file => !known.has(file));
            const updated = [...current.keys()].filter(file => known.has(file) && known.get(file).hash !== current.get(file).hash);
            const removed = relevant.filter(file => !current.has(file) && known.has(file));
            if (!added.length && !updated.length && !removed.length) return { added: 0, updated: 0, removed: 0, durationMs: Date.now() - started, wrote: false };

            const totals = await write(known, current, [...added, ...updated], removed);
            return { added: added.length, updated: updated.length, removed: removed.length, ...totals, durationMs: Date.now() - started, wrote: true };
        },

        /** Drop the whole project scope (rebuilt on the next sync). */
        async reset() {
            const known = await repository.projectFiles();
            await repository.applyProjectChanges({ removePaths: [...known.keys()] });
            return { removed: known.size };
        }
    };
    return api;
}
