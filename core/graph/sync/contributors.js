import { PROJECT_SCOPE } from '../repository/index.js';
import { debug } from '../../observability/index.js';

// Knowledge a host adds that the graph cannot read from files (e.g. its composition). Each contributor gets
// `{ root, files }` at every write and returns `{ nodes, relations }`; a failing one is skipped (logged), the files still get written.
let contributors = [];
export function configureLensContributors(list = []) {
    contributors = [...list];
}
export async function contributed(root, files, stamp) {
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
