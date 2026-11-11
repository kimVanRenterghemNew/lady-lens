/**
 * The Mendix model changes a branch brings, as data for a client (an extension draws and words it): commits, changed files,
 * and per changed document its module, folders, name, type, element changes and, for a flow, before/after graphs.
 * Read from git at the merge-base and at `to`, without a checkout and without mxcli. MPR v1: documents compared by
 * ContentsHash; MPR v2: the .mxunit files git reports as changed.
 * @module core/mendix/mendixDiff
 */
import path from 'path';
import { createGit } from '../git/index.js';
import { readMendixModel, locationOf, guidFromFile } from './modelReader.js';
import { elementChanges } from './elementDiff.js';
import { flowComparison } from './flows.js';

const STATUS_NAMES = { A: 'added', D: 'removed', M: 'modified', R: 'renamed' };

function findMpr(git, ref) {
    return (git.listTree(ref) || []).filter(name => /\.mpr$/i.test(name) && !name.includes('/')).sort()[0] ?? null;
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
    const touched = new Set(files.filter(file => /\.mxunit$/i.test(file.path)).flatMap(file => [file.path, file.oldPath].filter(Boolean)).map(guidFromFile));
    recordAfterUnitsV2(after.units, before.units, touched, changes);
    recordDeletedUnitsV2(before.units, after.units, touched, changes);
    return changes;
}

// which units differ: MPR v1 by ContentsHash, MPR v2 by the .mxunit files of the file diff
function changedUnits(before, after, files) {
    if (after.format === 'mpr-v2' || before.format === 'mpr-v2') {
        return changedUnitsV2(before, after, files);
    }
    const changes = new Map();
    for (const [id, unit] of after.units) {
        const change = unitChange(before.units.get(id), unit);
        if (change) changes.set(id, change);
    }
    for (const id of before.units.keys()) if (!after.units.has(id)) changes.set(id, 'deleted');
    return changes;
}

function documentEntry(id, change, before, after) {
    const beforeDoc = change === 'added' ? null : before.document(id);
    const afterDoc = change === 'deleted' ? null : after.document(id);
    const doc = afterDoc ?? beforeDoc;
    if (!doc) return null;
    const where = locationOf(change === 'deleted' ? before : after, id);
    const elements = elementChanges(beforeDoc, afterDoc);
    const flow = flowComparison(beforeDoc, afterDoc, elements);
    return {
        id, change, module: where.module, folders: where.folders, name: doc.Name ?? null, type: doc.$Type,
        qualifiedName: where.module && doc.Name ? `${where.module}.${doc.Name}` : doc.Name ?? null,
        ...(change === 'modified' ? { elements } : {}),
        ...(flow ? { flow } : {})
    };
}

/**
 * @param {{ from: string, to: string, root?: string, git?: object, mpr?: string }} args
 *   from: base branch (the diff is against its merge-base with `to`); to: the branch with the changes
 */
export async function mendixDiff({ from, to, root = process.cwd(), git = createGit({ root }), mpr } = {}) {
    const started = Date.now();
    if (!from || !to) return { error: 'from and to are required' };
    for (const ref of [from, to]) if (!git.resolveCommit(ref)) return { error: `unknown branch or commit: ${ref}` };
    const base = git.mergeBase(from, to);
    if (!base) return { error: `no common history between ${from} and ${to}` };
    const project = mpr ?? findMpr(git, to) ?? findMpr(git, base);
    if (!project) return { error: `no .mpr in ${to}: not a Mendix project at ${path.basename(root)}` };
    const files = git.diffNameStatus(base, to);
    const before = await readMendixModel({ git, ref: base, mpr: project });
    let after = null;
    try {
        after = await readMendixModel({ git, ref: to, mpr: project });
        const documents = [...changedUnits(before, after, files)]
            .map(([id, change]) => documentEntry(id, change, before, after))
            .filter(entry => entry && entry.type !== 'Projects$Folder' && entry.type !== 'Projects$ModuleImpl')
            .sort((a, b) => String(a.module).localeCompare(String(b.module)) || String(a.name).localeCompare(String(b.name)));
        return {
            from, to, mergeBase: base, project, format: after.format,
            commits: git.commitList(base, to),
            files: files.map(file => ({ ...file, status: STATUS_NAMES[file.status] || file.status })),
            documents,
            durationMs: Date.now() - started
        };
    } finally {
        [before, after].forEach(model => model?.close());
    }
}
