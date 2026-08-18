import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// Points next-intl at the per-request config (locale + messages).
const withNextIntl = createNextIntlPlugin('./lib/i18n/request.ts');

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // A type error must fail the build. Silencing this is how a codebase with
  // `strict: true` quietly stops being strict.
  //
  // There is no `eslint` key here: Next.js 16 removed `next lint` and the
  // build-time ESLint integration with it. Lint runs as its own CI job
  // (`npm run lint`), which is stricter — it cannot be skipped by a build flag.
  typescript: { ignoreBuildErrors: false },
};

export default withNextIntl(nextConfig);
