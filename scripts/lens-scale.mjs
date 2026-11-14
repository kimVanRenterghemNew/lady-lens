#!/usr/bin/env node
/**
 * Scale benchmark for lady-lens (Story 23.10).
 * Generates a synthetic repository of N files, runs sync and queries,
 * verifies correctness, and measures performance.
 *
 * Usage: node scripts/lens-scale.mjs [count] [--profile <name>] [--seed <n>] [--keep]
 * Profiles: see SCALE_PROFILES in core/bench/scaleRepo.js.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import { generateScaleRepo, SCALE_PROFILES } from '../core/bench/index.js';

const flagValue = name => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; };
const profile = flagValue('--profile') || 'default';
const seed = Number(flagValue('--seed')) || 1;
const count = Number(process.argv[2]) || SCALE_PROFILES[profile]?.count || 500;
const keep = process.argv.includes('--keep');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `lens-scale-${profile}-${count}-`));
const dbDir = path.join(tmpDir, '.memory', 'graph');
const dbPath = path.join(dbDir, 'project.lbdb');

console.log(`Generating synthetic repo (${profile}, seed ${seed}) with ${count} files at ${tmpDir}...`);
const t0Gen = Date.now();
const { files: fileCount } = generateScaleRepo({ dir: tmpDir, profile, count, seed });
console.log(`Generated ${fileCount} files in ${Date.now() - t0Gen} ms.`);

// Configure lady-lens
process.env.LENS_REPO_ROOT = tmpDir;
process.env.LENS_GRAPH_DB = dbPath;
process.env.LENS_PROJECT_GRAPH = '1';

const { configureLensRoot } = await import('../core/configuration/index.js');
configureLensRoot(tmpDir);

const { createGraphSync } = await import('../core/graph/index.js');
const { RESEARCH_TOOLS } = await import('../core/search/index.js');

// 1. Initial Sync
console.log('Running initial sync...');
const t0Sync = Date.now();
const sync = createGraphSync();
const syncResult = await sync.sync({ mode: 'full' });
const syncTimeMs = Date.now() - t0Sync;

let dbSizeMb;
try {
    const stats = fs.statSync(dbPath);
    dbSizeMb = (stats.size / (1024 * 1024)).toFixed(2);
} catch {
    // Some engines use directory
    dbSizeMb = '?';
}

console.log(`Initial sync finished in ${(syncTimeMs / 1000).toFixed(2)} s (${syncResult.nodes} nodes, DB size: ${dbSizeMb} MB).`);

// 2. Incremental sync without changes
const t0Inc = Date.now();
await sync.sync({ mode: 'incremental' });
const incTimeMs = Date.now() - t0Inc;
console.log(`Incremental sync (unchanged) in ${incTimeMs} ms.`);

// 3. Measure Queries
const queries = [
    { tool: 'definedIn', args: { symbol: 'func_0_0_0' }, check: res => res.locations?.[0]?.path === 'src/mod_0/file_0.js' },
    { tool: 'exports', args: { file: 'src/mod_0/file_0.js' }, check: res => res.names?.includes('func_0_0_0') },
    { tool: 'exists', args: { file: 'src/mod_0/file_0.js' }, check: res => res.exists === true },
    { tool: 'imports', args: { file: 'src/mod_0/file_0.js' }, check: res => Array.isArray(res.files) },
    { tool: 'importedBy', args: { file: 'src/mod_0/file_0.js' }, check: res => Array.isArray(res.files) },
    { tool: 'functionView', args: { symbol: 'func_0_0_0' }, check: res => res.definitions?.[0]?.path === 'src/mod_0/file_0.js' },
    { tool: 'graph_query', args: { query: 'func_0_0_0' }, check: res => res.nodes?.length > 0 || res.symbols?.length > 0 }
];

console.log('\n--- Benchmarking Queries ---');
const queryResults = [];
let allChecksPassed = true;

for (const q of queries) {
    const t0Q = performance.now();
    const res = await RESEARCH_TOOLS[q.tool](q.args);
    const duration = performance.now() - t0Q;

    const ok = q.check(res);
    if (!ok) {
        console.error(`FAIL: ${q.tool} check failed! Response:`, JSON.stringify(res));
        allChecksPassed = false;
    }

    queryResults.push({
        tool: q.tool,
        timeMs: duration.toFixed(1),
        passed: ok
    });
    console.log(`  ${q.tool.padEnd(14)} : ${duration.toFixed(1).padStart(7)} ms [${ok ? 'PASS' : 'FAIL'}]`);
}

// 4. Repeated queries in long-running process (like MCP)
console.log('\n--- Repeated Queries (Warm Cache / Process in Memory) ---');
for (const q of queries) {
    const t0Q = performance.now();
    await RESEARCH_TOOLS[q.tool](q.args);
    const duration = performance.now() - t0Q;
    console.log(`  ${q.tool.padEnd(14)} (warm) : ${duration.toFixed(1).padStart(7)} ms`);
}

// Summary Report
console.log('\n================ SCALE REPORT ================');
console.log(`Files:                ${fileCount}`);
console.log(`Nodes:                ${syncResult.nodes}`);
console.log(`Initial Sync:         ${(syncTimeMs / 1000).toFixed(2)} s`);
console.log(`Incremental Sync:     ${incTimeMs} ms`);
console.log(`Database Size:        ${dbSizeMb} MB`);
console.log(`All checks passed:    ${allChecksPassed ? 'YES' : 'NO'}`);
console.log('==============================================\n');

if (!keep) {
    try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
        // cleanup failed
    }
}

if (!allChecksPassed) {
    console.error('Scale benchmark FAILED verification check.');
    process.exit(1);
}
