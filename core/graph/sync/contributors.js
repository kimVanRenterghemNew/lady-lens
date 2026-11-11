import { PROJECT_SCOPE } from '../repository/index.js';
import { debug } from '../../observability/index.js';

// Knowledge a host adds that the graph cannot read from files (e.g. its composition). Each contributor gets
// `{ root, files }` at every write and returns `{ nodes, relations }`; a failing one is skipped (logged), the files still get written.
let contributors = [];
export function configureLensContributors(list = []) {
    contributors = [...list];
}
function pushContributedNodes(nodeList, stamp, nodes) {
    for (const node of nodeList) nodes.push({ scope: PROJECT_SCOPE, path: '', contentHash: '', metadata: {}, createdAt: stamp, updatedAt: stamp, observedAt: stamp, ...node });
}

function pushContributedRelations(relationList, stamp, relations) {
    for (const relation of relationList) relations.push({ confidence: 'EXTRACTED', createdAt: stamp, ...relation });
}

function recordContributorResult(result, stamp, nodes, relations) {
    if (!result) return;
    if (result.nodes) pushContributedNodes(result.nodes, stamp, nodes);
    if (result.relations) pushContributedRelations(result.relations, stamp, relations);
}

async function runContributor(contributor, root, files, stamp, nodes, relations) {
    try {
        const result = await contributor({ root, files });
        recordContributorResult(result, stamp, nodes, relations);
    } catch (error) {
        debug(1, 'graph:contributor', `a graph contributor failed and was skipped: ${error.message}`);
    }
}

export async function contributed(root, files, stamp) {
    const nodes = [];
    const relations = [];
    for (const contributor of contributors) {
        await runContributor(contributor, root, files, stamp, nodes, relations);
    }
    return { nodes, relations };
}
