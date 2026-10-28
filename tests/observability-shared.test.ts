import { describe, expect, it } from 'vitest';

import {
  TELEMETRY_SPAN_NAMES,
  appEnvOf,
  isTelemetryPath,
  tracesSampleRate,
} from '@/lib/observability/shared';

/** Spec 0004 AC-2 and AC-5: the sample rates per environment, and no span for the telemetry paths. */

describe('tracesSampleRate (D67)', () => {
  it.each([
    ['production', 0.1],
    ['preview', 1],
    ['local', 0],
  ] as const)('%s → %s', (environment, rate) => {
    expect(tracesSampleRate(environment)).toBe(rate);
  });

  it('reads anything unknown as local', () => {
    expect(appEnvOf('development')).toBe('local');
    expect(appEnvOf(undefined)).toBe('local');
    expect(appEnvOf('preview')).toBe('preview');
  });
});

describe('the telemetry paths get no span (AC-2)', () => {
  it.each([
    '/api/e',
    '/api/e?o=1&p=2&r=de',
    '/api/a/e/',
    '/api/a/static/array.js',
    'https://x.test/api/a/i/v0/e/',
  ])('%s is telemetry', (url) => {
    expect(isTelemetryPath(url)).toBe(true);
  });

  it.each(['/api/health', '/api/explore', '/api/admin', '/en/api/e', 'https://x.test/api/events'])(
    '%s is not',
    (url) => {
      expect(isTelemetryPath(url)).toBe(false);
    },
  );

  it('matches the server span names of the rewrites, and nothing else', () => {
    const ignored = (name: string) => TELEMETRY_SPAN_NAMES.some((pattern) => pattern.test(name));
    expect(ignored('POST /api/e')).toBe(true);
    expect(ignored('GET /api/a/static/array.js')).toBe(true);
    expect(ignored('GET /api/health')).toBe(false);
    expect(ignored('GET /[locale]')).toBe(false);
  });
});
