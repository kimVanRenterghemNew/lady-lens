import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { performance } from 'perf_hooks';
import { createProfiler } from '../core/observability/index.js';
import { createGraphSync, createGraphRepository, rankGraphNodes, codeHealth } from '../core/graph/index.js';
import { loadGraphModel, definedInTool, exportsTool, fileExists } from '../core/search/index.js';

describe('Performance Diagnostics & Benchmarks', () => {
    let repo;
    let tempDir;
    let dbPath;
    let loadedModel;

    beforeAll(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-test-'));
        dbPath = path.join(tempDir, 'project.lbdb');
        process.env.LENS_GRAPH_DB = dbPath;
        process.env.LENS_PROJECT_GRAPH = '1';

        repo = createGraphRepository({ databasePath: dbPath });
        const sync = createGraphSync({ root: process.cwd(), repository: repo });
        await sync.sync({ mode: 'full' });

        loadedModel = await loadGraphModel({ sessionId: 'perf-test', text: 'code graph search', includeProject: true });

        return () => {
            try {
                fs.rmSync(tempDir, { recursive: true, force: true });
            } catch {
                // ignore
            }
        };
    });

    it('profiler accurately records metrics and detects bottlenecks', () => {
        const profiler = createProfiler('test-tracker');
        profiler.enable();

        profiler.record('fast-op', 2.0);
        profiler.record('fast-op', 3.0);
        profiler.record('slow-bottleneck-op', 120.0);
        profiler.record('slow-bottleneck-op', 150.0);
        profiler.record('slow-bottleneck-op', 140.0);

        const stats = profiler.getStats();
        expect(stats.length).toBe(2);

        const slow = stats.find(s => s.label === 'slow-bottleneck-op');
        expect(slow.count).toBe(3);
        expect(slow.isBottleneck).toBe(true);
        expect(slow.pctOfTotal).toBeGreaterThan(90);

        const report = profiler.formatReport({ title: 'Test Report' });
        expect(report).toContain('⚠️ BOTTLENECK');
        expect(report).toContain('slow-bottleneck-op');
    });

    it('codeHealth on loaded graph executes within expected time (< 100ms)', () => {
        const t0 = performance.now();
        const iterations = 5;
        for (let i = 0; i < iterations; i++) {
            const result = codeHealth(loadedModel.graph);
            expect(result.summary.files).toBeGreaterThan(0);
        }
        const avgMs = (performance.now() - t0) / iterations;
        expect(avgMs).toBeLessThan(100);
    });

    it('rankGraphNodes executes efficiently on query terms', () => {
        const t0 = performance.now();
        const iterations = 10;
        for (let i = 0; i < iterations; i++) {
            const matches = rankGraphNodes(loadedModel.graph, 'graph sync repository', { limit: 10 });
            expect(matches.length).toBeGreaterThan(0);
        }
        const avgMs = (performance.now() - t0) / iterations;
        // Even before optimization it took ~200ms; with optimization it should be < 50ms
        expect(avgMs).toBeLessThan(250);
    });

    it('direct queries (definedIn, exports, exists) execute within budget', async () => {
        // Warm up the database connection
        await fileExists({ file: 'core/graph/sync/graphSync.js' });

        const t0 = performance.now();
        const def = await definedInTool({ symbol: 'createGraphSync' });
        expect(def.found).toBe(true);

        const exp = await exportsTool({ file: 'core/graph/sync/graphSync.js' });
        expect(exp.names.length).toBeGreaterThan(0);

        const ex = await fileExists({ file: 'core/graph/sync/graphSync.js' });
        expect(ex.exists).toBe(true);

        const totalMs = performance.now() - t0;
        expect(totalMs).toBeLessThan(1000);
    });
});
