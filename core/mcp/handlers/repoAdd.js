import path from 'path';
import { createGraphSync } from '../../graph/index.js';
import { registerRepo } from '../../repository/index.js';

/** Registers a checkout and (unless `sync: false`) indexes it; `activate` makes it the active repository first. */
export async function repoAdd({ path: dir, db, database, branch, sync: doSync = true }, { activate }) {
    const target = path.resolve(dir);
    const extra = Object.fromEntries(Object.entries({ db, database, branch }).filter(([, value]) => value));
    const registered = registerRepo(target, extra);
    if (doSync === false) return { registered, sync: null };
    activate(registered);
    const sync = await createGraphSync().sync({ mode: 'incremental' });
    registerRepo(target, { ...(extra.database ? { database: extra.database } : {}), lastSync: new Date().toISOString(), nodes: sync.nodes });
    return { registered, sync };
}
