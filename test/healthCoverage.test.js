/**
 * Coverage per file in the health report: from an istanbul json-summary, a risk below 50% of lines. A measured
 * coverage is the truth over the import guess: a file covered through another is tested, and has no untested-exports.
 * A barrel (index.js) has no code: never untested-exports, never zone-of-pain. Tool config files are scripts.
 */
import { describe, it, expect } from 'vitest';
import { createGraph, codeHealth, coverageFromSummary, fileKindOf, calculateArchitectureMetrics } from '../core/graph/index.js';

const SUMMARY = {
    total: { lines: { pct: 70 } },
    'C:\\repo\\core\\low.js': { lines: { pct: 12.5 } },
    'C:\\repo\\core\\fine.js': { lines: { pct: 50 } },
    'C:\\elsewhere\\x.js': { lines: { pct: 0 } }
};
const toRepoPath = (file) => (file.startsWith('C:\\repo\\') ? file.slice('C:\\repo\\'.length).replace(/\\/g, '/') : null);

describe('coverage in code health', () => {
    it('reads % lines per repo file from the summary, without the total or files outside the repository', () => {
        expect([...coverageFromSummary(SUMMARY, toRepoPath)]).toEqual([['core/low.js', 12.5], ['core/fine.js', 50]]);
    });

    it('marks low-coverage below 50%; MUST NOT mark a file at 50% or a file without coverage data', () => {
        const graph = createGraph('t');
        for (const path of ['core/low.js', 'core/fine.js', 'core/unknown.js']) graph.addNode(`file:${path}`, 'CodeFile', { path, kind: 'source', lines: 10 });
        const files = Object.fromEntries(codeHealth(graph, { coverage: coverageFromSummary(SUMMARY, toRepoPath) }).files.map(entry => [entry.path, entry]));

        expect(files['core/low.js']).toMatchObject({ coverage: 12.5 });
        expect(files['core/low.js'].issues).toContain('low-coverage');
        expect(files['core/fine.js'].issues).not.toContain('low-coverage');
        expect(files['core/unknown.js'].issues).not.toContain('low-coverage');
        expect(files['core/unknown.js']).not.toHaveProperty('coverage');
    });

    it('MUST count a file covered through another file as tested, and trust coverage over the name guess for exports', () => {
        const graph = createGraph('t');
        const add = (path, extra = {}) => graph.addNode(`file:${path}`, 'CodeFile', { path, kind: 'source', lines: 10, ...extra });
        add('core/m/index.js', { exports: ['run', 'helper'] });
        add('core/m/run.js', { exports: ['run', 'helper'] });
        add('core/m/cycles.js', { exports: ['cyclesOf'] });
        add('core/m/guess.js', { exports: ['named', 'unnamed'] });
        add('test/m.test.js', { kind: 'test' });
        graph.addEdge('file:core/m/index.js', 'file:core/m/run.js', 'IMPORTS');
        graph.addEdge('file:core/m/run.js', 'file:core/m/cycles.js', 'IMPORTS');
        graph.addEdge('file:test/m.test.js', 'file:core/m/index.js', 'IMPORTS');
        graph.addEdge('file:test/m.test.js', 'file:core/m/guess.js', 'IMPORTS');
        const text = "import { run } from '../core/m/index.js'; import { named } from '../core/m/guess.js'; run(); named();";
        const coverage = new Map([['core/m/run.js', 90], ['core/m/cycles.js', 80]]);
        const files = Object.fromEntries(codeHealth(graph, { readFile: path => path === 'test/m.test.js' ? text : null, coverage }).files.map(entry => [entry.path, entry]));

        expect(files['core/m/cycles.js']).toMatchObject({ tested: true, issues: [] });
        expect(files['core/m/run.js'].untestedExports).toEqual([]);
        expect(files['core/m/index.js'].untestedExports).toEqual([]);
        expect(files['core/m/guess.js'].untestedExports).toEqual(['unnamed']);   // no coverage for it: the name guess stays
    });

    it('MUST NOT put a barrel in the zone of pain; a stable, depended-on file with untested exports is in it', () => {
        const graph = createGraph('t');
        for (const path of ['core/p/index.js', 'core/p/base.js', 'core/u1.js', 'core/u2.js', 'test/p.test.js']) graph.addNode(`file:${path}`, 'CodeFile', { path, kind: path.startsWith('test/') ? 'test' : 'source', lines: 10, exports: path.endsWith('base.js') || path.endsWith('index.js') ? ['base', 'other'] : [] });
        for (const from of ['core/u1.js', 'core/u2.js']) { graph.addEdge(`file:${from}`, 'file:core/p/index.js', 'IMPORTS'); graph.addEdge(`file:${from}`, 'file:core/p/base.js', 'IMPORTS'); }
        graph.addEdge('file:test/p.test.js', 'file:core/p/base.js', 'IMPORTS');
        const report = codeHealth(graph, { readFile: () => 'base()' });
        expect(report.zoneOfPain.map(entry => entry.path)).toEqual(['core/p/base.js']);
    });

    it('a tool config file is a script, not source to test', () => {
        expect(['vitest.config.js', 'eslint.config.mjs', 'web/app.config.ts', 'core/config.js'].map(path => fileKindOf(path))).toEqual(['script', 'script', 'script', 'source']);
    });

    it('MUST NOT flag a barrel for high fan-in or fan-out; a plain file with as many users is flagged', () => {
        const graph = createGraph('t');
        const users = Array.from({ length: 41 }, (_, i) => `core/u${i}.js`);
        for (const path of ['core/hub/index.js', 'core/hub/plain.js', ...users]) graph.addNode(`file:${path}`, 'CodeFile', { path, kind: 'source', lines: 10 });
        for (const user of users) { graph.addEdge(`file:${user}`, 'file:core/hub/index.js', 'IMPORTS'); graph.addEdge(`file:${user}`, 'file:core/hub/plain.js', 'IMPORTS'); }
        const files = Object.fromEntries(codeHealth(graph).files.map(entry => [entry.path, entry.issues]));
        expect(files['core/hub/index.js']).not.toContain('high-fan-in');
        expect(files['core/hub/plain.js']).toContain('high-fan-in');
    });

    it('zone of pain follows its options: the instability limit, no centrality, a path found case-insensitively, odd function data', () => {
        const graph = createGraph('t');
        graph.addNode('file:core/Base.js', 'CodeFile', { path: 'core/Base.js', kind: 'source', lines: 10, functions: [{ name: 'f', issues: ['large-function'] }, { name: 'g' }] });
        graph.addNode('file:core/odd.js', 'CodeFile', { path: 'core/odd.js', kind: 'source', lines: 10, functions: 'none' });
        graph.addNode('file:core/user.js', 'CodeFile', { path: 'core/user.js', kind: 'source', lines: 10 });
        graph.addEdge('file:core/user.js', 'file:core/Base.js', 'IMPORTS');
        graph.addEdge('file:core/user.js', 'file:core/odd.js', 'IMPORTS');
        const entries = (base = 'core/Base.js') => [base, 'core/odd.js', 'core/user.js'].map(path => ({ path, tested: true, issues: [] }));
        const strict = calculateArchitectureMetrics(graph, entries(), { skipCentrality: true, zoneOfPainInstability: 0.01 });
        expect(strict.zoneOfPain.map(e => [e.path, e.centralityScore])).toEqual([['core/Base.js', 0]]);
        expect(calculateArchitectureMetrics(graph, entries('core/BASE.js'), { skipCentrality: true }).complexFunctions.map(f => [f.name, f.file])).toEqual([['f', 'core/BASE.js']]);
        expect(calculateArchitectureMetrics(graph, entries(), { zoneOfPainInstability: 0 }).zoneOfPain).toEqual([]);
    });
});
