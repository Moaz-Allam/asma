import { describe, expect, it, vi } from 'vitest';

import { createHealthCheck, healthResponse, type Ping } from '@/lib/health/check';

/**
 * Spec 0004 AC-10 (D71): GET /api/health tells "app up" from "database down". 200 only when
 * health_ping() answers true within 2 seconds; every other outcome is the same 503. A result is reused
 * for 5 seconds per instance, the response is never cached by anyone else, and it never carries
 * personal data, a secret or error text. Tests first; the ping is injected.
 */

const SHA = '0123456789abcdef0123456789abcdef01234567';
const T0 = Date.UTC(2026, 9, 28, 12, 0, 0);

function check(ping: Ping, options: { now?: () => number; env?: Record<string, string | undefined> } = {}) {
  return createHealthCheck({ ping, timeoutMs: 50, now: options.now ?? (() => T0), env: options.env ?? {} });
}

describe('the answer', () => {
  it('is 200 ok when the database answers true in time', async () => {
    const result = await check(async () => true, {
      env: { VERCEL_GIT_COMMIT_SHA: SHA, VERCEL_REGION: 'fra1' },
    })();
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      status: 'ok',
      db: 'ok',
      commit: SHA,
      region: 'fra1',
      checkedAt: '2026-10-28T12:00:00.000Z',
    });
  });

  const degraded = { status: 'degraded', db: 'down', commit: 'local', region: 'local' };
  it.each([
    ['answers false', async () => false],
    ['answers something other than true', async () => 'true' as unknown as boolean],
    ['throws', async () => Promise.reject(new Error('connection refused'))],
    ['never answers', () => new Promise<boolean>(() => {})],
    [
      'is aborted',
      (signal: AbortSignal) =>
        new Promise<boolean>((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason)),
        ),
    ],
    ['answers true too late', () => new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 200))],
  ] as Array<[string, Ping]>)('is the same 503 when the database %s', async (_name, ping) => {
    const result = await check(ping)();
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject(degraded);
    expect(Object.keys(result.body).sort()).toEqual(['checkedAt', 'commit', 'db', 'region', 'status']);
  });

  it('never carries error text or a secret', async () => {
    const result = await check(async () => {
      throw new Error('password authentication failed for user postgres, token=abc');
    })();
    const json = JSON.stringify(result.body);
    expect(json).not.toMatch(/password|token|postgres|abc/);
  });

  it('names the function region, never the business region, and a short SHA is not a commit', async () => {
    const result = await check(async () => true, {
      env: { VERCEL_GIT_COMMIT_SHA: 'abc123', VERCEL_REGION: '' },
    })();
    expect(result.body.commit).toBe('local');
    expect(result.body.region).toBe('local');
  });
});

describe('the 5 second memo per instance', () => {
  it('reuses a result for 5 seconds, with the time it was taken', async () => {
    let now = T0;
    const ping = vi.fn(async () => true);
    const run = check(ping, { now: () => now });

    await run();
    now = T0 + 4_999;
    const reused = await run();
    expect(ping).toHaveBeenCalledTimes(1);
    expect(reused.body.checkedAt).toBe('2026-10-28T12:00:00.000Z');

    now = T0 + 5_000;
    const fresh = await run();
    expect(ping).toHaveBeenCalledTimes(2);
    expect(fresh.body.checkedAt).toBe('2026-10-28T12:00:05.000Z');
  });

  it('shares one ping between requests that arrive together', async () => {
    const ping = vi.fn(() => new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 10)));
    const run = check(ping);
    const results = await Promise.all([run(), run(), run()]);
    expect(ping).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
  });

  it('remembers a degraded answer too, so a down database is not hammered', async () => {
    const ping = vi.fn(async () => false);
    const run = check(ping);
    await run();
    await run();
    expect(ping).toHaveBeenCalledTimes(1);
  });
});

describe('the response', () => {
  it('is JSON, uncached by anyone, with the status of the result', async () => {
    const response = healthResponse(await check(async () => false)());
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-type')).toMatch(/^application\/json/);
    expect(await response.json()).toMatchObject({ status: 'degraded', db: 'down' });
  });
});
