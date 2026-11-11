/**
 * Small Mendix projects in a temporary git repository, for the model reader and mendix_diff: an .mpr (SQLite, one Unit row
 * per document) in MPR v1 (BSON in the row) or MPR v2 (BSON in mprcontents/<a>/<b>/<guid>.mxunit), committed per step.
 */
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { guidOf } from '../../core/mendix/index.js';

function cstring(text) { return Buffer.concat([Buffer.from(text, 'utf8'), Buffer.from([0])]); }

/** A plain object or array to BSON: strings, numbers (int32), booleans, null, nested objects and arrays. */
export function encodeBson(value, isArray = Array.isArray(value)) {
    const parts = [];
    for (const [key, field] of Object.entries(value)) {
        const name = cstring(isArray ? String(key) : key);
        if (typeof field === 'string') { const text = cstring(field); const length = Buffer.alloc(4); length.writeInt32LE(text.length); parts.push(Buffer.from([0x02]), name, length, text); }
        else if (typeof field === 'number') { const number = Buffer.alloc(4); number.writeInt32LE(field); parts.push(Buffer.from([0x10]), name, number); }
        else if (typeof field === 'boolean') parts.push(Buffer.from([0x08]), name, Buffer.from([field ? 1 : 0]));
        else if (field === null) parts.push(Buffer.from([0x0a]), name);
        else parts.push(Buffer.from([Array.isArray(field) ? 0x04 : 0x03]), name, encodeBson(field));
    }
    const body = Buffer.concat(parts);
    const size = Buffer.alloc(4);
    size.writeInt32LE(body.length + 5);
    return Buffer.concat([size, body, Buffer.from([0])]);
}

export const unitId = () => crypto.randomBytes(16);

/** A repository whose `commit(units, message, branch?)` writes the .mpr (and mprcontents/) for `units`: [{ id, container, doc }]. */
export async function mendixRepo({ format = 'mpr-v1' } = {}) {
    const { DatabaseSync } = await import('node:sqlite');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-mendix-git-'));
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    const write = units => {
        const mpr = path.join(root, 'App.mpr');
        fs.rmSync(mpr, { force: true });
        fs.rmSync(path.join(root, 'mprcontents'), { recursive: true, force: true });
        const db = new DatabaseSync(mpr);
        db.exec(`CREATE TABLE Unit (UnitID BLOB PRIMARY KEY NOT NULL, ContainerID BLOB, ContainmentName TEXT, ContentsHash TEXT${format === 'mpr-v1' ? ', Contents BLOB' : ''})`);
        for (const unit of units) {
            const bson = encodeBson(unit.doc);
            const hash = crypto.createHash('sha256').update(bson).digest('base64');
            if (format === 'mpr-v1') db.prepare('INSERT INTO Unit VALUES (?, ?, ?, ?, ?)').run(unit.id, unit.container ?? null, 'Documents', hash, bson);
            else {
                db.prepare('INSERT INTO Unit VALUES (?, ?, ?, ?)').run(unit.id, unit.container ?? null, 'Documents', hash);
                const guid = guidOf(unit.id);
                const file = path.join(root, 'mprcontents', guid.slice(0, 2), guid.slice(2, 4), `${guid}.mxunit`);
                fs.mkdirSync(path.dirname(file), { recursive: true });
                fs.writeFileSync(file, bson);
            }
        }
        db.close();
    };
    return {
        root,
        git,
        commit(units, message, branch = null) {
            if (branch) git('checkout', '-q', '-B', branch);
            write(units);
            git('add', '-A');
            git('commit', '-q', '-m', message);
        },
        checkout: branch => git('checkout', '-q', branch),
        remove: () => fs.rmSync(root, { recursive: true, force: true })
    };
}
