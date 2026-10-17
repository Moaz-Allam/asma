import next from 'eslint-config-next';
import tseslint from 'typescript-eslint';

/**
 * Lint is one of the layers an agent cannot talk its way past — a rule stated in
 * a document gets forgotten; a red pipeline does not.
 *
 * Single doors (context/architecture.md §42): each risky system has exactly one
 * module allowed to import its SDK or read its secret. Every rule below has a
 * proof that it fires in tests/lint/eslint-rules.test.ts. A new door adds its
 * rule and its proof in the same change that creates the module.
 */

// Files that are allowed through a door. Paths are relative to the repo root.
const DB_DOOR = ['lib/db/**'];
const PSP_DOOR = ['lib/psp/**'];
const RELAY = ['**/relay/**', '**/outbox/**', '**/*relay*.ts'];
const SERVICE_ROLE_USERS = ['lib/db/**', 'app/api/webhooks/**', 'lib/jobs/**', ...RELAY];
const TESTS = ['tests/**', 'e2e/**', '**/*.test.ts', '**/*.spec.ts'];

/** Builds the import restrictions, minus whatever the door being configured may use. */
function restrictedImports({ supabase = false, psp = false, admin = false } = {}) {
  const paths = [];
  const patterns = [
    { group: ['../../*'], message: 'Use the @/ alias, never a relative climb (code-standards §21).' },
  ];
  if (!supabase) {
    for (const name of ['@supabase/supabase-js', '@supabase/ssr']) {
      paths.push({ name, message: 'Supabase clients are created only in lib/db/ (architecture.md §42).' });
    }
  }
  if (!psp) {
    paths.push({ name: 'iyzipay', message: 'A PSP SDK is imported only inside lib/psp/ (rule 3, §42).' });
    patterns.push({
      group: ['@/lib/psp', '@/lib/psp/*'],
      message: 'Only the outbox relay calls lib/psp (rule 3). Write an outbox_events row instead.',
    });
  }
  if (!admin) {
    patterns.push({
      group: ['@/lib/db/admin'],
      message: 'The service role client bypasses RLS: webhooks, jobs, and the relay only (§42).',
    });
  }
  return ['error', { paths, patterns }];
}

// Secrets readable only inside their door: matched as identifier, string literal, and template text.
const SECRETS = ['SUPABASE_SERVICE_ROLE_KEY', 'IYZICO_[A-Z0-9_]+', 'PAYTABS_[A-Z0-9_]+'];
const secretMessage = 'This secret is read only inside its single door (architecture.md §42).';
function restrictedSecrets(exempt = []) {
  const names = SECRETS.filter((s) => !exempt.includes(s));
  if (names.length === 0) return 'off';
  const alt = `(${names.join('|')})`;
  return [
    'error',
    { selector: `MemberExpression[property.name=/^${alt}$/]`, message: secretMessage },
    { selector: `Literal[value=/^${alt}$/]`, message: secretMessage },
    { selector: `TemplateElement[value.raw=/${alt}/]`, message: secretMessage },
  ];
}

const config = [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'context/**',
      'docs/**',
      '.claude/**',
      '.agents/**',
      'tests/stubs/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
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
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-restricted-imports': restrictedImports(),
      'no-restricted-syntax': restrictedSecrets(),
    },
  },
  // ── Doors. Later objects override earlier ones for the files they match. ──
  { files: DB_DOOR, rules: { 'no-restricted-imports': restrictedImports({ supabase: true, admin: true }) } },
  { files: PSP_DOOR, rules: { 'no-restricted-imports': restrictedImports({ psp: true }) } },
  { files: RELAY, rules: { 'no-restricted-imports': restrictedImports({ psp: true, admin: true }) } },
  {
    files: SERVICE_ROLE_USERS.filter((g) => !DB_DOOR.includes(g) && !RELAY.includes(g)),
    rules: { 'no-restricted-imports': restrictedImports({ admin: true }) },
  },
  {
    files: ['lib/db/admin.ts'],
    rules: { 'no-restricted-syntax': restrictedSecrets(['SUPABASE_SERVICE_ROLE_KEY']) },
  },
  {
    files: PSP_DOOR,
    rules: { 'no-restricted-syntax': restrictedSecrets(['IYZICO_[A-Z0-9_]+', 'PAYTABS_[A-Z0-9_]+']) },
  },
  // Tests build fake environments and fixtures; the doors protect production code. This config file
  // must name the secrets to define the rule.
  { files: [...TESTS, 'eslint.config.mjs'], rules: { 'no-restricted-syntax': 'off' } },
];

export default config;
