#!/usr/bin/env node
/**
 * Eval: where does a sync of a Mendix project spend its time? Syncs into a temporary database (the real lens is never
 * touched) and times each phase apart: the code graph without Mendix, every mxcli call of the Mendix contributor on its
 * own, the contributor as a whole (as sync runs it), and a second sync with nothing changed.
 *
 * Usage: node evals/mendixSync.mjs <project folder> [--json] [--skip-graph]
 *   LENS_MXCLI_PATH=<mxcli> when mxcli is not on the PATH.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { performance } from 'perf_hooks';
import { createGraphSync, createGraphRepository, findMendixProject, mendixContributor } from '../core/graph/index.js';
import { configureLensRoot } from '../core/configuration/index.js';

const run = promisify(execFile);
const MXCLI_CALLS = {
    'mxcli project-tree': ['project-tree'],
    'mxcli structure -d 3': ['structure', '-d', '3'],
    'mxcli graph-report': ['graph-report'],
    'mxcli CATALOG.widgets': ['-c', "SELECT ContainerQualifiedName AS page, Name AS widget FROM CATALOG.widgets WHERE ContainerType = 'PAGE' AND (AttributeRef <> '' OR MicroflowRef <> '' OR NanoflowRef <> '')"],
    'mxcli CATALOG.attributes': ['-c', 'SELECT EntityQualifiedName AS entity, Name AS name FROM CATALOG.attributes WHERE IsRequired = 1'],
    'mxcli refresh catalog full source': ['-c', 'refresh catalog full source']
};

async function timed(label, fn, results) {
    const t0 = performance.now();
    let note;
    try { note = (await fn()) ?? ''; } catch (error) { note = `error: ${String(error.message).split('\n')[0]}`; }
    const ms = Math.round(performance.now() - t0);
    results.push({ phase: label, ms, note: String(note) });
    console.error(`${label.padEnd(36)} ${String(ms).padStart(8)} ms  ${note}`);
}

export async function evalMendixSync(root, { skipGraph = false } = {}) {
    const project = findMendixProject(root);
    if (!project) throw new Error(`no .mpr in ${root}`);
    const mxcli = process.env.LENS_MXCLI_PATH || 'mxcli';
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-mendix-eval-'));
    const repository = createGraphRepository({ databasePath: path.join(temp, 'graph.lbdb') });
    configureLensRoot(root);
    const results = [];
    try {
        for (const [label, args] of Object.entries(MXCLI_CALLS)) {
            await timed(label, async () => `${(await run(mxcli, [...args, '-p', project, '--json'], { maxBuffer: 256 * 1024 * 1024, windowsHide: true })).stdout.length} bytes`, results);
        }
        fs.rmSync(path.join(root, '.mxcli', 'lens-contribution.json'), { force: true });
        await timed('mendixContributor, .mpr changed', async () => { const r = await mendixContributor({ root }); return `${r.nodes.length} nodes, ${r.relations.length} relations`; }, results);
        await timed('mendixContributor, .mpr unchanged', async () => { const r = await mendixContributor({ root }); return `${r.nodes.length} nodes (cache)`; }, results);
        if (!skipGraph) {
            await timed('graph sync full, without Mendix', async () => { const r = await createGraphSync({ root, repository, contribute: false }).syncFiles({ mode: 'full' }); return JSON.stringify(r).slice(0, 80); }, results);
            await timed('graph sync again, nothing changed', async () => { const r = await createGraphSync({ root, repository }).sync(); return JSON.stringify(r).slice(0, 80); }, results);
        }
    } finally {
        fs.rmSync(temp, { recursive: true, force: true });
    }
    return { project, results };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
    const root = process.argv[2];
    if (!root) { console.error('usage: node evals/mendixSync.mjs <project folder> [--json] [--skip-graph]'); process.exit(2); }
    const { project, results } = await evalMendixSync(path.resolve(root), { skipGraph: process.argv.includes('--skip-graph') });
    if (process.argv.includes('--json')) console.log(JSON.stringify({ project, results }, null, 2));
    else console.log(`\n${project}\n${results.map(r => `${r.phase.padEnd(36)} ${String(r.ms).padStart(8)} ms  ${r.note}`).join('\n')}`);
}
