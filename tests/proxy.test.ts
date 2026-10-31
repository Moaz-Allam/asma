import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Spec 0004 AC-13: every page response carries an enforced CSP with a fresh nonce, and the nonce reaches
 * Next through the request headers (Next stamps its own scripts with the nonce it finds in the
 * request's policy). Violation reports go to our own /api/csp handler (D83). The proxy never throws:
 * these tests run the real environment module, not a mock of it.
 */

const VALID_ENV = {
  NODE_ENV: 'test',
  APP_DEFAULT_LOCALE: 'ar',
  APP_SUPPORTED_LOCALES: 'ar,tr,en',
  NEXT_PUBLIC_SUPABASE_URL: 'https://ref.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
};

async function loadProxy(env: Record<string, string>) {
  vi.resetModules();
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  return (await import('@/proxy')).proxy;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

function nonceOf(policy: string | null): string | undefined {
  return policy?.match(/'nonce-([^']+)'/)?.[1];
}

describe('proxy: the nonce and the policy', () => {
  it('passes the policy to Next through the request headers and sets it on the response', async () => {
    const proxy = await loadProxy(VALID_ENV);
    const response = proxy(new NextRequest('http://localhost/en'));
    const sent = response.headers.get('content-security-policy');
    const forwarded = response.headers.get('x-middleware-request-content-security-policy');

    expect(sent).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(sent).toContain("connect-src 'self' https://ref.supabase.co wss://ref.supabase.co");
    expect(forwarded).toBe(sent);
    expect(response.headers.get('x-middleware-override-headers')).toContain('content-security-policy');
    expect(response.headers.get('x-middleware-request-x-nonce')).toBe(nonceOf(sent));
  });

  it('makes a fresh nonce for every request', async () => {
    const proxy = await loadProxy(VALID_ENV);
    const nonces = new Set(
      Array.from({ length: 20 }, () =>
        nonceOf(proxy(new NextRequest('http://localhost/tr')).headers.get('content-security-policy')),
      ),
    );
    expect(nonces.size).toBe(20);
  });

  it('keeps the policy on a locale redirect too', async () => {
    const proxy = await loadProxy(VALID_ENV);
    const response = proxy(new NextRequest('http://localhost/', { headers: { 'accept-language': 'tr' } }));
    expect(response.headers.get('location')).toMatch(/\/tr$/);
    expect(response.headers.get('content-security-policy')).toContain("'strict-dynamic'");
  });

  it('sends violation reports to our own /api/csp handler on the page origin, never to Sentry', async () => {
    const proxy = await loadProxy({
      ...VALID_ENV,
      NEXT_PUBLIC_SENTRY_DSN: 'https://k@o1.ingest.de.sentry.io/2',
    });
    const response = proxy(new NextRequest('https://aldebyani.test/ar'));
    const policy = response.headers.get('content-security-policy') ?? '';
    expect(policy).toContain('report-uri https://aldebyani.test/api/csp');
    expect(policy).toContain('report-to csp-endpoint');
    expect(policy).not.toContain('sentry.io');
    expect(response.headers.get('reporting-endpoints')).toBe('csp-endpoint="https://aldebyani.test/api/csp"');
  });

  it.each([
    ['a malformed Sentry DSN', { ...VALID_ENV, NEXT_PUBLIC_SENTRY_DSN: 'nonsense' }],
    ['a missing Supabase URL', { ...VALID_ENV, NEXT_PUBLIC_SUPABASE_URL: '' }],
  ])('never throws with %s: the policy only gets stricter', async (_name, env) => {
    const proxy = await loadProxy(env);
    const response = proxy(new NextRequest('http://localhost/ar'));
    const policy = response.headers.get('content-security-policy') ?? '';
    expect(policy).toContain("'strict-dynamic'");
    expect(policy).toContain("connect-src 'self';");
  });
});

describe('the matcher', () => {
  it('leaves the API surface, Next internals, files and prefetches alone', async () => {
    const { config } = await import('@/proxy');
    const [matcher] = config.matcher;
    expect(matcher?.source).toBe('/((?!api|_next|_vercel|.*\\..*).*)');
    expect(matcher?.missing).toEqual([
      { type: 'header', key: 'next-router-prefetch' },
      { type: 'header', key: 'purpose', value: 'prefetch' },
    ]);
  });
});
