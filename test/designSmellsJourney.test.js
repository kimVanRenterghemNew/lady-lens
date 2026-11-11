/**
 * Journey Test J3: health flags all 10 design smells with file, line and advice,
 * and reports 0 smells on the refactored variants.
 */
import { describe, it, expect } from 'vitest';
import { createGraph, codeHealth, analyzeSource } from '../core/graph/index.js';
import { healthTool } from '../core/search/index.js';

describe('Journey J3: health flags design smells and clears on refactoring', () => {
    const SMELLY_FILES = {
        'core/services/dispatcher.js': 'function dispatch(x) { if (x === "a") return 1; if (x === "b") return 2; if (x === "c") return 3; return 0; }',
        'core/services/fetcher.js': 'function fetch(timeout = 100, retries = 3, cache = true) { return timeout; }',
        'core/services/deep.js': 'function check(a, b, c) { if (a) { if (b) { if (c) { return true; } } } return false; }',
        'core/services/loop.js': 'function scan(items) { for (const item of items) { if (item.a) doA(); if (item.b) doB(); } }',
        'core/services/cond.js': 'function validate(a, b, c, d) { if (a && b && c && d) return true; return false; }',
        'core/services/flag.js': 'function execute(task, isDryRun) { if (isDryRun) return null; return runTask(task); }',
        'core/services/repeated.js': 'export function run(s) { if (s === "pending") return 1; if (s === "pending") return 2; if (s === "pending") return 3; return 0; }',
        'core/services/state.js': 'let globalState = 0;\nexport function mutate() { globalState++; }',
        'core/services/badIo.js': 'import { execSync } from "child_process";\nexport const ping = () => execSync("ping");',
        'core/services/god.js': Array.from({ length: 18 }, (_, i) => `export const fn${i} = () => ${i};`).join('\n')
    };

    const CLEAN_FILES = {
        'core/services/dispatcher.js': 'const ACTIONS = new Map([["a", 1], ["b", 2], ["c", 3]]);\nfunction dispatch(x) { return ACTIONS.get(x) ?? 0; }',
        'core/services/fetcher.js': 'const DEFAULTS = { timeout: 100, retries: 3, cache: true };\nfunction fetch(opts) { const config = { ...DEFAULTS, ...opts }; return config.timeout; }',
        'core/services/deep.js': 'function check(a, b, c) { if (!a) return false; if (!b) return false; if (!c) return false; return true; }',
        'core/services/loop.js': 'function scan(items) { items.filter(i => i.a).forEach(doA); items.filter(i => i.b).forEach(doB); }',
        'core/services/cond.js': 'const isValid = (a, b) => a && b; const isReady = (c, d) => c && d;\nfunction validate(a, b, c, d) { if (isValid(a, b) && isReady(c, d)) return true; return false; }',
        'core/services/flag.js': 'function execute(task) { return runTask(task); }\nfunction executeDry(task) { return null; }',
        'core/services/repeated.js': 'const STATUS_PENDING = "pending";\nexport function run(s) { if (s === STATUS_PENDING) return 1; if (s === STATUS_PENDING) return 2; if (s === STATUS_PENDING) return 3; return 0; }',
        'core/services/state.js': 'export function createState(initial = 0) { let state = initial; return { inc() { state++; } }; }',
        'core/git/safeIo.js': 'import { execSync } from "child_process";\nexport const gitStatus = () => execSync("git status");',
        'core/services/split.js': 'export const fn1 = () => 1;\nexport const fn2 = () => 2;'
    };

    function buildGraph(files) {
        const graph = createGraph('journey-smells');
        for (const [filePath, content] of Object.entries(files)) {
            const facts = analyzeSource(content, filePath);
            graph.addNode(`file:${filePath}`, 'CodeFile', {
                path: filePath,
                kind: 'source',
                lines: content.split('\n').length,
                exports: facts.exports,
                functions: facts.functions,
                fileSmells: facts.fileSmells
            });
        }
        return graph;
    }

    it('flags all 10 design smells with file, line, and advice on smelly code', () => {
        const graph = buildGraph(SMELLY_FILES);
        const report = codeHealth(graph);

        expect(report.summary.designSmells).toBeGreaterThanOrEqual(10);
        const issues = report.designSmells.map(s => s.issue);
        expect(issues).toContain('dispatch-chain');
        expect(issues).toContain('fallback-heavy');
        expect(issues).toContain('deep-nesting');
        expect(issues).toContain('loop-branching');
        expect(issues).toContain('long-condition');
        expect(issues).toContain('flag-parameter');
        expect(issues).toContain('repeated-literal');
        expect(issues).toContain('global-mutable-state');
        expect(issues).toContain('direct-io');
        expect(issues).toContain('god-module');

        for (const smell of report.designSmells) {
            expect(smell.file).toBeDefined();
            expect(smell.line).toBeGreaterThanOrEqual(1);
            expect(smell.advice).toBeDefined();
            expect(typeof smell.advice).toBe('string');
            expect(smell.advice.length).toBeGreaterThan(5);
        }
    });

    it('reports 0 design smells on clean, refactored code', () => {
        const graph = buildGraph(CLEAN_FILES);
        const report = codeHealth(graph);

        expect(report.designSmells).toEqual([]);
        expect(report.summary.designSmells).toBe(0);
    });

    it('healthTool includes designSmells and reflects budget limits', async () => {
        const res = await healthTool({ limit: 5 }, {
            refresh: async () => ({ fresh: true }),
            history: () => []
        });

        expect(res.relation).toBe('health');
        expect(Array.isArray(res.designSmells)).toBe(true);
        expect(res.designSmells.length).toBeLessThanOrEqual(5);
    });
});
