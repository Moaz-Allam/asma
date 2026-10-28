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
const OBSERVABILITY_DOOR = ['lib/observability/**'];
const ANALYTICS_DOOR = ['lib/analytics/**'];
const TESTS = ['tests/**', 'e2e/**', '**/*.test.ts', '**/*.spec.ts'];

const sentryMessage =
  'Sentry is imported only in lib/observability/ (spec 0004 AC-8). Call its door functions instead.';
const posthogMessage =
  'PostHog is imported only in lib/analytics/ (spec 0004 AC-8). Call track() or its other door functions.';

/**
 * Builds the import restrictions, minus whatever the door being configured may use.
 * `sentry`: false (no Sentry at all), 'build-wrapper' (next.config.ts: withSentryConfig only), or true.
 * `posthog`: false (no PostHog at all) or true.
 */
function restrictedImports({
  supabase = false,
  psp = false,
  admin = false,
  sentry = false,
  posthog = false,
} = {}) {
  const paths = [];
  const patterns = [
    { group: ['../../*'], message: 'Use the @/ alias, never a relative climb (code-standards §21).' },
  ];
  if (sentry === false) patterns.push({ regex: '^@sentry/', message: sentryMessage });
  if (posthog === false) patterns.push({ regex: '^(posthog-|@posthog/)', message: posthogMessage });
  if (sentry === 'build-wrapper') {
    patterns.push({ regex: '^@sentry/(?!nextjs/config$)', message: sentryMessage });
    paths.push({
      name: '@sentry/nextjs/config',
      allowImportNames: ['withSentryConfig'],
      message: 'next.config.ts may import only the build wrapper, withSentryConfig (spec 0004 AC-8).',
    });
  }
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
// Spec 0004 AC-8: the telemetry keys are read only by their doors, lib/env.ts, lib/deployment.ts and
// next.config.ts; the auth token by next.config.ts alone (lib/deployment.ts only names it to check it).
const TELEMETRY_KEYS = ['NEXT_PUBLIC_SENTRY_DSN', 'SENTRY_AUTH_TOKEN', 'NEXT_PUBLIC_POSTHOG_KEY'];
const telemetryMessage =
  'This key is read only inside its door (lib/observability, lib/analytics), lib/env.ts, lib/deployment.ts or ' +
  'next.config.ts (spec 0004 AC-8). Call a door function, or sentryDsn() from lib/env.ts.';
function restrictedSecrets(exempt = []) {
  const selectors = [];
  for (const [all, message] of [
    [SECRETS, secretMessage],
    [TELEMETRY_KEYS, telemetryMessage],
  ]) {
    const names = all.filter((s) => !exempt.includes(s));
    if (names.length === 0) continue;
    const alt = `(${names.join('|')})`;
    selectors.push(
      { selector: `MemberExpression[property.name=/^${alt}$/]`, message },
      { selector: `Literal[value=/^${alt}$/]`, message },
      { selector: `TemplateElement[value.raw=/${alt}/]`, message },
    );
  }
  return selectors.length === 0 ? 'off' : ['error', ...selectors];
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
  // ── Telemetry doors (spec 0004 AC-8). ──
  {
    files: OBSERVABILITY_DOOR,
    rules: {
      'no-restricted-imports': restrictedImports({ sentry: true }),
      'no-restricted-syntax': restrictedSecrets(['NEXT_PUBLIC_SENTRY_DSN']),
    },
  },
  {
    files: ['next.config.ts'],
    rules: {
      'no-restricted-imports': restrictedImports({ sentry: 'build-wrapper' }),
      'no-restricted-syntax': restrictedSecrets(TELEMETRY_KEYS),
    },
  },
  { files: ['lib/deployment.ts'], rules: { 'no-restricted-syntax': restrictedSecrets(TELEMETRY_KEYS) } },
  {
    files: ANALYTICS_DOOR,
    rules: {
      'no-restricted-imports': restrictedImports({ posthog: true }),
      'no-restricted-syntax': restrictedSecrets(['NEXT_PUBLIC_POSTHOG_KEY']),
    },
  },
  {
    files: ['lib/env.ts'],
    rules: {
      'no-restricted-syntax': restrictedSecrets(['NEXT_PUBLIC_SENTRY_DSN', 'NEXT_PUBLIC_POSTHOG_KEY']),
    },
  },
  // Tests build fake environments and fixtures; the doors protect production code. This config file
  // must name the secrets to define the rule.
  { files: [...TESTS, 'eslint.config.mjs'], rules: { 'no-restricted-syntax': 'off' } },
];

export default config;
