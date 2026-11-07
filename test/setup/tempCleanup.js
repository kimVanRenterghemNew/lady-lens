// What a vitest worker leaves in the temp folder, and its removal: one graph database per worker and process.
import fs from 'fs';
import os from 'os';
import path from 'path';

/** Per worker AND per process: nothing is shared with an earlier run. */
export function workerTempFiles({ tmp = os.tmpdir(), worker = process.env.VITEST_WORKER_ID || 0, pid = process.pid } = {}) {
    return { graph: path.join(tmp, `lens-test-graph-${worker}-${pid}.lbdb`), home: path.join(tmp, `lens-test-home-${worker}-${pid}`) };
}

/** Removes the files (a Ladybug database may come with .wal/.shadow files, or be a folder). Never throws. */
export function removeWorkerTemp(files) {
    for (const base of Object.values(files)) {
        for (const target of [base, `${base}.wal`, `${base}.shadow`, `${base}.lock`]) {
            try { fs.rmSync(target, { recursive: true, force: true }); } catch { /* still open on Windows */ }
        }
    }
}
