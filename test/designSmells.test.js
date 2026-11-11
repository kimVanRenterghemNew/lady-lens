/**
 * AC5: AST Design smell detection for all 10 smells from Step 6.
 * Each smell has a case that MUST trigger it (with line and advice)
 * and a refactored version that does not.
 */
import { describe, it, expect } from 'vitest';
import { parse } from 'acorn';
import { detectFunctionSmells, detectFileSmells, adviceFor } from '../core/graph/index.js';

const parseFn = code => parse(code, { ecmaVersion: 'latest', sourceType: 'module', locations: true }).body[0];
const parseModule = code => parse(code, { ecmaVersion: 'latest', sourceType: 'module', locations: true });

describe('AST function smells', () => {
    it('MUST flag dispatch-chain on 3+ key comparisons, and NOT on Map/routes lookup', () => {
        const bad = parseFn('function route(name) { if (name === "a") return 1; if (name === "b") return 2; if (name === "c") return 3; return 0; }');
        const badSmells = detectFunctionSmells(bad, 4);
        expect(badSmells.find(s => s.issue === 'dispatch-chain')).toMatchObject({
            issue: 'dispatch-chain',
            advice: adviceFor('dispatch-chain')
        });

        const good = parseFn('function route(name, routes) { const match = routes.find(r => r.name === name); return match ? match.handler() : null; }');
        expect(detectFunctionSmells(good, 2).find(s => s.issue === 'dispatch-chain')).toBeUndefined();
    });

    it('MUST flag fallback-heavy on 3+ fallbacks and >= 40% CC, and NOT on normalized edge', () => {
        const bad = parseFn('function fetch(a = 1, b = 2, c = 3) { return a; }');
        const badSmells = detectFunctionSmells(bad, 4);
        expect(badSmells.find(s => s.issue === 'fallback-heavy')).toMatchObject({
            issue: 'fallback-heavy',
            advice: adviceFor('fallback-heavy')
        });

        const good = parseFn('function fetch(opts) { const { a, b, c } = { ...DEFAULTS, ...opts }; return a; }');
        expect(detectFunctionSmells(good, 1).find(s => s.issue === 'fallback-heavy')).toBeUndefined();
    });

    it('MUST flag deep-nesting when depth > 2, and NOT on early return', () => {
        const bad = parseFn('function process(a, b, c) { if (a) { if (b) { if (c) { return 1; } } } return 0; }');
        const badSmells = detectFunctionSmells(bad, 4);
        expect(badSmells.find(s => s.issue === 'deep-nesting')).toMatchObject({
            issue: 'deep-nesting',
            advice: adviceFor('deep-nesting')
        });

        const good = parseFn('function process(a, b, c) { if (!a) return 0; if (!b) return 0; if (!c) return 0; return 1; }');
        expect(detectFunctionSmells(good, 4).find(s => s.issue === 'deep-nesting')).toBeUndefined();
    });

    it('MUST flag loop-branching on 2+ ifs in a loop, and NOT on pipeline', () => {
        const bad = parseFn('function filterItems(items) { for (const x of items) { if (x.valid) doA(); if (x.active) doB(); } }');
        const badSmells = detectFunctionSmells(bad, 3);
        expect(badSmells.find(s => s.issue === 'loop-branching')).toMatchObject({
            issue: 'loop-branching',
            advice: adviceFor('loop-branching')
        });

        const good = parseFn('function filterItems(items) { return items.filter(x => x.valid).map(x => x.active); }');
        expect(detectFunctionSmells(good, 1).find(s => s.issue === 'loop-branching')).toBeUndefined();
    });

    it('MUST flag long-condition on 3+ logic operators, and NOT on named predicates', () => {
        const bad = parseFn('function test(a, b, c, d) { if (a && b && c && d) return true; return false; }');
        const badSmells = detectFunctionSmells(bad, 4);
        expect(badSmells.find(s => s.issue === 'long-condition')).toMatchObject({
            issue: 'long-condition',
            advice: adviceFor('long-condition')
        });

        const good = parseFn('function test(a, b) { if (isValid(a) && isReady(b)) return true; return false; }');
        expect(detectFunctionSmells(good, 3).find(s => s.issue === 'long-condition')).toBeUndefined();
    });

    it('MUST flag flag-parameter controlling an if, and NOT on two functions', () => {
        const bad = parseFn('function save(record, isDryRun) { if (isDryRun) return null; return doSave(record); }');
        const badSmells = detectFunctionSmells(bad, 2);
        expect(badSmells.find(s => s.issue === 'flag-parameter')).toMatchObject({
            issue: 'flag-parameter',
            advice: adviceFor('flag-parameter')
        });

        const good = parseFn('function save(record) { return doSave(record); }');
        expect(detectFunctionSmells(good, 1).find(s => s.issue === 'flag-parameter')).toBeUndefined();
    });
});

describe('AST file smells', () => {
    it('MUST flag repeated-literal on 3+ identical string comparisons, and NOT on constants', () => {
        const badAst = parseModule('if (state === "ready") a(); if (state === "ready") b(); if (state === "ready") c();');
        const badSmells = detectFileSmells(badAst, 'core/flow.js');
        expect(badSmells.find(s => s.issue === 'repeated-literal')).toMatchObject({
            issue: 'repeated-literal',
            advice: adviceFor('repeated-literal')
        });

        const goodAst = parseModule('const READY = "ready"; if (state === READY) a(); if (state === READY) b(); if (state === READY) c();');
        expect(detectFileSmells(goodAst, 'core/flow.js').find(s => s.issue === 'repeated-literal')).toBeUndefined();
    });

    it('MUST flag global-mutable-state, and NOT on factories', () => {
        const badAst = parseModule('let count = 0; export function inc() { count++; }');
        const badSmells = detectFileSmells(badAst, 'core/counter.js');
        expect(badSmells.find(s => s.issue === 'global-mutable-state')).toMatchObject({
            issue: 'global-mutable-state',
            advice: adviceFor('global-mutable-state')
        });

        const goodAst = parseModule('export function createCounter() { let count = 0; return { inc() { count++; } }; }');
        expect(detectFileSmells(goodAst, 'core/counter.js').find(s => s.issue === 'global-mutable-state')).toBeUndefined();
    });

    it('MUST flag direct-io outside adapters, and NOT inside adapters', () => {
        const badAst = parseModule('import { execSync } from "child_process"; export const run = () => execSync("ls");');
        const badSmells = detectFileSmells(badAst, 'core/utils/helper.js');
        expect(badSmells.find(s => s.issue === 'direct-io')).toMatchObject({
            issue: 'direct-io',
            advice: adviceFor('direct-io')
        });

        // inside designated adapter: MUST NOT flag
        const goodSmells = detectFileSmells(badAst, 'core/git/client.js');
        expect(goodSmells.find(s => s.issue === 'direct-io')).toBeUndefined();
    });

    it('MUST flag god-module on excessive imports/exports, and NOT on barrels', () => {
        const badSmells = detectFileSmells(parseModule('export const a = 1;'), 'core/heavy.js', { exportsCount: 16 });
        expect(badSmells.find(s => s.issue === 'god-module')).toMatchObject({
            issue: 'god-module',
            advice: adviceFor('god-module')
        });

        // barrels (index.js) are exempt
        const barrelSmells = detectFileSmells(parseModule('export const a = 1;'), 'core/index.js', { exportsCount: 25 });
        expect(barrelSmells.find(s => s.issue === 'god-module')).toBeUndefined();
    });
});
