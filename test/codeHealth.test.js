/**
 * Code health from the graph. Per signal a case it MUST flag and one it must not:
 * test reach through barrels (a test via index.js reaches the module; naive TESTS edges say "untested"), untested exports,
 * import cycles, boundary violations (import into a module's inside instead of its index.js), size, fan-in/out, hotspots
 * (churn x size).
 */
import { describe, it, expect } from 'vitest';
import { createGraph, codeHealth } from '../core/graph/index.js';

function graphOf(files, imports) {
    const graph = createGraph('health');
    for (const [path, { kind = 'source', lines = 10, exports = [] } = {}] of Object.entries(files)) {
        graph.addNode(`file:${path}`, 'CodeFile', { path, kind, lines, exports });
    }
    for (const [from, to] of imports) graph.addEdge(`file:${from}`, `file:${to}`, 'IMPORTS');
    return graph;
}

const files = {
    'core/store/index.js': { exports: ['createStore'] },
    'core/store/store.js': { exports: ['createStore', 'dropStore'] },
    'core/store/inner.js': { exports: ['secret'] },
    'core/orphan/orphan.js': { exports: ['lonely'] },
    'core/a/a.js': {}, 'core/a/b.js': {},
    'core/big/big.js': { lines: 900 },
    'core/app.js': {},
    'test/store.test.js': { kind: 'test' },
    'scripts/run.mjs': { kind: 'script' }
};
const imports = [
    ['core/store/index.js', 'core/store/store.js'],
    ['core/store/store.js', 'core/store/inner.js'],
    ['test/store.test.js', 'core/store/index.js'],
    ['core/a/a.js', 'core/a/b.js'], ['core/a/b.js', 'core/a/a.js'],
    ['core/app.js', 'core/store/store.js'],
    ['core/app.js', 'core/store/index.js']
];
const texts = { 'test/store.test.js': "import { createStore } from '../core/store/index.js';\nit('works', () => createStore());\n" };
const report = codeHealth(graphOf(files, imports), { readFile: path => texts[path] ?? null, churn: new Map([['core/big/big.js', 30], ['core/app.js', 2]]) });
const file = (path) => report.files.find(item => item.path === path);

describe('code health', () => {
    it('MUST count a test that imports through index.js as reaching the module, and flag a file no test reaches', () => {
        expect(file('core/store/store.js')).toMatchObject({ tested: true, tests: ['test/store.test.js'] });
        expect(file('core/orphan/orphan.js')).toMatchObject({ tested: false });
        expect(file('core/orphan/orphan.js').issues).toContain('untested');
        expect(file('core/store/store.js').issues).not.toContain('untested');
        // a script is run, not imported: no test reaching it is not a finding
        expect(file('scripts/run.mjs')).toMatchObject({ tested: false });
        expect(file('scripts/run.mjs').issues).not.toContain('untested');
    });

    it('MUST name the exports no reaching test mentions', () => {
        expect(file('core/store/store.js').untestedExports).toEqual(['dropStore']);
    });

    it('MUST flag files in an import cycle, and not files outside it', () => {
        expect(report.cycles).toEqual([{ size: 2, shortest: ['core/a/a.js', 'core/a/b.js', 'core/a/a.js'] }]);
        expect(file('core/a/a.js').issues).toContain('cycle');
        expect(file('core/store/store.js').issues).not.toContain('cycle');
    });

    it('MUST flag an import into the inside of a module from outside it; via index.js or from inside is fine', () => {
        expect(file('core/app.js').boundaryViolations).toEqual(['core/store/store.js']);
        expect(file('core/store/store.js').boundaryViolations).toEqual([]);
    });

    it('MUST flag a large file, count fan-in/out and rank hotspots by churn x size', () => {
        expect(file('core/big/big.js').issues).toContain('large');
        expect(file('core/app.js').issues).not.toContain('large');
        expect(file('core/store/store.js')).toMatchObject({ fanIn: 2, fanOut: 1 });
        expect(report.hotspots[0]).toMatchObject({ path: 'core/big/big.js', churn: 30, hotspot: 27000 });
    });

    it('rolls files up per module (a folder with an index.js) and narrows to one file or module', () => {
        // inner.js is only imported by store.js (not a barrel): no test imports it, so it is untested
        expect(report.modules.find(m => m.module === 'core/store')).toMatchObject({ files: 3, untested: 1 });
        expect(file('core/store/inner.js').tested).toBe(false);
        const one = codeHealth(graphOf(files, imports), { readFile: () => null, module: 'core/a' });
        expect(one.files.map(item => item.path)).toEqual(['core/a/a.js', 'core/a/b.js']);
    });
});

describe('code health: shortest loop in a big cycle', () => {
    it('MUST give the shortest loop of a cycle, not only its members', () => {
        // a -> b -> c -> d -> a, plus the short loop c <-> d
        const graph = graphOf({ 'x/a.js': {}, 'x/b.js': {}, 'x/c.js': {}, 'x/d.js': {} }, [['x/a.js', 'x/b.js'], ['x/b.js', 'x/c.js'], ['x/c.js', 'x/d.js'], ['x/d.js', 'x/a.js'], ['x/d.js', 'x/c.js']]);
        expect(codeHealth(graph).cycles).toEqual([{ size: 4, shortest: ['x/c.js', 'x/d.js', 'x/c.js'] }]);
    });
});
