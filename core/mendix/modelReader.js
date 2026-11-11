/**
 * A Mendix model at one commit, read from git without a checkout. The .mpr is SQLite with one Unit row per document (its
 * container and a ContentsHash). An MPR v1 project keeps the BSON in the row (Contents); an MPR v2 project (Mendix 10+)
 * keeps it in mprcontents/…/<guid>.mxunit. Changed documents are found by hash, so only those are decoded.
 * @module core/mendix/modelReader
 */
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { decodeBson, guidOf } from './bson.js';

async function sqlite() {
    try { return (await import('node:sqlite')).DatabaseSync; } catch { return null; }
}

const hex = bytes => (bytes ? Buffer.from(bytes).toString('hex') : null);
/** The GUID an mprcontents/ file is named after (lower case, without folders and extension). */
export const guidFromFile = name => path.posix.basename(name.replace(/\\/g, '/')).replace(/\.mxunit$/i, '').toLowerCase();

/**
 * @param {{ git: object, ref: string, mpr: string }} options - `mpr`: the .mpr path as git knows it at `ref`
 * @returns {Promise<{ format: string, units: Map<string, {container: string|null, hash: string}>, document: (id: string) => object|null, close: () => void }>}
 */
export async function readMendixModel({ git, ref, mpr }) {
    const DatabaseSync = await sqlite();
    if (!DatabaseSync) throw new Error(`reading a Mendix model needs node:sqlite (Node 22.13+); this lens runs on Node ${process.version}. Choose a newer Node with: lens node <path to node.exe>`);
    const bytes = git.readBlobBytes(ref, mpr);
    if (!bytes) throw new Error(`${mpr} is not in ${ref}`);
    const file = path.join(os.tmpdir(), `lens-mpr-${crypto.randomUUID()}.mpr`);
    fs.writeFileSync(file, bytes);
    const removeFile = () => fs.rmSync(file, { force: true });
    let db = null;
    try {
        db = new DatabaseSync(file, { readOnly: true });
        return modelOf(db, git, ref, () => { db.close(); removeFile(); });
    } catch (error) {
        db?.close(); // a corrupt .mpr must not leave its (often 100+ MB) temp copy locked behind
        removeFile();
        throw error;
    }
}

function readUnits(db, columns) {
    const rows = db.prepare(`SELECT UnitID AS id, ContainerID AS container${columns.has('ContentsHash') ? ', ContentsHash AS hash' : ''} FROM Unit`).all();
    return new Map(rows.map(row => [hex(row.id), { container: hex(row.container), hash: row.hash ?? null, guid: guidOf(Buffer.from(row.id)) }]));
}

// MPR v2: the file of a unit is named after its GUID (which files changed, git's file diff tells: see mendixDiff)
function contentFilesOf(git, ref, inRow) {
    if (inRow) return new Map();
    return new Map((git.listTree(ref) || []).filter(name => /\.mxunit$/i.test(name)).map(name => [guidFromFile(name), name]));
}

function modelOf(db, git, ref, close) {
    const columns = new Set(db.prepare('PRAGMA table_info(Unit)').all().map(column => column.name));
    const inRow = columns.has('Contents');
    const units = readUnits(db, columns);
    const contentFiles = contentFilesOf(git, ref, inRow);
    for (const unit of units.values()) unit.file = contentFiles.get(unit.guid) ?? null;
    const readRow = inRow ? db.prepare('SELECT Contents FROM Unit WHERE UnitID = ?') : null;
    const cache = new Map();
    const document = id => {
        if (cache.has(id)) return cache.get(id);
        const bytes = inRow ? readRow.get(Buffer.from(id, 'hex'))?.Contents : units.get(id)?.file && git.readBlobBytes(ref, units.get(id).file);
        const doc = bytes ? decodeBson(Buffer.from(bytes)) : null;
        cache.set(id, doc);
        return doc;
    };
    return {
        format: inRow ? 'mpr-v1' : 'mpr-v2',
        units,
        document,
        close
    };
}

/** Module and folder path of a unit, from its container chain (`Projects$ModuleImpl`, `Projects$Folder`). */
export function locationOf(model, id) {
    const folders = [];
    let at = model.units.get(id)?.container;
    for (let guard = 0; at && guard < 64; guard += 1) {
        const doc = model.document(at);
        if (!doc) break;
        if (doc.$Type === 'Projects$ModuleImpl') return { module: doc.Name, folders: folders.reverse() };
        if (doc.$Type === 'Projects$Folder') folders.push(doc.Name);
        at = model.units.get(at)?.container;
    }
    return { module: null, folders: folders.reverse() };
}
