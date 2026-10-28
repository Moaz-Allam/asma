import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// Node's native TypeScript resolver loads this file: a relative import needs its `.ts` extension, and
// lib/deployment.ts stays free of dependencies and `@/` imports for the same reason.
import { appEnv, appRelease, assertDeploymentKeys } from './lib/deployment.ts';

// Points next-intl at the per-request config (locale + messages).
const withNextIntl = createNextIntlPlugin('./lib/i18n/request.ts');

// The value of PHASE_PRODUCTION_BUILD in next/constants, written out so this file needs no CommonJS import.
const PHASE_PRODUCTION_BUILD = 'phase-production-build';

export default function config(phase: string): NextConfig {
  // Spec 0004 AC-9: a deployment build without its keys stops here, naming each missing one. The boot
  // check is the same function, called from register() in instrumentation.ts.
  if (phase === PHASE_PRODUCTION_BUILD) assertDeploymentKeys({ ...process.env, NEXT_PHASE: phase }, 'build');

  const nextConfig: NextConfig = {
    reactStrictMode: true,

    // A type error must fail the build. Silencing this is how a codebase with
    // `strict: true` quietly stops being strict.
    //
    // There is no `eslint` key here: Next.js 16 removed `next lint` and the
    // build-time ESLint integration with it. Lint runs as its own CI job
    // (`npm run lint`), which is stricter — it cannot be skipped by a build flag.
    typescript: { ignoreBuildErrors: false },

    // The browser cannot read VERCEL_ENV or VERCEL_GIT_COMMIT_SHA, so their derived names are inlined
    // at build: the environment (`production`, `preview`, `local`) and the release (full SHA or `local`)
    // that Sentry and PostHog tag every browser event with.
    env: {
      NEXT_PUBLIC_APP_ENV: appEnv(process.env),
      NEXT_PUBLIC_APP_RELEASE: appRelease(process.env),
    },
  };

  return withNextIntl(nextConfig);
}
