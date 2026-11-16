/**
 * Bundled background sync queue for repositories (backlog/snelheid-en-hooks.md AC6).
 * At most one sync runs per repo at a time; if triggers arrive while running, exactly
 * one additional sync runs when the current one finishes.
 * @module core/mcp/syncQueue
 */
export function createSyncQueue(runSync) {
    const running = new Set();
    const pending = new Set();

    async function trigger(repo) {
        if (running.has(repo)) {
            pending.add(repo);
            return;
        }
        running.add(repo);
        try {
            await runSync(repo);
        } catch {
            // background sync errors never crash the daemon or fail the queue
        } finally {
            running.delete(repo);
            if (pending.has(repo)) {
                pending.delete(repo);
                trigger(repo);
            }
        }
    }

    return {
        trigger,
        isRunning: (repo) => running.has(repo),
        isPending: (repo) => pending.has(repo)
    };
}
