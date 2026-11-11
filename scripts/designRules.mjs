// Measures the design rules over the code with the ESLint API, per function (complexity) and per file (nesting,
// else-if chains). `node scripts/designRules.mjs --write` writes eslint-baseline.json after a clean-up; without
// --write it prints the totals. test/designRules.internal.test.js compares the measurement with the baseline.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ESLint } from 'eslint';
import { DESIGN_FILES, DESIGN_RULES, BASELINE_FILE } from './designConfig.mjs';

export { readBaseline, DESIGN_RULES } from './designConfig.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// "Function 'name' has a complexity of 8." / "Arrow function has a complexity of 7." / "Async method 'x' has ..."
const functionLabel = message => message.match(/'([^']+)'/)?.[1] ?? message.match(/^(.*?) has a complexity/)?.[1] ?? 'function';

const RULE_RECORDERS = {
    complexity(m, out, file, seen) {
        const label = functionLabel(m.message);
        const k = (seen.get(label) || 0) + 1;
        seen.set(label, k);
        (out.functions[file] ||= {})[`${label}#${k}`] = Number(m.message.match(/complexity of (\d+)/)[1]);
    },
    'max-depth'(_m, out, file) {
        out.depth[file] = (out.depth[file] || 0) + 1;
    },
    'no-restricted-syntax'(m, out, file) {
        if (m.message.startsWith('else-if')) out.elseIf[file] = (out.elseIf[file] || 0) + 1;
    }
};

/** `{ functions: { file: { 'name#k': complexity } }, depth: { file: n }, elseIf: { file: n } }`, k = k-th of that name in the file. */
export async function measureDesignRules({ cwd = ROOT, patterns = DESIGN_FILES } = {}) {
    const eslint = new ESLint({ cwd, overrideConfig: { rules: DESIGN_RULES } });
    const results = await eslint.lintFiles(patterns);
    const out = { functions: {}, depth: {}, elseIf: {} };
    for (const result of results) {
        const file = path.relative(cwd, result.filePath).replace(/\\/g, '/');
        const seen = new Map();
        for (const m of result.messages) {
            RULE_RECORDERS[m.ruleId]?.(m, out, file, seen);
        }
    }
    return out;
}

/** Number of functions above the norm and the sum of what they are above it: both may only fall. */
export function totals(measure, norm = DESIGN_RULES.complexity[1].max) {
    const values = Object.values(measure.functions).flatMap(Object.values);
    const sum = obj => Object.values(obj).reduce((s, n) => s + n, 0);
    return { functions: values.length, aboveNorm: values.reduce((s, cc) => s + cc - norm, 0), depth: sum(measure.depth), elseIf: sum(measure.elseIf) };
}

const sorted = obj => Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, typeof v === 'object' ? sorted(v) : v]));

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    const measure = await measureDesignRules();
    if (process.argv.includes('--write')) fs.writeFileSync(BASELINE_FILE, JSON.stringify(sorted(measure), null, 2) + '\n');
    console.log(JSON.stringify(totals(measure)));
}
