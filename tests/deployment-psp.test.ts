import { describe, expect, it } from 'vitest';

import { assertDeploymentKeys, missingDeploymentKeys } from '@/lib/deployment';

/**
 * Spec 0011-08 AC-2: the PSP door on a deployment. `off` (unset) and `fake` boot without any PSP key, so merging
 * 08 never stops production; `fake` never runs on production; `iyzico` needs its keys, the relay secret and the
 * server only DSN, and its live host only on production. One case each.
 */

const SHA = '0123456789abcdef0123456789abcdef01234567';
const DSN = 'https://examplepublickey@o4507000000000000.ingest.de.sentry.io/4507000000000001';
const SERVER_DSN = 'https://serverpublickey@o4507000000000000.ingest.de.sentry.io/4507000000000002';
const base = {
  VERCEL: '1',
  VERCEL_GIT_COMMIT_SHA: SHA,
  NEXT_PUBLIC_SENTRY_DSN: DSN,
  NEXT_PUBLIC_POSTHOG_KEY: 'phc_example',
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'site-key',
};
const iyzico = {
  ...base,
  PSP_DRIVER: 'iyzico',
  IYZICO_API_KEY: 'api-key',
  IYZICO_SECRET_KEY: 'secret-key',
  IYZICO_BASE_URL: 'https://sandbox-api.iyzipay.com',
  RELAY_SECRET: 'r'.repeat(32),
  SENTRY_SERVER_DSN: SERVER_DSN,
};
const PSP_KEYS = [
  'PSP_DRIVER',
  'IYZICO_API_KEY',
  'IYZICO_SECRET_KEY',
  'IYZICO_BASE_URL',
  'RELAY_SECRET',
  'SENTRY_SERVER_DSN',
];
const pspMissing = (env: Record<string, string | undefined>) =>
  missingDeploymentKeys(env, 'runtime').filter((name) => PSP_KEYS.includes(name));

describe('PSP_DRIVER on a deployment', () => {
  it.each([
    ['unset (off) on production', { ...base, VERCEL_ENV: 'production' }],
    ['off on production', { ...base, VERCEL_ENV: 'production', PSP_DRIVER: 'off' }],
    ['fake on a preview', { ...base, VERCEL_ENV: 'preview', PSP_DRIVER: 'fake' }],
  ])('%s boots without any PSP key', (_name, env) => {
    expect(pspMissing(env)).toEqual([]);
    expect(() => assertDeploymentKeys(env, 'runtime')).not.toThrow();
  });

  it('refuses the fake on production', () => {
    const env = { ...base, VERCEL_ENV: 'production', PSP_DRIVER: 'fake' };
    expect(pspMissing(env)).toEqual(['PSP_DRIVER']);
    expect(() => assertDeploymentKeys(env, 'runtime')).toThrow(/PSP_DRIVER/);
  });

  it('refuses an unknown driver', () => {
    expect(pspMissing({ ...base, PSP_DRIVER: 'stripe' })).toEqual(['PSP_DRIVER']);
  });

  it('never checks the PSP at build', () => {
    expect(
      missingDeploymentKeys({ ...base, VERCEL_ENV: 'production', PSP_DRIVER: 'fake' }, 'build'),
    ).not.toContain('PSP_DRIVER');
  });
});

describe('PSP_DRIVER=iyzico needs its keys', () => {
  it('a complete preview lacks nothing', () => {
    expect(pspMissing({ ...iyzico, VERCEL_ENV: 'preview' })).toEqual([]);
  });

  it.each(['IYZICO_API_KEY', 'IYZICO_SECRET_KEY', 'IYZICO_BASE_URL', 'RELAY_SECRET', 'SENTRY_SERVER_DSN'])(
    'refuses to boot without %s',
    (name) => {
      const env = { ...iyzico, VERCEL_ENV: 'preview', [name]: undefined };
      expect(pspMissing(env)).toEqual([name]);
      expect(() => assertDeploymentKeys(env, 'runtime')).toThrow(new RegExp(name));
    },
  );

  it('refuses a relay secret under 32 characters', () => {
    expect(pspMissing({ ...iyzico, RELAY_SECRET: 'short' })).toEqual(['RELAY_SECRET']);
  });

  it('refuses a server DSN equal to the browser one, or outside the EU', () => {
    expect(pspMissing({ ...iyzico, SENTRY_SERVER_DSN: DSN })).toEqual(['SENTRY_SERVER_DSN']);
    expect(pspMissing({ ...iyzico, SENTRY_SERVER_DSN: 'https://k@o1.ingest.us.sentry.io/2' })).toEqual([
      'SENTRY_SERVER_DSN',
    ]);
  });

  it('allows the live host on production only', () => {
    const live = { ...iyzico, IYZICO_BASE_URL: 'https://api.iyzipay.com' };
    expect(pspMissing({ ...live, VERCEL_ENV: 'production' })).toEqual([]);
    expect(pspMissing({ ...live, VERCEL_ENV: 'preview' })).toEqual(['IYZICO_BASE_URL']);
  });

  it('refuses any other host', () => {
    expect(pspMissing({ ...iyzico, IYZICO_BASE_URL: 'https://api.iyzipay.com.evil.example' })).toEqual([
      'IYZICO_BASE_URL',
    ]);
    expect(pspMissing({ ...iyzico, IYZICO_BASE_URL: 'http://sandbox-api.iyzipay.com' })).toEqual([
      'IYZICO_BASE_URL',
    ]);
  });

  it('with off or fake, none of the iyzico keys is asked for', () => {
    expect(pspMissing({ ...base, PSP_DRIVER: 'off', IYZICO_BASE_URL: 'nonsense' })).toEqual([]);
  });
});
