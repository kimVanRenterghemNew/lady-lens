/**
 * The MDL export of a Mendix project: mxcli's text of every document in .mxcli/mdl/<Module>/<Name>.<type>.mdl, so lens
 * grep/glob/read_chunk find widget and flow settings that live only in the binary .mpr.
 *
 * It runs in its own background process (`lens mendix-export <project>`), never inside a sync: its catalog refresh took
 * 617 s on a changed 4,000-file project, and the sync, and every MCP call queued behind it, waited for it.
 * LENS_MDL_EXPORT: `background` (default), `inline` (wait for it, as before), `off`.
 */
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { debug } from '../../observability/index.js';
import { lensEnv } from '../../configuration/index.js';
import { mxcli, mxcliPath } from './mxcli.js';

const LENS_BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'bin', 'lens.mjs');
const REFRESH_TIMEOUT_MS = 60 * 60_000;
const safeSegment = (value) => String(value).replace(/[^\w.-]/g, '_').replace(/^\.+/, '_');
const mxcliDir = project => path.join(path.dirname(project), '.mxcli');
const stateFile = project => path.join(mxcliDir(project), 'lens-mdl.json');
const lockFile = project => path.join(mxcliDir(project), 'lens-mdl.lock');
const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

// mxcli's -c output folds SourceText onto one line, so the text is read from its catalog.db (the FTS5 content table).
// process.getBuiltinModule (Node 20.16+/22.3+) answers synchronously; on older Node there is no node:sqlite either
export const canExportMdl = () => { try { return Boolean(process.getBuiltinModule?.('node:sqlite')); } catch { return false; } };

/** The state of a Mendix model: the .mpr and, for MPR v2 (Mendix 10+), its mprcontents/; a change makes it stale. */
export function projectKey(project) {
    const stat = fs.statSync(project);
    let files = 0, newest = 0;
    const walk = dir => {
        for (const entry of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
            if (entry.isDirectory()) walk(path.join(dir, entry.name));
            else { files += 1; newest = Math.max(newest, fs.statSync(path.join(dir, entry.name)).mtimeMs); }
        }
    };
    walk(path.join(path.dirname(project), 'mprcontents'));
    return `${stat.size}:${stat.mtimeMs}:${files}:${newest}:${mxcliPath()}:mdl=${canExportMdl()}`;
}

async function loadSqlite() {
    try { return (await import('node:sqlite')).DatabaseSync; } catch {
        console.warn(`lady-lens: Node ${process.version} has no node:sqlite (Node 22.13+ needed); Mendix text not exported. Run: lens node <newer node.exe>`);
        return null;
    }
}

function readSourceRows(catalog, DatabaseSync) {
    if (!fs.existsSync(catalog)) return [];
    try {
        const db = new DatabaseSync(catalog, { readOnly: true });
        try { return db.prepare('SELECT c0 AS name, c1 AS type, c2 AS text FROM source_content').all(); } finally { db.close(); }
    } catch { return []; }
}

function sourceDocPath(dir, row) {
    const [module, ...rest] = String(row.name).split('.');
    return path.join(dir, safeSegment(module), `${safeSegment(rest.join('.') || module)}.${safeSegment(String(row.type || 'document').toLowerCase())}.mdl`);
}

function writeSourceDoc(dir, row) {
    if (!row || !row.name || typeof row.text !== 'string') return 0;
    const file = sourceDocPath(dir, row);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, row.text);
    return 1;
}

/** Refreshes mxcli's catalog with the source text and writes it to .mxcli/mdl. The catalog keeps the text per unit hash. */
export async function writeMendixSources(project, cli = mxcliPath()) {
    // without node:sqlite the catalog cannot be read: skip the refresh, which took 17 min on a first build
    const DatabaseSync = await loadSqlite();
    if (!DatabaseSync) return 0;
    await mxcli(project, ['-c', 'refresh catalog full source'], cli, REFRESH_TIMEOUT_MS);
    const rows = readSourceRows(path.join(mxcliDir(project), 'catalog.db'), DatabaseSync);
    if (rows.length === 0) return 0; // keep the previous export when there is no source index
    const dir = path.join(mxcliDir(project), 'mdl');
    fs.rmSync(dir, { recursive: true, force: true });
    return rows.reduce((written, row) => written + writeSourceDoc(dir, row), 0);
}

/**
 * The export itself (the background process runs this). Afterwards the cached mxcli answer of the sync is dropped: its
 * catalog questions (page fields) were asked before this refresh, so the next sync asks them again.
 */
export async function runMdlExport(project) {
    const started = Date.now();
    const key = projectKey(project);
    try {
        const documents = await writeMendixSources(project);
        fs.writeFileSync(stateFile(project), JSON.stringify({ key, documents, durationMs: Date.now() - started, finishedAt: new Date().toISOString() }));
        fs.rmSync(path.join(mxcliDir(project), 'lens-contribution.json'), { force: true });
        debug(1, 'mendix', `MDL export: ${documents} documents written to .mxcli/mdl in ${Date.now() - started} ms`);
    } catch (error) {
        debug(1, 'mendix', `MDL export failed after ${Date.now() - started} ms: ${error.stack || error}`);
    } finally {
        fs.rmSync(lockFile(project), { force: true });
    }
}

const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };

const STARTERS = {
    off: () => 'off',
    inline: async project => { await runMdlExport(project); return 'done'; },
    background: project => {
        const lock = readJson(lockFile(project));
        if (lock?.pid && alive(lock.pid)) return `running (pid ${lock.pid})`;
        const child = spawn(process.execPath, [LENS_BIN, 'mendix-export', project], { detached: true, stdio: 'ignore', windowsHide: true, env: process.env });
        child.unref();
        fs.writeFileSync(lockFile(project), JSON.stringify({ pid: child.pid, startedAt: new Date().toISOString() }));
        return `started in the background (pid ${child.pid})`;
    }
};

/** Starts the MDL export when the model changed since the last one; says what it did. Never waits in `background`. */
const exportMode = () => (canExportMdl() && STARTERS[lensEnv('MDL_EXPORT')] ? lensEnv('MDL_EXPORT') : canExportMdl() ? 'background' : 'off');

export async function startMdlExport(project) {
    const mode = exportMode();
    if (mode === 'off') return 'off';
    if (readJson(stateFile(project))?.key === projectKey(project)) return 'up to date';
    fs.mkdirSync(mxcliDir(project), { recursive: true });
    return STARTERS[mode](project);
}
