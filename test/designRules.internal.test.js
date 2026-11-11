/**
 * Design rules (backlog/if-ketens-afdwingen.md): complexity 5, nesting 2, no else-if chain. New code MUST meet them;
 * code above the norm today is in eslint-baseline.json per function and may only get better. After a clean-up the
 * baseline must shrink with it: `node scripts/designRules.mjs --write`.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { ESLint } from 'eslint';
import { measureDesignRules, totals, readBaseline, DESIGN_RULES } from '../scripts/designRules.mjs';

const REFRESH = 'run `node scripts/designRules.mjs --write`';

/** What `measure` breaks against `baseline`: new or grown (worse), and gone or lower but still listed (stale). */
export function compare(measure, baseline) {
    const worse = [], stale = [];
    const files = new Set([...Object.keys(measure.functions), ...Object.keys(baseline.functions)]);
    for (const file of files) {
        const now = measure.functions[file] || {}, before = baseline.functions[file] || {};
        for (const [key, cc] of Object.entries(now)) {
            if (!(key in before)) worse.push(`${file} ${key}: complexity ${cc} (norm 5)`);
            else if (cc > before[key]) worse.push(`${file} ${key}: complexity ${before[key]} -> ${cc}`);
        }
        for (const [key, cc] of Object.entries(before)) if (!(key in now) || now[key] < cc) stale.push(`${file} ${key}: ${cc} -> ${now[key] ?? 'at the norm'}`);
    }
    for (const kind of ['depth', 'elseIf']) {
        for (const file of new Set([...Object.keys(measure[kind]), ...Object.keys(baseline[kind])])) {
            const now = measure[kind][file] || 0, before = baseline[kind][file] || 0;
            if (now > before) worse.push(`${file} ${kind}: ${before} -> ${now}`);
            if (now < before) stale.push(`${file} ${kind}: ${before} -> ${now}`);
        }
    }
    return { worse, stale };
}

describe('design rules', () => {
    let measure, baseline;
    beforeAll(async () => { [measure, baseline] = [await measureDesignRules(), readBaseline()]; }, 120_000);

    it('MUST NOT add a function above the norm, nor make a listed one more complex, deeper or more chained', () => {
        expect(compare(measure, baseline).worse).toEqual([]);
    });

    it(`MUST shrink the baseline with every clean-up (${REFRESH})`, () => {
        expect(compare(measure, baseline).stale).toEqual([]);
    });

    it('the totals may only fall', () => {
        const [now, before] = [totals(measure), totals(baseline)];
        for (const key of Object.keys(now)) expect(now[key], key).toBeLessThanOrEqual(before[key]);
    });

    it('compare: a new, a grown and a stale function are each named', () => {
        const base = { functions: { 'a.js': { 'f#1': 8, 'g#1': 9 } }, depth: { 'a.js': 2 }, elseIf: {} };
        const now = { functions: { 'a.js': { 'f#1': 9, 'h#1': 6 } }, depth: { 'a.js': 1 }, elseIf: { 'b.js': 1 } };
        expect(compare(now, base)).toEqual({
            worse: ['a.js f#1: complexity 8 -> 9', 'a.js h#1: complexity 6 (norm 5)', 'b.js elseIf: 0 -> 1'],
            stale: ['a.js g#1: 9 -> at the norm', 'a.js depth: 2 -> 1']
        });
    });

    it('J1: a name dispatch as an if-chain breaks the rules; the same as a lookup table does not', async () => {
        const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: { languageOptions: { ecmaVersion: 'latest', sourceType: 'module' }, rules: DESIGN_RULES } });
        const chain = `export function route(name) {\n  if (name === 'a') return 1;\n  else if (name === 'b') return 2;\n  else if (name === 'c') return 3;\n  else if (name === 'd') return 4;\n  else if (name === 'e') return 5;\n  return 0;\n}\n`;
        const table = `const ROUTES = { a: 1, b: 2, c: 3, d: 4, e: 5 };\nexport const route = name => ROUTES[name] ?? 0;\n`;
        const [bad] = await eslint.lintText(chain, { filePath: 'core/x/route.js' });
        const [good] = await eslint.lintText(table, { filePath: 'core/x/route.js' });
        expect(new Set(bad.messages.map(m => m.ruleId))).toEqual(new Set(['complexity', 'no-restricted-syntax']));
        expect(good.messages).toEqual([]);
    });
});
