#!/usr/bin/env node
/**
 * Comprehensive Benchmark & Performance Diagnostic Suite for lady-lens.
 *
 * Runs indexing, search, ranking, views, and graph queries while profiling
 * subphases to locate performance bottlenecks.
 *
 * Usage:
 *   node scripts/benchmark.mjs
 *   node scripts/benchmark.mjs --synthetic 300
 *   node scripts/benchmark.mjs --json
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { performance } from 'perf_hooks';
import { createProfiler } from '../core/observability/index.js';
import { configureLensRoot } from '../core/configuration/index.js';
import { createGraphSync, createGraphRepository, rankGraphNodes } from '../core/graph/index.js';
import {
    graph_query,
    definedInTool,
    exportsTool,
    fileExists,
    imports,
    importedBy,
    functionViewTool,
    folderViewTool,
    healthTool,
    loadGraphModel
} from '../core/search/index.js';

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export async function runBenchmark({ targetRoot } = {}) {
    const profiler = createProfiler('lady-lens-benchmark');
    profiler.enable();

    const ROOT = targetRoot ? path.resolve(targetRoot) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    configureLensRoot(ROOT);

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lens-bench-'));
    const dbPath = path.join(tempDir, 'project.lbdb');

    process.env.LENS_REPO_ROOT = ROOT;
    process.env.LENS_GRAPH_DB = dbPath;
    process.env.LENS_PROJECT_GRAPH = '1';

    console.log(`[BENCHMARK] Start performance run op: ${ROOT}`);
    console.log(`[BENCHMARK] Tijdelijke database: ${dbPath}\n`);

    const repository = createGraphRepository({ databasePath: dbPath });
    const sync = createGraphSync({ root: ROOT, repository });

    // 1. Full Sync
    console.log('1. Meten van Full Sync...');
    const t0Sync = performance.now();
    const fullSyncResult = await sync.sync({ mode: 'full' });
    const fullSyncMs = performance.now() - t0Sync;
    profiler.record('Sync: Full', fullSyncMs);
    console.log(`   ✓ Full sync gereed: ${fullSyncMs.toFixed(1)} ms (${fullSyncResult.nodes} nodes, ${fullSyncResult.edges} edges)`);

    // 2. Incremental Sync (geen wijzigingen)
    console.log('2. Meten van Incremental Sync (onveranderd)...');
    const t0Inc = performance.now();
    await sync.sync({ mode: 'incremental' });
    const incMs = performance.now() - t0Inc;
    profiler.record('Sync: Incremental (unchanged)', incMs);
    console.log(`   ✓ Incrementele sync gereed: ${incMs.toFixed(1)} ms`);

    // 3. Load Graph Model
    console.log('3. Meten van GraphModel laden...');
    const t0Load = performance.now();
    const loadedModel = await loadGraphModel({ sessionId: 'bench', text: 'code graph search', includeProject: true });
    const loadMs = performance.now() - t0Load;
    profiler.record('Storage: loadGraphModel (koud)', loadMs);

    // Warm load (uit cache)
    const t0WarmLoad = performance.now();
    await loadGraphModel({ sessionId: 'bench', text: 'code graph search', includeProject: true });
    profiler.record('Storage: loadGraphModel (warm cache)', performance.now() - t0WarmLoad);

    // Bepaal representatieve steekproef uit de graaf
    const codeNodes = Array.from(loadedModel.graph.nodes.values()).filter(n => n.type === 'CodeFile');
    const sampleCodeNode = codeNodes.find(n => Array.isArray(n.exports) && n.exports.length > 0)
        || codeNodes[0]
        || { path: 'core/graph/sync/graphSync.js', exports: ['createGraphSync'] };
    const sampleFile = sampleCodeNode.path;
    const sampleSymbol = sampleCodeNode.exports?.[0] || 'createGraphSync';
    const sampleFolder = sampleFile.includes('/') ? sampleFile.slice(0, sampleFile.lastIndexOf('/')) : '.';

    console.log(`   (Testtargets: symbool="${sampleSymbol}", bestand="${sampleFile}", map="${sampleFolder}")`);

    // 4. Ranking (rankGraphNodes)
    console.log('4. Meten van rankGraphNodes (50 herhalingen)...');
    const sampleWords = String(sampleSymbol).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[\s._-]+/).filter(w => w.length >= 3);
    const queries = [
        sampleWords.join(' '),
        sampleSymbol,
        'order service data common',
        'unit test tracer mock',
        'health import cycle'
    ].filter(Boolean);

    for (let i = 0; i < 50; i++) {
        const q = queries[i % queries.length];
        const t0Rank = performance.now();
        rankGraphNodes(loadedModel.graph, q, { limit: 10 });
        profiler.record('Query: rankGraphNodes', performance.now() - t0Rank);
    }

    // 5. graph_query (eind-tot-eind)
    console.log('5. Meten van graph_query (20 herhalingen)...');
    for (let i = 0; i < 20; i++) {
        const q = queries[i % queries.length];
        const t0Gq = performance.now();
        await graph_query({ sessionId: 'bench', query: q, limit: 10 });
        profiler.record('Query: graph_query (e2e)', performance.now() - t0Gq);
    }

    // 6. Direct Queries
    console.log('6. Meten van Direct Queries...');
    for (let i = 0; i < 15; i++) {
        const t0Def = performance.now();
        await definedInTool({ symbol: sampleSymbol });
        profiler.record('Direct: definedIn', performance.now() - t0Def);

        const t0Exp = performance.now();
        await exportsTool({ file: sampleFile });
        profiler.record('Direct: exports', performance.now() - t0Exp);

        const t0Imp = performance.now();
        await imports({ file: sampleFile });
        profiler.record('Direct: imports', performance.now() - t0Imp);

        const t0ImpBy = performance.now();
        await importedBy({ file: sampleFile });
        profiler.record('Direct: importedBy', performance.now() - t0ImpBy);

        const t0Ex = performance.now();
        await fileExists({ file: sampleFile });
        profiler.record('Direct: exists', performance.now() - t0Ex);
    }

    // 7. Function View
    console.log('7. Meten van Function View (10 herhalingen)...');
    for (let i = 0; i < 10; i++) {
        const t0Fv = performance.now();
        await functionViewTool({ symbol: sampleSymbol });
        profiler.record('View: functionView', performance.now() - t0Fv);
    }

    // 8. Folder View
    console.log('8. Meten van Folder View (10 herhalingen)...');
    for (let i = 0; i < 10; i++) {
        const t0Fold = performance.now();
        await folderViewTool({ folder: sampleFolder });
        profiler.record('View: folderView', performance.now() - t0Fold);
    }

    // 9. Code Health
    console.log('9. Meten van Code Health (5 herhalingen)...');
    for (let i = 0; i < 5; i++) {
        const t0Health = performance.now();
        await healthTool({});
        profiler.record('Analysis: codeHealth', performance.now() - t0Health);
    }

    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }

    const reportText = profiler.formatReport({ title: `lady-lens Performance Benchmark (${fullSyncResult.nodes} nodes, ${fullSyncResult.edges} edges)` });
    return { stats: profiler.getStats(), report: reportText, fullSyncResult };
}

if (isMain) {
    let target = null;
    const repoIdx = process.argv.indexOf('--repo');
    if (repoIdx !== -1 && process.argv[repoIdx + 1]) target = process.argv[repoIdx + 1];
    runBenchmark({ targetRoot: target }).then(res => {
        if (process.argv.includes('--json')) console.log(JSON.stringify(res.stats, null, 2));
        else console.log(res.report);
    }).catch(err => {
        console.error('Benchmark mislukt:', err);
        process.exit(1);
    });
}
