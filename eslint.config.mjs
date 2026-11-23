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
// Spec 0011-13 AC-1: the email door. Only the relay sends mail (umbrella U-4), so only it imports lib/email.
const EMAIL_DOOR = ['lib/email/**'];
// Spec 0011-08 AC-3: only modules under lib/ get the relay's rights. A route file, `app/api/relay` included,
// only parses the request and calls lib/relay, so it may import neither lib/psp nor the service role.
const RELAY = ['lib/**/relay/**', 'lib/**/outbox/**', 'lib/**/*relay*.ts'];
// Spec 0011-08, security review G1: lib/relay hands out the service role client and the PSP, so only the
// relay's own routes and the fake card page may import it.
const RELAY_CALLERS = ['app/api/relay/**', 'app/api/psp/**', 'app/*/dev/fake-checkout/**'];
const SERVICE_ROLE_USERS = ['lib/db/**', 'app/api/webhooks/**', 'lib/jobs/**', ...RELAY];
const OBSERVABILITY_DOOR = ['lib/observability/**'];
const ANALYTICS_DOOR = ['lib/analytics/**'];
const AUTH_DOOR = ['lib/auth/**'];
// Spec 0011-20b AC-10: the map door. Only it imports the map packages or reads the MapTiler key.
const MAPS_DOOR = ['lib/maps/**'];
const TESTS = ['tests/**', 'e2e/**', '**/*.test.ts', '**/*.spec.ts'];

const sentryMessage =
  'Sentry is imported only in lib/observability/ (spec 0004 AC-8). Call its door functions instead.';
const posthogMessage =
  'PostHog is imported only in lib/analytics/ (spec 0004 AC-8). Call track() or its other door functions.';
const emailImportMessage =
  'Only the outbox relay sends mail (spec 0011-13 AC-1, rule 3): lib/email is imported by lib/relay alone. ' +
  'A move writes its audit row; a trigger queues the mail.';
// Security review S20 (guardrail): the agreement file door takes the relay's handle and the renderer runs only in the
// relay (rule 3), so only lib/relay imports them.
const mapsMessage =
  'The map packages are imported only in lib/maps/ (spec 0011-20b AC-10). Use AddressMap, forwardGeocode or ' +
  'reverseGeocode.';
const agreementFilesMessage =
  'lib/storage/agreements and lib/agreements/render belong to the relay (spec 0011-20 AC-6): pages and actions ' +
  'read agreements through lib/agreements and lib/admin-agreements.';

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
  relay = false,
  email = false,
  agreementFiles = false,
  maps = false,
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
  if (!email) {
    patterns.push({
      group: ['@/lib/email', '@/lib/email/*'],
      message: emailImportMessage,
    });
  }
  if (!maps) patterns.push({ regex: '^(maplibre-gl|@maptiler/)', message: mapsMessage });
  if (!agreementFiles) {
    patterns.push({
      group: ['@/lib/storage/agreements', '@/lib/agreements/render'],
      message: agreementFilesMessage,
    });
  }
  if (!relay) {
    patterns.push({
      group: ['@/lib/relay', '@/lib/relay/*'],
      message:
        'lib/relay holds the service role client and the PSP: only the relay route, the PSP routes and the fake card page call it (spec 0011-08).',
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
  email = false,
  agreementFiles = false,
  maps = false,
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
  if (!email) modules.push(['^@.lib.email(.|$)', emailImportMessage]);
  if (!maps) modules.push(['^(maplibre-gl|@maptiler.)', mapsMessage]);
  if (!agreementFiles) {
    modules.push(['^@.lib.(storage.agreements|agreements.render)$', agreementFilesMessage]);
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
const SECRETS = ['SUPABASE_SERVICE_ROLE_KEY', 'IYZICO_[A-Z0-9_]+', 'PAYTABS_[A-Z0-9_]+', 'RELAY_SECRET'];
const secretMessage = 'This secret is read only inside its single door (architecture.md §42).';
// Spec 0004 AC-8: the telemetry keys are read only by their doors, lib/env.ts, lib/deployment.ts and
// next.config.ts; the auth token by next.config.ts alone (lib/deployment.ts only names it to check it).
// Spec 0011-08 AC-14: SENTRY_SERVER_DSN, the server only project (R5), joins the same rule.
const TELEMETRY_KEYS = [
  'NEXT_PUBLIC_SENTRY_DSN',
  'SENTRY_AUTH_TOKEN',
  'NEXT_PUBLIC_POSTHOG_KEY',
  'SENTRY_SERVER_DSN',
];
// Spec 0011-13 AC-1: the email keys and Resend's host belong to lib/email (plus lib/env.ts and lib/deployment.ts,
// which validate and check them). EMAIL_DRIVER is not a secret, but which driver runs is the door's to decide.
const EMAIL_KEYS = ['EMAIL_API_KEY', 'EMAIL_FROM', 'EMAIL_DRIVER', 'EMAIL_FAKE_FILE'];
const emailKeyMessage =
  'The email keys are read only inside lib/email (spec 0011-13 AC-1), lib/env.ts and lib/deployment.ts. ' +
  'Mail is sent by the relay through lib/email.';
// Matched as a literal or template text anywhere outside the door, so no module calls Resend past it.
const RESEND_HOST = 'api.resend.com';
const resendMessage = 'Only lib/email calls Resend (spec 0011-13 AC-1). The relay sends mail through it.';
// Spec 0011-20b AC-10: public by design, but read only by the map door (and validated in lib/env.ts), so one place
// decides whether the map shows.
const MAP_KEYS = ['NEXT_PUBLIC_MAPTILER_KEY'];
const mapKeyMessage =
  'The MapTiler key is read only inside lib/maps (spec 0011-20b AC-10) and lib/env.ts. Call mapKey() from lib/maps.';
const telemetryMessage =
  'This key is read only inside its door (lib/observability, lib/analytics), lib/env.ts, lib/deployment.ts or ' +
  'next.config.ts (spec 0004 AC-8). Call a door function, or sentryDsn() / posthogKey() from lib/env.ts.';
function secretSelectors(exempt) {
  const selectors = [];
  for (const [all, message] of [
    [SECRETS, secretMessage],
    [TELEMETRY_KEYS, telemetryMessage],
    [EMAIL_KEYS, emailKeyMessage],
    [MAP_KEYS, mapKeyMessage],
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
  if (!exempt.includes(RESEND_HOST)) {
    selectors.push(
      { selector: 'Literal[value=/api\\.resend\\.com/]', message: resendMessage },
      { selector: 'TemplateElement[value.raw=/api\\.resend\\.com/]', message: resendMessage },
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

// Spec 0011-18 (security review): only lib/notifications/live.ts joins a Realtime channel or sets its token, so the one
// private topic and its teardown live in one place.
const realtimeMessage =
  'Only lib/notifications/live.ts calls Realtime (spec 0011-18). Use useNoticePings, or add a door for a new channel.';
const REALTIME_DOOR_SELECTORS = [
  { selector: "MemberExpression[property.name='realtime']", message: realtimeMessage },
  { selector: "ObjectPattern > Property[key.name='realtime']", message: realtimeMessage },
  { selector: "CallExpression[callee.property.name='channel']", message: realtimeMessage },
  { selector: "CallExpression[callee.property.name='removeChannel']", message: realtimeMessage },
];

/** no-restricted-syntax for one door: its secrets, its modules by import() or require(), env access, Auth, Storage, Realtime. */
function restrictedSyntax({
  exempt = [],
  modules = {},
  envAccess = false,
  auth = false,
  storage = false,
  realtime = false,
} = {}) {
  return [
    'error',
    ...secretSelectors(exempt),
    ...restrictedModules(modules),
    ...(envAccess ? [] : ENV_ACCESS),
    ...(auth ? [] : AUTH_DOOR_SELECTORS),
    ...(storage ? [] : STORAGE_DOOR_SELECTORS),
    ...(realtime ? [] : REALTIME_DOOR_SELECTORS),
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
      'no-restricted-imports': restrictedImports({
        psp: true,
        admin: true,
        relay: true,
        email: true,
        agreementFiles: true,
      }),
      // The relay route's secret is checked inside lib/relay (spec 0011-08 AC-5).
      'no-restricted-syntax': restrictedSyntax({
        exempt: ['RELAY_SECRET'],
        modules: { psp: true, admin: true, email: true, agreementFiles: true },
      }),
    },
  },
  // ── The email door (spec 0011-13 AC-1): its keys and Resend's host. ──
  {
    files: EMAIL_DOOR,
    rules: { 'no-restricted-syntax': restrictedSyntax({ exempt: [...EMAIL_KEYS, RESEND_HOST] }) },
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
  {
    files: ['lib/notifications/live.ts'],
    rules: { 'no-restricted-syntax': restrictedSyntax({ realtime: true }) },
  },
  // ── The map door (spec 0011-20b AC-10). ──
  {
    files: MAPS_DOOR,
    rules: {
      'no-restricted-imports': restrictedImports({ maps: true }),
      'no-restricted-syntax': restrictedSyntax({ exempt: MAP_KEYS, modules: { maps: true } }),
    },
  },
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
    // It names the PSP keys and the relay secret only to check that a deployment has them (spec 0011-08
    // AC-2), as it names SENTRY_AUTH_TOKEN; it never passes a value on.
    rules: {
      'no-restricted-syntax': restrictedSyntax({
        exempt: [...TELEMETRY_KEYS, 'IYZICO_[A-Z0-9_]+', 'RELAY_SECRET', ...EMAIL_KEYS],
      }),
    },
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
        exempt: [
          'NEXT_PUBLIC_SENTRY_DSN',
          'NEXT_PUBLIC_POSTHOG_KEY',
          'SENTRY_SERVER_DSN',
          ...EMAIL_KEYS,
          ...MAP_KEYS,
        ],
        envAccess: true,
      }),
    },
  },
  // The scripts start processes with a copy of the environment.
  { files: ['scripts/**'], rules: { 'no-restricted-syntax': restrictedSyntax({ envAccess: true }) } },
  // Tests build fake environments and fixtures; the doors protect production code. This config file
  // must name the secrets to define the rule.
  { files: [...TESTS, 'eslint.config.mjs'], rules: { 'no-restricted-syntax': 'off' } },
  // Spec 0011-08: the PSP contract suite and the relay's tests import lib/psp to test it. Every other import rule
  // still holds in tests.
  {
    files: TESTS,
    rules: {
      'no-restricted-imports': restrictedImports({
        psp: true,
        relay: true,
        email: true,
        agreementFiles: true,
      }),
    },
  },
  { files: RELAY_CALLERS, rules: { 'no-restricted-imports': restrictedImports({ relay: true }) } },
];

export default config;
