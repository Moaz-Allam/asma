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
  scrubSpan,
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

const TRACE = 'a3f9c2b1d4e5f60718293a4b5c6d7e8f';
const TRACE_ID = TRACE;

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
    // camelCase and dotted keys fold to the same words (review 2026-10-29).
    'phoneNumber',
    'firstName',
    'fullName',
    'customerPhone',
    'customerEmail',
    'emailAddress',
    'postalCode',
    'nationalId',
    'birthDate',
    'accessToken',
    'apiKey',
    'APIKey',
    'clientSecret',
    'user.name',
    'client.address',
    'details',
    'hint',
    // Spec 0008 AC-18: a request's street line, its notes and the answers a customer typed.
    'line',
    'address_line',
    'addressLine',
    'notes',
    'answers',
    'p_address_line',
    'p_notes',
    'p_answers',
    // Spec 0009 AC-20: the apply message.
    'applicationMessage',
    'application_message',
    'p_message',
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
    'requestId',
    'userId',
    'traceId',
    'statusCode',
    'url.full',
    'http.route',
    'db.collection.name',
  ])('%s is not', (key) => {
    expect(isPersonalKey(key)).toBe(false);
  });
});

// ── URLs ─────────────────────────────────────────────────────────────────────────────────────
describe('scrubUrl: only utm_* and page stay (D85), every fragment goes', () => {
  it('drops the parameters the spec listed, in any case and with - or _', () => {
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

  it('redacts an email in the path, also percent encoded', () => {
    expect(scrubUrl('/en/u/ali@example.com?x=1')).toBe('/en/u/[email]');
    expect(scrubUrl('https://x.test/u/ali%40example.com/edit')).toBe('https://x.test/u/[email]/edit');
  });

  // Spec 0006 AC-24: an object name holds a provider id and a document type; a signed link holds a token.
  it('cuts a Storage URL after its bucket, for every object route', () => {
    const base = 'https://abc.supabase.co/storage/v1/object';
    const name = '6f1c2d3e-0000-4000-8000-000000000001/id_front/9a8b7c6d-0000-4000-8000-000000000002.jpg';
    expect(scrubUrl(`${base}/provider-documents/${name}`)).toBe(`${base}/provider-documents`);
    expect(scrubUrl(`${base}/sign/provider-documents/${name}?token=eyJhbGciOi.x.y`)).toBe(
      `${base}/sign/provider-documents`,
    );
    expect(scrubUrl(`${base}/authenticated/provider-photos/${name}`)).toBe(
      `${base}/authenticated/provider-photos`,
    );
    expect(scrubUrl(`${base}/public/provider-photos/${name}`)).toBe(`${base}/public/provider-photos`);
    expect(scrubUrl(`${base}/upload/sign/provider-documents/${name}?token=1`)).toBe(
      `${base}/upload/sign/provider-documents`,
    );
    expect(scrubUrl(`${base}/info/provider-documents/${name}`)).toBe(`${base}/info/provider-documents`);
    expect(scrubUrl(`${base}/list/provider-documents`)).toBe(`${base}/list/provider-documents`);
    expect(scrubUrl(`${base}/sign/provider-documents`)).toBe(`${base}/sign/provider-documents`);
    expect(scrubUrl(`${base}/move`)).toBe(`${base}/move`);
  });

  it('cuts a local Storage URL too, and one inside a message', () => {
    expect(scrubUrl('http://127.0.0.1:54421/storage/v1/object/provider-photos/u/profile_photo/x.jpg')).toBe(
      'http://127.0.0.1:54421/storage/v1/object/provider-photos',
    );
    expect(
      redactMessage(
        'Failed to load https://abc.supabase.co/storage/v1/object/sign/provider-documents/u/selfie/x.png?token=t',
      ),
    ).toBe('Failed to load https://abc.supabase.co/storage/v1/object/sign/provider-documents');
  });

  it('leaves a page path that only looks like storage alone', () => {
    expect(scrubUrl('/tr/provider/profile/documents')).toBe('/tr/provider/profile/documents');
    expect(scrubUrl('https://x.test/storage/v1/bucket/provider-documents')).toBe(
      'https://x.test/storage/v1/bucket/provider-documents',
    );
  });

  it('drops every parameter that is not allow listed: names nobody thought of are safe too', () => {
    expect(
      scrubUrl(
        '/tr/search?search=ali&query=veli&term=x&code[]=1&ids=1,2&page=3&utm_source=ad&UTM_Medium=cpc',
      ),
    ).toBe('/tr/search?page=3&utm_source=ad&UTM_Medium=cpc');
  });

  it('splits parameters on ; as well as &', () => {
    expect(scrubUrl('/tr?utm_source=x;code=secret;page=2')).toBe('/tr?utm_source=x&page=2');
  });

  it('drops an allowed parameter whose value holds personal data or a URL with a token', () => {
    expect(scrubUrl('/tr?utm_source=ali%40x.com&page=2')).toBe('/tr?page=2');
    expect(scrubUrl('/tr?utm_content=https%3A%2F%2Fx.test%2Fa%3Fcode%3Ds3cr3t')).toBe('/tr');
  });

  it('keeps a clean URL unchanged', () => {
    expect(scrubUrl('https://x.test/tr/requests/3f1c2a9e-1b2c-4d5e-8f90-a1b2c3d4e5f6?page=2')).toBe(
      'https://x.test/tr/requests/3f1c2a9e-1b2c-4d5e-8f90-a1b2c3d4e5f6?page=2',
    );
  });

  it('property: no parameter value survives unless its name is allow listed', () => {
    fc.assert(
      fc.property(word(1, 10), word(6, 12), fc.boolean(), (name, secret, fragment) => {
        fc.pre(name !== 'page' && !name.startsWith('utm_'));
        const url = `https://x.test/en/p?page=1&${name}=${secret}${fragment ? `#${secret}` : ''}`;
        const out = scrubUrl(url);
        expect(out).not.toContain(secret);
        expect(out).toBe('https://x.test/en/p?page=1');
      }),
    );
  });
});

describe('URLs inside text keep no token, code or fragment (review 2026-10-29)', () => {
  it.each([
    [
      'Redirect to https://x.test/auth/callback?code=abc123&access_token=zzz#refresh_token=yyy failed',
      'Redirect to https://x.test/auth/callback failed',
    ],
    [
      'Failed to fetch RSC payload for https://x.test/tr/a?token=t0k&email=ali%40x.com. Falling back',
      'Failed to fetch RSC payload for https://x.test/tr/a Falling back',
    ],
    ['GET /tr/auth/callback?code=SECRET6 took 30ms', 'GET /tr/auth/callback took 30ms'],
    ['see "/tr?token_hash=abc#access_token=z" now', 'see "/tr" now'],
    [
      'kept: https://x.test/tr?page=2 and /tr/x?utm_source=ad',
      'kept: https://x.test/tr?page=2 and /tr/x?utm_source=ad',
    ],
  ])('%s', (input, expected) => {
    expect(redactMessage(input)).toBe(expected);
  });

  it('scrubs a URL in an exception value, a console breadcrumb message and a log message', () => {
    const url = 'https://x.test/auth/confirm?token_hash=abc#access_token=zzz';
    const event = scrubEvent({ exception: { values: [{ type: 'Error', value: `bad ${url}` }] } });
    const crumb = scrubBreadcrumb({
      category: 'console',
      message: `callback ${url}`,
      data: { arguments: ['callback', url] },
    });
    const log = scrubLog({ message: `confirm ${url}`, attributes: {} });
    for (const out of [event, crumb, log]) {
      const json = JSON.stringify(out);
      expect(json).toContain('https://x.test/auth/confirm');
      for (const secret of ['abc', 'zzz', 'token_hash', 'access_token']) expect(json).not.toContain(secret);
    }
  });

  it('scrubs a URL inside a user data string and a relative URL in a span description', () => {
    const out = scrubEvent({
      extra: { note_text: 'came from https://x.test/tr?code=c0d' },
      spans: [{ span_id: 'c1c2d3e4f5a6b7c8', description: 'GET /api/x?email=ali%40x.com&code=c0d' }],
    });
    const json = JSON.stringify(out);
    for (const secret of ['c0d', 'ali%40x.com']) expect(json).not.toContain(secret);
    expect(out?.spans?.[0]?.description).toBe('GET /api/x');
  });

  it('redacts a request action payload at any depth (spec 0008 AC-18)', () => {
    const out = scrubEvent({
      extra: {
        input: {
          serviceId: '0f8fad5b-d9cb-469f-a165-70867728950e',
          addressLine: 'Moda Cad. No 5 Daire 3',
          notes: 'Kapının şifresi 4411',
          answers: { rooms: 3, details: 'Yaşlı annem evde' },
          nested: [{ line: 'Bağdat Cad. 12' }],
        },
      },
    });
    const json = JSON.stringify(out);
    for (const secret of ['Moda Cad', 'Kapının', 'Yaşlı', 'Bağdat']) expect(json).not.toContain(secret);
    expect(json).toContain('0f8fad5b-d9cb-469f-a165-70867728950e');
  });
});

describe('frames, transaction names and fragment attributes', () => {
  it('scrubs a page URL used as the file of a stackless browser error', () => {
    const page = 'https://x.test/tr?code=SECRET1#access_token=SECRET2';
    const out = scrubEvent({
      exception: {
        values: [
          {
            type: 'Error',
            value: 'x',
            stacktrace: {
              frames: [
                { filename: page, abs_path: page, lineno: 1 },
                { filename: 'app:///_next/static/chunks/a.js', abs_path: 'app:///_next/static/chunks/a.js' },
              ],
            },
          },
        ],
      },
    });
    const frames = out?.exception?.values?.[0]?.stacktrace?.frames;
    expect(frames?.[0]).toEqual({ filename: 'https://x.test/tr', abs_path: 'https://x.test/tr', lineno: 1 });
    expect(frames?.[1]?.filename).toBe('app:///_next/static/chunks/a.js');
  });

  it.each([
    ['GET /tr/auth/callback?code=SECRET6', 'GET /tr/auth/callback'],
    ['/tr/x?token=1#y', '/tr/x'],
    ['GET /tr/[id]', 'GET /tr/[id]'],
    ['checkout flow', 'checkout flow'],
  ])('the transaction %s becomes %s', (transaction, expected) => {
    expect(scrubEvent({ type: 'transaction', transaction })?.transaction).toBe(expected);
  });

  it('filters the fragment attributes the SDK records apart from the URL', () => {
    const out = scrubEvent({
      spans: [
        {
          span_id: 'c1c2d3e4f5a6b7c8',
          data: {
            'http.fragment': '#access_token=x',
            'url.fragment': 'refresh_token=y',
            'http.method': 'GET',
          },
        },
      ],
    });
    expect(out?.spans?.[0]?.data).toEqual({
      'http.fragment': FILTERED,
      'url.fragment': FILTERED,
      'http.method': 'GET',
    });
  });

  it('walks the feedback and state contexts as user data', () => {
    const out = scrubEvent({
      contexts: {
        feedback: { contact_email: 'ali@example.com', message: 'call me' },
        state: { phone: '+905551234567' },
      },
    });
    expect(JSON.stringify(out)).not.toMatch(/ali@example\.com|call me|905551234567/);
  });
});

describe('ui breadcrumbs and spans name elements without their attribute values', () => {
  it('drops the attribute values of a ui.click selector', () => {
    expect(
      scrubBreadcrumb({ category: 'ui.click', message: 'body > div.card > button[aria-label="Ali Veli"]' }),
    ).toEqual({ category: 'ui.click', message: 'body > div.card > button' });
  });

  it('scrubs a standalone span sent through beforeSendSpan, such as an INP span', () => {
    const span = {
      span_id: 'c1c2d3e4f5a6b7c8',
      trace_id: TRACE_ID,
      op: 'ui.interaction.click',
      description: 'body > button[title="Ali Veli"][name="phone"]',
      data: {
        'sentry.op': 'ui.interaction.click',
        'http.url': 'https://x.test/a?code=c0d',
        'client.address': '85.105.1.2',
      },
    };
    expect(scrubSpan(span)).toEqual({
      ...span,
      description: 'body > button',
      data: {
        'sentry.op': 'ui.interaction.click',
        'http.url': 'https://x.test/a',
        'client.address': FILTERED,
      },
    });
  });

  it('keeps only the ids of a span it cannot scrub, and never throws', () => {
    const hostile = {
      span_id: 'c1c2d3e4f5a6b7c8',
      get data(): unknown {
        throw new Error('boom');
      },
    };
    expect(() => scrubSpan(hostile)).not.toThrow();
    expect(scrubSpan(hostile)).toMatchObject({
      span_id: 'c1c2d3e4f5a6b7c8',
      description: FILTERED,
      data: {},
    });
  });
});

describe('the walk is bounded: cycles and huge values cost linear time (review 2026-10-29)', () => {
  it('scrubs an object with six self references in well under a second', () => {
    const node: Record<string, unknown> = { email: 'ali@example.com', label: 'x' };
    for (let i = 0; i < 6; i += 1) node[`self${i}`] = node;
    const started = performance.now();
    const out = scrubBreadcrumb({ category: 'console', data: { arguments: [node] } });
    expect(performance.now() - started).toBeLessThan(200);
    expect(JSON.stringify(out)).not.toContain('ali@example.com');
    expect(JSON.stringify(out)).toContain(FILTERED);
  });

  it('caps a very wide object and a very long array', () => {
    const wide = Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`k${i}`, i]));
    const long = Array.from({ length: 5000 }, (_, i) => i);
    const out = scrubEvent({ extra: { wide, long } }) as { extra: { wide: object; long: unknown[] } } | null;
    expect(Object.keys(out?.extra.wide ?? {}).length).toBe(1001);
    expect(out?.extra.long.length).toBe(1001);
    expect(out?.extra.long.at(-1)).toBe(FILTERED);
  });
});

// ── free text ────────────────────────────────────────────────────────────────────────────────
describe('redactMessage: emails, IPs and phones in message like text', () => {
  it('property: a seeded email, IP or phone becomes exactly one marker, with no residue', () => {
    const tagged = fc.oneof(
      email.map((value) => [value, '[email]'] as const),
      phone.map((value) => [value, '[phone]'] as const),
      ipv4.map((value) => [value, '[ip]'] as const),
      ipv6.map((value) => [value, '[ip]'] as const),
    );
    fc.assert(
      fc.property(tagged, word(0, 8), word(0, 8), ([pii, marker], before, after) => {
        expect(redactMessage(`${before} ${pii} ${after}`)).toBe(`${before} ${marker} ${after}`);
      }),
      { numRuns: 500 },
    );
  });

  it.each([
    ['blocked 203.0.113.9.', 'blocked [ip].'],
    ['peer ::ffff:203.0.113.9 left', 'peer [ip] left'],
    ['peer c8:22::c8:67.3.216.85 left', 'peer [ip] left'],
    ['peer d3:a4:d:2c:669:3:48.111.6.224 left', 'peer [ip] left'],
    ['call +90 (555) 123 45 67 now', 'call [phone] now'],
    ['رقمي ٠٥٥٥١٢٣٤٥٦٧ شكرا', 'رقمي [phone] شكرا'],
    ['شماره ۰۵۵۵۱۲۳۴۵۶۷', 'شماره [phone]'],
    ['yaz çağrı@örnek.com.tr bana', 'yaz [email] bana'],
  ])('%s', (input, expected) => {
    expect(redactMessage(input)).toBe(expected);
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
    ['call +90 555 123 45 67 or (555) 123-4567', 'call [phone] or [phone]'],
    ['status 404 after 3 tries, v10.75.2', 'status 404 after 3 tries, v10.75.2'],
  ])('%s', (input, expected) => {
    expect(redactMessage(input)).toBe(expected);
  });
});

// ── whole events ─────────────────────────────────────────────────────────────────────────────
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
    fingerprint: ['alert', 'flag_read_failed', 'TR:notifications_enabled'],
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

describe('spec 0011-08 AC-16: a full iyzico style answer leaves nothing personal, no token and no card page', () => {
  it('scrubs the buyer, the token, the card page and the IP at any depth', () => {
    const answer = {
      status: 'success',
      paymentId: 'p-1',
      token: 'tok-secret-1',
      paymentPageUrl: 'https://pay.example.test/p/tok-secret-2',
      checkoutFormContent: '<script src="https://pay.example.test/tok-secret-3"></script>',
      buyer: {
        id: 'b',
        name: 'Ayşe',
        surname: 'Yılmaz',
        email: 'ayse@x.test',
        identityNumber: '11111111111',
        ip: '10.9.8.7',
        gsmNumber: '+905551112233',
      },
      itemTransactions: [{ itemId: 'i', psp_token: 'tok-secret-4', payer_ip: '10.1.2.3' }],
    };
    const json = JSON.stringify(scrubEvent({ extra: { answer } }));
    for (const secret of [
      'tok-secret',
      'Ayşe',
      'Yılmaz',
      'ayse@x.test',
      '11111111111',
      '10.9.8.7',
      '10.1.2.3',
      '5551112233',
    ]) {
      expect(json).not.toContain(secret);
    }
    expect(json).toContain('p-1');
  });

  it("drops pay_commission's IP argument and the attempt's IP column (spec 0011-09 R-10)", () => {
    const json = JSON.stringify(
      scrubEvent({
        extra: {
          rpc: { fn: 'pay_commission', p_request_id: 'r-1', p_locale: 'tr', p_payer_ip: '203.0.113.9' },
          attempt: { id: 'a-1', payer_ip: '2001:db8::7' },
        },
      }),
    );
    expect(json).not.toContain('203.0.113.9');
    expect(json).not.toContain('2001:db8::7');
    expect(json).toContain('r-1');
  });
});

describe('spec 0011-08 S7: the fake card page path loses its token', () => {
  it('replaces the token segment, keeping the rest of the URL', () => {
    expect(scrubUrl('http://localhost:3100/tr/dev/fake-checkout/fk1_abc_def?chosen=success')).toBe(
      'http://localhost:3100/tr/dev/fake-checkout/[token]',
    );
    expect(scrubUrl('/en/dev/fake-checkout/fk1_abc')).toBe('/en/dev/fake-checkout/[token]');
  });
});
