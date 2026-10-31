/**
 * the coder sees, for every file in scope, what that file's imports REALLY export (from the project graph),
 * so an invented name (`createOutputConsole(true)`) is visibly wrong before validation.
 */
import { describe, it, expect } from 'vitest';
import { createGraph, scopeInterfaces, renderScopeInterfaces } from '../core/graph/index.js';

function fixture() {
    const graph = createGraph('t');
    const add = (file, extra = {}) => graph.addNode(`file:${file}`, 'CodeFile', { path: file, kind: 'source', ...extra });
    add('core/a.js', { exports: ['runA', 'helperA'], symbols: ['runA', 'helperA', 'internal'] });
    add('core/b.js', { exports: ['createB', 'B_LIMIT'] });
    add('core/c.js', { exports: Array.from({ length: 40 }, (_, i) => `name${i}`) });
    add('core/d.js', { exports: [] });
    add('test/a.test.js', { kind: 'test' });
    const edge = (from, to, type = 'IMPORTS') => graph.addEdge(`file:${from}`, `file:${to}`, type, 1);
    edge('core/a.js', 'core/b.js'); edge('core/a.js', 'core/c.js'); edge('core/a.js', 'core/d.js'); edge('test/a.test.js', 'core/a.js', 'TESTS');
    return graph;
}

describe('scopeInterfaces', () => {
    it('own exports plus the exports of every imported module, sorted and bounded', () => {
        const [entry] = scopeInterfaces(fixture(), ['core/a.js'], { maxNames: 5 });
        expect(entry).toMatchObject({ file: 'core/a.js', exports: ['helperA', 'runA'] });
        expect(entry.imports.map(item => item.file)).toEqual(['core/b.js', 'core/c.js', 'core/d.js']);
        expect(entry.imports[0].exports).toEqual(['B_LIMIT', 'createB']);
        expect(entry.imports[1].exports).toHaveLength(5);
        expect(entry.imports[1].moreExports).toBe(35);
    });
    it('a file that is not in the graph (a new file) is skipped, not an error', () => {
        expect(scopeInterfaces(fixture(), ['core/new.js'])).toEqual([]);
    });
    it('at most maxImports imported modules per file', () => {
        expect(scopeInterfaces(fixture(), ['core/a.js'], { maxImports: 2 })[0].imports).toHaveLength(2);
        expect(scopeInterfaces(fixture(), ['core/a.js'], { maxImports: 2 })[0].moreImports).toBe(1);
    });
});

describe('renderScopeInterfaces', () => {
    it('says which names exist, flags modules that export nothing, and stays within the char budget', () => {
        const text = renderScopeInterfaces(scopeInterfaces(fixture(), ['core/a.js']), { maxChars: 4000 });
        expect(text).toContain('imports core/b.js, which exports: B_LIMIT, createB');
        expect(text).toMatch(/core\/d\.js, which exports: \(nothing named\)/);
        expect(text).toMatch(/Only these names exist/);
        const tiny = renderScopeInterfaces(scopeInterfaces(fixture(), ['core/a.js']), { maxChars: 200 });
        expect(tiny.length).toBeLessThanOrEqual(200 + 170); // budget for the list, plus the fixed closing sentence
        expect(tiny).not.toMatch(/\.\.\./);
    });
    it('nothing to show -> empty string', () => {
        expect(renderScopeInterfaces([])).toBe('');
    });
});
