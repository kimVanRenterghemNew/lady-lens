import { describe, it, expect } from 'vitest';
import {
    resolveCodeFile,
    fileLookup,
    recognizeSymbolQuestion,
    definedIn,
    exportsOf
} from '../core/graph/index.js';

describe('importLookup branch coverage', () => {
    const mockGraph = {
        nodes: new Map([
            ['file:core/a.js', { id: 'file:core/a.js', type: 'CodeFile', path: 'core/a.js', exports: ['funcA'] }],
            ['file:core/nested/a.js', { id: 'file:core/nested/a.js', type: 'CodeFile', path: 'core/nested/a.js', exports: [] }],
            ['file:core/b.js', {
                id: 'file:core/b.js', type: 'CodeFile', path: 'core/b.js',
                symbolRanges: { mySymbol: [10, 20] }, exports: ['mySymbol']
            }],
            ['file:test/a.test.js', { id: 'file:test/a.test.js', type: 'CodeFile', kind: 'test', path: 'test/a.test.js', exports: [] }],
            ['doc:docs/intro.md', { id: 'doc:docs/intro.md', type: 'Document', path: 'docs/intro.md' }]
        ])
    };

    it('resolveCodeFile without lookupCodeFile method handles empty, exact, lowercase, ambiguous', () => {
        expect(resolveCodeFile(mockGraph, '')).toEqual({});
        expect(resolveCodeFile(mockGraph, null)).toEqual({});

        // exact match
        const exact = resolveCodeFile(mockGraph, 'core/b.js');
        expect(exact.node.path).toBe('core/b.js');

        // lowercase match
        const lower = resolveCodeFile(mockGraph, 'CORE/B.JS');
        expect(lower.node.path).toBe('core/b.js');

        // ambiguous basename (a.js is in core/a.js and core/nested/a.js)
        const amb = resolveCodeFile(mockGraph, 'a.js');
        expect(amb.candidates).toEqual(['core/a.js', 'core/nested/a.js']);

        // unique basename
        const uniq = resolveCodeFile(mockGraph, 'b.js');
        expect(uniq.node.path).toBe('core/b.js');

        // unknown
        expect(resolveCodeFile(mockGraph, 'unknown.js')).toEqual({});
    });

    it('fileLookup without lookupFile method handles existing and similar files', () => {
        const found = fileLookup(mockGraph, 'core/a.js');
        expect(found.exists).toBe(true);
        expect(found.similar).toEqual([]);

        const notFound = fileLookup(mockGraph, 'other/folder/a.js');
        expect(notFound.exists).toBe(false);
        expect(notFound.similar).toEqual(['core/a.js', 'core/nested/a.js']);
    });

    it('recognizeSymbolQuestion tests backticked, named, identifiers and negative paths', () => {
        expect(recognizeSymbolQuestion(null)).toBeNull();
        expect(recognizeSymbolQuestion('core/a.js')).toBeNull();
        expect(recognizeSymbolQuestion('just some statement without question')).toBeNull();

        // ticked
        const ticked = recognizeSymbolQuestion('In welk bestand staat `calculateTotal` gedefinieerd?');
        expect(ticked?.symbols).toEqual(['calculateTotal']);

        // named function keyword
        const named = recognizeSymbolQuestion('Which file contains function generateReport?');
        expect(named?.symbols).toEqual(['generateReport']);

        // identifier with underscore/camelCase
        const ident = recognizeSymbolQuestion('Waar is parse_query_string implemented?');
        expect(ident?.symbols).toEqual(['parse_query_string']);

        // plain word
        const plain = recognizeSymbolQuestion('In welk bestand staat widget gedefinieerd?');
        expect(plain?.symbols).toEqual(['widget']);
    });

    it('definedIn and exportsOf test symbolRanges, exports array and missing', () => {
        const withRange = definedIn(mockGraph, 'mySymbol');
        expect(withRange.found).toBe(true);
        expect(withRange.locations[0]).toEqual({ path: 'core/b.js', startLine: 10, endLine: 20 });

        const withExportOnly = definedIn(mockGraph, 'funcA');
        expect(withExportOnly.found).toBe(true);
        expect(withExportOnly.locations[0]).toEqual({ path: 'core/a.js' });

        const notFound = definedIn(mockGraph, 'nonExistent');
        expect(notFound.found).toBe(false);

        const exp = exportsOf(mockGraph, 'core/a.js');
        expect(exp.found).toBe(true);
        expect(exp.names).toEqual(['funcA']);

        const missingExp = exportsOf(mockGraph, 'ghost.js');
        expect(missingExp.found).toBe(false);
    });
});
