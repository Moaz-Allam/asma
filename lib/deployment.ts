/**
 * Is this a deployment, and does it have what a deployment must have? Spec 0004 AC-9, D71.
 *
 * On a deployment, error reporting and analytics are on: their keys exist and are well formed, or it
 * does not build (`next.config.ts`, build phase) or boot (`register()` in `instrumentation.ts`). A
 * preview that ships without them fails silently in the worst way: nobody sees its errors.
 *
 * ⚠️ No dependencies, no `@/` imports, erasable TypeScript only (no enum, namespace, or parameter
 * property). `next.config.ts` imports this file through Node's native TypeScript resolver, which only
 * strips types and resolves relative paths with an explicit `.ts` extension.
 */

export type DeploymentEnv = Readonly<Record<string, string | undefined>>;
export type DeploymentPhase = 'build' | 'runtime';
export type AppEnv = 'production' | 'preview' | 'local';

const PRODUCTION_PHASES: ReadonlySet<string> = new Set(['phase-production-build', 'phase-production-server']);

/** An empty value means "not set", as in `lib/env.ts`: the e2e wrapper blanks variables rather than unsetting them. */
function read(env: DeploymentEnv, name: string): string | undefined {
  const value = env[name];
  return value === undefined || value === '' ? undefined : value;
}

/**
 * True on Vercel always, and for any production build or server unless `APP_LOCAL_ONLY` is exactly
 * `1` (the CI build and the e2e build). Throws when `APP_LOCAL_ONLY` is set on Vercel: that pair would
 * switch every key check off on a real deployment.
 */
export function isDeployment(env: DeploymentEnv): boolean {
  const onVercel = read(env, 'VERCEL') === '1';
  const localOnly = read(env, 'APP_LOCAL_ONLY');
  if (onVercel && localOnly !== undefined) {
    throw new Error(
      'APP_LOCAL_ONLY is set on Vercel. It marks a local build only and must never exist in a Vercel ' +
        'environment, because it switches the deployment key checks off. Remove it from the project settings.',
    );
  }
  if (onVercel) return true;
  const production =
    read(env, 'NODE_ENV') === 'production' || PRODUCTION_PHASES.has(read(env, 'NEXT_PHASE') ?? '');
  return production && localOnly !== '1';
}

/** A full lowercase commit SHA, the release name Vercel's Sentry integration also uses. */
export function isCommitSha(value: string): boolean {
  return /^[0-9a-f]{40}$/.test(value);
}

export type SentryDsn = { publicKey: string; host: string; projectId: string };

/**
 * The parts of a Sentry DSN on the EU ingest (`https://<key>@o<org>.ingest.de.sentry.io/<project>`), or
 * null for anything else: another region, plain http, a missing key, a look alike host. D62 keeps every
 * event in the EU; lib/security/csp.ts derives the report endpoint from these parts without the SDK.
 */
export function parseEuSentryDsn(value: string): SentryDsn | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const projectId = url.pathname.slice(1);
  const wellFormed =
    url.protocol === 'https:' &&
    url.username !== '' &&
    url.password === '' &&
    url.port === '' &&
    url.search === '' &&
    url.hash === '' &&
    // The SaaS ingest host. Only this shape engages the /api/e tunnel (@sentry/nextjs tunnelRoute.js).
    /^o\d+\.ingest\.de\.sentry\.io$/.test(url.hostname) &&
    /^\d+$/.test(projectId);
  return wellFormed ? { publicKey: url.username, host: url.hostname, projectId } : null;
}

type Requirement = {
  name: string;
  phases: readonly DeploymentPhase[];
  /** Required only on Vercel builds, not on a local production build. */
  vercelOnly: boolean;
  /** What a well formed value looks like, for the refusal message. Never the value itself. */
  expected: string;
  valid: (value: string, env: DeploymentEnv) => boolean;
  /** When set, the key is checked only when this holds (spec 0011-08: the iyzico keys only with that driver). */
  when?: (env: DeploymentEnv) => boolean;
  /** An unset key passes; a set one must be valid (PSP_DRIVER defaults to `off`). */
  optional?: boolean;
};

const IYZICO_LIVE_URL = 'https://api.iyzipay.com';
const IYZICO_SANDBOX_URL = 'https://sandbox-api.iyzipay.com';

/** The PSP driver a deployment runs, `off` when unset (spec 0011-08 AC-2). */
function pspDriverOf(env: DeploymentEnv): string {
  return read(env, 'PSP_DRIVER') ?? 'off';
}

const withIyzico = (env: DeploymentEnv) => pspDriverOf(env) === 'iyzico';

/**
 * Each key joins this list in the task that adds its door (spec 0004 build plan), so a preview never
 * demands a key whose code does not exist yet.
 */
const REQUIREMENTS: readonly Requirement[] = [
  {
    name: 'VERCEL_GIT_COMMIT_SHA',
    phases: ['build'],
    vercelOnly: true,
    expected: 'the full 40 character commit SHA (Vercel sets it for Git deployments)',
    valid: isCommitSha,
  },
  // Task 5: the Sentry door (lib/observability).
  {
    name: 'NEXT_PUBLIC_SENTRY_DSN',
    phases: ['build', 'runtime'],
    vercelOnly: false,
    expected: 'an EU Sentry DSN, https://<key>@o<org>.ingest.de.sentry.io/<project>',
    valid: (value) => parseEuSentryDsn(value) !== null,
  },
  {
    name: 'SENTRY_AUTH_TOKEN',
    phases: ['build'],
    vercelOnly: false,
    expected: 'a Sentry auth token for the source map upload (a secret, set by the owner, build only)',
    valid: (value) => value.trim() !== '',
  },
  // Task 10: the PostHog door (lib/analytics).
  {
    name: 'NEXT_PUBLIC_POSTHOG_KEY',
    phases: ['build', 'runtime'],
    vercelOnly: false,
    expected: 'a PostHog project key, phc_… (never a personal API key, phx_…)',
    valid: isPostHogProjectKey,
  },
  // Spec 0005: the bot check on /login. Without it nobody can sign in.
  {
    name: 'NEXT_PUBLIC_TURNSTILE_SITE_KEY',
    phases: ['build', 'runtime'],
    vercelOnly: false,
    expected: 'a Turnstile site key, from the Cloudflare widget (owner step S9)',
    valid: (value) => value.trim() !== '',
  },
  // Spec 0011-08 AC-2: the PSP door. `off` (unset) and `fake` boot without any PSP key, so merging 08 never
  // stops production; the fake never runs on production; `iyzico` needs its keys, the relay secret and the
  // server only DSN, and its live host only on production.
  {
    name: 'PSP_DRIVER',
    phases: ['runtime'],
    vercelOnly: false,
    optional: true,
    expected: 'off, fake or iyzico; never fake on production',
    valid: (value, env) =>
      ['off', 'fake', 'iyzico'].includes(value) &&
      !(value === 'fake' && read(env, 'VERCEL_ENV') === 'production'),
  },
  {
    name: 'IYZICO_API_KEY',
    phases: ['runtime'],
    vercelOnly: false,
    when: withIyzico,
    expected: 'the iyzico API key (a secret, owner step S1 or S2)',
    valid: (value) => value.trim() !== '',
  },
  {
    name: 'IYZICO_SECRET_KEY',
    phases: ['runtime'],
    vercelOnly: false,
    when: withIyzico,
    expected: 'the iyzico secret key (a secret, owner step S1 or S2)',
    valid: (value) => value.trim() !== '',
  },
  {
    name: 'IYZICO_BASE_URL',
    phases: ['runtime'],
    vercelOnly: false,
    when: withIyzico,
    expected: `${IYZICO_SANDBOX_URL}, or ${IYZICO_LIVE_URL} on production only`,
    valid: (value, env) =>
      value === IYZICO_SANDBOX_URL || (value === IYZICO_LIVE_URL && read(env, 'VERCEL_ENV') === 'production'),
  },
  {
    name: 'RELAY_SECRET',
    phases: ['runtime'],
    vercelOnly: false,
    when: withIyzico,
    expected: 'the relay secret, at least 32 characters, equal to Vault relay_secret (owner step S33)',
    valid: (value) => value.length >= 32,
  },
  {
    name: 'SENTRY_SERVER_DSN',
    phases: ['runtime'],
    vercelOnly: false,
    when: withIyzico,
    expected: 'the server only EU Sentry DSN (owner step S32), never the browser one',
    valid: (value, env) => parseEuSentryDsn(value) !== null && value !== read(env, 'NEXT_PUBLIC_SENTRY_DSN'),
  },
];

/** A PostHog project key (`phc_…`), public by design. A personal API key (`phx_…`) must never ship. */
export function isPostHogProjectKey(value: string): boolean {
  return /^phc_[A-Za-z0-9]+$/.test(value);
}

/** The names of the keys a deployment lacks, or holds malformed, in this phase. Assumes a deployment. */
export function missingDeploymentKeys(env: DeploymentEnv, phase: DeploymentPhase): string[] {
  const onVercel = read(env, 'VERCEL') === '1';
  return REQUIREMENTS.filter((r) => r.phases.includes(phase) && (onVercel || !r.vercelOnly))
    .filter((r) => r.when === undefined || r.when(env))
    .filter((r) => {
      const value = read(env, r.name);
      if (value === undefined) return r.optional !== true;
      return !r.valid(value, env);
    })
    .map((r) => r.name);
}

/** Refuses a deployment build or boot that lacks a key, naming every one. Does nothing off a deployment. */
export function assertDeploymentKeys(env: DeploymentEnv, phase: DeploymentPhase): void {
  if (!isDeployment(env)) return;
  const missing = missingDeploymentKeys(env, phase);
  if (missing.length === 0) return;
  const lines = missing.map((name) => {
    const expected = REQUIREMENTS.find((r) => r.name === name)?.expected ?? 'a value';
    return `  ${name}: missing or malformed; expected ${expected}`;
  });
  throw new Error(
    `Deployment ${phase} refused. A deployment needs its error reporting and analytics keys (spec 0004, D71):\n` +
      `${lines.join('\n')}\n\n` +
      'Set them in both the Preview and Production scopes on Vercel. A local production build or ' +
      '`next start` sets APP_LOCAL_ONLY=1 instead. See .env.example.',
  );
}

/** `production` or `preview` on Vercel, else `local`. Mirrored to the browser as NEXT_PUBLIC_APP_ENV. */
export function appEnv(env: DeploymentEnv): AppEnv {
  const vercelEnv = read(env, 'VERCEL_ENV');
  return vercelEnv === 'production' || vercelEnv === 'preview' ? vercelEnv : 'local';
}

/** The full commit SHA on Vercel, else `local`. Mirrored to the browser as NEXT_PUBLIC_APP_RELEASE. */
export function appRelease(env: DeploymentEnv): string {
  const sha = read(env, 'VERCEL_GIT_COMMIT_SHA');
  return sha !== undefined && isCommitSha(sha) ? sha : 'local';
}
