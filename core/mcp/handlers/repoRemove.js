import { unregisterRepo } from '../../repository/index.js';

export function repoRemove({ repo }) {
    const removed = unregisterRepo(repo);
    return { removed: !!removed, repo: removed };
}
