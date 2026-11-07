/** The entity of one file, shared by the sync of the working copy and the index of a branch that is not checked out. */
import { buildCodeEntity, buildConfigEntity, buildDependencyEntity, buildDocumentEntity } from '../adapters/ladybug/index.js';
import { DEFAULT_SCRIPT_PATHS } from './codeFacts.js';
import { isDocFile, isConfigFile } from './languages/index.js';

/** Files the package declares as entry points (`bin`, `main`): the CLI dispatcher is found by "cli"/"command". */
export function entryPointsFrom(packageJson) {
    try {
        const pkg = JSON.parse(packageJson);
        const bins = typeof pkg.bin === 'string' ? [pkg.bin] : Object.values(pkg.bin || {});
        return new Set([...bins, pkg.main].filter(Boolean).map(entry => String(entry).replace(/\\/g, '/').replace(/^\.\//, '')));
    } catch {
        return new Set();
    }
}

export function entityFor(file, source, { stamp, entryPoints, settings }) {
    if (isDocFile(file)) return buildDocumentEntity(file, source, { now: stamp });
    if (isConfigFile(file)) return buildConfigEntity(file, source, { now: stamp });
    const scriptPaths = [...DEFAULT_SCRIPT_PATHS, ...(settings?.project?.script_paths || [])];
    const entity = buildCodeEntity(file, source, { now: stamp, includeAst: settings?.graph?.ast?.enabled === true, scriptPaths });
    if (entryPoints.has(file)) entity.metadata.keywords = [...entity.metadata.keywords, 'cli', 'entrypoint', 'command'];
    return entity;
}

/** Dependency nodes for the references of these files (entities or stored infos with `metadata`). */
export const dependencyNodesOf = (infos, stamp) => [...infos].flatMap(info => (info.metadata?.references || []).map(reference => buildDependencyEntity(reference, { now: stamp })));
