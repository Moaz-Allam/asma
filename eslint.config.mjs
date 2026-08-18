import next from 'eslint-config-next';
import tseslint from 'typescript-eslint';

/**
 * Lint is one of the layers an agent cannot talk its way past — a rule stated in
 * a document gets forgotten; a red pipeline does not.
 */
const config = [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'context/**',
      'specs/**',
      '.claude/**',
      '.agents/**',
      'screens/**',
      'tests/stubs/**',
    ],
  },
  ...next,
  ...tseslint.configs.recommended,
  {
    rules: {
      // code-standards.md §1 — no `any`. `strict: true` does not ban it, so this
      // rule is the thing actually enforcing it. Narrow from `unknown` instead.
      '@typescript-eslint/no-explicit-any': 'error',
      // Allow a leading underscore for deliberately unused bindings (e.g. the
      // omitted key in a destructure), and nothing else.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // code-standards.md §21 — always the `@/` alias, never a relative climb.
      'no-restricted-imports': ['error', { patterns: ['../../*'] }],
    },
  },
];

export default config;
