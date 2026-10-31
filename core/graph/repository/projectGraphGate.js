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

/** `/graph status | sync [--full] | reset` */
export async function runGraphCommand(args = '', { sync = createGraphSync(), log = noop, record = noop } = {}) {
    const [action = 'status', ...flags] = String(args).trim().split(/\s+/).filter(Boolean);

    if (action === 'status') {
        const status = await sync.status();
        log(`🕸️ Project graph (Ladybug ${status.databasePath}): ${status.exists ? `${status.nodes} nodes` : 'not built yet'}`);
        log(status.stale
            ? `   stale: ${status.newFiles.length} new, ${status.changedFiles.length} changed, ${status.removedFiles.length} removed - run /graph sync`
            : '   up to date');
        return status;
    }
    if (action === 'sync') {
        const result = await sync.sync({ mode: flags.includes('--full') ? 'full' : 'incremental' });
        recordSync(record, result, 'command');
        log(summaryLine(result));
        return result;
    }
    if (action === 'reset') {
        const result = await sync.reset();
        log(`🕸️ Project scope removed from the graph (${result.removed} files). It is rebuilt on the next /plan or /graph sync.`);
        return { reset: true };
    }
    log('Usage: /graph [status|sync [--full]|reset]');
    return null;
}
