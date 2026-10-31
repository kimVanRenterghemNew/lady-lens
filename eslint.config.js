import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'outputs/**', 'vault/**', '**/*.generated.js', '.claude/**'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.node } },
    rules: {
      // `const { a: _a, ...rest } = obj` drops a key on purpose (rest-omit); not an unused variable.
      'no-unused-vars': ['error', { ignoreRestSiblings: true }],
      'no-restricted-syntax': ['error', { selector: 'ClassDeclaration', message: 'No class: use a factory function.' },
        { selector: 'ClassExpression', message: 'No class: use a factory function.' }],
    },
  }
];
