/**
 * The Mendix model changes a branch or worktree brings, as data for a client: commits, changed files,
 * and per changed document its module, folders, name, type, element changes and, for a flow, before/after graphs.
 * Read from git or disk worktree without mxcli.
 * @module core/mendix/mendixDiff
 */
import path from 'path';
import { createGit } from '../git/index.js';
import { resolveRefTarget } from '../repository/index.js';
import { readMendixModel, readMendixModelFromFolder, locationOf } from './modelReader.js';
import { elementChanges } from './elementDiff.js';
import { flowComparison } from './flows.js';
import { findMpr, changedUnits, extractWidgetSummary } from './diffUnits.js';

const STATUS_NAMES = { A: 'added', D: 'removed', M: 'modified', R: 'renamed' };

function docMeta(where, doc) {
    const name = doc.Name ?? null;
    const qualifiedName = where.module && name ? `${where.module}.${name}` : name;
    return { module: where.module, folders: where.folders, name, type: doc.$Type, qualifiedName };
}

function documentEntry(id, change, before, after, options) {
    const beforeDoc = change === 'added' ? null : before.document(id);
    const afterDoc = change === 'deleted' ? null : after.document(id);
    const doc = afterDoc || beforeDoc;
    if (!doc) return null;
    const where = locationOf(change === 'deleted' ? before : after, id);
    const elements = elementChanges(beforeDoc, afterDoc, options);
    const flow = flowComparison(beforeDoc, afterDoc, elements);
    const entry = { id, change, ...docMeta(where, doc) };
    if (elements.length) entry.elements = elements;
    if (flow) entry.flow = flow;
    return entry;
}

function throwIfDubious(e) {
    const msg = String(e?.message || '');
    if (/dubious ownership/i.test(msg)) throw e;
}

function checkDubiousOwnership(git) {
    try {
        git?.resolveCommit?.('HEAD');
    } catch (e) {
        throwIfDubious(e);
    }
}

function loadModel(target, git, ref, project) {
    if (target?.isFolder || target?.isWorktree) {
        return readMendixModelFromFolder({ folder: target.folder, mpr: project });
    }
    return readMendixModel({ git, ref, mpr: project });
}

function filterDocs(documents, modules, docFilter) {
    let result = documents;
    if (modules) {
        const mods = Array.isArray(modules) ? modules : [modules];
        result = result.filter(d => mods.includes(d.module));
    }
    if (docFilter) {
        const docs = Array.isArray(docFilter) ? docFilter : [docFilter];
        result = result.filter(d => docs.includes(d.name) || docs.includes(d.qualifiedName));
    }
    return result;
}

function tryDiff(git, base, toRef) {
    try {
        return git.diffNameStatus?.(base, toRef) || [];
    } catch {
        return [];
    }
}

function getDiffFiles(targetTo, git, base) {
    if (targetTo.isWorktree) return git.worktreeChanges?.() || [];
    return tryDiff(git, base, targetTo.commit || targetTo.ref);
}

const formatResolved = r => ({ folder: r.folder, branch: r.branch ?? null, commit: r.commit ?? null, dirty: Boolean(r.dirty) });

function mergeBaseOf(git, a, b) {
    return git?.mergeBase ? git.mergeBase(a, b) : null;
}

function isCrossTarget(a, b) {
    return Boolean(a.isFolder || a.isWorktree || b.isFolder || b.isWorktree);
}

function determineBase(git, resFrom, resTo, from, to) {
    const fromRef = resFrom.commit || from;
    const toRef = resTo.commit || to;
    const base = mergeBaseOf(git, fromRef, toRef);
    if (base) return base;
    return isCrossTarget(resFrom, resTo) ? fromRef : null;
}

function tryCommitList(git, base, toRef) {
    try {
        return git.commitList(base, toRef);
    } catch {
        return [];
    }
}

function getCommits(git, base, toRef, isWorktree) {
    if (isWorktree || !base) return [];
    if (!git || !git.commitList) return [];
    return tryCommitList(git, base, toRef);
}

function resolveTargets(from, to, root, git, registryFile) {
    const resFrom = resolveRefTarget({ ref: from, root, git, registryFile });
    if (resFrom.error) return { error: resFrom.error };
    const resTo = resolveRefTarget({ ref: to, root, git, registryFile });
    if (resTo.error) return { error: resTo.error };
    return { resFrom, resTo };
}

function buildDiffResult({ base, project, resFrom, resTo, format, commits, files, documents, ignored, started, from, to, widgets }) {
    return {
        schemaVersion: 1, from, to,
        resolved: { from: formatResolved(resFrom), to: formatResolved(resTo) },
        mergeBase: base, project, format, commits,
        widgets,
        files: files.map(file => ({ ...file, status: STATUS_NAMES[file.status] || file.status })),
        documents,
        ...(Object.keys(ignored).length ? { ignored } : {}),
        durationMs: Date.now() - started
    };
}

async function executeDiff({ base, project, resFrom, resTo, git, detail, ignore, docFilter, modules, started, from, to }) {
    const files = getDiffFiles(resTo, git, base);
    const widgets = extractWidgetSummary(files, resTo.folder);
    const before = await loadModel(resFrom, git, base, project);
    let after = null;
    try {
        after = await loadModel(resTo, git, resTo.commit || to, project);
        const ignored = {};
        const options = { detail, ignore, ignored };
        const rawDocs = [...changedUnits(before, after, files)]
            .map(([id, change]) => documentEntry(id, change, before, after, options))
            .filter(entry => entry && entry.type !== 'Projects$Folder' && entry.type !== 'Projects$ModuleImpl')
            .sort((a, b) => String(a.module).localeCompare(String(b.module)) || String(a.name).localeCompare(String(b.name)));
        const commits = getCommits(git, base, resTo.commit || to, resTo.isWorktree);
        const documents = filterDocs(rawDocs, modules, docFilter);
        return buildDiffResult({ base, project, resFrom, resTo, format: after.format, commits, files, documents, ignored, started, from, to, widgets });
    } finally {
        [before, after].forEach(model => model?.close());
    }
}

export async function mendixDiff(opts = {}) {
    const started = Date.now();
    const { from, to, root = process.cwd() } = opts;
    if (!from || !to) return { schemaVersion: 1, error: 'from and to are required' };
    const git = opts.git || createGit({ root });
    checkDubiousOwnership(git);
    const targets = resolveTargets(from, to, root, git, opts.registryFile);
    if (targets.error) return { schemaVersion: 1, error: targets.error };
    const { resFrom, resTo } = targets;
    const base = determineBase(git, resFrom, resTo, from, to);
    if (!base) return { schemaVersion: 1, error: `no common history between ${from} and ${to}` };
    const project = opts.mpr || findMpr(git, to, resTo.folder) || findMpr(git, base, resFrom.folder);
    if (!project) return { schemaVersion: 1, error: `no .mpr in ${to}: not a Mendix project at ${path.basename(root)}` };
    return executeDiff({ base, project, resFrom, resTo, git, ...opts, started, from, to });
}
