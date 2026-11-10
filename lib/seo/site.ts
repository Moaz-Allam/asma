import 'server-only';

import { appEnv } from '@/lib/deployment';
import { getEnv } from '@/lib/env';
import { LOCALES } from '@/lib/i18n/direction';
import en from '@/messages/en.json';

/**
 * Where the site lives, and whether search engines may see it (spec 0005 AC-29, AC-30). Indexing is one
 * switch: `APP_SITE_URL` set, on production. An empty value or any preview says `noindex` everywhere, the
 * sitemap is empty and `robots.txt` disallows all, so no code changes on launch day.
 */

export function siteUrl(): string {
  const configured = getEnv().APP_SITE_URL;
  if (configured) return configured;
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return vercel ? `https://${vercel}` : 'http://localhost:3000';
}

export function indexable(): boolean {
  return Boolean(getEnv().APP_SITE_URL) && appEnv(process.env) === 'production';
}

/** A legal page stays out of search while it is a draft: the marker is the switch (D100). */
export function legalPageIsFinal(page: 'terms' | 'privacy'): boolean {
  return !en.Legal[`${page}Body`].startsWith('[draft] ');
}

/** `hreflang` for one public path: the three locales, and `x-default` on the bare path (D19). */
export function languageAlternates(path: string): Record<string, string> {
  const entries = LOCALES.map((locale) => [locale, `/${locale}${path}`]);
  return { ...Object.fromEntries(entries), 'x-default': path === '' ? '/' : path };
}
