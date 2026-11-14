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
const AUTH_DOOR = ['lib/auth/**'];
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

/**
 * The same door modules as `restrictedImports`, reached by `import()` or `require()`, which
 * no-restricted-imports never sees (D86). esquery regexes cannot hold a `/`, so `.` stands in for it.
 */
function restrictedModules({
  supabase = false,
  psp = false,
  admin = false,
  sentry = false,
  posthog = false,
} = {}) {
  const modules = [];
  if (sentry === false) modules.push(['^@sentry.', sentryMessage]);
  if (sentry === 'build-wrapper') modules.push(['^@sentry.(?!nextjs.config$)', sentryMessage]);
  if (posthog === false) modules.push(['^(posthog-|@posthog.)', posthogMessage]);
  if (!supabase) {
    modules.push([
      '^@supabase.(supabase-js|ssr)$',
      'Supabase clients are created only in lib/db/ (architecture.md §42).',
    ]);
  }
  if (!psp) {
    modules.push(
      ['^iyzipay$', 'A PSP SDK is imported only inside lib/psp/ (rule 3, §42).'],
      [
        '^@.lib.psp(.|$)',
        'Only the outbox relay calls lib/psp (rule 3). Write an outbox_events row instead.',
      ],
    );
  }
  if (!admin) {
    modules.push([
      '^@.lib.db.admin$',
      'The service role client bypasses RLS: webhooks, jobs, and the relay only (§42).',
    ]);
  }
  return modules.flatMap(([source, message]) => [
    { selector: `ImportExpression[source.value=/${source}/]`, message },
    { selector: `CallExpression[callee.name='require'][arguments.0.value=/${source}/]`, message },
  ]);
}

// Secrets readable only inside their door: matched as identifier, string literal, template text, and
// a destructured name (`const { KEY } = process.env`, D86).
const SECRETS = ['SUPABASE_SERVICE_ROLE_KEY', 'IYZICO_[A-Z0-9_]+', 'PAYTABS_[A-Z0-9_]+'];
const secretMessage = 'This secret is read only inside its single door (architecture.md §42).';
// Spec 0004 AC-8: the telemetry keys are read only by their doors, lib/env.ts, lib/deployment.ts and
// next.config.ts; the auth token by next.config.ts alone (lib/deployment.ts only names it to check it).
const TELEMETRY_KEYS = ['NEXT_PUBLIC_SENTRY_DSN', 'SENTRY_AUTH_TOKEN', 'NEXT_PUBLIC_POSTHOG_KEY'];
const telemetryMessage =
  'This key is read only inside its door (lib/observability, lib/analytics), lib/env.ts, lib/deployment.ts or ' +
  'next.config.ts (spec 0004 AC-8). Call a door function, or sentryDsn() / posthogKey() from lib/env.ts.';
function secretSelectors(exempt) {
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
      { selector: `ObjectPattern > Property[key.name=/^${alt}$/]`, message },
    );
  }
  return selectors;
}

// A computed key or a spread reads any variable at all, past every rule above (D86). Only lib/env.ts,
// next.config.ts and the scripts read the environment that way.
const envAccessMessage =
  'Read the environment through lib/env.ts (getEnv(), sentryDsn(), posthogKey()), never by a computed key ' +
  'or a spread of process.env (D86).';
const ENV_ACCESS = [
  {
    selector:
      "MemberExpression[computed=true][object.type='MemberExpression'][object.object.name='process'][object.property.name='env']",
    message: envAccessMessage,
  },
  {
    selector: "SpreadElement > MemberExpression[object.name='process'][property.name='env']",
    message: envAccessMessage,
  },
];

// Spec 0005 AC-25: only lib/auth/ touches `supabase.auth`, and lib/db/proxy.ts for the session refresh.
// Everyone else calls a named lib/auth function. Matched on the property, so a renamed client is caught.
const authMessage =
  'Only lib/auth/ calls supabase.auth (spec 0005 AC-25). Call a named lib/auth function instead.';
const AUTH_DOOR_SELECTORS = [
  { selector: "MemberExpression[property.name='auth']", message: authMessage },
  { selector: "ObjectPattern > Property[key.name='auth']", message: authMessage },
];
// getSession() reads the cookie without asking the Auth server, so it proves nothing on the server, and
// no code here has a reason to call it (spec 0005 AC-25). Banned in every door.
const getSessionMessage = 'Never getSession(): identity comes from getUser() in lib/auth (spec 0005 AC-12).';
const NO_GET_SESSION = [
  { selector: "MemberExpression[property.name='getSession']", message: getSessionMessage },
  { selector: "ObjectPattern > Property[key.name='getSession']", message: getSessionMessage },
  { selector: "Literal[value='getSession']", message: getSessionMessage },
];

// Spec 0006 AC-26: only lib/storage/ calls `.storage` (uploads, signed links, removes), so every file
// rule (paths, limits, content types, cache control, link lifetime) lives in one place. Matched on the
// property, so a renamed client is caught, and on a destructure.
const storageMessage =
  'Only lib/storage/ calls supabase.storage (spec 0006 AC-26). Call uploadProviderFile, signedLink or removeOld.';
const STORAGE_DOOR_SELECTORS = [
  { selector: "MemberExpression[property.name='storage']", message: storageMessage },
  { selector: "ObjectPattern > Property[key.name='storage']", message: storageMessage },
];

/** no-restricted-syntax for one door: its secrets, its modules by import() or require(), env access, Auth, Storage. */
function restrictedSyntax({
  exempt = [],
  modules = {},
  envAccess = false,
  auth = false,
  storage = false,
} = {}) {
  return [
    'error',
    ...secretSelectors(exempt),
    ...restrictedModules(modules),
    ...(envAccess ? [] : ENV_ACCESS),
    ...(auth ? [] : AUTH_DOOR_SELECTORS),
    ...(storage ? [] : STORAGE_DOOR_SELECTORS),
    ...NO_GET_SESSION,
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
      'supabase/.temp/**',
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
      'no-restricted-syntax': restrictedSyntax(),
    },
  },
  // ── Doors. Later objects override earlier ones for the files they match, so each sets both rules. ──
  {
    files: DB_DOOR,
    rules: {
      'no-restricted-imports': restrictedImports({ supabase: true, admin: true }),
      'no-restricted-syntax': restrictedSyntax({ modules: { supabase: true, admin: true } }),
    },
  },
  {
    files: PSP_DOOR,
    rules: {
      'no-restricted-imports': restrictedImports({ psp: true }),
      'no-restricted-syntax': restrictedSyntax({
        exempt: ['IYZICO_[A-Z0-9_]+', 'PAYTABS_[A-Z0-9_]+'],
        modules: { psp: true },
      }),
    },
  },
  {
    files: RELAY,
    rules: {
      'no-restricted-imports': restrictedImports({ psp: true, admin: true }),
      'no-restricted-syntax': restrictedSyntax({ modules: { psp: true, admin: true } }),
    },
  },
  {
    files: SERVICE_ROLE_USERS.filter((g) => !DB_DOOR.includes(g) && !RELAY.includes(g)),
    rules: {
      'no-restricted-imports': restrictedImports({ admin: true }),
      'no-restricted-syntax': restrictedSyntax({ modules: { admin: true } }),
    },
  },
  {
    files: ['lib/db/admin.ts'],
    rules: {
      'no-restricted-syntax': restrictedSyntax({
        exempt: ['SUPABASE_SERVICE_ROLE_KEY'],
        modules: { supabase: true, admin: true },
      }),
    },
  },
  // ── Auth door (spec 0005 AC-25). lib/db/proxy.ts is the one exemption: the session refresh lives there. ──
  { files: AUTH_DOOR, rules: { 'no-restricted-syntax': restrictedSyntax({ auth: true }) } },
  {
    files: ['lib/db/proxy.ts'],
    rules: {
      'no-restricted-syntax': restrictedSyntax({ modules: { supabase: true, admin: true }, auth: true }),
    },
  },
  // ── Storage door (spec 0006 AC-26). ──
  { files: ['lib/storage/**'], rules: { 'no-restricted-syntax': restrictedSyntax({ storage: true }) } },
  // ── Telemetry doors (spec 0004 AC-8). ──
  {
    files: OBSERVABILITY_DOOR,
    rules: {
      'no-restricted-imports': restrictedImports({ sentry: true }),
      'no-restricted-syntax': restrictedSyntax({
        exempt: ['NEXT_PUBLIC_SENTRY_DSN'],
        modules: { sentry: true },
      }),
    },
  },
  {
    files: ['next.config.ts'],
    rules: {
      'no-restricted-imports': restrictedImports({ sentry: 'build-wrapper' }),
      'no-restricted-syntax': restrictedSyntax({
        exempt: TELEMETRY_KEYS,
        modules: { sentry: 'build-wrapper' },
        envAccess: true,
      }),
    },
  },
  {
    files: ['lib/deployment.ts'],
    rules: { 'no-restricted-syntax': restrictedSyntax({ exempt: TELEMETRY_KEYS }) },
  },
  {
    files: ANALYTICS_DOOR,
    rules: {
      'no-restricted-imports': restrictedImports({ posthog: true }),
      'no-restricted-syntax': restrictedSyntax({
        exempt: ['NEXT_PUBLIC_POSTHOG_KEY'],
        modules: { posthog: true },
      }),
    },
  },
  {
    files: ['lib/env.ts'],
    rules: {
      'no-restricted-syntax': restrictedSyntax({
        exempt: ['NEXT_PUBLIC_SENTRY_DSN', 'NEXT_PUBLIC_POSTHOG_KEY'],
        envAccess: true,
      }),
    },
  },
  // The scripts start processes with a copy of the environment.
  { files: ['scripts/**'], rules: { 'no-restricted-syntax': restrictedSyntax({ envAccess: true }) } },
  // Tests build fake environments and fixtures; the doors protect production code. This config file
  // must name the secrets to define the rule.
  { files: [...TESTS, 'eslint.config.mjs'], rules: { 'no-restricted-syntax': 'off' } },
];

export default config;
