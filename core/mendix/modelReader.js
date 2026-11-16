/**
 * A Mendix model at one commit or on disk, read without a checkout or mxcli.
 * The .mpr is SQLite with one Unit row per document (its container and a ContentsHash).
 * MPR v1 keeps BSON in the row (Contents); MPR v2 keeps it in mprcontents/…/<guid>.mxunit.
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

function readUnits(db, columns) {
    const rows = db.prepare(`SELECT UnitID AS id, ContainerID AS container${columns.has('ContentsHash') ? ', ContentsHash AS hash' : ''} FROM Unit`).all();
    return new Map(rows.map(row => [hex(row.id), { container: hex(row.container), hash: row.hash ?? null, guid: guidOf(Buffer.from(row.id)) }]));
}

function contentFilesOf(git, ref, inRow) {
    if (inRow) return new Map();
    return new Map((git.listTree(ref) || []).filter(name => /\.mxunit$/i.test(name)).map(name => [guidFromFile(name), name]));
}

function recordDiskEntry(entry, dir, baseDir, result) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
        listDiskMxUnits(full, baseDir, result);
        return;
    }
    if (/\.mxunit$/i.test(entry.name)) result.push(path.relative(baseDir, full).replace(/\\/g, '/'));
}

function listDiskMxUnits(dir, baseDir, result) {
    if (!fs.existsSync(dir)) return result;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) recordDiskEntry(entry, dir, baseDir, result);
    return result;
}

function diskContentFilesOf(folder, inRow) {
    if (inRow) return new Map();
    const contentsDir = path.join(folder, 'mprcontents');
    const files = listDiskMxUnits(contentsDir, folder, []);
    return new Map(files.map(name => [guidFromFile(name), name]));
}

function fetchDocBytes(id, inRow, readRow, units, readBlob) {
    if (inRow) return readRow.get(Buffer.from(id, 'hex'))?.Contents;
    const file = units.get(id)?.file;
    return file ? readBlob(file) : null;
}

function createModel(db, inRow, units, readBlob, close) {
    const readRow = inRow ? db.prepare('SELECT Contents FROM Unit WHERE UnitID = ?') : null;
    const cache = new Map();
    const document = id => {
        if (cache.has(id)) return cache.get(id);
        const bytes = fetchDocBytes(id, inRow, readRow, units, readBlob);
        const doc = bytes ? decodeBson(Buffer.from(bytes)) : null;
        cache.set(id, doc);
        return doc;
    };
    return { format: inRow ? 'mpr-v1' : 'mpr-v2', units, document, close };
}

function openModelDb(file, onOpen) {
    const DatabaseSync = onOpen.DatabaseSync;
    const removeFile = () => fs.rmSync(file, { force: true });
    let db = null;
    try {
        db = new DatabaseSync(file, { readOnly: true });
        return onOpen.build(db, () => { db.close(); removeFile(); });
    } catch (error) {
        db?.close();
        removeFile();
        throw error;
    }
}

export async function readMendixModel({ git, ref, mpr }) {
    const DatabaseSync = await sqlite();
    if (!DatabaseSync) throw new Error(`reading a Mendix model needs node:sqlite (Node 22.13+)`);
    const bytes = git.readBlobBytes(ref, mpr);
    if (!bytes) throw new Error(`${mpr} is not in ${ref}`);
    const file = path.join(os.tmpdir(), `lens-mpr-${crypto.randomUUID()}.mpr`);
    fs.writeFileSync(file, bytes);
    return openModelDb(file, {
        DatabaseSync,
        build: (db, close) => {
            const columns = new Set(db.prepare('PRAGMA table_info(Unit)').all().map(c => c.name));
            const inRow = columns.has('Contents');
            const units = readUnits(db, columns);
            const contentFiles = contentFilesOf(git, ref, inRow);
            for (const unit of units.values()) unit.file = contentFiles.get(unit.guid) ?? null;
            return createModel(db, inRow, units, f => git.readBlobBytes(ref, f), close);
        }
    });
}

export async function readMendixModelFromFolder({ folder, mpr }) {
    const DatabaseSync = await sqlite();
    if (!DatabaseSync) throw new Error(`reading a Mendix model needs node:sqlite (Node 22.13+)`);
    const mprPath = path.join(folder, mpr);
    if (!fs.existsSync(mprPath)) throw new Error(`${mpr} is not in ${folder}`);
    const file = path.join(os.tmpdir(), `lens-mpr-${crypto.randomUUID()}.mpr`);
    fs.copyFileSync(mprPath, file);
    return openModelDb(file, {
        DatabaseSync,
        build: (db, close) => {
            const columns = new Set(db.prepare('PRAGMA table_info(Unit)').all().map(c => c.name));
            const inRow = columns.has('Contents');
            const units = readUnits(db, columns);
            const contentFiles = diskContentFilesOf(folder, inRow);
            for (const unit of units.values()) unit.file = contentFiles.get(unit.guid) ?? null;
            const readBlob = f => { try { return fs.readFileSync(path.join(folder, f)); } catch { return null; } };
            return createModel(db, inRow, units, readBlob, close);
        }
    });
}

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
