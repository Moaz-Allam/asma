import { describe, expect, it } from 'vitest';

import { buildCsp, cspReportUri, reportingEndpoints } from '@/lib/security/csp';
import { SECURITY_HEADERS } from '@/lib/security/headers';

/**
 * Spec 0004 AC-12 and AC-13 (D69): static security headers on every response, and a strict nonce
 * Content Security Policy with exactly the directives of the spec's CSP table. Tests first.
 */

const DSN = 'https://0a1b2c3d4e5f60718293a4b5c6d7e8f9@o4507000000000000.ingest.de.sentry.io/4507000000000001';
const REPORT =
  'https://o4507000000000000.ingest.de.sentry.io/api/4507000000000001/security/?sentry_key=0a1b2c3d4e5f60718293a4b5c6d7e8f9';

function directives(policy: string): Record<string, string> {
  return Object.fromEntries(
    policy.split(';').map((part) => {
      const [name = '', ...values] = part.trim().split(/\s+/);
      return [name, values.join(' ')];
    }),
  );
}

describe('static security headers (AC-12)', () => {
  it('are exactly the six the spec names', () => {
    expect(Object.fromEntries(SECURITY_HEADERS.map(({ key, value }) => [key, value]))).toEqual({
      'Strict-Transport-Security': 'max-age=86400',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'DENY',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    });
  });
});

describe('buildCsp (AC-13)', () => {
  const production = directives(
    buildCsp('bm9uY2U=', { dev: false, supabaseUrl: 'https://ref.supabase.co', reportUri: REPORT }),
  );

  it('has exactly the directives of the CSP table', () => {
    expect(production).toEqual({
      'default-src': "'self'",
      'script-src': "'self' 'nonce-bm9uY2U=' 'strict-dynamic'",
      'style-src': "'self' 'unsafe-inline'",
      'img-src': "'self' blob: data:",
      'font-src': "'self'",
      'connect-src': "'self' https://ref.supabase.co wss://ref.supabase.co",
      'worker-src': "'self' blob:",
      'frame-src': "'none'",
      'frame-ancestors': "'none'",
      'object-src': "'none'",
      'base-uri': "'self'",
      'form-action': "'self'",
      'report-uri': REPORT,
      'report-to': 'csp-endpoint',
    });
  });

  it('adds unsafe-eval in development only (the dev overlay)', () => {
    const dev = directives(buildCsp('n', { dev: true, supabaseUrl: 'https://ref.supabase.co' }));
    expect(dev['script-src']).toBe("'self' 'nonce-n' 'strict-dynamic' 'unsafe-eval'");
    expect(production['script-src']).not.toContain('unsafe-eval');
  });

  it('takes http and ws from a local Supabase URL', () => {
    const local = directives(buildCsp('n', { dev: false, supabaseUrl: 'http://127.0.0.1:54421' }));
    expect(local['connect-src']).toBe("'self' http://127.0.0.1:54421 ws://127.0.0.1:54421");
  });

  it('never upgrades insecure requests (local and e2e run on http)', () => {
    expect(production).not.toHaveProperty('upgrade-insecure-requests');
  });

  it('leaves out only the report directives without a report endpoint, and never throws', () => {
    const noReport = directives(buildCsp('n', { dev: false, supabaseUrl: 'https://ref.supabase.co' }));
    expect(noReport).not.toHaveProperty('report-uri');
    expect(noReport).not.toHaveProperty('report-to');
    expect(noReport['script-src']).toBe("'self' 'nonce-n' 'strict-dynamic'");
    expect(() => buildCsp('n', { dev: false, supabaseUrl: 'not a url' })).not.toThrow();
    expect(directives(buildCsp('n', { dev: false, supabaseUrl: 'not a url' }))['connect-src']).toBe("'self'");
  });
});

describe('cspReportUri: the Sentry security endpoint, derived from the DSN without the SDK', () => {
  it('builds it from the ingest host, project id and public key', () => {
    expect(cspReportUri(DSN)).toBe(REPORT);
    expect(reportingEndpoints(REPORT)).toBe(`csp-endpoint="${REPORT}"`);
  });

  it.each([undefined, '', 'nonsense', 'https://key@o1.ingest.us.sentry.io/2'])('gives none for %j', (dsn) => {
    expect(cspReportUri(dsn)).toBeUndefined();
  });
});
