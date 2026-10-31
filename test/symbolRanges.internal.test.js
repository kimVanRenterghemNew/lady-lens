/**
 * a symbol resolves to path + line range (from the graph), so the coder reads only those lines.
 */
import { describe, it, expect } from 'vitest';
import { locateSymbols } from '../core/graph/index.js';
import { analyzeSource } from '../core/graph/index.js';
import { buildCodeEntity } from '../core/graph/adapters/ladybug/index.js';

const SOURCE = [
    '/** Demo. */',
    'import fs from "fs";',
    '',
    'export function runThing(a) {',
    '    return helper(a);',
    '}',
    '',
    'const helper = (x) => {',
    '    return x + 1;',
    '};',
    '',
    'export class Store {',
    '    save() {',
    '        return 1;',
    '    }',
    '}',
    ''
].join('\n');

describe('analyzeSource symbolRanges', () => {
    const facts = analyzeSource(SOURCE);
    it('functions, consts, classes and methods carry 1-based start/end lines', () => {
        expect(facts.symbolRanges.runThing).toEqual([4, 6]);
        expect(facts.symbolRanges.helper).toEqual([8, 10]);
        expect(facts.symbolRanges.Store).toEqual([12, 16]);
        expect(facts.symbolRanges.save).toEqual([13, 15]);
    });
    it('only for symbols that are in `symbols`, and capped', () => {
        for (const name of Object.keys(facts.symbolRanges)) expect(facts.symbols).toContain(name);
    });
    it('a parse error gives no ranges instead of throwing', () => {
        expect(analyzeSource('export function (').symbolRanges).toEqual({});
    });
    it('the code entity stores them in its metadata', () => {
        expect(buildCodeEntity('core/x.js', SOURCE).metadata.symbolRanges.runThing).toEqual([4, 6]);
    });
});

describe('locateSymbols', () => {
    const nodes = [
        { id: 'file:core/x.js', type: 'CodeFile', kind: 'source', path: 'core/x.js', symbols: ['runThing', 'helper'], symbolRanges: { runThing: [4, 6], helper: [8, 10] } },
        { id: 'file:core/y.js', type: 'CodeFile', kind: 'source', path: 'core/y.js', symbols: ['runThing'], symbolRanges: { runThing: [20, 30] } },
        { id: 'file:test/x.test.js', type: 'CodeFile', kind: 'test', path: 'test/x.test.js', symbolRanges: { runThing: [1, 2] } }
    ];
    it('finds a symbol named in the question: every source file that declares it, with path and range', () => {
        expect(locateSymbols(nodes, 'where is runThing used')).toEqual([
            { name: 'runThing', path: 'core/x.js', startLine: 4, endLine: 6 },
            { name: 'runThing', path: 'core/y.js', startLine: 20, endLine: 30 }
        ]);
    });
    it('matches whole identifiers only, case-sensitive, and ignores tests', () => {
        expect(locateSymbols(nodes, 'runThings helperX')).toEqual([]);
        expect(locateSymbols(nodes, 'runthing')).toEqual([]);
    });
    it('is bounded', () => {
        expect(locateSymbols(nodes, 'runThing helper', { limit: 1 })).toHaveLength(1);
    });
    it('a node without ranges (older index) is skipped', () => {
        expect(locateSymbols([{ type: 'CodeFile', kind: 'source', path: 'core/old.js', symbols: ['runThing'] }], 'runThing')).toEqual([]);
    });
});
