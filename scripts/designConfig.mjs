// The design rules (backlog/if-ketens-afdwingen.md): complexity 5, nesting 2, no else after return, no else-if chain.
// One source for eslint.config.js, scripts/designRules.mjs and test/designRules.internal.test.js.
import fs from 'fs';

export const DESIGN_FILES = ['core/**/*.js', 'bin/**/*.mjs', 'ui/**/*.mjs', 'ui/**/*.html', 'scripts/**/*.mjs'];

export const CLASS_RULES = [
    { selector: 'ClassDeclaration', message: 'No class: use a factory function.' },
    { selector: 'ClassExpression', message: 'No class: use a factory function.' }
];
export const ELSE_IF = { selector: 'IfStatement > IfStatement.alternate', message: 'else-if chain: use a lookup table, a router or early returns.' };

export const DESIGN_RULES = {
    complexity: ['error', { max: 5 }],
    'max-depth': ['error', 2],
    'no-else-return': 'error',
    'no-restricted-syntax': ['error', ...CLASS_RULES, ELSE_IF]
};

export const BASELINE_FILE = new URL('../eslint-baseline.json', import.meta.url);

/** `{ functions: { file: { key: complexity } }, depth: { file: count }, elseIf: { file: count } }`; empty without a file. */
export function readBaseline() {
    try { return JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')); } catch { return { functions: {}, depth: {}, elseIf: {} }; }
}

/** Files with anything in the baseline: ESLint leaves the design rules to the test there (it checks per function). */
export const baselineFiles = (baseline = readBaseline()) => [...new Set([...Object.keys(baseline.functions), ...Object.keys(baseline.depth), ...Object.keys(baseline.elseIf)])].sort();
