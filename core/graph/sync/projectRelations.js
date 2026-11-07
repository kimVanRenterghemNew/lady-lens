import path from 'path';
import { resolveImportPath, resolveCallee } from '../model/index.js';
import { dependencyNodeId, fileNodeId } from '../adapters/ladybug/index.js';
import { deriveDocumentRelations } from './documentRelations.js';

const toPosix = (value) => String(value).replace(/\\/g, '/');

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
        if (byName) return byName;
        byName = new Map();
        for (const [file, info] of files) {
            if (info.type !== 'CodeFile' || info.kind === 'test') continue;
            for (const name of Object.keys(info.metadata?.symbolRanges || {})) byName.set(name, [...(byName.get(name) || []), file]);
        }
        return byName;
    };
    const relations = [];
    for (const [file, info] of files) {
        if (info.type === 'Config') {
            // An npm script that starts a script: package.json RUNS it.
            for (const target of info.metadata?.runs || []) {
                if (codePaths.has(target)) relations.push({ from: fileNodeId(file), to: fileNodeId(target), relation: 'RUNS', confidence: 'EXTRACTED', createdAt: now });
            }
            for (const reference of info.metadata?.references || []) {
                const target = reference.kind === 'project'
                    ? toPosix(path.posix.normalize(path.posix.join(path.posix.dirname(file), reference.path)))
                    : null;
                if (target && configPaths.includes(target)) {
                    relations.push({ from: fileNodeId(file), to: fileNodeId(target), relation: 'PROJECT_REFERENCE', confidence: 'EXTRACTED', createdAt: now });
                } else {
                    relations.push({ from: fileNodeId(file), to: dependencyNodeId(reference), relation: 'DEPENDS_ON', confidence: 'EXTRACTED', createdAt: now });
                }
            }
        } else if (info.type === 'CodeFile') {
            // Code that names a config file (by file name) READS it.
            for (const name of info.metadata?.reads || []) {
                for (const target of configPaths.filter(config => config === name || config.endsWith(`/${name}`))) {
                    relations.push({ from: fileNodeId(file), to: fileNodeId(target), relation: 'READS', confidence: 'INFERRED', createdAt: now });
                }
            }
            for (const specifier of info.metadata?.imports || []) {
                const target = resolveImportPath(file, specifier, has);
                if (!target || target === file) continue;
                relations.push({ from: fileNodeId(file), to: fileNodeId(target), relation: info.kind === 'test' ? 'TESTS' : 'IMPORTS', confidence: 'EXTRACTED', createdAt: now });
            }
            // A call to a function of another file CALLS that file (through barrels); weight = number of call sites.
            const callSites = new Map();
            for (const [, name, , specifier] of info.metadata?.calls || []) {
                const target = specifier ? resolveCallee({ from: file, name, specifier }, lookup) : null;
                if (target && target !== file) callSites.set(target, (callSites.get(target) || 0) + 1);
            }
            for (const [target, weight] of callSites) relations.push({ from: fileNodeId(file), to: fileNodeId(target), relation: 'CALLS', confidence: 'EXTRACTED', weight, createdAt: now });
        } else if (info.type === 'Document') {
            relations.push(...deriveDocumentRelations(file, info, { codePaths, docPaths, declarers, now }));
        }
    }
    return relations;
}
