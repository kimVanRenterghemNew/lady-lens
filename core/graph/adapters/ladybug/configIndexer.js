/**
 * Pure: the project entity for one configuration file (YAML, package.json). Kind `config`; what it is for (its leading
 * comment, or a package's description); its top-level keys; and, for package.json, the scripts its npm scripts run.
 */
import crypto from 'crypto';
import path from 'path';
import { fileNodeId } from './ladybugIndexer.js';
import { normalizeNodeId } from '../../index.js';

const RUNS = /(?:^|[\s;&|])(?:node|bash|sh|pwsh|powershell)\s+(?:-\S+\s+)*([\w./-]+\.(?:m?js|cjs|sh|ps1))/g;

/** `node scripts/report.mjs --x && bash scripts/y.sh` -> ['scripts/report.mjs', 'scripts/y.sh'] */
export function scriptsRun(command) {
    return [...String(command).matchAll(RUNS)].map(match => match[1].replace(/^\.\//, ''));
}

function yamlFacts(source) {
    const purpose = [];
    for (const line of String(source).split(/\r?\n/)) {
        if (/^\s*#/.test(line)) purpose.push(line.replace(/^\s*#\s?/, '').trim());
        else if (line.trim()) break;
    }
    const keys = [...String(source).matchAll(/^([A-Za-z_][\w.-]*)\s*:/gm)].map(match => match[1]);
    return { purpose: purpose.join(' ').slice(0, 240), keys, runs: [] };
}

function packageFacts(source) {
    let pkg;
    try { pkg = JSON.parse(source); } catch { return { purpose: '', keys: [], runs: [] }; }
    const runs = [...new Set(Object.values(pkg.scripts || {}).flatMap(scriptsRun))].sort();
    return { purpose: String(pkg.description || pkg.name || '').slice(0, 240), keys: Object.keys(pkg), runs };
}

function xmlAttributes(tag) {
    return Object.fromEntries([...String(tag).matchAll(/([A-Za-z][\w.-]*)\s*=\s*["']([^"']*)["']/g)].map(match => [match[1], match[2]]));
}

function projectFacts(source) {
    const references = [];
    for (const match of String(source).matchAll(/<ProjectReference\b([^>]*)>/gi)) {
        const attributes = xmlAttributes(match[1]);
        if (attributes.Include) references.push({ kind: 'project', name: attributes.Include, path: attributes.Include });
    }
    for (const match of String(source).matchAll(/<PackageReference\b([^>]*)\/>|<PackageReference\b([^>]*)>([\s\S]*?)<\/PackageReference>/gi)) {
        const attributes = xmlAttributes(match[1] || match[2]);
        const version = attributes.Version || match[3]?.match(/<Version>\s*([^<]+?)\s*<\/Version>/i)?.[1] || '';
        if (attributes.Include) references.push({ kind: 'package', name: attributes.Include, ...(version ? { version } : {}) });
    }
    return { purpose: '', keys: ['ProjectReference', 'PackageReference'], runs: [], references };
}

function referenceManagerFacts(source) {
    const references = [];
    for (const match of String(source).matchAll(/<functionalblock\b[^>]*>([\s\S]*?)<\/functionalblock>/gi)) {
        const name = match[1].match(/<name>([^<]+)<\/name>/i)?.[1]?.trim();
        const version = match[1].match(/<version>([^<]+)<\/version>/i)?.[1]?.trim();
        const type = match[1].match(/<type>([^<]+)<\/type>/i)?.[1]?.trim();
        if (name) references.push({ kind: 'functionalblock', name, ...(version ? { version } : {}), ...(type ? { type } : {}) });
    }
    return { purpose: '', keys: ['functionalblocks', 'projects'], runs: [], references };
}

function configFacts(relativePath, source) {
    const extension = path.extname(relativePath).toLowerCase();
    if (path.basename(relativePath) === 'package.json') return packageFacts(source);
    if (extension === '.csproj') return projectFacts(source);
    if ((extension === '.xml' && /<referenceManager\b/i.test(source)) || path.basename(relativePath).toLowerCase() === 'packages.reference') return referenceManagerFacts(source);
    return yamlFacts(source);
}

export function dependencyNodeId(reference) {
    const version = reference.version ? `@${reference.version}` : '';
    return normalizeNodeId(`dependency:${reference.kind}:${reference.name}${version}`);
}

export function buildDependencyEntity(reference, { now = new Date().toISOString() } = {}) {
    return {
        id: dependencyNodeId(reference),
        type: 'Dependency',
        kind: reference.kind,
        scope: 'project',
        path: '',
        name: reference.name,
        contentHash: '',
        documentation: reference.type || '',
        metadata: { ...(reference.version ? { version: reference.version } : {}) },
        createdAt: now,
        updatedAt: now,
        observedAt: now
    };
}

export function buildConfigEntity(relativePath, source, { now = new Date().toISOString() } = {}) {
    const facts = configFacts(relativePath, source);
    return {
        id: fileNodeId(relativePath),
        type: 'Config',
        kind: 'config',
        scope: 'project',
        path: relativePath,
        name: path.basename(relativePath),
        contentHash: crypto.createHash('sha256').update(source).digest('hex'),
        documentation: facts.purpose,
        metadata: { keys: facts.keys.slice(0, 60), runs: facts.runs, ...(facts.references?.length ? { references: facts.references } : {}) },
        createdAt: now,
        updatedAt: now,
        observedAt: now
    };
}
