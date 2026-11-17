// Repository management for the page (the Repos tab): list, sync, rename, merge duplicates, remove and the folder settings. Changes are POSTs
// that carry the `x-lens-ui` header: a web page on another origin cannot send it without a CORS preflight, which this
// server never answers, so only the page itself can change the registry.
import fs from 'fs';
import { listRegisteredRepos, groupRegisteredRepos, registerRepo, unregisterRepo, findRegisteredRepo } from '../core/repository/index.js';
import { repoSync } from '../core/mcp/index.js';
import { readConfig, writeConfig } from './graph-ui-repo-config.mjs';

/** The registry and the sync the Repos tab works on; tests hand in their own. */
export const defaultRepos = { list: listRegisteredRepos, find: findRegisteredRepo, register: registerRepo, unregister: unregisterRepo, sync: repoSync };

const MAX_BODY = 4096;

const describe = r => ({ id: r.id, path: r.path, name: r.name, nodes: r.nodes, lastSync: r.lastSync, branch: r.branch, exists: fs.existsSync(r.path), group: r.groupId, copies: r.groupFolders.length, locations: r.locations || [] });

const fromPage = req => req.method === 'POST' && Boolean(req.headers['x-lens-ui']);

const groupOf = (repos, repo) => groupRegisteredRepos(repos.list()).find(r => r.id === repo.id)?.groupId;

const mergedLocations = (source, target) => [...new Set([...(target.locations ?? []), ...(source.locations ?? []), source.path])];

// the merged checkout stays registered, pointing at the database of the repository it joined, so a sync in either folder updates the one graph
const merge = (repos, { id, into }) => {
    const source = repos.find(id), target = repos.find(into);
    if (!source || !target || source.id === target.id) return { error: 'pick two different registered repositories' };
    if (groupOf(repos, source) !== groupOf(repos, target)) return { error: 'only copies of the same repository (same git history) can be merged' };
    repos.register(target.path, { locations: mergedLocations(source, target) });
    repos.register(source.path, { database: target.database, mergedInto: target.id });
    return { merged: source.id, into: target.id };
};

const rename = (repos, repo, name) => {
    if (typeof name !== 'string' || !name.trim()) return { error: 'a name is required' };
    repos.register(repo.path, { name: name.trim().slice(0, 80) });
    return { renamed: repo.id };
};

const ACTIONS = {
    sync: (repos, repo, { full }, inRepo) => inRepo(new URL(`http://x/?repo=${encodeURIComponent(repo.id)}`), () => repos.sync({ full: full === true })),
    rename: (repos, repo, { name }) => rename(repos, repo, name),
    remove: (repos, repo) => {
        repos.list().filter(r => r.mergedInto === repo.id).forEach(r => repos.unregister(r.id));
        return { removed: Boolean(repos.unregister(repo.id)) };
    },
    merge: (repos, repo, { into }) => merge(repos, { id: repo.id, into }),
    config: (_repos, repo, body) => writeConfig(repo, body)
};

/** Runs one change; `inRepo` points the sync at the right repository. */
function change(repos, inRepo, body) {
    const repo = repos.find(body.id), run = Object.hasOwn(ACTIONS, body.action) ? ACTIONS[body.action] : null;
    if (!repo) return { error: `unknown repository: ${body.id}` };
    return run ? run(repos, repo, body, inRepo) : { error: `unknown action: ${body.action}` };
}

const parse = text => {
    try { return JSON.parse(text ?? ''); } catch { return null; }
};

/** A checkout merged into another repository stays registered (it shares that database) but is not listed twice. */
const visible = all => all.filter(r => !r.mergedInto);

export const repoRoutes = (repos = defaultRepos) => ({
    '/api/repos/all'(_req, res, _url, { send }) {
        send(res, 200, visible(groupRegisteredRepos(repos.list())).map(describe));
    },

    async '/api/repos/config'(_req, res, url, { send }) {
        const repo = repos.find(url.searchParams.get('id'));
        send(res, repo ? 200 : 404, repo ? await readConfig(repo) : { error: 'unknown repository' });
    },

    async '/api/repos/change'(req, res, _url, { send, inRepo, readBody, canSwitch }) {
        if (!fromPage(req)) return send(res, 403, { error: 'POST from the page only' });
        const body = parse(await readBody(req, MAX_BODY));
        if (!body) return send(res, 400, { error: 'JSON body expected' });
        if (body.action === 'sync' && !canSwitch) return send(res, 409, { error: 'sync of another repository needs the daemon (lens mcp -d)' });
        send(res, 200, await change(repos, inRepo, body));
    }
});
