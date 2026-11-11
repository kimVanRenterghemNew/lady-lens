import { createGraphSync, indexBranch } from '../../graph/index.js';
import { createGit } from '../../git/index.js';
import { REPO_ROOT } from '../../configuration/index.js';
import { registerRepo, findRegisteredRepo } from '../../repository/index.js';

/**
 * Syncs the active repository and records the result in the registry. With `branch` only that branch is indexed (scope
 * `branch:<name>`, no checkout). A Mendix project syncs incrementally too: a changed model alone makes the sync write.
 */
// a registered repo keeps its database: writing the active one on every sync once pointed lady-lens at another repo's
// database for good (a context switch mid-sync), and every later sync of it wrote into that other database
const newDatabase = (repoPath) => (findRegisteredRepo(repoPath) ? {} : { database: process.env.LENS_GRAPH_DB });

export async function repoSync({ full, branch } = {}) {
    const activePath = process.env.LENS_REPO_ROOT || REPO_ROOT;
    const git = createGit({ root: activePath });
    if (branch) return indexBranch({ git, branch });
    const sync = await createGraphSync({ git }).sync({ mode: full ? 'full' : 'incremental' });
    registerRepo(activePath, { ...newDatabase(activePath), lastSync: new Date().toISOString(), nodes: sync.nodes });
    return sync;
}
