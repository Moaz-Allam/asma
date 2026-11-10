import type { MetadataRoute } from 'next';

import { LOCALES } from '@/lib/i18n/direction';
import { indexable, languageAlternates, legalPageIsFinal, siteUrl } from '@/lib/seo/site';

/** Spec 0005 AC-29, AC-30: empty until the site may be indexed. A draft legal page never appears. */
export const dynamic = 'force-dynamic';

function absolute(paths: Record<string, string>, base: string): Record<string, string> {
  return Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, `${base}${path}`]));
}

export default function sitemap(): MetadataRoute.Sitemap {
  if (!indexable()) return [];
  const base = siteUrl();
  const paths = [
    '',
    ...(legalPageIsFinal('terms') ? ['/terms'] : []),
    ...(legalPageIsFinal('privacy') ? ['/privacy'] : []),
  ];
  return paths.flatMap((path) =>
    LOCALES.map((locale) => ({
      url: `${base}/${locale}${path}`,
      alternates: { languages: absolute(languageAlternates(path), base) },
    })),
  );
}
