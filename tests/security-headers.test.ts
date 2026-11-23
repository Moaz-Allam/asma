import { describe, expect, it } from 'vitest';

import { buildCsp, cspReportUri, reportingEndpoints } from '@/lib/security/csp';
import { SECURITY_HEADERS } from '@/lib/security/headers';

/**
 * Spec 0004 AC-12 and AC-13 (D69): static security headers on every response, and a strict nonce
 * Content Security Policy with exactly the directives of the spec's CSP table. Tests first.
 */

const REPORT = 'https://aldebyani.test/api/csp';

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
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self), payment=()',
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
      // Spec 0006 AC-25: signed Storage links to a photo or a document, from the Supabase origin only.
      'img-src': "'self' blob: data: https://ref.supabase.co",
      'font-src': "'self'",
      'connect-src': "'self' https://ref.supabase.co wss://ref.supabase.co https://api.maptiler.com",
      'worker-src': "'self' blob:",
      'frame-src': 'https://challenges.cloudflare.com',
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
    expect(local['connect-src']).toBe(
      "'self' http://127.0.0.1:54421 ws://127.0.0.1:54421 https://api.maptiler.com",
    );
    expect(local['img-src']).toBe("'self' blob: data: http://127.0.0.1:54421");
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
    expect(directives(buildCsp('n', { dev: false, supabaseUrl: 'not a url' }))['connect-src']).toBe(
      "'self' https://api.maptiler.com",
    );
    expect(directives(buildCsp('n', { dev: false, supabaseUrl: 'not a url' }))['img-src']).toBe(
      "'self' blob: data:",
    );
  });
});

describe('cspReportUri: our own /api/csp handler, which scrubs before Sentry (D83)', () => {
  it('is absolute on the page origin, and names the report-to group', () => {
    expect(cspReportUri('https://aldebyani.test')).toBe(REPORT);
    expect(cspReportUri('http://127.0.0.1:3100')).toBe('http://127.0.0.1:3100/api/csp');
    expect(reportingEndpoints(REPORT)).toBe(`csp-endpoint="${REPORT}"`);
  });
});
