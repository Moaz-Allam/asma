import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

import { captureKeys } from '../lib/analytics/capture-body';
import { parseEuSentryDsn } from '../lib/deployment';

import { expect, test } from './fixtures';
import { onboard, signIn } from './auth';
import { testPhone } from './numbers';

/**
 * Spec 0004 at 390px in every locale: the security headers and the nonce CSP (AC-12, AC-13), both
 * telemetry SDKs running against stubs with zero CSP violations (AC-13), cookieless analytics with a
 * scrubbed pageview and nothing stored on the device (AC-3, AC-6, AC-7), a real browser error scrubbed
 * on its way through the tunnel (AC-2, AC-3), and the health endpoint's degraded answer (AC-10).
 */

const STATIC_HEADERS = {
  'strict-transport-security': 'max-age=86400',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'cross-origin-opener-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(self), payment=()',
};

test('every page carries the security headers and a nonce CSP that Next stamps on its scripts', async ({
  page,
}, testInfo) => {
  const response = await page.goto(`/${testInfo.project.name}`);
  const headers = response?.headers() ?? {};
  expect(headers).toMatchObject(STATIC_HEADERS);

  const policy = headers['content-security-policy'] ?? '';
  expect(policy).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(policy).not.toContain('unsafe-eval');
  const nonce = /'nonce-([^']+)'/.exec(policy)?.[1];

  const scriptNonces = await page
    .locator('script[nonce]')
    .evaluateAll((scripts) => scripts.map((script) => (script as HTMLScriptElement).nonce));
  expect(scriptNonces.length).toBeGreaterThan(0);
  expect(new Set(scriptNonces)).toEqual(new Set([nonce]));

  const second = await page.request.get(`/${testInfo.project.name}`);
  expect(second.headers()['content-security-policy']).not.toContain(`'nonce-${nonce}'`);
});

test('both SDKs run with zero CSP violations, nothing leaves the origin, nothing stays on the device', async ({
  page,
  context,
  telemetry,
}, testInfo) => {
  const locale = testInfo.project.name;
  await page.goto(`/${locale}?token=e2e-secret-token&utm_source=e2e#e2e-fragment`);

  // PostHog starts after hydration and sends the first pageview manually.
  await expect
    .poll(() => telemetry.posthog.find((e) => e.event === '$pageview'), { timeout: 20_000 })
    .toBeTruthy();
  const pageview = telemetry.posthog.find((e) => e.event === '$pageview');
  const url = String(pageview?.properties.$current_url);
  expect(url).toContain(`/${locale}`);
  expect(url).toContain('utm_source=e2e');
  expect(url).not.toContain('e2e-secret-token');
  expect(url).not.toContain('e2e-fragment');
  expect(pageview?.properties.app_env).toBe('local');
  expect(pageview?.properties).not.toHaveProperty('utm_source');
  expect(telemetry.posthog.every((e) => ['$pageview', 'locale_changed'].includes(e.event))).toBe(true);

  // The stub hides the handler, so the real SDK's real bytes go through the relay's own parser: a handler
  // that refused every real call once passed this whole suite (2026-10-31).
  expect(telemetry.posthogCalls.length).toBeGreaterThan(0);
  for (const { body, compression } of telemetry.posthogCalls) {
    const keys = captureKeys(body, compression);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((key) => key.startsWith('phc_'))).toBe(true);
  }

  expect(await telemetry.cspViolations()).toEqual([]);
  expect(telemetry.offOrigin).toEqual([]);

  const storage = await page.evaluate(() => ({
    local: Object.keys(localStorage),
    session: Object.keys(sessionStorage),
  }));
  expect(storage).toEqual({ local: [], session: [] });
  // next-intl's own locale cookie is ours and functional; neither SDK may add one.
  const cookies = (await context.cookies())
    .map((cookie) => cookie.name)
    .filter((name) => name !== 'NEXT_LOCALE');
  expect(cookies).toEqual([]);
});

test('switching language sends locale_changed and the next pageview', async ({
  page,
  telemetry,
}, testInfo) => {
  const from = testInfo.project.name;
  const to = from === 'tr' ? 'en' : 'tr';
  await page.goto(`/${from}`);
  await expect
    .poll(() => telemetry.posthog.some((e) => e.event === '$pageview'), { timeout: 20_000 })
    .toBe(true);
  await signIn(page, from, testPhone(from, 'localeTelemetry'));
  await onboard(page, 'Locale Tester');
  await page.goto(`/${from}/account`);
  await page.locator(`nav button[lang="${to}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/${to}/account$`));
  await expect
    .poll(() => telemetry.posthog.find((e) => e.event === 'locale_changed'), { timeout: 20_000 })
    .toMatchObject({ properties: { from_locale: from, to_locale: to, app_env: 'local' } });
  await expect
    .poll(
      () =>
        telemetry.posthog.some(
          (e) => e.event === '$pageview' && String(e.properties.$pathname) === `/${to}/account`,
        ),
      {
        timeout: 20_000,
      },
    )
    .toBe(true);
});

test('a browser error reaches the tunnel with its personal data scrubbed', async ({
  page,
  telemetry,
}, testInfo) => {
  await page.goto(`/${testInfo.project.name}`);
  await page.waitForLoadState('load');
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error('e2e failure for ali@example.com from 85.105.1.2 at +90 555 123 45 67');
    });
  });

  await expect
    .poll(() => telemetry.sentry.some((envelope) => envelope.includes('"type":"event"')), {
      timeout: 20_000,
    })
    .toBe(true);
  // The relay forwards an envelope only when its first line names our DSN: the SDK must write it there.
  for (const envelope of telemetry.sentry) {
    const header = JSON.parse(envelope.split('\n', 1)[0] ?? '{}') as { dsn?: string };
    expect(parseEuSentryDsn(header.dsn ?? '')).not.toBeNull();
  }

  const sent = telemetry.sentry.join('\n');
  expect(sent).toContain('e2e failure for [email] from [ip] at [phone]');
  for (const pii of ['ali@example.com', '85.105.1.2', '555 123 45 67']) expect(sent).not.toContain(pii);
  expect(sent).not.toMatch(/"user":\s*\{/);
  expect(telemetry.offOrigin).toEqual([]);
});

test('the telemetry relays are our own handlers, refusing anything not ours before calling out (D83)', async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'en', 'one locale is enough for a machine endpoint');
  const foreign = JSON.stringify({ dsn: 'https://other@o9.ingest.de.sentry.io/9' });
  expect((await request.post('/api/e', { data: `${foreign}\n{"type":"event"}\n{}` })).status()).toBe(403);
  expect((await request.get('/api/e')).status()).toBe(405);

  // posthog-js posts to /api/a/e/ with a trailing slash: it must reach the handler, not a redirect.
  const event = gzipSync(JSON.stringify([{ event: '$pageview', properties: { token: 'phc_bbbbbbbbbbbb' } }]));
  const capture = await request.post('/api/a/e/?compression=gzip-js', { data: event, maxRedirects: 0 });
  expect(capture.status()).toBe(403);
  expect((await request.post('/api/a/array/phc_x/config.js', { data: '{}' })).status()).toBe(404);

  expect(
    (await request.post('/api/csp', { data: '{}', headers: { 'content-type': 'text/plain' } })).status(),
  ).toBe(415);
});

test('the health endpoint pings the real database (ok with it, degraded without it), uncached, with nothing else in it', async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'en', 'one locale is enough for a machine endpoint');
  // With the local stack, health_ping() runs through the anon key against the migrated database
  // (review 2026-10-29); with E2E_NO_DB=1 (CI today) there is no database to answer.
  const withDatabase = process.env.E2E_NO_DB !== '1';
  const response = await request.get('/api/health');
  expect(response.status()).toBe(withDatabase ? 200 : 503);
  expect(response.headers()['cache-control']).toBe('no-store');
  expect(response.headers()).toMatchObject(STATIC_HEADERS);
  const body: unknown = await response.json();
  expect(body).toEqual({
    status: withDatabase ? 'ok' : 'degraded',
    db: withDatabase ? 'ok' : 'down',
    commit: 'local',
    region: 'local',
    checkedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
  });
});

test('no locale page is prerendered: each one renders per request with its own nonce', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'en', 'the manifest is the same for every locale');
  const manifest = JSON.parse(readFileSync('.next/prerender-manifest.json', 'utf8')) as {
    routes: Record<string, unknown>;
  };
  const routes = Object.keys(manifest.routes);
  for (const locale of ['/ar', '/tr', '/en']) expect(routes).not.toContain(locale);
});
