import type { MetadataRoute } from 'next';

import { indexable, siteUrl } from '@/lib/seo/site';

/** Spec 0005 AC-30: disallow all until the site may be indexed. */
export const dynamic = 'force-dynamic';

export default function robots(): MetadataRoute.Robots {
  if (!indexable()) return { rules: { userAgent: '*', disallow: '/' } };
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/',
        '/*/requests',
        '/*/provider',
        '/*/admin',
        '/*/account',
        '/*/login',
        '/*/onboarding',
      ],
    },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
