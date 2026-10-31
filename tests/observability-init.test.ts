import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Spec 0004 AC-2 to AC-5 and AC-17, read straight off the options both Sentry SDKs are started with, so
 * a refactor that drops a mask flag, the tunnel or a scrub hook fails here (review 2026-10-29). The SDK
 * is mocked; nothing is sent.
 */

const sdk = vi.hoisted(() => ({ captureException: vi.fn() }));

vi.mock('@sentry/nextjs', () => ({
  addEventProcessor: vi.fn(),
  addIntegration: vi.fn(),
  browserTracingIntegration: vi.fn(() => ({ name: 'BrowserTracing' })),
  captureException: sdk.captureException,
  captureRouterTransitionStart: vi.fn(),
  captureRequestError: vi.fn(),
  flush: vi.fn(),
  init: vi.fn(),
}));
vi.mock('next/server', () => ({ after: vi.fn() }));
vi.mock('@/lib/env', () => ({ sentryDsn: () => undefined }));

const DSN = 'https://k@o1.ingest.de.sentry.io/2';

async function loadClient(env: Record<string, string>) {
  vi.resetModules();
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  return import('@/lib/observability/client');
}

afterEach(() => {
  vi.unstubAllEnvs();
  sdk.captureException.mockClear();
});

describe('the browser SDK options (AC-2 to AC-4)', () => {
  it('sends through our own tunnel, with no PII, no trace header and the right sample rates', async () => {
    const { clientOptions } = await loadClient({
      NEXT_PUBLIC_SENTRY_DSN: DSN,
      NEXT_PUBLIC_APP_ENV: 'production',
    });
    const options = clientOptions() as Record<string, unknown>;
    expect(options).toMatchObject({
      dsn: DSN,
      environment: 'production',
      tunnel: '/api/e',
      sendDefaultPii: false,
      tracesSampleRate: 0.1,
      tracePropagationTargets: [],
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 1,
    });
    expect(options).not.toHaveProperty('dataCollection');
  });

  it('runs every hook through the scrubber, the standalone span hook included', async () => {
    const { clientOptions } = await loadClient({ NEXT_PUBLIC_SENTRY_DSN: DSN });
    const options = clientOptions() as Record<string, (value: object) => unknown>;
    const event = { message: 'mail ali@example.com', user: { id: 'u1' } };
    expect(options.beforeSend?.(event)).toEqual({ message: 'mail [email]' });
    expect(options.beforeSendTransaction?.({ type: 'transaction', transaction: '/tr?token=1' })).toEqual({
      type: 'transaction',
      transaction: '/tr',
    });
    expect(options.beforeBreadcrumb?.({ category: 'console', message: 'ali@example.com' })).toEqual({
      category: 'console',
      message: '[email]',
    });
    expect(
      options.beforeSendSpan?.({
        span_id: 's',
        op: 'ui.interaction.click',
        description: 'button[title="Ali"]',
      }),
    ).toMatchObject({ description: 'button' });
  });

  it('masks text, inputs, media and the attributes that can carry personal data, and stores nothing', async () => {
    const { REPLAY_OPTIONS } = await loadClient({ NEXT_PUBLIC_SENTRY_DSN: DSN });
    expect(REPLAY_OPTIONS).toMatchObject({
      maskAllText: true,
      maskAllInputs: true,
      blockAllMedia: true,
      stickySession: false,
      networkDetailAllowUrls: [],
    });
    expect(REPLAY_OPTIONS.maskAttributes).toEqual(
      expect.arrayContaining(['title', 'placeholder', 'aria-label', 'href', 'src', 'value', 'alt']),
    );
  });
});

describe('reportClientError: the boundaries report each error once (AC-17)', () => {
  it('reports an error rendered in the browser, or anything thrown that is not an Error', async () => {
    const { reportClientError } = await loadClient({ NEXT_PUBLIC_SENTRY_DSN: DSN });
    reportClientError(new Error('client'));
    reportClientError('a string');
    reportClientError({ digest: '' });
    expect(sdk.captureException).toHaveBeenCalledTimes(3);
  });

  it('leaves an error with a digest alone: the server reported it already', async () => {
    const { reportClientError } = await loadClient({ NEXT_PUBLIC_SENTRY_DSN: DSN });
    reportClientError(Object.assign(new Error('server'), { digest: '123' }));
    expect(sdk.captureException).not.toHaveBeenCalled();
  });

  it('never throws, even when the SDK does', async () => {
    const { reportClientError } = await loadClient({ NEXT_PUBLIC_SENTRY_DSN: DSN });
    sdk.captureException.mockImplementationOnce(() => {
      throw new Error('transport down');
    });
    expect(() => reportClientError(new Error('x'))).not.toThrow();
  });
});

describe('the server SDK options (AC-1, AC-3, AC-5)', () => {
  async function serverOptions(env: Record<string, string> = {}) {
    vi.resetModules();
    vi.unstubAllEnvs();
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
    return (await import('@/lib/observability/server')).serverOptions(DSN) as Record<string, unknown>;
  }

  it('sends no PII, no local variables, no trace header, and turns Sentry Logs on', async () => {
    expect(await serverOptions()).toMatchObject({
      dsn: DSN,
      sendDefaultPii: false,
      includeLocalVariables: false,
      tracePropagationTargets: [],
      enableLogs: true,
    });
  });

  it('samples at our own rate whatever an incoming trace header asks', async () => {
    const sampler = (await serverOptions({ VERCEL_ENV: 'production' })).tracesSampler as (
      context: object,
    ) => number;
    expect(sampler({ name: 'GET /tr', parentSampled: true })).toBe(0.1);
    expect(sampler({ name: 'GET /tr', parentSampled: false })).toBe(0.1);
    const local = (await serverOptions()).tracesSampler as (context: object) => number;
    expect(local({ name: 'GET /tr', parentSampled: true })).toBe(0);
  });

  it('scrubs logs and standalone spans, and gives the telemetry paths no span', async () => {
    const options = await serverOptions();
    const beforeSendLog = options.beforeSendLog as (log: object) => unknown;
    expect(beforeSendLog({ message: 'ali@example.com', attributes: {} })).toEqual({
      message: '[email]',
      attributes: {},
    });
    const beforeSendSpan = options.beforeSendSpan as (span: object) => unknown;
    expect(beforeSendSpan({ span_id: 's', description: 'GET /tr?code=1' })).toEqual({
      span_id: 's',
      description: 'GET /tr',
    });
    const ignored = options.ignoreSpans as RegExp[];
    expect(ignored.some((pattern) => pattern.test('POST /api/csp'))).toBe(true);
  });
});
