/**
 * What changing a file reaches (consequences) and its known risks, the two fields `graph_query` adds to a code file.
 */
import { describe, it, expect } from 'vitest';
import { createGraph, fileImpact, codeHealth } from '../core/graph/index.js';

function fixture() {
    const graph = createGraph('t');
    const code = (path, extra = {}) => graph.addNode(`file:${path}`, 'CodeFile', { path, kind: 'source', lines: 10, ...extra });
    code('core/q/questions.js', { exports: ['ask'] });
    code('core/q/index.js', { exports: ['ask'] });
    code('core/h/one.js');
    code('core/h/two.js');
    code('core/h/three.js');
    code('core/c/left.js');
    code('core/c/right.js');
    code('test/q.test.js', { kind: 'test' });
    code('test/barrel-only.test.js', { kind: 'test' });
    const edge = (from, to, type = 'IMPORTS', strength = 1) => graph.addEdge(`file:${from}`, `file:${to}`, type, { weight: 1, strength });
    edge('core/q/index.js', 'core/q/questions.js');
    for (const from of ['core/h/one.js', 'core/h/two.js', 'core/h/three.js']) edge(from, 'core/q/index.js');
    edge('core/h/one.js', 'core/q/questions.js', 'CALLS', 1);
    edge('core/h/two.js', 'core/q/questions.js', 'CALLS', 4);
    edge('core/q/questions.js', 'core/h/three.js', 'CO_CHANGES', 5);
    edge('test/q.test.js', 'core/q/index.js', 'TESTS');
    edge('test/barrel-only.test.js', 'core/q/index.js', 'TESTS');
    edge('test/q.test.js', 'core/q/questions.js', 'CALLS', 9);
    edge('core/c/left.js', 'core/c/right.js');
    edge('core/c/right.js', 'core/c/left.js');
    return graph;
}
const TEXTS = {
    'test/q.test.js': "import { ask } from '../core/q/index.js';\nask();\n",
    'test/barrel-only.test.js': "import * as q from '../core/q/index.js';\nit('loads', () => q);\n"
};
const readFile = (path) => TEXTS[path] ?? null;

describe('fileImpact', () => {
    it('counts importers through the barrel, lists callers by call sites, reaching tests and co-change partners', () => {
        expect(fileImpact(fixture(), ['core/q/questions.js'], { readFile }).get('core/q/questions.js')).toEqual({
            consequences: { importedBy: 3, calledBy: ['core/h/two.js', 'core/h/one.js'], tests: 1, changesWith: ['core/h/three.js'] },
            risks: []
        });
    });

    it('MUST NOT count a test as a caller, nor a test that only imports the barrel without naming an export', () => {
        const { consequences } = fileImpact(fixture(), ['core/q/questions.js'], { readFile }).get('core/q/questions.js');
        expect(consequences.calledBy).not.toContain('test/q.test.js');
        expect(consequences.tests).toBe(1);
    });

    it('MUST NOT count the barrel or a test as an importer, and MUST report an untested file in a cycle', () => {
        const impact = fileImpact(fixture(), ['core/c/left.js', 'core/q/questions.js'], { readFile });
        expect(impact.get('core/q/questions.js').consequences.importedBy).toBe(3);
        expect(impact.get('core/c/left.js')).toEqual({ consequences: { importedBy: 1, calledBy: [], tests: 0, changesWith: [] }, risks: ['untested', 'cycle'] });
    });

    it('health for `only` some files gives the same entries as the full report, and no others (graph_query asks for ~10)', () => {
        const full = codeHealth(fixture(), { readFile }).files;
        const only = codeHealth(fixture(), { readFile, only: ['core/c/left.js', 'core/q/questions.js'] }).files;
        expect(only.map(entry => entry.path).sort()).toEqual(['core/c/left.js', 'core/q/questions.js']);
        for (const entry of only) expect(entry).toEqual(full.find(item => item.path === entry.path));
    });
});
