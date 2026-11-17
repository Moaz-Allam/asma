import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Spec 0004 AC-1, AC-3, AC-5, AC-11: the server side doors. The SDK is mocked: these tests prove what
 * our code hands to Sentry (tags, fingerprint, the log record, the allow listed headers) and that every
 * door flushes after the response, mirrors to the console without the SDK, and never throws.
 */

const sentry = vi.hoisted(() => ({
  client: undefined as object | undefined,
  tags: {} as Record<string, string>,
  fingerprint: undefined as string[] | undefined,
  captureMessage: vi.fn(),
  captureRequestError: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  flush: vi.fn(async () => true),
  startNewTrace: vi.fn((run: () => unknown) => run()),
  after: vi.fn(),
}));

vi.mock('@sentry/nextjs', () => ({
  getClient: () => sentry.client,
  withScope: (callback: (scope: object) => void) =>
    callback({
      setTag: (key: string, value: string) => {
        sentry.tags[key] = value;
      },
      setFingerprint: (fingerprint: string[]) => {
        sentry.fingerprint = fingerprint;
      },
    }),
  captureMessage: sentry.captureMessage,
  captureRequestError: sentry.captureRequestError,
  logger: sentry.logger,
  getActiveSpan: () => undefined,
  getCurrentScope: () => ({ getPropagationContext: () => ({ traceId: 'a3f9c2b1d4e5f60718293a4b5c6d7e8f' }) }),
  startNewTrace: sentry.startNewTrace,
  flush: sentry.flush,
  init: vi.fn(),
}));
vi.mock('next/server', () => ({ after: sentry.after }));
vi.mock('@/lib/env', () => ({ sentryDsn: () => undefined, getEnv: () => ({}) }));

const { raiseAlert } = await import('@/lib/observability/alert');
const { inJobRun, log } = await import('@/lib/observability/log');
const { captureRequestError } = await import('@/lib/observability/server');

const UUID = '3f1c2a9e-1b2c-4d5e-8f90-a1b2c3d4e5f6';

beforeEach(() => {
  sentry.client = {};
  sentry.tags = {};
  sentry.fingerprint = undefined;
  for (const mock of [sentry.captureMessage, sentry.captureRequestError, sentry.flush, sentry.after])
    mock.mockClear();
  for (const mock of Object.values(sentry.logger)) mock.mockClear();
  sentry.after.mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('raiseAlert (AC-11)', () => {
  it('sends one event tagged alert, fingerprinted by reason and record, flushed after the response', () => {
    raiseAlert('flag_read_failed', { recordId: 'TR:notifications_enabled', region: 'TR', cause: 'timeout' });
    expect(sentry.tags).toEqual({ alert: 'flag_read_failed', region: 'TR', cause: 'timeout' });
    expect(sentry.fingerprint).toEqual(['alert', 'flag_read_failed', 'TR:notifications_enabled', 'local']);
    expect(sentry.captureMessage).toHaveBeenCalledWith('alert flag_read_failed', 'error');
    expect(sentry.after).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['production', 'production'],
    ['preview', 'preview'],
  ])('keeps a %s alert apart from every other environment (D84)', (vercelEnv, expected) => {
    vi.stubEnv('VERCEL_ENV', vercelEnv);
    try {
      raiseAlert('flag_read_failed', { recordId: 'TR:notifications_enabled' });
      expect(sentry.fingerprint).toEqual(['alert', 'flag_read_failed', 'TR:notifications_enabled', expected]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('starts the flush at once outside a request, where after() is unavailable', () => {
    sentry.after.mockImplementation(() => {
      throw new Error('after() was called outside a request scope');
    });
    raiseAlert('flag_read_failed', { recordId: 'KSA:notifications_enabled' });
    expect(sentry.flush).toHaveBeenCalledWith(2000);
  });

  it('mirrors to the console without the SDK', () => {
    sentry.client = undefined;
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    raiseAlert('flag_read_failed', { recordId: 'TR:notifications_enabled', region: 'TR', cause: 'missing' });
    expect(sentry.captureMessage).not.toHaveBeenCalled();
    expect(JSON.parse(String(error.mock.calls[0]?.[0]))).toEqual({
      alert: 'flag_read_failed',
      recordId: 'TR:notifications_enabled',
      region: 'TR',
      cause: 'missing',
    });
  });

  it('never throws', () => {
    sentry.captureMessage.mockImplementationOnce(() => {
      throw new Error('transport down');
    });
    expect(() => raiseAlert('flag_read_failed', { recordId: 'TR:notifications_enabled' })).not.toThrow();
  });
});

describe('the logger (AC-5)', () => {
  it('sends the event, the correlation id and the allowed ids to Sentry Logs, flushed after the response', () => {
    log.error('flag_read_failed', { region: 'TR', user_id: UUID, request_id: 'fra1::iad1::abc-123' });
    expect(sentry.logger.error).toHaveBeenCalledWith('flag_read_failed', {
      event: 'flag_read_failed',
      correlation_id: 'a3f9c2b1d4e5f60718293a4b5c6d7e8f',
      region: 'TR',
      user_id: UUID,
      request_id: 'fra1::iad1::abc-123',
    });
    expect(sentry.after).toHaveBeenCalledTimes(1);
  });

  it('drops any id that is not well formed: an email is never a user id', () => {
    log.warn('flag_read_failed', {
      user_id: 'ali@example.com',
      request_id: 'has spaces and ali@example.com',
      region: 'XX' as 'TR',
    });
    expect(sentry.logger.warn).toHaveBeenCalledWith('flag_read_failed', {
      event: 'flag_read_failed',
      correlation_id: 'a3f9c2b1d4e5f60718293a4b5c6d7e8f',
    });
  });

  it('mirrors to the console without the SDK', () => {
    sentry.client = undefined;
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    log.info('flag_read_failed', { region: 'KSA' });
    expect(sentry.logger.info).not.toHaveBeenCalled();
    expect(JSON.parse(String(info.mock.calls[0]?.[0]))).toEqual({
      level: 'info',
      event: 'flag_read_failed',
      correlation_id: 'a3f9c2b1d4e5f60718293a4b5c6d7e8f',
      region: 'KSA',
    });
  });

  it('gives each job run a fresh trace, so its records share their own correlation id', () => {
    expect(inJobRun(() => 'done')).toBe('done');
    expect(sentry.startNewTrace).toHaveBeenCalledTimes(1);
  });
});

describe('captureRequestError (AC-1, AC-3)', () => {
  it('passes only allow listed headers and a scrubbed path, and awaits the flush', async () => {
    await captureRequestError(
      new Error('boom'),
      {
        method: 'POST',
        path: '/tr/auth/callback?code=abc&page=2',
        headers: {
          cookie: 'sb-access-token=secret',
          authorization: 'Bearer secret',
          'x-forwarded-for': '85.105.1.2',
          'x-real-ip': '85.105.1.2',
          'x-vercel-ip-city': 'Izmir',
          'user-agent': 'Mozilla/5.0',
          'next-action': 'abc123',
        },
      },
      {
        routerKind: 'App Router',
        routePath: '/[locale]/auth/callback',
        routeType: 'action',
        revalidateReason: undefined,
      },
    );
    const [, request] = sentry.captureRequestError.mock.calls[0] ?? [];
    expect(request).toEqual({
      method: 'POST',
      path: '/tr/auth/callback?page=2',
      headers: { 'user-agent': 'Mozilla/5.0', 'next-action': 'abc123' },
    });
    expect(sentry.flush).toHaveBeenCalledWith(2000);
  });

  it('never throws', async () => {
    sentry.captureRequestError.mockImplementationOnce(() => {
      throw new Error('sdk down');
    });
    await expect(
      captureRequestError(
        new Error('boom'),
        { method: 'GET', path: '/en', headers: {} },
        {
          routerKind: 'App Router',
          routePath: '/[locale]',
          routeType: 'render',
          revalidateReason: undefined,
        },
      ),
    ).resolves.toBeUndefined();
  });
});
