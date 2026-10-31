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
import { resolveImportPath, resolveCallee } from '../model/index.js';
import { debug } from '../../observability/index.js';
import { DEFAULT_SCRIPT_PATHS } from './codeFacts.js';
import { coChangeRelations } from './gitHistory.js';
import { buildCodeEntity, buildConfigEntity, buildDocumentEntity, fileNodeId } from '../adapters/ladybug/index.js';
import { deriveDocumentRelations } from './documentRelations.js';
import { isCodeFile, isDocFile, isConfigFile } from './languages/index.js';

const toPosix = (value) => String(value).replace(/\\/g, '/');
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

// Knowledge a host adds that the graph cannot read from files (e.g. its composition). Each contributor gets
// `{ root, files }` at every write and returns `{ nodes, relations }`; a failing one is skipped (logged), the files still get written.
let contributors = [];
export function configureLensContributors(list = []) {
    contributors = [...list];
}

async function contributed(root, files, stamp) {
    const nodes = [];
    const relations = [];
    for (const contributor of contributors) {
        try {
            const result = await contributor({ root, files });
            for (const node of result?.nodes || []) nodes.push({ scope: PROJECT_SCOPE, path: '', contentHash: '', metadata: {}, createdAt: stamp, updatedAt: stamp, observedAt: stamp, ...node });
            for (const relation of result?.relations || []) relations.push({ confidence: 'EXTRACTED', createdAt: stamp, ...relation });
        } catch (error) {
            debug(1, 'graph:contributor', `a graph contributor failed and was skipped: ${error.message}`);
        }
    }
    return { nodes, relations };
}

export function isProjectGraphEnabled(env = process.env) {
    return lensEnv('PROJECT_GRAPH', env) !== '0';
}

function isIndexable(file) {
    return isCodeFile(file) || isDocFile(file) || isConfigFile(file);
}

/** Files the package declares as entry points (`bin`, `main`): the CLI dispatcher is found by "cli"/"command". */
function entryPointsOf(root) {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
        const bins = typeof pkg.bin === 'string' ? [pkg.bin] : Object.values(pkg.bin || {});
        return new Set([...bins, pkg.main].filter(Boolean).map(entry => toPosix(entry).replace(/^\.\//, '')));
    } catch {
        return new Set();
    }
}

/** Bumped when the facts of a file gain a field: every file is then re-read once, also when its content did not change. */
export const FACTS_VERSION = 6;

/** All project relations from the metadata of every (current) project file. Pure. */
export function deriveProjectRelations(files, now = new Date().toISOString()) {
    const codePaths = new Set([...files.entries()].filter(([, info]) => info.type === 'CodeFile').map(([file]) => file));
    const configPaths = [...files.entries()].filter(([, info]) => info.type === 'Config').map(([file]) => file);
    const docPaths = new Set([...files.entries()].filter(([, info]) => info.type === 'Document').map(([file]) => file));
    const has = (file) => codePaths.has(file);
    const lookup = {
        has,
        declares: (file, name) => Boolean(files.get(file)?.metadata?.symbolRanges?.[name]),
        reexports: (file) => (files.get(file)?.metadata?.imports || []).map(specifier => resolveImportPath(file, specifier, has)).filter(Boolean)
    };
    // name -> the non-test code files that declare it, built once on first use
    let byName = null;
    const declarers = () => {
        if (byName) return byName;
        byName = new Map();
        for (const [file, info] of files) {
            if (info.type !== 'CodeFile' || info.kind === 'test') continue;
            for (const name of Object.keys(info.metadata?.symbolRanges || {})) byName.set(name, [...(byName.get(name) || []), file]);
        }
        return byName;
    };
    const relations = [];
    for (const [file, info] of files) {
        if (info.type === 'Config') {
            // An npm script that starts a script: package.json RUNS it.
            for (const target of info.metadata?.runs || []) {
                if (codePaths.has(target)) relations.push({ from: fileNodeId(file), to: fileNodeId(target), relation: 'RUNS', confidence: 'EXTRACTED', createdAt: now });
            }
        } else if (info.type === 'CodeFile') {
            // Code that names a config file (by file name) READS it.
            for (const name of info.metadata?.reads || []) {
                for (const target of configPaths.filter(config => config === name || config.endsWith(`/${name}`))) {
                    relations.push({ from: fileNodeId(file), to: fileNodeId(target), relation: 'READS', confidence: 'INFERRED', createdAt: now });
                }
            }
            for (const specifier of info.metadata?.imports || []) {
                const target = resolveImportPath(file, specifier, has);
                if (!target || target === file) continue;
                relations.push({ from: fileNodeId(file), to: fileNodeId(target), relation: info.kind === 'test' ? 'TESTS' : 'IMPORTS', confidence: 'EXTRACTED', createdAt: now });
            }
            // A call to a function of another file CALLS that file (through barrels); weight = number of call sites.
            const callSites = new Map();
            for (const [, name, , specifier] of info.metadata?.calls || []) {
                const target = specifier ? resolveCallee({ from: file, name, specifier }, lookup) : null;
                if (target && target !== file) callSites.set(target, (callSites.get(target) || 0) + 1);
            }
            for (const [target, weight] of callSites) relations.push({ from: fileNodeId(file), to: fileNodeId(target), relation: 'CALLS', confidence: 'EXTRACTED', weight, createdAt: now });
        } else if (info.type === 'Document') {
            relations.push(...deriveDocumentRelations(file, info, { codePaths, docPaths, declarers, now }));
        }
    }
    return relations;
}

/**
 * @param {{root?: string, repository?: object, settings?: object, now?: () => number, contribute?: boolean}} [options]
 *   contribute: false leaves out the host's contributors (a graph of another folder, e.g. a package, is not the host's)
 */
export function createGraphSync({ root = REPO_ROOT, repository = createGraphRepository(), settings, now = Date.now, contribute = true } = {}) {
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

    function entityFor(file, source, stamp, entryPoints) {
        if (isDocFile(file)) return buildDocumentEntity(file, source, { now: stamp });
        if (isConfigFile(file)) return buildConfigEntity(file, source, { now: stamp });
        const scriptPaths = [...DEFAULT_SCRIPT_PATHS, ...(resolvedSettings?.project?.script_paths || [])];
        const entity = buildCodeEntity(file, source, { now: stamp, includeAst: resolvedSettings?.graph?.ast?.enabled === true, scriptPaths });
        if (entryPoints.has(file)) entity.metadata.keywords = [...entity.metadata.keywords, 'cli', 'entrypoint', 'command'];
        return entity;
    }

    async function write(known, current, filesToIndex, removed) {
        const stamp = new Date(now()).toISOString();
        const entryPoints = entryPointsOf(root);
        const upserts = filesToIndex.map(file => {
            try {
                const entity = entityFor(file, current.get(file).source, stamp, entryPoints);
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

        const extra = contribute ? await contributed(root, merged, stamp) : { nodes: [], relations: [] };
        // What changes together (git history), recomputed at every write.
        const coChange = coChangeRelations(root, new Set([...merged.keys()].filter(file => merged.get(file).type === 'CodeFile')), { now: stamp });
        const totals = await repository.applyProjectChanges({ upserts: [...upserts, ...extra.nodes], removePaths: removed, relations: [...deriveProjectRelations(merged, stamp), ...coChange, ...extra.relations] });
        return totals;
    }

    return {
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

        /** Bring the project scope up to date. `mode: 'full'` re-indexes every file. */
        async sync({ mode = 'incremental' } = {}) {
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
}
