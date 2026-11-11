/**
 * AC4: functionComplexity counts exactly the same as ESLint's `complexity` rule,
 * including `?.`, default values, logical assignments and callbacks.
 * AC5: health flags `complexity-above-norm` (> 5) and `high-cyclomatic-complexity` (> 15);
 * the zone of pain only triggers on heavy functions (> 15).
 */
import { describe, it, expect } from 'vitest';
import { parse } from 'acorn';
import { ESLint } from 'eslint';
import { computeFunctionMetrics, calculateArchitectureMetrics, createGraph } from '../core/graph/index.js';

const parseFn = code => parse(code, { ecmaVersion: 'latest', sourceType: 'module' }).body[0];

async function eslintComplexity(code) {
    const eslint = new ESLint({
        overrideConfigFile: true,
        overrideConfig: {
            languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
            rules: { complexity: ['error', { max: 0 }] }
        }
    });
    const [result] = await eslint.lintText(code);
    const msg = result.messages.find(m => m.ruleId === 'complexity');
    return msg ? Number(msg.message.match(/complexity of (\d+)/)[1]) : 1;
}

describe('functionComplexity (AC4 & AC5)', () => {
    const sampleCases = [
        {
            name: 'optional chaining and defaults',
            code: 'function testDefaults(a = 1, b = 2) { return a?.b?.c ?? b; }'
        },
        {
            name: 'logical assignments and branches',
            code: 'function testLogicalAssign(x, y) { x ||= 1; y &&= 2; return x ? y : null; }'
        },
        {
            name: 'nested if conditions with optional call',
            code: 'function testNested(obj, fn) { if (obj?.active) { fn?.(); return 1; } return 0; }'
        },
        {
            name: 'switch cases and null checks',
            code: 'function testSwitch(x) { switch(x) { case 1: return "a"; case 2: return "b"; default: return "c"; } }'
        }
    ];

    for (const { name, code } of sampleCases) {
        it(`MUST match ESLint complexity count for: ${name}`, async () => {
            const astFn = parseFn(code);
            const metrics = computeFunctionMetrics(astFn, name);
            const esCc = await eslintComplexity(code);
            expect(metrics.cyclomaticComplexity).toBe(esCc);
        });
    }

    it('assigns complexity-above-norm for CC between 6 and 15, and high-cyclomatic-complexity for CC > 15', () => {
        const branches = n => Array.from({ length: n }, (_, i) => `if (x === ${i}) return ${i};`).join('\n');
        const codeNorm = `function fnNorm(x) { ${branches(6)} return -1; }`; // CC = 7
        const codeHigh = `function fnHigh(x) { ${branches(16)} return -1; }`; // CC = 17

        const metricsNorm = computeFunctionMetrics(parseFn(codeNorm), 'fnNorm');
        expect(metricsNorm.cyclomaticComplexity).toBe(7);
        expect(metricsNorm.issues).toContain('complexity-above-norm');
        expect(metricsNorm.issues).not.toContain('high-cyclomatic-complexity');

        const metricsHigh = computeFunctionMetrics(parseFn(codeHigh), 'fnHigh');
        expect(metricsHigh.cyclomaticComplexity).toBe(17);
        expect(metricsHigh.issues).toContain('high-cyclomatic-complexity');
        expect(metricsHigh.issues).not.toContain('complexity-above-norm');
    });

    it('zone of pain includes files with high-cyclomatic-complexity, but NOT files that only have complexity-above-norm', () => {
        const graph = createGraph('cop');
        graph.addNode('file:core/norm.js', 'CodeFile', {
            path: 'core/norm.js',
            kind: 'source',
            lines: 30,
            functions: [{ name: 'fNorm', cyclomaticComplexity: 8, issues: ['complexity-above-norm'] }]
        });
        graph.addNode('file:core/heavy.js', 'CodeFile', {
            path: 'core/heavy.js',
            kind: 'source',
            lines: 30,
            functions: [{ name: 'fHeavy', cyclomaticComplexity: 18, issues: ['high-cyclomatic-complexity'] }]
        });
        for (let i = 0; i < 5; i++) {
            graph.addNode(`file:core/caller${i}.js`, 'CodeFile', { path: `core/caller${i}.js`, kind: 'source', lines: 10 });
            graph.addEdge(`file:core/caller${i}.js`, 'file:core/norm.js', 'IMPORTS');
            graph.addEdge(`file:core/caller${i}.js`, 'file:core/heavy.js', 'IMPORTS');
        }

        const entries = [
            { path: 'core/norm.js', tested: true, issues: [] },
            { path: 'core/heavy.js', tested: true, issues: [] },
            ...Array.from({ length: 5 }, (_, i) => ({ path: `core/caller${i}.js`, tested: true, issues: [] }))
        ];

        const metrics = calculateArchitectureMetrics(graph, entries, { zoneOfPainInstability: 0.5 });
        const painPaths = metrics.zoneOfPain.map(e => e.path);
        expect(painPaths).toContain('core/heavy.js');
        expect(painPaths).not.toContain('core/norm.js');
    });
});
