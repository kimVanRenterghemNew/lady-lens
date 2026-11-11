/**
 * Command-level glue around GraphSync: what `/plan`, `/code` and `/graph` do with it.
 * Kept out of the entry point on purpose: it only decides, the caller reports.
 * TODO(coverage): Current line coverage is 83.33% (< 85% target). Raise to >= 85%.
 *
 * @module core/graph/projectGraphGate
 */
import { createGraphSync, isProjectGraphEnabled } from '../sync/index.js';

const noop = () => {};

function summaryLine(result) {
    return `🕸️ Project graph: ${result.nodes} nodes${result.edges === null ? '' : `, ${result.edges} edges`} `
        + `(${result.added} new, ${result.updated} changed, ${result.removed} removed, ${result.unchanged ?? '?'} unchanged, ${result.durationMs} ms)`;
}

function recordSync(record, result, trigger) {
    record({
        event: 'graph_sync', trigger, mode: result.mode || 'incremental',
        added: result.added, updated: result.updated, removed: result.removed, unchanged: result.unchanged ?? null,
        node_count: result.nodes, edge_count: result.edges, duration_ms: result.durationMs, wrote: result.wrote
    });
}

/**
 * Make sure the project graph exists and is current before planning. An EMPTY graph is an error,
 * never a silent `matches: 0`: that silence is what hid a never-filled graph for a whole phase.
 * @returns {Promise<{ok: boolean, skipped?: boolean, reason?: 'empty'|'error', result?: object, error?: string}>}
 */
export async function ensureProjectGraph({ sync, enabled = isProjectGraphEnabled(), log = noop, record = noop } = {}) {
    if (!enabled) return { ok: true, skipped: true };
    try {
        const result = await (sync || createGraphSync()).sync();
        recordSync(record, result, 'plan');
        log(summaryLine(result));
        return result.nodes > 0 ? { ok: true, result } : { ok: false, reason: 'empty', result };
    } catch (error) {
        return { ok: false, reason: 'error', error: error.message };
    }
}

/** Re-index files that `/code` (or Execute) just wrote. Never throws: a stale graph must not fail a successful write. */
export async function touchProjectGraph({ paths = [], sync, enabled = isProjectGraphEnabled(), log = noop, record = noop } = {}) {
    if (!enabled || !paths.length) return null;
    try {
        const result = await (sync || createGraphSync()).touch(paths);
        if (result.wrote) {
            recordSync(record, { ...result, mode: 'touch' }, 'code');
            log(`🕸️ Project graph updated: +${result.added} ~${result.updated} -${result.removed}`);
        }
        return result;
    } catch (error) {
        log(`⚠️  Project graph not updated (${error.message}). Run /graph sync.`);
        return null;
    }
}

async function handleStatus(sync, log) {
    const status = await sync.status();
    const countText = status.exists ? `${status.nodes} nodes` : 'not built yet';
    log(`🕸️ Project graph (Ladybug ${status.databasePath}): ${countText}`);
    const staleText = `   stale: ${status.newFiles.length} new, ${status.changedFiles.length} changed, ${status.removedFiles.length} removed - run /graph sync`;
    log(status.stale ? staleText : '   up to date');
    return status;
}

async function handleSync(sync, flags, log, record) {
    const mode = flags.includes('--full') ? 'full' : 'incremental';
    const result = await sync.sync({ mode });
    recordSync(record, result, 'command');
    log(summaryLine(result));
    return result;
}

async function handleReset(sync, log) {
    const result = await sync.reset();
    log(`🕸️ Project scope removed from the graph (${result.removed} files). It is rebuilt on the next /plan or /graph sync.`);
    return { reset: true };
}

const GRAPH_COMMAND_ACTIONS = {
    __proto__: null, // "/graph toString" must print the usage, not call an inherited function
    status(sync, _flags, log) { return handleStatus(sync, log); },
    sync(sync, flags, log, record) { return handleSync(sync, flags, log, record); },
    reset(sync, _flags, log) { return handleReset(sync, log); }
};

const COMMAND_DEFAULTS = { sync: null, log: noop, record: noop };

/** `/graph status | sync [--full] | reset` */
export async function runGraphCommand(args, deps) {
    const opts = Object.assign({}, COMMAND_DEFAULTS, deps);
    const sync = opts.sync || createGraphSync();
    const parts = String(args || '').trim().split(/\s+/).filter(Boolean);
    const action = parts[0] || 'status';
    const flags = parts.slice(1);

    const handler = GRAPH_COMMAND_ACTIONS[action];
    if (!handler) {
        opts.log('Usage: /graph [status|sync [--full]|reset]');
        return null;
    }
    return handler(sync, flags, opts.log, opts.record);
}
