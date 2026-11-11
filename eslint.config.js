import js from '@eslint/js';
import globals from 'globals';
import html from 'eslint-plugin-html';
import { DESIGN_FILES, DESIGN_RULES, CLASS_RULES, baselineFiles } from './scripts/designConfig.mjs';

const legacy = baselineFiles();

export default [
  { ignores: ['node_modules/**', 'outputs/**', 'vault/**', '**/*.generated.js', '.claude/**'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.node } },
    rules: {
      // `const { a: _a, ...rest } = obj` drops a key on purpose (rest-omit); not an unused variable.
      'no-unused-vars': ['error', { ignoreRestSiblings: true }],
      'no-restricted-syntax': ['error', ...CLASS_RULES],
    },
  },
  // The page scripts of `lens ui`: classic scripts in the browser, each part of the page sees the names of the others.
  {
    files: ['ui/**/*.html'],
    plugins: { html },
    languageOptions: { sourceType: 'script', globals: { ...globals.browser, cytoscape: 'readonly' } },
    rules: { 'no-undef': 'off', 'no-unused-vars': 'off' },
  },
  // Design rules (backlog/if-ketens-afdwingen.md) for all new code.
  { files: DESIGN_FILES, rules: DESIGN_RULES },
  // Files with code above the norm today: test/designRules.internal.test.js holds them to eslint-baseline.json per function.
  ...(legacy.length ? [{
    files: legacy,
    rules: {
      complexity: ['warn', { max: 5 }],
      'max-depth': ['warn', 2],
      'no-else-return': 'warn',
    },
  }] : []),
];
