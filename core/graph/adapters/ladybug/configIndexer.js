/**
 * Pure: the project entity for one configuration file (YAML, package.json). Kind `config`; what it is for (its leading
 * comment, or a package's description); its top-level keys; and, for package.json, the scripts its npm scripts run.
 */
import crypto from 'crypto';
import path from 'path';
import { fileNodeId } from './ladybugIndexer.js';

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

export function buildConfigEntity(relativePath, source, { now = new Date().toISOString() } = {}) {
    const facts = path.basename(relativePath) === 'package.json' ? packageFacts(source) : yamlFacts(source);
    return {
        id: fileNodeId(relativePath),
        type: 'Config',
        kind: 'config',
        scope: 'project',
        path: relativePath,
        name: path.basename(relativePath),
        contentHash: crypto.createHash('sha256').update(source).digest('hex'),
        documentation: facts.purpose,
        metadata: { keys: facts.keys.slice(0, 60), runs: facts.runs },
        createdAt: now,
        updatedAt: now,
        observedAt: now
    };
}
