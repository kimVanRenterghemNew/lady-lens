import { createGraphSync, findMendixProject, indexBranch } from '../../graph/index.js';
import { createGit } from '../../git/index.js';
import { REPO_ROOT } from '../../configuration/index.js';
import { registerRepo } from '../../repository/index.js';

/** Syncs the active repository (Mendix projects always in full) and records the result in the registry. With `branch` only that branch is indexed (scope `branch:<name>`, no checkout). */
export async function repoSync({ full, branch } = {}) {
    const activePath = process.env.LENS_REPO_ROOT || REPO_ROOT;
    const git = createGit({ root: activePath });
    if (branch) return indexBranch({ git, branch });
    const sync = await createGraphSync({ git }).sync({ mode: full || findMendixProject(activePath) ? 'full' : 'incremental' });
    registerRepo(activePath, { database: process.env.LENS_GRAPH_DB, lastSync: new Date().toISOString(), nodes: sync.nodes });
    return sync;
}
