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

type Requirement = {
  name: string;
  phases: readonly DeploymentPhase[];
  /** Required only on Vercel builds, not on a local production build. */
  vercelOnly: boolean;
  /** What a well formed value looks like, for the refusal message. Never the value itself. */
  expected: string;
  valid: (value: string) => boolean;
};

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
];

/** The names of the keys a deployment lacks, or holds malformed, in this phase. Assumes a deployment. */
export function missingDeploymentKeys(env: DeploymentEnv, phase: DeploymentPhase): string[] {
  const onVercel = read(env, 'VERCEL') === '1';
  return REQUIREMENTS.filter((r) => r.phases.includes(phase) && (onVercel || !r.vercelOnly))
    .filter((r) => {
      const value = read(env, r.name);
      return value === undefined || !r.valid(value);
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
