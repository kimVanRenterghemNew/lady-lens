/**
 * Detect which Mendix units changed between two models (MPR v1 by ContentsHash, MPR v2 by .mxunit files).
 * @module core/mendix/diffUnits
 */
import fs from 'fs';
import path from 'path';
import { guidFromFile } from './modelReader.js';

function findSubMpr(folder, sub) {
    try {
        const subFiles = fs.readdirSync(path.join(folder, sub.name));
        const match = subFiles.filter(n => /\.mpr$/i.test(n)).sort()[0];
        return match ? path.posix.join(sub.name, match) : null;
    } catch {
        return null;
    }
}

function matchSubMpr(folder, entries) {
    for (const sub of entries.filter(e => e.isDirectory() && !e.name.startsWith('.'))) {
        const nested = findSubMpr(folder, sub);
        if (nested) return nested;
    }
    return null;
}

function findDiskMpr(folder) {
    try {
        const entries = fs.readdirSync(folder, { withFileTypes: true });
        const rootMpr = entries.filter(e => e.isFile() && /\.mpr$/i.test(e.name)).map(e => e.name).sort()[0];
        return rootMpr || matchSubMpr(folder, entries);
    } catch {
        return null;
    }
}

const depthOf = p => p.split('/').length;

function findGitMpr(git, ref) {
    const tree = git?.listTree?.(ref) || [];
    const mprs = tree.filter(name => /\.mpr$/i.test(name));
    return mprs.sort((a, b) => depthOf(a) - depthOf(b) || a.localeCompare(b))[0] ?? null;
}

export function findMpr(git, ref, folder) {
    const disk = folder ? findDiskMpr(folder) : null;
    return disk || findGitMpr(git, ref);
}

const isWidgetFile = f => /(?:^|[\\/])widgets[\\/].+\.mpk$/i.test(f.path);
const baseNameOf = p => path.posix.basename(p.replace(/\\/g, '/'));

function readDiskWidgetCount(folder) {
    if (!folder) return null;
    const dir = path.join(folder, 'widgets');
    if (!fs.existsSync(dir)) return 0;
    try {
        return fs.readdirSync(dir).filter(f => /\.mpk$/i.test(f)).length;
    } catch {
        return null;
    }
}

export function extractWidgetSummary(files, folder) {
    const list = (files || []).filter(isWidgetFile);
    const added = list.filter(f => f.status === 'added' || f.status === 'A').map(f => baseNameOf(f.path));
    const removed = list.filter(f => f.status === 'removed' || f.status === 'D').map(f => baseNameOf(f.path));
    const modified = list.filter(f => f.status === 'modified' || f.status === 'M').map(f => baseNameOf(f.path));
    const diskCount = readDiskWidgetCount(folder);
    const res = { changed: list.length > 0, added, removed, modified };
    if (diskCount !== null) res.diskCount = diskCount;
    return res;
}

const unitChange = (oldUnit, newUnit) => {
    if (!oldUnit) return 'added';
    if (oldUnit.hash !== newUnit.hash) return 'modified';
    return null;
};

function recordAfterUnitsV2(afterUnits, beforeUnits, touched, changes) {
    for (const [id, unit] of afterUnits) {
        if (touched.has(unit.guid)) changes.set(id, beforeUnits.has(id) ? 'modified' : 'added');
    }
}

function recordDeletedUnitsV2(beforeUnits, afterUnits, touched, changes) {
    for (const [id, unit] of beforeUnits) {
        if (!afterUnits.has(id) && (touched.has(unit.guid) || !unit.file)) changes.set(id, 'deleted');
    }
}

function changedUnitsV2(before, after, files) {
    const changes = new Map();
    const touched = new Set((files || []).filter(file => /\.mxunit$/i.test(file.path)).flatMap(file => [file.path, file.oldPath].filter(Boolean)).map(guidFromFile));
    recordAfterUnitsV2(after.units, before.units, touched, changes);
    recordDeletedUnitsV2(before.units, after.units, touched, changes);
    return changes;
}

function v1UnitsDiff(before, after) {
    const changes = new Map();
    for (const [id, unit] of after.units) {
        const change = unitChange(before.units.get(id), unit);
        if (change) changes.set(id, change);
    }
    for (const id of before.units.keys()) if (!after.units.has(id)) changes.set(id, 'deleted');
    return changes;
}

export function changedUnits(before, after, files) {
    const isV2 = after.format === 'mpr-v2' || before.format === 'mpr-v2';
    if (isV2 && files?.length) return changedUnitsV2(before, after, files);
    return v1UnitsDiff(before, after);
}
