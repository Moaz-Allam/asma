import { gzipSync } from 'node:zlib';

import { describe, expect, it, vi } from 'vitest';

import { CAPTURE_LIMIT_BYTES, createPostHogForwarder } from '@/lib/analytics/forward';
import { readCapped } from '@/lib/http/body';
import {
  CSP_REPORT_LIMIT_BYTES,
  ENVELOPE_LIMIT_BYTES,
  createCspReportForwarder,
  createEnvelopeForwarder,
} from '@/lib/observability/forward';

/**
 * D83 (after the 00b reviews): the telemetry paths are our own Route Handlers, not rewrites. Each one
 * forwards only to a fixed EU destination, only for our own DSN or project key, and never forwards a
 * visitor's cookie, referer, authorization or IP. Tests first; fetch is injected and recorded.
 */

const DSN = 'https://e2e0000000000000000000000000000@o4507000000000000.ingest.de.sentry.io/4507000000000001';
const OTHER_DSN =
  'https://other00000000000000000000000000@o4507000000000000.ingest.de.sentry.io/4507000000000002';
const KEY = 'phc_aaaaaaaaaaaa';

/** The headers a real browser request carries, none of which may reach a vendor. */
const VISITOR_HEADERS = {
  cookie: 'NEXT_LOCALE=tr; _vercel_jwt=secret; sb-ref-auth-token=secret',
  referer: 'https://aldebyani.test/tr?token=secret&email=ali%40example.com',
  authorization: 'Bearer secret',
  'x-forwarded-for': '85.105.1.2',
  'x-real-ip': '85.105.1.2',
  'x-vercel-ip-city': 'Izmir',
};
const LEAKY = ['secret', '85.105.1.2', 'Izmir', 'ali%40example.com'];

type Sent = { url: string; init: RequestInit };

function recorder(response: () => Response = () => new Response('{"id":"1"}', { status: 200 })) {
  const sent: Sent[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), init: init ?? {} });
    return response();
  });
  return { sent, fetch: fetch as unknown as typeof globalThis.fetch };
}

function headersOf(sent: Sent): Record<string, string> {
  return Object.fromEntries(new Headers(sent.init.headers).entries());
}

function envelope(dsn: string | undefined, item = '{"type":"event"}\n{"message":"x"}'): string {
  return `${JSON.stringify(dsn === undefined ? { event_id: 'e1' } : { event_id: 'e1', dsn })}\n${item}`;
}

function post(url: string, body: BodyInit, headers: Record<string, string> = {}): Request {
  return new Request(url, { method: 'POST', body, headers: { ...VISITOR_HEADERS, ...headers } });
}

describe('readCapped: a body is read up to its limit, never further', () => {
  it('returns the bytes under the limit and null over it, declared or streamed', async () => {
    expect(
      new TextDecoder().decode((await readCapped(post('https://x.test/a', 'hello'), 5)) ?? undefined),
    ).toBe('hello');
    expect(await readCapped(post('https://x.test/a', 'hello!'), 5)).toBeNull();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 10; i += 1) controller.enqueue(new Uint8Array(1024));
        controller.close();
      },
    });
    const streamed = new Request('https://x.test/a', {
      method: 'POST',
      body: stream,
      duplex: 'half',
    } as RequestInit);
    expect(await readCapped(streamed, 4096)).toBeNull();
  });
});

describe('POST /api/e: the Sentry tunnel', () => {
  it('forwards an envelope for our DSN to its fixed EU ingest URL, with the content type only', async () => {
    const { sent, fetch } = recorder();
    const relay = createEnvelopeForwarder({ dsn: () => DSN, fetch });
    const response = await relay(post('https://aldebyani.test/api/e', envelope(DSN)));

    expect(response.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe('https://o4507000000000000.ingest.de.sentry.io/api/4507000000000001/envelope/');
    expect(headersOf(sent[0] as Sent)).toEqual({ 'content-type': 'application/x-sentry-envelope' });
    expect(new TextDecoder().decode(sent[0]?.init.body as Uint8Array)).toBe(envelope(DSN));
    for (const value of LEAKY) expect(JSON.stringify(headersOf(sent[0] as Sent))).not.toContain(value);
  });

  it('relays the rate limit headers the SDK backs off on, and nothing else', async () => {
    const { fetch } = recorder(
      () =>
        new Response('{}', {
          status: 429,
          headers: {
            'retry-after': '60',
            'x-sentry-rate-limits': '60:error',
            'set-cookie': 'a=b',
            'x-other': '1',
          },
        }),
    );
    const response = await createEnvelopeForwarder({ dsn: () => DSN, fetch })(
      post('https://aldebyani.test/api/e', envelope(DSN)),
    );
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(response.headers.get('x-sentry-rate-limits')).toBe('60:error');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('x-other')).toBeNull();
  });

  it.each([
    ['another project', envelope(OTHER_DSN)],
    ['a US DSN', envelope('https://key@o1.ingest.us.sentry.io/2')],
    ['no DSN in its header', envelope(undefined)],
    ['a header that is not JSON', 'not json\n{}'],
  ])('refuses an envelope for %s without calling out', async (_name, body) => {
    const { sent, fetch } = recorder();
    const response = await createEnvelopeForwarder({ dsn: () => DSN, fetch })(
      post('https://aldebyani.test/api/e', body),
    );
    expect(response.status).toBe(403);
    expect(sent).toHaveLength(0);
  });

  it('refuses an envelope over the limit, and answers 404 without a DSN of its own', async () => {
    const { sent, fetch } = recorder();
    const big = `${envelope(DSN)}${'x'.repeat(ENVELOPE_LIMIT_BYTES)}`;
    expect(
      (await createEnvelopeForwarder({ dsn: () => DSN, fetch })(post('https://x.test/api/e', big))).status,
    ).toBe(413);
    expect(
      (
        await createEnvelopeForwarder({ dsn: () => undefined, fetch })(
          post('https://x.test/api/e', envelope(DSN)),
        )
      ).status,
    ).toBe(404);
    expect(sent).toHaveLength(0);
  });

  it('answers 502, never throws, when Sentry cannot be reached', async () => {
    const fetch = vi.fn(async () =>
      Promise.reject(new Error('network')),
    ) as unknown as typeof globalThis.fetch;
    const response = await createEnvelopeForwarder({ dsn: () => DSN, fetch })(
      post('https://x.test/api/e', envelope(DSN)),
    );
    expect(response.status).toBe(502);
  });
});

describe('POST /api/csp: violation reports, scrubbed', () => {
  const relay = (fetch: typeof globalThis.fetch, dsn: string | null = DSN) =>
    createCspReportForwarder({
      dsn: () => dsn ?? undefined,
      environment: () => 'preview',
      release: () => 'abc',
      fetch,
    });

  it('scrubs a report-uri report and sends it to our security endpoint, with the user agent only', async () => {
    const { sent, fetch } = recorder();
    const report = {
      'csp-report': {
        'document-uri':
          'https://aldebyani.test/tr/auth/callback?code=secret&email=ali%40example.com#access_token=secret',
        referrer: 'https://aldebyani.test/tr?token=secret',
        'blocked-uri': 'inline',
        'violated-directive': 'script-src-elem',
        'source-file': 'https://aldebyani.test/tr?token=secret',
        'script-sample': 'alert("ali@example.com")',
        'status-code': 200,
      },
    };
    const response = await relay(fetch)(
      post('https://aldebyani.test/api/csp', JSON.stringify(report), {
        'content-type': 'application/csp-report',
        'user-agent': 'Mozilla/5.0',
      }),
    );

    expect(response.status).toBe(204);
    const target = new URL(sent[0]?.url ?? '');
    expect(`${target.origin}${target.pathname}`).toBe(
      'https://o4507000000000000.ingest.de.sentry.io/api/4507000000000001/security/',
    );
    expect(Object.fromEntries(target.searchParams)).toEqual({
      sentry_key: 'e2e0000000000000000000000000000',
      sentry_environment: 'preview',
      sentry_release: 'abc',
    });
    expect(headersOf(sent[0] as Sent)).toEqual({
      'content-type': 'application/csp-report',
      'user-agent': 'Mozilla/5.0',
    });
    expect(JSON.parse(String(sent[0]?.init.body))).toEqual({
      'csp-report': {
        'document-uri': 'https://aldebyani.test/tr/auth/callback',
        referrer: 'https://aldebyani.test/tr',
        'blocked-uri': 'inline',
        'violated-directive': 'script-src-elem',
        'source-file': 'https://aldebyani.test/tr',
        'script-sample': 'alert("[email]")',
        'status-code': 200,
      },
    });
  });

  it('scrubs a Reporting API batch the same way', async () => {
    const { sent, fetch } = recorder();
    const reports = [
      {
        type: 'csp-violation',
        url: 'https://aldebyani.test/en?email=ali%40example.com',
        body: {
          documentURL: 'https://aldebyani.test/en?email=ali%40example.com',
          blockedURL: 'chrome-extension://abc/inject.js',
          effectiveDirective: 'script-src-elem',
        },
      },
    ];
    await relay(fetch)(
      post('https://aldebyani.test/api/csp', JSON.stringify(reports), {
        'content-type': 'application/reports+json',
      }),
    );
    expect(JSON.parse(String(sent[0]?.init.body))).toEqual([
      {
        type: 'csp-violation',
        url: 'https://aldebyani.test/en',
        body: {
          documentURL: 'https://aldebyani.test/en',
          blockedURL: 'chrome-extension://abc/inject.js',
          effectiveDirective: 'script-src-elem',
        },
      },
    ]);
  });

  it.each([
    ['another content type', 'text/plain', '{}', 415],
    ['a body that is not JSON', 'application/csp-report', 'nope', 400],
    ['a body over the limit', 'application/csp-report', `{"a":"${'x'.repeat(CSP_REPORT_LIMIT_BYTES)}"}`, 413],
  ])('refuses %s without calling out', async (_name, contentType, body, status) => {
    const { sent, fetch } = recorder();
    const response = await relay(fetch)(
      post('https://x.test/api/csp', body, { 'content-type': contentType }),
    );
    expect(response.status).toBe(status);
    expect(sent).toHaveLength(0);
  });

  it('accepts and drops a report when there is no DSN', async () => {
    const { sent, fetch } = recorder();
    const response = await relay(
      fetch,
      null,
    )(post('https://x.test/api/csp', '{}', { 'content-type': 'application/csp-report' }));
    expect(response.status).toBe(204);
    expect(sent).toHaveLength(0);
  });
});

describe('POST /api/a/*: the PostHog relay', () => {
  const event = (token: string) => ({
    event: '$pageview',
    properties: { token, $current_url: 'https://x.test/tr' },
  });
  const gzip = (payload: unknown) => gzipSync(Buffer.from(JSON.stringify(payload)));

  it('forwards a gzip capture call for our key to EU Cloud, with the content type only', async () => {
    const { sent, fetch } = recorder(() => new Response('{"status":1}', { status: 200 }));
    const relay = createPostHogForwarder({ key: () => KEY, fetch });
    const body = gzip([event(KEY), event(KEY)]);
    const response = await relay(
      post('https://aldebyani.test/api/a/e/?ip=1&_=1730&ver=1.418.11&compression=gzip-js&extra=x', body, {
        'content-type': 'text/plain',
      }),
      ['e', ''],
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"status":1}');
    expect(sent[0]?.url).toBe('https://eu.i.posthog.com/e/?compression=gzip-js&ver=1.418.11&_=1730');
    expect(headersOf(sent[0] as Sent)).toEqual({ 'content-type': 'text/plain' });
    expect(Buffer.from(sent[0]?.init.body as Uint8Array).equals(body)).toBe(true);
  });

  it('accepts a plain JSON batch naming our key', async () => {
    const { sent, fetch } = recorder();
    const response = await createPostHogForwarder({ key: () => KEY, fetch })(
      post('https://x.test/api/a/batch/', JSON.stringify({ api_key: KEY, batch: [event(KEY)] }), {
        'content-type': 'application/json',
      }),
      ['batch'],
    );
    expect(response.status).toBe(200);
    expect(sent).toHaveLength(1);
  });

  it.each([
    ['another project key', gzip([event('phc_bbbbbbbbbbbb')])],
    ['a mix of keys', gzip([event(KEY), event('phc_bbbbbbbbbbbb')])],
    ['no key at all', gzip([{ event: '$pageview', properties: {} }])],
  ])('refuses a call naming %s without calling out', async (_name, body) => {
    const { sent, fetch } = recorder();
    const response = await createPostHogForwarder({ key: () => KEY, fetch })(
      post('https://x.test/api/a/e/?compression=gzip-js', body),
      ['e'],
    );
    expect(response.status).toBe(403);
    expect(sent).toHaveLength(0);
  });

  it.each([
    [['array', 'phc_x', 'config.js']],
    [['static', 'recorder.js']],
    [['flags']],
    [['decide']],
    [['api', 'surveys']],
    [[]],
  ])('answers 404 for any other path: %j', async (path) => {
    const { sent, fetch } = recorder();
    const response = await createPostHogForwarder({ key: () => KEY, fetch })(
      post('https://x.test/api/a/x', gzip([event(KEY)])),
      path,
    );
    expect(response.status).toBe(404);
    expect(sent).toHaveLength(0);
  });

  it('refuses a body over the limit, a gzip bomb and a body it cannot read', async () => {
    const { sent, fetch } = recorder();
    const relay = createPostHogForwarder({ key: () => KEY, fetch });
    const big = new Uint8Array(CAPTURE_LIMIT_BYTES + 1);
    expect((await relay(post('https://x.test/api/a/e/', big), ['e'])).status).toBe(413);
    const bomb = gzipSync(Buffer.alloc(20 * 1024 * 1024, 0x20));
    expect(bomb.byteLength).toBeLessThan(CAPTURE_LIMIT_BYTES);
    expect((await relay(post('https://x.test/api/a/e/?compression=gzip-js', bomb), ['e'])).status).toBe(400);
    expect((await relay(post('https://x.test/api/a/e/?compression=gzip-js', 'not gzip'), ['e'])).status).toBe(
      400,
    );
    expect(sent).toHaveLength(0);
  });

  it('answers 404 without a key of its own', async () => {
    const { sent, fetch } = recorder();
    const response = await createPostHogForwarder({ key: () => undefined, fetch })(
      post('https://x.test/api/a/e/', gzip([event(KEY)])),
      ['e'],
    );
    expect(response.status).toBe(404);
    expect(sent).toHaveLength(0);
  });
});
