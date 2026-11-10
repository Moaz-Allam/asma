import { afterEach, describe, expect, it, vi } from 'vitest';

import { landingJsonLd, serializeJsonLd } from '@/lib/seo/json-ld';

/** Spec 0005 AC-29, AC-30. Indexing is one switch, and a preview can never turn it on. */

const VALID_ENV = {
  NODE_ENV: 'test',
  APP_DEFAULT_LOCALE: 'ar',
  APP_SUPPORTED_LOCALES: 'ar,tr,en',
  NEXT_PUBLIC_SUPABASE_URL: 'https://ref.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
};

async function loadSite(env: Record<string, string>) {
  vi.resetModules();
  for (const [name, value] of Object.entries({ ...VALID_ENV, ...env })) vi.stubEnv(name, value);
  return import('@/lib/seo/site');
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('indexable', () => {
  it.each([
    ['no address, not on Vercel', {}],
    ['no address on production', { VERCEL_ENV: 'production' }],
    ['an address on a preview', { APP_SITE_URL: 'https://aldebyani.com', VERCEL_ENV: 'preview' }],
    ['an address off Vercel', { APP_SITE_URL: 'https://aldebyani.com' }],
  ])('stays off with %s', async (_name, env) => {
    expect((await loadSite(env)).indexable()).toBe(false);
  });

  it('turns on with an address on production, with no code change', async () => {
    const site = await loadSite({ APP_SITE_URL: 'https://aldebyani.com', VERCEL_ENV: 'production' });
    expect(site.indexable()).toBe(true);
  });
});

describe('siteUrl', () => {
  it('prefers the configured address', async () => {
    const site = await loadSite({
      APP_SITE_URL: 'https://aldebyani.com',
      VERCEL_PROJECT_PRODUCTION_URL: 'aldebyani.vercel.app',
    });
    expect(site.siteUrl()).toBe('https://aldebyani.com');
  });

  it('then the production address on Vercel, then localhost', async () => {
    const site = await loadSite({ VERCEL_PROJECT_PRODUCTION_URL: 'aldebyani.vercel.app' });
    expect(site.siteUrl()).toBe('https://aldebyani.vercel.app');
    vi.unstubAllEnvs();
    expect((await loadSite({})).siteUrl()).toBe('http://localhost:3000');
  });

  it.each(['http://aldebyani.com', 'https://aldebyani.com/', 'aldebyani.com'])(
    'refuses %s as a site address',
    async (value) => {
      const site = await loadSite({ APP_SITE_URL: value });
      expect(() => site.siteUrl()).toThrow(/APP_SITE_URL/);
    },
  );
});

describe('legal pages and alternates', () => {
  it('holds a draft out of search', async () => {
    const site = await loadSite({});
    expect(site.legalPageIsFinal('terms')).toBe(false);
    expect(site.legalPageIsFinal('privacy')).toBe(false);
  });

  it('names the three locales and x-default', async () => {
    const site = await loadSite({});
    expect(site.languageAlternates('')).toEqual({ ar: '/ar', tr: '/tr', en: '/en', 'x-default': '/' });
  });
});

describe('the structured data', () => {
  const blocks = landingJsonLd({
    url: 'https://aldebyani.com',
    locale: 'en',
    name: 'Aldebyani',
    description: 'Home services',
    serviceName: 'Home cleaning',
    regions: [{ code: 'TR', dialCode: '+90', supportWhatsapp: null }],
    faqs: [{ question: 'Who sets the price?', answer: 'The platform.' }],
  });

  it('has the four blocks', () => {
    expect(blocks.map((block) => block['@type'])).toEqual(['Organization', 'WebSite', 'Service', 'FAQPage']);
  });

  it('serves the live regions, by name', () => {
    expect(blocks[2]?.areaServed).toEqual([{ '@type': 'Country', name: 'Türkiye' }]);
  });

  it('makes no rating or price claim (B7)', () => {
    const text = JSON.stringify(blocks);
    expect(text).not.toMatch(/aggregateRating|"price"|offers/i);
  });

  it('cannot close its own script tag', () => {
    expect(serializeJsonLd({ a: '</script><script>alert(1)</script>' })).not.toContain('<');
  });
});
