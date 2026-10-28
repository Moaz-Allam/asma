import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  ALLOWED_REQUEST_HEADERS,
  FILTERED,
  isPersonalKey,
  redactMessage,
  scrubBreadcrumb,
  scrubEvent,
  scrubLog,
  scrubRecordingEvent,
  scrubUrl,
} from '@/lib/observability/scrub';

/**
 * Spec 0004 AC-3 and the key invariants: personal data never leaves. Tests first, property based.
 * The scrubber walks user data fields only (extra, request, breadcrumb data, log attributes, span
 * attributes, user defined contexts, replay URLs), never SDK owned ones, and a failure drops the event.
 * Recorded payloads from the real SDK join these in the e2e suite (browser) and the verification preview.
 */

// ── generators: realistic personal data, and the ids that must survive ─────────────────────────
const lower = fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split(''));
const digit = fc.constantFrom(...'0123456789'.split(''));
const word = (min: number, max: number) =>
  fc.array(lower, { minLength: min, maxLength: max }).map((chars) => chars.join(''));
const digits = (n: number) => fc.array(digit, { minLength: n, maxLength: n }).map((d) => d.join(''));

const email = fc
  .tuple(word(1, 12), fc.constantFrom('', '.', '+', '_', '-'), word(0, 6), word(2, 10), word(2, 6))
  .map(([a, sep, b, domain, tld]) => `${a}${b ? sep + b : ''}@${domain}.${tld}`);

const phone = fc.oneof(
  fc
    .tuple(digits(3), digits(3), digits(2), digits(2))
    .map(([a, b, c, d]) => `+90 5${a.slice(1)} ${b} ${c} ${d}`),
  digits(9).map((d) => `05${d}`),
  fc.tuple(digits(3), digits(3), digits(4)).map(([a, b, c]) => `(${a}) ${b}-${c}`),
  fc.tuple(digits(2), digits(3), digits(4)).map(([a, b, c]) => `+966 ${a} ${b} ${c}`),
);

const ipv4 = fc.ipV4();
// Every generated IPv6 address carries at least one hex digit (the bare `::` holds no address).
const ipv6 = fc.ipV6().filter((ip) => /[0-9a-f]/i.test(ip));

const hex = (n: number) =>
  fc
    .array(fc.constantFrom(...'0123456789abcdef'.split('')), { minLength: n, maxLength: n })
    .map((h) => h.join(''))
    // A real id with no letter at all is astronomically rare, and is indistinguishable from a long number.
    .filter((h) => /[a-f]/.test(h));
const traceId = hex(32);
const sha = hex(40);
const uuid = fc.uuid().filter((u) => /[a-f]/.test(u));

// ── the key rule ─────────────────────────────────────────────────────────────────────────────
describe('isPersonalKey: the keys whose values never leave', () => {
  it.each([
    'name',
    'first_name',
    'Full-Name',
    'EMAIL',
    'phone_number',
    'address',
    'postal_code',
    'lat',
    'Longitude',
    'iban',
    'card_number',
    'password',
    'otp',
    'jwt',
    'Authorization',
    'cookie',
    'note',
    'description',
    'message',
    'body',
    'tckn',
    'national-id',
    'date_of_birth',
    'customer_email',
    'contact-phone',
    'billing_address',
    'refresh_token',
    'client_secret',
    'api_key',
    'db_password',
  ])('%s is personal', (key) => {
    expect(isPersonalKey(key)).toBe(true);
  });

  it.each([
    'id',
    'status',
    'region',
    'request_id',
    'user_id',
    'correlation_id',
    'event',
    'locale',
    'count',
    'tokens',
  ])('%s is not', (key) => {
    expect(isPersonalKey(key)).toBe(false);
  });
});

// ── URLs ─────────────────────────────────────────────────────────────────────────────────────
describe('scrubUrl: sensitive parameters and every fragment go', () => {
  it('drops the listed parameters, in any case and with - or _', () => {
    expect(
      scrubUrl(
        'https://x.test/tr/a?token=abc&Access-Token=1&refresh_token=2&token_hash=3&code=4&email=5&phone=6&q=7&ref=8&customer=9&page=2',
      ),
    ).toBe('https://x.test/tr/a?page=2');
  });

  it('drops a parameter named like a personal key, and one whose value holds an email or phone', () => {
    expect(scrubUrl('/en/x?name=Ali&city=Izmir&utm_source=mail&c=ali%40x.com&p=%2B905551234567')).toBe(
      '/en/x?utm_source=mail',
    );
  });

  it('drops every fragment, including access tokens in it', () => {
    expect(scrubUrl('https://x.test/auth/callback#access_token=abc&type=recovery')).toBe(
      'https://x.test/auth/callback',
    );
    expect(scrubUrl('/ar#section')).toBe('/ar');
  });

  it('keeps the host as it is, even an IP address: it is the server, not a person', () => {
    expect(scrubUrl('http://127.0.0.1:3100/en?token=1#x')).toBe('http://127.0.0.1:3100/en');
    expect(new URL(scrubUrl('http://127.0.0.1:3100/en')).pathname).toBe('/en');
    expect(scrubUrl('http://[::1]:3000/tr')).toBe('http://[::1]:3000/tr');
  });

  it('drops credentials in the URL, and still redacts an IP in the path', () => {
    expect(scrubUrl('https://ali%40example.com:secret@x.test/a')).toBe('https://x.test/a');
    expect(scrubUrl('https://x.test/u/85.105.1.2')).toBe('https://x.test/u/[ip]');
  });

  it('redacts an email in the path', () => {
    expect(scrubUrl('/en/u/ali@example.com?x=1')).toBe('/en/u/[email]?x=1');
  });

  it('keeps a clean URL unchanged', () => {
    expect(scrubUrl('https://x.test/tr/requests/3f1c2a9e-1b2c-4d5e-8f90-a1b2c3d4e5f6?page=2')).toBe(
      'https://x.test/tr/requests/3f1c2a9e-1b2c-4d5e-8f90-a1b2c3d4e5f6?page=2',
    );
  });

  it('property: no sensitive parameter value survives', () => {
    const param = fc.constantFrom('token', 'access_token', 'code', 'email', 'phone', 'q', 'ref', 'customer');
    fc.assert(
      fc.property(param, word(6, 12), fc.boolean(), (name, secret, fragment) => {
        const url = `https://x.test/en/p?keep=1&${name}=${secret}${fragment ? `#${secret}` : ''}`;
        const out = scrubUrl(url);
        expect(out).not.toContain(secret);
        expect(out).toContain('keep=1');
      }),
    );
  });
});

// ── free text ────────────────────────────────────────────────────────────────────────────────
describe('redactMessage: emails, IPs and phones in message like text', () => {
  it('property: no seeded email, IP or phone survives', () => {
    fc.assert(
      fc.property(fc.oneof(email, phone, ipv4, ipv6), word(0, 8), word(0, 8), (pii, before, after) => {
        const out = redactMessage(`${before} ${pii} ${after}`);
        expect(out).not.toContain(pii);
      }),
    );
  });

  it('property: trace ids, uuids and commit SHAs survive', () => {
    fc.assert(
      fc.property(traceId, uuid, sha, (t, u, s) => {
        const text = `failed trace=${t} request ${u} release ${s} at 2026-10-28T17:00:00Z, retry in 12:30`;
        const out = redactMessage(text);
        expect(out).toContain(t);
        expect(out).toContain(u);
        expect(out).toContain(s);
        expect(out).toContain('2026-10-28T17:00:00Z');
        expect(out).toContain('12:30');
      }),
    );
  });

  it.each([
    ['contact ali.veli+x@example.com.tr now', 'contact [email] now'],
    ['from 192.168.1.20 and 2001:db8::8a2e:370:7334', 'from [ip] and [ip]'],
    ['call +90 555 123 45 67 or (555) 123-4567', 'call [phone] or (555) [phone]'],
    ['status 404 after 3 tries, v10.75.2', 'status 404 after 3 tries, v10.75.2'],
  ])('%s', (input, expected) => {
    expect(redactMessage(input)).toBe(expected);
  });
});

// ── whole events ─────────────────────────────────────────────────────────────────────────────
const TRACE = 'a3f9c2b1d4e5f60718293a4b5c6d7e8f';
const SHA = '0123456789abcdef0123456789abcdef01234567';

function errorEvent() {
  return {
    event_id: '9f8e7d6c5b4a39281706f5e4d3c2b1a0',
    timestamp: 1730134800.123,
    platform: 'javascript',
    level: 'error',
    environment: 'preview',
    release: SHA,
    sdk: { name: 'sentry.javascript.nextjs', version: '10.75.2' },
    tags: { runtime: 'node', alert: 'flag_read_failed' },
    fingerprint: ['alert', 'flag_read_failed', 'TR:funding_enabled'],
    user: { id: 'u1', email: 'ali@example.com', ip_address: '85.105.1.2' },
    message: 'Booking for ali@example.com failed from 85.105.1.2',
    exception: {
      values: [
        {
          type: 'Error',
          value: 'Could not reach +90 555 123 45 67 (trace a3f9c2b1d4e5f60718293a4b5c6d7e8f)',
          stacktrace: { frames: [{ filename: 'app:///lib/x.ts', lineno: 3, vars: { password: 'hunter2' } }] },
        },
      ],
    },
    request: {
      url: 'https://aldebyani.test/tr/auth/callback?code=abc123&page=2#access_token=zzz',
      method: 'GET',
      query_string: 'code=abc123&page=2',
      headers: {
        'User-Agent': 'Mozilla/5.0 Chrome/120.0.0.0',
        Cookie: 'sb-access-token=secret',
        Authorization: 'Bearer secret',
        'X-Forwarded-For': '85.105.1.2',
        'x-real-ip': '85.105.1.2',
        'x-vercel-ip-city': 'Izmir',
        'x-vercel-ip-latitude': '38.4',
        Referer: 'https://aldebyani.test/tr?email=ali%40example.com',
        'accept-language': 'tr-TR',
      },
      cookies: { 'sb-access-token': 'secret' },
      data: { phone: '+905551234567', note: 'gate code 1234' },
      env: { REMOTE_ADDR: '85.105.1.2' },
    },
    extra: {
      request_id: '3f1c2a9e-1b2c-4d5e-8f90-a1b2c3d4e5f6',
      customer: { name: 'Ali Veli', address: 'Alsancak', nested: { email: 'x@y.co' } },
      callback: 'https://aldebyani.test/tr?token=t0k',
      peer: '85.105.1.2',
      comment_text: 'write to ali@example.com',
    },
    contexts: {
      trace: {
        trace_id: TRACE,
        span_id: 'b1c2d3e4f5a6b7c8',
        data: { 'url.full': 'https://x.test/a?token=1', 'client.address': '85.105.1.2' },
      },
      os: { name: 'Windows' },
      browser: { name: 'Chrome', version: '120.0.0.0' },
      booking: { address: 'Kordon 5', status: 'open' },
    },
    breadcrumbs: [
      { category: 'navigation', data: { from: '/tr?token=a', to: '/tr/x#frag' } },
      { category: 'fetch', data: { url: '/api/x?email=ali%40example.com', method: 'GET', status_code: 200 } },
      {
        category: 'console',
        message: 'saw ali@example.com',
        data: { arguments: ['user', { phone: '+905551234567' }, '85.105.1.2'] },
      },
      { category: 'ui.click', message: 'button[aria-label="Call 0555 123 45 67"]' },
    ],
  };
}

describe('scrubEvent: an error event', () => {
  const out = scrubEvent(errorEvent());
  if (out === null) throw new Error('scrubEvent dropped a well formed event');
  const json = JSON.stringify(out);

  it('leaves no personal value anywhere', () => {
    for (const pii of [
      'ali@example.com',
      'ali%40example.com',
      '85.105.1.2',
      '+90 555 123 45 67',
      '+905551234567',
      'Izmir',
      'Ali Veli',
      'Alsancak',
      'Kordon 5',
      'hunter2',
      'secret',
      'abc123',
      'zzz',
      't0k',
      '0555 123 45 67',
      'gate code',
    ]) {
      expect(json, pii).not.toContain(pii);
    }
  });

  it('never sets user', () => {
    expect(out).not.toHaveProperty('user');
  });

  it('keeps only allow listed request headers', () => {
    const names = Object.keys(out.request?.headers ?? {}).map((h) => h.toLowerCase());
    expect(names.sort()).toEqual(['accept-language', 'referer', 'user-agent']);
    for (const name of names) expect(ALLOWED_REQUEST_HEADERS).toContain(name);
    expect(out.request).not.toHaveProperty('cookies');
    expect(out.request).not.toHaveProperty('data');
    expect(out.request).not.toHaveProperty('env');
    expect(out.request?.url).toBe('https://aldebyani.test/tr/auth/callback?page=2');
    expect(out.request?.query_string).toBe('page=2');
  });

  it('keeps SDK owned fields and the ids exactly', () => {
    const original = errorEvent();
    expect(out.event_id).toBe(original.event_id);
    expect(out.release).toBe(SHA);
    expect(out.environment).toBe('preview');
    expect(out.sdk).toEqual(original.sdk);
    expect(out.tags).toEqual(original.tags);
    expect(out.fingerprint).toEqual(original.fingerprint);
    expect(out.contexts?.trace?.trace_id).toBe(TRACE);
    expect(out.contexts?.os).toEqual(original.contexts.os);
    expect(out.contexts?.browser).toEqual(original.contexts.browser);
    expect(out.extra?.request_id).toBe(original.extra.request_id);
    expect(out.exception?.values?.[0]?.value).toContain(TRACE);
  });

  it('filters personal keys, keeping the key visible', () => {
    expect(out.contexts?.booking).toEqual({ address: FILTERED, status: 'open' });
    expect(out.extra?.customer).toEqual({ name: FILTERED, address: FILTERED, nested: { email: FILTERED } });
  });
});

describe('scrubEvent: a transaction', () => {
  it('scrubs span attributes and descriptions, leaving span ids alone', () => {
    const out = scrubEvent({
      type: 'transaction',
      transaction: '/tr/[id]',
      contexts: { trace: { trace_id: TRACE, span_id: 'b1c2d3e4f5a6b7c8' } },
      spans: [
        {
          span_id: 'c1c2d3e4f5a6b7c8',
          trace_id: TRACE,
          description: 'GET https://eu.i.posthog.com/e?token=t0k',
          data: {
            'http.url': 'https://x.test/a?code=c0d',
            'sentry.op': 'http.client',
            'client.address': '85.105.1.2',
          },
        },
      ],
    });
    const json = JSON.stringify(out);
    for (const pii of ['t0k', 'c0d', '85.105.1.2']) expect(json).not.toContain(pii);
    expect(json).toContain('c1c2d3e4f5a6b7c8');
    expect(json).toContain('"sentry.op":"http.client"');
  });

  it('scrubs the URLs of a replay event', () => {
    const out = scrubEvent({
      type: 'replay_event',
      urls: ['https://x.test/tr?token=a#b', '/en/u/ali@example.com'],
    });
    expect(out?.urls).toEqual(['https://x.test/tr', '/en/u/[email]']);
  });
});

describe('the scrubber fails closed', () => {
  it('drops an event it cannot read', () => {
    const hostile = {
      get extra(): unknown {
        throw new Error('boom');
      },
    };
    expect(scrubEvent(hostile)).toBeNull();
  });

  it('property: never leaks a seeded value from random nested extra data', () => {
    const personalKey = fc.constantFrom(
      'email',
      'phone',
      'address',
      'name',
      'iban',
      'password',
      'note',
      'customer_email',
    );
    const safeKey = word(3, 8).filter((k) => !isPersonalKey(k));
    fc.assert(
      fc.property(
        personalKey,
        safeKey,
        safeKey,
        word(8, 14),
        fc.oneof(email, phone, ipv4),
        (pk, k1, k2, secret, inText) => {
          const event = { extra: { [k1]: { [k2]: { [pk]: secret }, text: `see ${inText} now` } } };
          const json = JSON.stringify(scrubEvent(event));
          expect(json).not.toContain(secret);
          // IPs and emails are redacted in every user data string; phones only in message like fields.
          if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(inText)) expect(json).not.toContain(inText);
          if (inText.includes('@')) expect(json).not.toContain(inText);
        },
      ),
    );
  });
});

describe('breadcrumbs, logs and replay recordings', () => {
  it('scrubs a breadcrumb at capture time', () => {
    const out = scrubBreadcrumb({
      category: 'fetch',
      message: 'to ali@example.com',
      data: { url: '/x?token=1' },
    });
    expect(out).toEqual({ category: 'fetch', message: 'to [email]', data: { url: '/x' } });
  });

  it('scrubs a log record, keeping the SDK attributes and the allowed ids', () => {
    const out = scrubLog({
      level: 'error',
      message: 'flag read failed for ali@example.com',
      attributes: {
        event: 'flag_read_failed',
        correlation_id: TRACE,
        region: 'TR',
        user_id: '3f1c2a9e-1b2c-4d5e-8f90-a1b2c3d4e5f6',
        email: 'ali@example.com',
        'sentry.release': SHA,
        'sentry.message.parameter.0': '+905551234567',
      },
    });
    expect(out?.message).toBe('flag read failed for [email]');
    expect(out?.attributes).toEqual({
      event: 'flag_read_failed',
      correlation_id: TRACE,
      region: 'TR',
      user_id: '3f1c2a9e-1b2c-4d5e-8f90-a1b2c3d4e5f6',
      email: FILTERED,
      'sentry.release': SHA,
      'sentry.message.parameter.0': '[phone]',
    });
  });

  it('scrubs the page URL in a replay meta event and a breadcrumb inside the recording', () => {
    expect(
      scrubRecordingEvent({ type: 4, data: { href: 'https://x.test/tr?token=1#a', width: 390 } }),
    ).toEqual({
      type: 4,
      data: { href: 'https://x.test/tr', width: 390 },
    });
    expect(
      scrubRecordingEvent({
        type: 5,
        data: { tag: 'breadcrumb', payload: { category: 'console', message: 'ali@example.com' } },
      }),
    ).toEqual({ type: 5, data: { tag: 'breadcrumb', payload: { category: 'console', message: '[email]' } } });
  });
});
