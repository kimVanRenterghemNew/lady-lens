/**
 * Index a branch without checking it out: its own scope `branch:<name>`, filled from the git objects (`ls-tree`,
 * `cat-file --batch`) with the same extractors as the working copy. The working copy, HEAD and the project scope are not
 * touched. Node ids get the scope as prefix, because an id is unique across scopes. A second index of the same branch reads
 * only what changed between the stored commit and the branch tip.
 * @module core/graph/sync/branchIndex
 */
import crypto from 'crypto';
import { loadProjectSettings, inGraphScope } from '../../repository/index.js';
import { createGraphRepository } from '../repository/index.js';
import { FACTS_VERSION } from './graphSync.js';
import { entityFor, entryPointsFrom, dependencyNodesOf } from './fileEntity.js';
import { deriveProjectRelations } from './projectRelations.js';
import { isCodeFile, isDocFile, isConfigFile } from './languages/index.js';

export const branchScope = name => `branch:${name}`;
const scoped = (scope, id) => `${scope}|${id}`;
const isIndexable = file => isCodeFile(file) || isDocFile(file) || isConfigFile(file);

/**
 * @param {{repository?: object, git: object, branch: string, settings?: object, now?: () => number}} options
 * @returns {Promise<{scope: string, branch: string, commit: string, mode: string, added: number, updated: number, removed: number, unchanged: number}>}
 */
export async function indexBranch({ repository = createGraphRepository(), git, branch, settings, now = Date.now }) {
    if (!git) throw new Error('indexBranch requires git');
    const sha = git.resolveCommit(branch);
    if (!sha) throw new Error(`Onbekende branch of commit: '${branch}'`);
    const resolved = settings || await loadProjectSettings();
    const scope = branchScope(branch);
    const headId = scoped(scope, 'head');
    const stored = await repository.scopeFiles(scope);
    const [headNode] = await repository.loadNodes({ ids: [headId] });
    const previous = headNode?.metadata?.head;

    let candidates = null; // null: the whole tree
    if (stored.size && previous && git.prefix() === '' && git.resolveCommit(previous) && [...stored.values()].every(info => info.metadata?.facts === FACTS_VERSION)) {
        if (previous === sha) return { scope, branch, commit: sha.slice(0, 7), mode: 'incremental', added: 0, updated: 0, removed: 0, unchanged: stored.size, wrote: false };
        candidates = git.changedSince(previous, sha);
    }
    const tree = candidates ?? git.listTree(sha);
    if (!tree) throw new Error(`Kan de bestanden van '${branch}' niet lezen`);
    const wanted = tree.filter(file => isIndexable(file) && inGraphScope(file, resolved));
    const texts = git.readBlobs(sha, wanted);

    const stamp = new Date(now()).toISOString();
    const entryPoints = entryPointsFrom(git.readBlobs(sha, ['package.json']).get('package.json') || '');
    const upserts = [];
    for (const [file, source] of texts) {
        if (source === null) continue;
        const entity = entityFor(file, source, { stamp, entryPoints, settings: resolved });
        entity.metadata = { ...entity.metadata, facts: FACTS_VERSION };
        upserts.push({ ...entity, id: scoped(scope, entity.id), scope });
    }
    const gone = [...texts].filter(([, source]) => source === null).map(([file]) => file);
    const removed = candidates ? gone.filter(file => stored.has(file)) : [...stored.keys()].filter(file => !texts.get(file) && texts.get(file) !== '');
    const merged = new Map(candidates ? stored : []);
    for (const file of removed) merged.delete(file);
    for (const entity of upserts) merged.set(entity.path, { id: entity.id, type: entity.type, kind: entity.kind, hash: entity.contentHash, metadata: entity.metadata });

    // relations come out with working-copy ids; every id in this scope has the scope prefix
    const relations = deriveProjectRelations(merged, stamp).map(relation => ({ ...relation, from: scoped(scope, relation.from), to: scoped(scope, relation.to) }));
    const dependencies = dependencyNodesOf(merged.values(), stamp).map(node => ({ ...node, id: scoped(scope, node.id), scope }));
    const head = { id: headId, type: 'Branch', kind: 'branch-index', scope, path: '', name: branch, contentHash: crypto.createHash('sha256').update(sha).digest('hex'), createdAt: stamp, updatedAt: stamp, observedAt: stamp, metadata: { head: sha } };
    await repository.applyScopeChanges(scope, { upserts: [...upserts, ...dependencies, head], removePaths: removed, relations });

    const added = upserts.filter(entity => !stored.has(entity.path)).length;
    return { scope, branch, commit: sha.slice(0, 7), mode: candidates ? 'incremental' : 'full', added, updated: upserts.length - added, removed: removed.length, unchanged: merged.size - upserts.length, wrote: true };
}
