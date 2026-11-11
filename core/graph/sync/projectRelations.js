import path from 'path';
import { resolveImportPath, resolveCallee } from '../model/index.js';
import { dependencyNodeId, fileNodeId } from '../adapters/ladybug/index.js';
import { deriveDocumentRelations } from './documentRelations.js';

const toPosix = (value) => String(value).replace(/\\/g, '/');

function deriveRunsRelations(file, runs, codePaths, now) {
    return runs
        .filter(target => codePaths.has(target))
        .map(target => ({ from: fileNodeId(file), to: fileNodeId(target), relation: 'RUNS', confidence: 'EXTRACTED', createdAt: now }));
}

function resolveProjectTarget(file, reference) {
    if (reference.kind !== 'project') return null;
    return toPosix(path.posix.normalize(path.posix.join(path.posix.dirname(file), reference.path)));
}

function toConfigReferenceRelation(file, reference, configPaths, now) {
    const target = resolveProjectTarget(file, reference);
    if (target && configPaths.includes(target)) {
        return { from: fileNodeId(file), to: fileNodeId(target), relation: 'PROJECT_REFERENCE', confidence: 'EXTRACTED', createdAt: now };
    }
    return { from: fileNodeId(file), to: dependencyNodeId(reference), relation: 'DEPENDS_ON', confidence: 'EXTRACTED', createdAt: now };
}

function deriveConfigRelations(file, info, { codePaths, configPaths, now }) {
    const runs = info.metadata?.runs || [];
    const references = info.metadata?.references || [];
    const runsList = deriveRunsRelations(file, runs, codePaths, now);
    const refList = references.map(ref => toConfigReferenceRelation(file, ref, configPaths, now));
    return [...runsList, ...refList];
}

function deriveReadRelations(file, info, configPaths, now) {
    const list = [];
    for (const name of info.metadata?.reads || []) {
        const matches = configPaths.filter(config => config === name || config.endsWith(`/${name}`));
        for (const target of matches) {
            list.push({ from: fileNodeId(file), to: fileNodeId(target), relation: 'READS', confidence: 'INFERRED', createdAt: now });
        }
    }
    return list;
}

function importRelationKind(kind) {
    if (kind === 'test') return 'TESTS';
    return 'IMPORTS';
}

function isValidTarget(target, file) {
    return target && target !== file;
}

function deriveImportRelations(file, info, has, now) {
    const list = [];
    const imports = info.metadata ? info.metadata.imports : null;
    if (!imports) return list;
    const relation = importRelationKind(info.kind);
    for (const specifier of imports) {
        const target = resolveImportPath(file, specifier, has);
        if (isValidTarget(target, file)) {
            list.push({ from: fileNodeId(file), to: fileNodeId(target), relation, confidence: 'EXTRACTED', createdAt: now });
        }
    }
    return list;
}

function resolveCallTarget(file, name, specifier, lookup) {
    if (!specifier) return null;
    return resolveCallee({ from: file, name, specifier }, lookup);
}

function countCallSites(file, calls, lookup) {
    const callSites = new Map();
    for (const [, name, , specifier] of calls) {
        const target = resolveCallTarget(file, name, specifier, lookup);
        if (target && target !== file) {
            const count = callSites.get(target) || 0;
            callSites.set(target, count + 1);
        }
    }
    return callSites;
}

function deriveCallRelations(file, info, lookup, now) {
    const calls = info.metadata?.calls || [];
    const callSites = countCallSites(file, calls, lookup);
    const list = [];
    for (const [target, weight] of callSites) {
        list.push({ from: fileNodeId(file), to: fileNodeId(target), relation: 'CALLS', confidence: 'EXTRACTED', weight, createdAt: now });
    }
    return list;
}

function deriveCodeRelations(file, info, { configPaths, has, lookup, now }) {
    return [
        ...deriveReadRelations(file, info, configPaths, now),
        ...deriveImportRelations(file, info, has, now),
        ...deriveCallRelations(file, info, lookup, now)
    ];
}

const TYPE_HANDLERS = {
    Config: deriveConfigRelations,
    CodeFile: deriveCodeRelations,
    Document: (file, info, ctx) => deriveDocumentRelations(file, info, ctx)
};

function isCodeFile(info) {
    return info.type === 'CodeFile' && info.kind !== 'test';
}

function appendDeclarer(byName, name, file) {
    const existing = byName.get(name);
    if (existing) {
        existing.push(file);
        return;
    }
    byName.set(name, [file]);
}

function recordDeclarer(byName, file, info) {
    if (!isCodeFile(info)) return;
    const ranges = info.metadata ? info.metadata.symbolRanges : null;
    if (!ranges) return;
    for (const name of Object.keys(ranges)) {
        appendDeclarer(byName, name, file);
    }
}

function buildDeclarers(files) {
    const byName = new Map();
    for (const [file, info] of files) {
        recordDeclarer(byName, file, info);
    }
    return byName;
}

/** All project relations from the metadata of every (current) project file. Pure. */
export function deriveProjectRelations(files, now = new Date().toISOString()) {
    const codePaths = new Set([...files.entries()].filter(([, info]) => info.type === 'CodeFile').map(([file]) => file));
    const configPaths = [...files.entries()].filter(([, info]) => info.type === 'Config').map(([file]) => file);
    const docPaths = new Set([...files.entries()].filter(([, info]) => info.type === 'Document').map(([file]) => file));
    const has = (file) => codePaths.has(file);
    const lookup = {
        has,
        declares: (file, name) => Boolean(files.get(file)?.metadata?.symbolRanges?.[name]),
        reexports: (file) => (files.get(file)?.metadata?.imports || []).map(specifier => resolveImportPath(file, specifier, has)).filter(Boolean)
    };
    // name -> the non-test code files that declare it, built once on first use
    let byName = null;
    const declarers = () => {
        if (!byName) byName = buildDeclarers(files);
        return byName;
    };
    const ctx = { codePaths, configPaths, docPaths, declarers, has, lookup, now };
    const relations = [];
    for (const [file, info] of files) {
        const handler = TYPE_HANDLERS[info.type];
        if (handler) relations.push(...handler(file, info, ctx));
    }
    return relations;
}
