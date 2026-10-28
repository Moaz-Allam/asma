import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

/**
 * Spec 0004 AC-13: every page response carries an enforced CSP with a fresh nonce, and the nonce reaches
 * Next through the request headers (Next stamps its own scripts with the nonce it finds in the
 * request's policy). The proxy never throws, whatever the DSN.
 */

const env = vi.hoisted(() => ({
  dsn: 'https://0a1b2c3d4e5f60718293a4b5c6d7e8f9@o4507000000000000.ingest.de.sentry.io/4507000000000001' as
    string | undefined,
}));

vi.mock('@/lib/env', () => ({
  getEnv: () => ({ NEXT_PUBLIC_SUPABASE_URL: 'https://ref.supabase.co' }),
  sentryDsn: () => env.dsn,
}));

const { proxy } = await import('@/proxy');

function nonceOf(policy: string | null): string | undefined {
  return policy?.match(/'nonce-([^']+)'/)?.[1];
}

describe('proxy: the nonce and the policy', () => {
  it('passes the policy to Next through the request headers and sets it on the response', () => {
    const response = proxy(new NextRequest('http://localhost/en'));
    const sent = response.headers.get('content-security-policy');
    const forwarded = response.headers.get('x-middleware-request-content-security-policy');

    expect(sent).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(forwarded).toBe(sent);
    expect(response.headers.get('x-middleware-override-headers')).toContain('content-security-policy');
    expect(response.headers.get('x-middleware-request-x-nonce')).toBe(nonceOf(sent));
  });

  it('makes a fresh nonce for every request', () => {
    const nonces = new Set(
      Array.from({ length: 20 }, () =>
        nonceOf(proxy(new NextRequest('http://localhost/tr')).headers.get('content-security-policy')),
      ),
    );
    expect(nonces.size).toBe(20);
  });

  it('keeps the policy on a locale redirect too', () => {
    const response = proxy(new NextRequest('http://localhost/', { headers: { 'accept-language': 'tr' } }));
    expect(response.headers.get('location')).toMatch(/\/tr$/);
    expect(response.headers.get('content-security-policy')).toContain("'strict-dynamic'");
  });

  it('reports violations to Sentry when the DSN is valid', () => {
    const response = proxy(new NextRequest('http://localhost/ar'));
    expect(response.headers.get('content-security-policy')).toContain('report-to csp-endpoint');
    expect(response.headers.get('reporting-endpoints')).toMatch(/^csp-endpoint="https:\/\/o4507/);
  });

  it.each([undefined, 'nonsense'])(
    'never throws, and leaves out only the report directives, with DSN %j',
    (dsn) => {
      env.dsn = dsn;
      const response = proxy(new NextRequest('http://localhost/ar'));
      const policy = response.headers.get('content-security-policy') ?? '';
      expect(policy).toContain("'strict-dynamic'");
      expect(policy).not.toContain('report-uri');
      expect(response.headers.get('reporting-endpoints')).toBeNull();
    },
  );
});
