/**
 * One search over several registered projects: every project, or only `repos` (id or path). Project after project (MCP
 * tool calls hold the repo lock); each project's matches stay apart. A name that is not registered comes back in `unknown`.
 */
import { listRegisteredRepos, findRegisteredRepo } from '../../repository/index.js';
import { searchView } from '../../search/index.js';

const DEFAULT_LIMIT = 50;

export function crossRepoSearch(args = {}, { list = listRegisteredRepos, find = findRegisteredRepo, search = searchView } = {}) {
    const { query, repos, limit = DEFAULT_LIMIT, ...options } = args ?? {};
    if (typeof query !== 'string' || !query.trim()) return { error: 'query is required' };
    const asked = Array.isArray(repos) && repos.length ? repos : null;
    const targets = asked ? asked.map(hint => find(hint)) : list();
    const unknown = asked ? asked.filter((hint, index) => !targets[index]) : [];
    const max = Math.max(1, Math.min(Number(limit) || DEFAULT_LIMIT, 1000));
    const results = [];
    let total = 0;
    for (const target of [...new Map(targets.filter(Boolean).map(target => [target.id, target])).values()]) {
        const found = search({ ...options, query, limit: max }, { root: target.path });
        if (found.error) return found;
        total += found.totalMatches;
        if (found.files.length) results.push({ repo: target.id, path: target.path, totalMatches: found.totalMatches, files: found.files, ...(found.truncated ? { truncated: true } : {}) });
    }
    return { query: query.trim(), repos: results, unknown, total, truncated: results.some(result => result.truncated) };
}
