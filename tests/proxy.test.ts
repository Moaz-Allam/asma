import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** The real @supabase/ssr needs a real Auth server; this keeps its contract (getAll, setAll, two arguments). */
type CookieMethods = {
  getAll(): Array<{ name: string; value: string }>;
  setAll(cookies: Array<{ name: string; value: string; options: object }>, headers: object): void;
};
const auth = vi.hoisted(() => ({ getClaims: vi.fn() }));
vi.mock('@supabase/ssr', () => ({
  createServerClient: (_url: string, _key: string, options: { cookies: CookieMethods }) => ({
    auth: { getClaims: () => auth.getClaims(options.cookies) },
  }),
}));

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
  auth.getClaims.mockReset();
});

function nonceOf(policy: string | null): string | undefined {
  return policy?.match(/'nonce-([^']+)'/)?.[1];
}

describe('proxy: the nonce and the policy', () => {
  it('passes the policy to Next through the request headers and sets it on the response', async () => {
    const proxy = await loadProxy(VALID_ENV);
    const response = await proxy(new NextRequest('http://localhost/en'));
    const sent = response.headers.get('content-security-policy');
    const forwarded = response.headers.get('x-middleware-request-content-security-policy');

    expect(sent).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(sent).toContain(
      "connect-src 'self' https://ref.supabase.co wss://ref.supabase.co https://api.maptiler.com",
    );
    expect(forwarded).toBe(sent);
    expect(response.headers.get('x-middleware-override-headers')).toContain('content-security-policy');
    expect(response.headers.get('x-middleware-request-x-nonce')).toBe(nonceOf(sent));
  });

  it('makes a fresh nonce for every request', async () => {
    const proxy = await loadProxy(VALID_ENV);
    const responses = await Promise.all(
      Array.from({ length: 20 }, () => proxy(new NextRequest('http://localhost/tr'))),
    );
    const nonces = new Set(responses.map((r) => nonceOf(r.headers.get('content-security-policy'))));
    expect(nonces.size).toBe(20);
  });

  it('keeps the policy on a locale redirect too', async () => {
    const proxy = await loadProxy(VALID_ENV);
    const response = await proxy(
      new NextRequest('http://localhost/', { headers: { 'accept-language': 'tr' } }),
    );
    expect(response.headers.get('location')).toMatch(/\/tr$/);
    expect(response.headers.get('content-security-policy')).toContain("'strict-dynamic'");
  });

  it('sends violation reports to our own /api/csp handler on the page origin, never to Sentry', async () => {
    const proxy = await loadProxy({
      ...VALID_ENV,
      NEXT_PUBLIC_SENTRY_DSN: 'https://k@o1.ingest.de.sentry.io/2',
    });
    const response = await proxy(new NextRequest('https://aldebyani.test/ar'));
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
    const response = await proxy(new NextRequest('http://localhost/ar'));
    const policy = response.headers.get('content-security-policy') ?? '';
    expect(policy).toContain("'strict-dynamic'");
    expect(policy).toContain("connect-src 'self' https://api.maptiler.com;");
  });
});

/**
 * Spec 0005 AC-11. Redirects are UX only: the page guard and the action guard are the checks that hold,
 * so a visitor with no Auth cookie costs no Auth call, a Server Action POST always passes through, and
 * an Auth outage passes through to the page guard.
 */
const { AuthApiError, AuthRetryableFetchError } = await import('@supabase/supabase-js');
const COOKIE = 'sb-ref-auth-token';
const PRIVATE = ['requests', 'requests/new', 'provider', 'provider/profile', 'admin', 'account'];
const SIGNED_IN = { data: { claims: { sub: 'user' } }, error: null };
const SIGNED_OUT = { data: null, error: null };

function signedIn(path: string): NextRequest {
  return new NextRequest(`http://localhost${path}`, { headers: { cookie: `${COOKIE}=old; other=kept` } });
}

describe('proxy: a visitor with no Auth cookie', () => {
  it('makes no Auth call', async () => {
    const proxy = await loadProxy(VALID_ENV);
    await proxy(new NextRequest('http://localhost/tr'));
    await proxy(new NextRequest('http://localhost/tr/requests'));
    expect(auth.getClaims).not.toHaveBeenCalled();
  });

  it.each(PRIVATE)('redirects /%s to the login with next', async (path) => {
    const proxy = await loadProxy(VALID_ENV);
    const response = await proxy(new NextRequest(`http://localhost/tr/${path}`));
    const location = new URL(response.headers.get('location') ?? '');
    expect(location.pathname).toBe('/tr/login');
    expect(location.searchParams.get('next')).toBe(`/${path}`);
  });

  it.each(['continue', 'onboarding'])('redirects /%s to the login', async (path) => {
    const proxy = await loadProxy(VALID_ENV);
    const response = await proxy(new NextRequest(`http://localhost/ar/${path}`));
    expect(new URL(response.headers.get('location') ?? '').pathname).toBe('/ar/login');
  });

  it('keeps the query string in next', async () => {
    const proxy = await loadProxy(VALID_ENV);
    const response = await proxy(new NextRequest('http://localhost/en/requests?page=2'));
    expect(new URL(response.headers.get('location') ?? '').searchParams.get('next')).toBe('/requests?page=2');
  });

  it.each(['/tr', '/tr/login', '/tr/terms', '/tr/privacy', '/tr/requestsfoo', '/tr/administrator'])(
    'leaves the public path %s alone',
    async (path) => {
      const proxy = await loadProxy(VALID_ENV);
      const response = await proxy(new NextRequest(`http://localhost${path}`));
      expect(response.headers.get('location')).toBeNull();
    },
  );

  it('lets the locale redirect happen first on a path with no locale', async () => {
    const proxy = await loadProxy(VALID_ENV);
    const response = await proxy(
      new NextRequest('http://localhost/requests', { headers: { 'accept-language': 'tr' } }),
    );
    expect(new URL(response.headers.get('location') ?? '').pathname).toBe('/tr/requests');
  });

  it('passes a Server Action POST through, so the action itself says unauthorized', async () => {
    const proxy = await loadProxy(VALID_ENV);
    const response = await proxy(
      new NextRequest('http://localhost/tr/requests', { method: 'POST', headers: { 'next-action': 'abc' } }),
    );
    expect(response.headers.get('location')).toBeNull();
  });

  it('keeps the policy and the reporting header on the redirect', async () => {
    const proxy = await loadProxy(VALID_ENV);
    const response = await proxy(new NextRequest('http://localhost/tr/account'));
    expect(response.status).toBe(307);
    expect(response.headers.get('content-security-policy')).toContain("'strict-dynamic'");
    expect(response.headers.get('reporting-endpoints')).toContain('csp-endpoint=');
  });
});

describe('proxy: a request with an Auth cookie', () => {
  beforeEach(() => {
    auth.getClaims.mockResolvedValue(SIGNED_IN);
  });

  it('refreshes the session, including on a chunked cookie name', async () => {
    const proxy = await loadProxy(VALID_ENV);
    await proxy(new NextRequest('http://localhost/tr', { headers: { cookie: `${COOKIE}.0=old` } }));
    expect(auth.getClaims).toHaveBeenCalledTimes(1);
  });

  it('lets a signed in user through to a private page', async () => {
    const proxy = await loadProxy(VALID_ENV);
    const response = await proxy(signedIn('/tr/requests'));
    expect(response.headers.get('location')).toBeNull();
  });

  it('hands refreshed cookies to this render and to the browser, with the cache headers', async () => {
    auth.getClaims.mockImplementation(async (cookies: CookieMethods) => {
      expect(cookies.getAll().find((c) => c.name === COOKIE)?.value).toBe('old');
      cookies.setAll([{ name: COOKIE, value: 'fresh', options: { path: '/', maxAge: 100 } }], {
        'Cache-Control': 'private, no-store',
      });
      return SIGNED_IN;
    });
    const proxy = await loadProxy(VALID_ENV);
    const response = await proxy(signedIn('/tr/requests'));

    const forwarded = response.headers.get('x-middleware-request-cookie') ?? '';
    expect(forwarded).toContain(`${COOKIE}=fresh`);
    expect(forwarded).toContain('other=kept');
    expect(forwarded).not.toContain(`${COOKIE}=old`);
    expect(response.cookies.get(COOKIE)?.value).toBe('fresh');
    expect(response.cookies.get(COOKIE)?.maxAge).toBe(100);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('content-security-policy')).toContain("'strict-dynamic'");
  });

  it('sends a dead session to the login and clears its cookie on the redirect', async () => {
    auth.getClaims.mockImplementation(async (cookies: CookieMethods) => {
      cookies.setAll([{ name: COOKIE, value: '', options: { path: '/', maxAge: 0 } }], {});
      return SIGNED_OUT;
    });
    const proxy = await loadProxy(VALID_ENV);
    const response = await proxy(signedIn('/tr/provider'));

    expect(new URL(response.headers.get('location') ?? '').pathname).toBe('/tr/login');
    expect(response.cookies.get(COOKIE)?.maxAge).toBe(0);
    expect(response.headers.get('content-security-policy')).toContain("'strict-dynamic'");
  });

  it('counts an Auth 4xx as signed out', async () => {
    auth.getClaims.mockResolvedValue({ data: null, error: new AuthApiError('bad jwt', 403, 'bad_jwt') });
    const proxy = await loadProxy(VALID_ENV);
    const response = await proxy(signedIn('/tr/requests'));
    expect(response.headers.get('location')).toContain('/tr/login');
  });

  it.each([
    ['a retryable error', async () => ({ data: null, error: new AuthRetryableFetchError('down', 503) })],
    ['an Auth 500', async () => ({ data: null, error: new AuthApiError('boom', 500, 'unexpected_failure') })],
    [
      'a throw',
      async () => {
        throw new Error('down');
      },
    ],
  ])('passes %s through to the page guard, and never throws', async (_name, outcome) => {
    auth.getClaims.mockImplementation(outcome);
    const proxy = await loadProxy(VALID_ENV);
    const response = await proxy(signedIn('/tr/requests'));
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('content-security-policy')).toContain("'strict-dynamic'");
  });

  it('never throws on a broken environment either', async () => {
    const proxy = await loadProxy({ ...VALID_ENV, NEXT_PUBLIC_SUPABASE_URL: '' });
    const response = await proxy(signedIn('/tr/requests'));
    expect(response.headers.get('location')).toBeNull();
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
