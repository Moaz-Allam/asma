import 'server-only';

import { getEnv } from '@/lib/env';
import { siteUrl } from '@/lib/seo/site';

/**
 * This deployment's own origin, with no trailing slash (spec 0011-08 AC-4, AC-21): where the PSP sends the
 * browser back (`/api/psp/callback`) and the host of the fake card page. `APP_ORIGIN` when set (the e2e
 * wrapper sets its port); else the public address on production, the branch address on a preview, and
 * `http://localhost:3000` in development. Never read from a request header, which a caller controls.
 */
export function appOrigin(): string {
  const configured = getEnv().APP_ORIGIN;
  if (configured) return configured;
  if (process.env.VERCEL_ENV === 'production') return siteUrl();
  const preview = process.env.VERCEL_BRANCH_URL ?? process.env.VERCEL_URL;
  return preview ? `https://${preview}` : 'http://localhost:3000';
}
