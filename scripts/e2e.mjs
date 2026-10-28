#!/usr/bin/env node
/**
 * `npm run test:e2e` — the end to end wrapper (code-standards.md §10, playbook §13.5).
 *
 * 1. Gets LOCAL Supabase values from `supabase status` (starting the local stack if needed).
 * 2. Builds the app with those values passed as process variables. Process variables beat env files,
 *    and every other variable named in .env.example is set to empty, so nothing from a developer's
 *    cloud env file can reach an e2e build. Analytics and error reporting stay off.
 * 3. Runs Playwright (390px, ar + tr + en). Extra arguments pass through: `-- --project=ar`.
 *
 * Flags: --reuse-build   skip the build when the last one was made by this wrapper.
 * Env:   E2E_NO_DB=1     do not touch the local database (only for suites that never read it).
 *        E2E_PORT        port for `next start` (default 3100).
 *
 * Later positions extend this: seeded accounts with random passwords per run, time moved with one
 * SQL statement, sent email read from a local outbox directory, one documentation range IP per
 * visitor so per address limits never mix runs.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const args = process.argv.slice(2);
const reuse = args.includes('--reuse-build');
const passThrough = args.filter((a) => a !== '--reuse-build');
const MARKER = join(root, '.next', 'e2e-build.json');

function run(cmd, cmdArgs, env, capture = false) {
  const result = spawnSync(cmd, cmdArgs, {
    cwd: root,
    env,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  return result;
}

function localSupabase() {
  if (process.env.E2E_NO_DB === '1') {
    // Shape-valid local values for suites that never reach the database. Never cloud values.
    return {
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54421',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'e2e-no-db-anon',
      SUPABASE_SERVICE_ROLE_KEY: 'e2e-no-db-service',
    };
  }
  let status = run('npx', ['supabase', 'status', '-o', 'json'], process.env, true);
  if (status.status !== 0) {
    console.log('e2e: local Supabase is not running; starting it (needs Docker)…');
    const start = run('npx', ['supabase', 'start'], process.env);
    if (start.status !== 0) {
      console.error(
        'e2e: could not start local Supabase. Start Docker, or set E2E_NO_DB=1 for DB free suites.',
      );
      process.exit(1);
    }
    status = run('npx', ['supabase', 'status', '-o', 'json'], process.env, true);
  }
  const json = JSON.parse(status.stdout.slice(status.stdout.indexOf('{')));
  const url = json.API_URL;
  const anon = json.ANON_KEY ?? json.PUBLISHABLE_KEY;
  const service = json.SERVICE_ROLE_KEY ?? json.SECRET_KEY;
  if (!url || !anon || !service) {
    console.error('e2e: `supabase status` did not return API_URL and keys.');
    process.exit(1);
  }
  return {
    NEXT_PUBLIC_SUPABASE_URL: url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anon,
    SUPABASE_SERVICE_ROLE_KEY: service,
  };
}

// Every variable the project documents starts EMPTY, so an env file cannot fill it in.
const documented = readFileSync(join(root, '.env.example'), 'utf8')
  .split(/\r?\n/)
  .map((line) => /^([A-Z][A-Z0-9_]*)=/.exec(line)?.[1])
  .filter(Boolean);
const blank = Object.fromEntries(documented.map((name) => [name, '']));

const env = {
  ...process.env,
  ...blank,
  APP_DEFAULT_LOCALE: 'ar',
  APP_SUPPORTED_LOCALES: 'ar,tr,en',
  FEATURE_STORED_BALANCE_WALLET: 'false',
  NEXT_TELEMETRY_DISABLED: '1',
  // A local production build and `next start`, never a deployment (lib/deployment.ts, spec 0004 AC-9).
  APP_LOCAL_ONLY: '1',
  // Shape valid telemetry keys, so both SDKs run; the journeys stub /api/e and /api/a in the browser.
  NEXT_PUBLIC_SENTRY_DSN: 'https://e2e00000000000000000000000000000@o0.ingest.de.sentry.io/0',
  NEXT_PUBLIC_POSTHOG_KEY: 'phc_e2e0000000000000000000000000000',
  ...localSupabase(),
};

function buildId() {
  const file = join(root, '.next', 'BUILD_ID');
  return existsSync(file) ? readFileSync(file, 'utf8').trim() : null;
}

// Reuse only the exact build this wrapper made. A later plain `npm run build` changes the BUILD_ID,
// and that build may carry values from a developer's env file, so it is never reused.
function lastE2eBuildId() {
  try {
    return JSON.parse(readFileSync(MARKER, 'utf8')).buildId ?? null;
  } catch {
    return null;
  }
}
const current = buildId();
const reusable = reuse && current !== null && current === lastE2eBuildId();
if (reusable) {
  console.log('e2e: reusing the last e2e build.');
} else {
  const build = run('npx', ['next', 'build'], env);
  if (build.status !== 0) process.exit(build.status ?? 1);
  writeFileSync(
    MARKER,
    JSON.stringify({ buildId: buildId(), builtAt: new Date().toISOString(), by: 'scripts/e2e.mjs' }),
  );
}

const test = run('npx', ['playwright', 'test', ...passThrough], env);
process.exit(test.status ?? 1);
