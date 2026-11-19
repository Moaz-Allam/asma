import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it, vi } from 'vitest';

import {
  createFakeDriver,
  createOffDriver,
  createResendDriver,
  RESEND_URL,
  resendOutcome,
} from '@/lib/email/drivers';
import type { OutgoingEmail } from '@/lib/email/types';
import { isEmailSender, parseEnv } from '@/lib/env';
import { missingDeploymentKeys } from '@/lib/deployment';

/**
 * Spec 0011-13 AC-1, AC-8, AC-9, R-4, R-11: the email door. Only lib/relay imports it (a source test beside the
 * lint rule); the three drivers; Resend's answers; the env schema and the deployment check.
 */

const ROOT = fileURLToPath(new URL('../', import.meta.url));

const MAIL: OutgoingEmail = {
  to: 'person-13@example.com',
  key: 'email:42:00000000-0000-4000-8000-000000000001:chosen',
  subject: 'You were chosen',
  text: 'text body',
  html: '<p>html body</p>',
  template: 'chosen',
  locale: 'en',
};

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (/\.(ts|tsx|mjs)$/.test(name)) out.push(path);
  }
  return out;
}

describe('only lib/relay imports lib/email (AC-1, umbrella U-4)', () => {
  it('no other source file names the door', () => {
    const importers = ['app', 'lib', 'components', 'actions']
      .flatMap((dir) => sources(join(ROOT, dir)))
      .filter((file) => /['"]@\/lib\/email(\/[^'"]*)?['"]/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(ROOT, file).replace(/\\/g, '/'));
    expect(importers.length).toBeGreaterThan(0);
    for (const file of importers) expect(file).toMatch(/^lib\/relay\//);
  });

  it('the Resend host is written only inside lib/email', () => {
    const files = ['app', 'lib', 'components', 'actions']
      .flatMap((dir) => sources(join(ROOT, dir)))
      .filter((file) => readFileSync(file, 'utf8').includes('api.resend.com'))
      .map((file) => relative(ROOT, file).replace(/\\/g, '/'));
    expect(files).toEqual(['lib/email/drivers.ts']);
  });
});

describe('Resend answers (R-11)', () => {
  it.each([
    [200, undefined, 'sent', undefined],
    [202, undefined, 'sent', undefined],
    [409, 'invalid_idempotent_request', 'already_sent', 'http_409:invalid_idempotent_request'],
    [409, 'concurrent_idempotent_requests', 'retry', 'http_409:concurrent_idempotent_requests'],
    [429, 'rate_limit_exceeded', 'retry', 'http_429:rate_limit_exceeded'],
    [500, 'internal_server_error', 'retry', 'http_500:internal_server_error'],
    [503, undefined, 'retry', 'http_503:unknown'],
    [400, 'validation_error', 'rejected', 'http_400:validation_error'],
    [401, 'missing_api_key', 'rejected', 'http_401:missing_api_key'],
    [403, 'invalid_from_address', 'rejected', 'http_403:invalid_from_address'],
    [422, 'validation_error', 'rejected', 'http_422:validation_error'],
    [422, 'The to field has person@x.com', 'rejected', 'http_422:unknown'],
  ])('%i %s → %s', (status, name, outcome, detail) => {
    expect(resendOutcome(status, name)).toEqual(detail === undefined ? { outcome } : { outcome, detail });
  });
});

describe('the resend driver (AC-8)', () => {
  const answer = (status: number, body: unknown = {}) =>
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
    );

  it('posts to Resend with the key, the outbox key as Idempotency-Key and no tracking options', async () => {
    const fetchImpl = answer(200, { id: 'abc' });
    const driver = createResendDriver({
      apiKey: 're_test',
      from: 'Aldebyani <no-reply@example.com>',
      fetchImpl,
    });
    expect(await driver.send(MAIL)).toEqual({ outcome: 'sent' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(RESEND_URL);
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer re_test');
    expect(headers['Idempotency-Key']).toBe(MAIL.key);
    expect(JSON.parse(init.body as string)).toEqual({
      from: 'Aldebyani <no-reply@example.com>',
      to: [MAIL.to],
      subject: MAIL.subject,
      html: MAIL.html,
      text: MAIL.text,
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('keeps only the status and the error name, never the message', async () => {
    const fetchImpl = answer(422, {
      name: 'validation_error',
      message: 'Invalid `to` field: person-13@example.com',
    });
    const driver = createResendDriver({ apiKey: 're_test', from: 'no-reply@example.com', fetchImpl });
    const result = await driver.send(MAIL);
    expect(result).toEqual({ outcome: 'rejected', detail: 'http_422:validation_error' });
    expect(JSON.stringify(result)).not.toContain('@');
  });

  it('a timeout or a network error retries', async () => {
    const timeout = vi.fn(async () => {
      throw new DOMException('The operation timed out.', 'TimeoutError');
    });
    expect(await createResendDriver({ apiKey: 'k', from: 'a@b.co', fetchImpl: timeout }).send(MAIL)).toEqual({
      outcome: 'retry',
      detail: 'timeout',
    });
    const down = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    expect(await createResendDriver({ apiKey: 'k', from: 'a@b.co', fetchImpl: down }).send(MAIL)).toEqual({
      outcome: 'retry',
      detail: 'network_error',
    });
  });

  it('without its key or sender it waits, and calls nobody', async () => {
    const fetchImpl = answer(200);
    expect(await createResendDriver({ apiKey: undefined, from: 'a@b.co', fetchImpl }).send(MAIL)).toEqual({
      outcome: 'retry',
      detail: 'not_configured',
    });
    expect(await createResendDriver({ apiKey: 'k', from: undefined, fetchImpl }).send(MAIL)).toEqual({
      outcome: 'retry',
      detail: 'not_configured',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('the off and fake drivers (R-4)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'email-fake-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('off sends nothing', async () => {
    expect(await createOffDriver().send(MAIL)).toEqual({ outcome: 'email_off' });
  });

  it('fake appends one JSON line per mail to its file', async () => {
    const file = join(dir, 'mail.jsonl');
    const driver = createFakeDriver(file);
    expect(await driver.send(MAIL)).toEqual({ outcome: 'sent' });
    expect(await driver.send({ ...MAIL, key: 'email:43:x:chosen' })).toEqual({ outcome: 'sent' });
    const lines = readFileSync(file, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines).toHaveLength(2);
    expect(Object.keys(lines[0] ?? {}).sort()).toEqual(
      ['from', 'html', 'id', 'key', 'locale', 'subject', 'template', 'text', 'to'].sort(),
    );
    expect(lines[0]).toMatchObject({ key: MAIL.key, to: MAIL.to, template: 'chosen', locale: 'en' });
  });

  it('fake without a file waits', async () => {
    expect(await createFakeDriver(undefined).send(MAIL)).toEqual({
      outcome: 'retry',
      detail: 'not_configured',
    });
  });
});

describe('the env schema and the deployment check (R-4, D192)', () => {
  const base = {
    NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'k',
  };

  it('EMAIL_DRIVER defaults to off and takes only the three drivers', () => {
    expect(() => parseEnv({ ...base, EMAIL_DRIVER: 'smtp' } as unknown as NodeJS.ProcessEnv)).toThrow(
      /EMAIL_DRIVER/,
    );
  });

  it('a sender is an address, or a name and an address in angle brackets', () => {
    expect(isEmailSender('no-reply@example.com')).toBe(true);
    expect(isEmailSender('Aldebyani <no-reply@example.com>')).toBe(true);
    expect(isEmailSender('Aldebyani no-reply@example.com')).toBe(false);
    expect(isEmailSender('"Evil" <a@b.co>')).toBe(false);
    expect(isEmailSender('A\r\nBcc: x@y.z <a@b.co>')).toBe(false);
  });

  const deployment = {
    VERCEL: '1',
    VERCEL_ENV: 'preview',
  } as Record<string, string>;
  const missing = (env: Record<string, string>) =>
    missingDeploymentKeys({ ...deployment, ...env }, 'runtime').filter((name) => name.startsWith('EMAIL_'));

  it('off, or unset, needs no email key', () => {
    expect(missing({})).toEqual([]);
    expect(missing({ EMAIL_DRIVER: 'off' })).toEqual([]);
  });

  it('fake is refused on every deployment, a preview included (security review item 6)', () => {
    expect(missing({ EMAIL_DRIVER: 'fake' })).toEqual(['EMAIL_DRIVER']);
    expect(missing({ EMAIL_DRIVER: 'fake', VERCEL_ENV: 'production' })).toEqual(['EMAIL_DRIVER']);
  });

  it('the deployment check and the env schema agree on the sender (security review item 7)', () => {
    for (const from of [
      'Aldebyani <no-reply@example.com',
      'no-reply@example.com>',
      'a@b.co',
      'Aldebyani <a@b.co>',
    ]) {
      const refused = missing({ EMAIL_DRIVER: 'resend', EMAIL_API_KEY: 'k', EMAIL_FROM: from }).includes(
        'EMAIL_FROM',
      );
      expect(refused).toBe(!isEmailSender(from));
    }
  });

  it('resend needs its key and its sender', () => {
    expect(missing({ EMAIL_DRIVER: 'resend' })).toEqual(['EMAIL_API_KEY', 'EMAIL_FROM']);
    expect(
      missing({
        EMAIL_DRIVER: 'resend',
        EMAIL_API_KEY: 're_x',
        EMAIL_FROM: 'Aldebyani <no-reply@example.com>',
      }),
    ).toEqual([]);
  });

  it('the fake file is never set on Vercel', () => {
    expect(missing({ EMAIL_FAKE_FILE: '/tmp/mail.jsonl' })).toEqual(['EMAIL_FAKE_FILE']);
  });
});
