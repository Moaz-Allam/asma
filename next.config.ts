// The build wrapper is the one Sentry import allowed outside lib/observability (spec 0004 AC-8).
import { withSentryConfig } from '@sentry/nextjs/config';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// Node's native TypeScript resolver loads this file: a relative import needs its `.ts` extension, and
// lib/deployment.ts stays free of dependencies and `@/` imports for the same reason.
import { appEnv, appRelease, assertDeploymentKeys, isCommitSha, isDeployment } from './lib/deployment.ts';
import { SENTRY_TUNNEL_ROUTE } from './lib/observability/shared.ts';
import { SECURITY_HEADERS } from './lib/security/headers.ts';

// Points next-intl at the per-request config (locale + messages).
const withNextIntl = createNextIntlPlugin('./lib/i18n/request.ts');

// The value of PHASE_PRODUCTION_BUILD in next/constants, written out so this file needs no CommonJS import.
const PHASE_PRODUCTION_BUILD = 'phase-production-build';

export default function config(phase: string): NextConfig {
  const env = { ...process.env, NEXT_PHASE: phase };
  // Spec 0004 AC-9: a deployment build without its keys stops here, naming each missing one. The boot
  // check is the same function, called from register() in instrumentation.ts.
  if (phase === PHASE_PRODUCTION_BUILD) assertDeploymentKeys(env, 'build');
  const deploymentBuild = phase === PHASE_PRODUCTION_BUILD && isDeployment(env);

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

    // Static security headers on every response (spec 0004 AC-12). The Content Security Policy is per
    // request, with its nonce, in proxy.ts.
    async headers() {
      return [{ source: '/:path*', headers: [...SECURITY_HEADERS] }];
    },

    // PostHog through the same origin (spec 0004 AC-6, D62: EU Cloud). Assets first, the rest after.
    // Sentry's /api/e tunnel is added by withSentryConfig below.
    async rewrites() {
      return [
        { source: '/api/a/static/:path*', destination: 'https://eu-assets.i.posthog.com/static/:path*' },
        { source: '/api/a/array/:path*', destination: 'https://eu-assets.i.posthog.com/array/:path*' },
        { source: '/api/a/:path*', destination: 'https://eu.i.posthog.com/:path*' },
      ];
    },
    // PostHog calls its endpoints with a trailing slash; the cost is that /ar and /ar/ both answer.
    skipTrailingSlashRedirect: true,
  };

  const release = appRelease(process.env);

  return withSentryConfig(withNextIntl(nextConfig), {
    // Org, project and region are constants (D62: EU). Vercel's Sentry integration may add SENTRY_ORG
    // and SENTRY_PROJECT; nothing reads them.
    org: 'aldebyani',
    project: 'aldebyani',
    sentryUrl: 'https://de.sentry.io',
    // A secret, read here only (lint enforced). Required on a deployment build (lib/deployment.ts).
    authToken: process.env.SENTRY_AUTH_TOKEN,
    telemetry: false,
    silent: !process.env.CI,

    // The release is the full commit SHA, the name Vercel's Sentry integration uses (AC-1). Only a
    // deployment build creates one.
    release: deploymentBuild && isCommitSha(release) ? { name: release } : { create: false },

    // Browser reports travel through the same origin, so a blocker of *.sentry.io loses nothing (AC-2).
    tunnelRoute: SENTRY_TUNNEL_ROUTE,

    // Source maps: on a deployment build they are uploaded, then deleted, and never served (AC-1). The
    // plugin only logs a failed upload by default; rethrowing makes it fail the build instead. Every
    // other build makes none: the plugin would otherwise pick up a local `.env.sentry-build-plugin`
    // token and upload a developer's build to the real project.
    widenClientFileUpload: true,
    sourcemaps: deploymentBuild ? { deleteSourcemapsAfterUpload: true } : { disable: true },
    errorHandler: (error) => {
      throw error;
    },
  });
}
