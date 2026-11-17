import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Db } from '@/lib/db/types';
import { createFakeAdapter, FAKE_SIGNATURE_HEADER, fakeSignature } from '@/lib/psp/fake';
import { createOffAdapter } from '@/lib/psp/off';

/**
 * Spec 0011-08 AC-5, AC-8, AC-9, AC-12, R-7, R-11, R-14: the relay route's door (secret, body, task, 202), the
 * callback and webhook handlers, and the daily reconcile's day, last run and compare.
 */

const mocks = vi.hoisted(() => ({
  env: { RELAY_SECRET: 'x'.repeat(40) as string | undefined },
  runTask: vi.fn(async () => undefined),
  after: vi.fn((run: () => unknown) => void run()),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/env', () => ({ getEnv: () => mocks.env, pspDriver: () => 'fake' }));
vi.mock('@/lib/observability/log', () => ({ log: mocks.log }));
vi.mock('@/lib/observability/alert', () => ({ raiseAlert: vi.fn() }));
vi.mock('@/lib/observability/server', () => ({ checkIn: vi.fn() }));
vi.mock('next/server', async (load) => ({
  ...(await load<typeof import('next/server')>()),
  after: mocks.after,
}));
vi.mock('@/lib/relay/task', async (load) => ({
  ...(await load<typeof import('@/lib/relay/task')>()),
  runTask: mocks.runTask,
}));

const { POST } = await import('@/app/api/relay/route');
const { parseTask, relaySecretMatches } = await import('@/lib/relay/task');
const { handleCallback, formFields } = await import('@/lib/relay/callback');
const { handleWebhook } = await import('@/lib/relay/webhook');
const { dailyMismatch, isLastDailyRun, previousLocalDay } = await import('@/lib/relay/reconcile');

const SECRET = 'x'.repeat(40);
const post = (body: string, secret?: string) =>
  POST(
    new Request('http://localhost/api/relay', {
      method: 'POST',
      body,
      headers: secret === undefined ? {} : { 'x-relay-secret': secret },
    }),
  );

beforeEach(() => {
  mocks.env.RELAY_SECRET = SECRET;
  mocks.runTask.mockClear();
  for (const f of Object.values(mocks.log)) f.mockClear();
});

describe('/api/relay (AC-5, R-7)', () => {
  it('answers 202 at once and runs the task after the response', async () => {
    const response = await post('{"task":"drain"}', SECRET);
    expect(response.status).toBe(202);
    expect(mocks.after).toHaveBeenCalled();
    expect(mocks.runTask).toHaveBeenCalledWith('drain');
  });

  it.each([
    ['no secret header', undefined],
    ['a wrong secret', 'y'.repeat(40)],
    ['a prefix of the secret', SECRET.slice(0, 39)],
  ])('%s is a 404, logged relay_refused', async (_name, secret) => {
    expect((await post('{"task":"drain"}', secret)).status).toBe(404);
    expect(mocks.log.warn).toHaveBeenCalledWith('relay_refused');
    expect(mocks.runTask).not.toHaveBeenCalled();
  });

  it('without the secret configured, even an empty header is a 404', async () => {
    mocks.env.RELAY_SECRET = undefined;
    expect((await post('{"task":"drain"}', '')).status).toBe(404);
    expect(relaySecretMatches('')).toBe(false);
  });

  it.each([
    ['an unknown task', '{"task":"payout"}'],
    ['not JSON', 'drain'],
    ['a body over 1 KiB', JSON.stringify({ task: 'drain', pad: 'p'.repeat(1100) })],
  ])('%s is a 400', async (_name, body) => {
    expect((await post(body, SECRET)).status).toBe(400);
    expect(mocks.runTask).not.toHaveBeenCalled();
  });

  it('knows exactly the four tasks', () => {
    const enc = (task: string) => new TextEncoder().encode(JSON.stringify({ task }));
    for (const task of ['drain', 'reconcile_pending', 'reconcile_daily', 'heartbeat'])
      expect(parseTask(enc(task))).toBe(task);
    expect(parseTask(enc('retention'))).toBeNull();
  });
});

function db(answer: { data?: unknown; error?: { message: string } }) {
  const rpc = vi.fn(async () => ({ data: answer.data ?? null, error: answer.error ?? null }));
  return { db: { rpc } as unknown as Db, rpc };
}

describe('the callback (AC-8, R-1)', () => {
  it("sends the browser to the attempt's return page in its locale (spec 0011-09 AC-12)", async () => {
    const { db: d, rpc } = db({ data: { attempt_id: 'a-1', locale: 'en', region: 'TR' } });
    expect(await handleCallback(d, { token: 't-1', status: 'success' })).toBe('/en/pay/a-1/return');
    expect(rpc).toHaveBeenCalledWith('psp_callback', {
      p_token: 't-1',
      p_fields: { token: 't-1', status: 'success' },
    });
  });

  it('an unknown token goes home, logged without the token', async () => {
    const { db: d } = db({ data: null });
    expect(await handleCallback(d, { token: 'secret-token' })).toBe('/');
    expect(mocks.log.warn).toHaveBeenCalledWith('psp_callback_unknown');
    expect(JSON.stringify(mocks.log.warn.mock.calls)).not.toContain('secret-token');
  });

  it('a missing or oversized token goes home with no database call', async () => {
    const { db: d, rpc } = db({ data: null });
    expect(await handleCallback(d, {})).toBe('/');
    expect(await handleCallback(d, { token: 't'.repeat(501) })).toBe('/');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('reads a form body, first value of each field', () => {
    expect(formFields(new TextEncoder().encode('token=a%20b&token=c&x=1'))).toEqual({ token: 'a b', x: '1' });
  });
});

describe('the webhook (AC-9)', () => {
  const store = { get: async () => null, set: async () => undefined };
  const psp = createFakeAdapter({ store, origin: 'http://localhost:3100' });

  it("a signed webhook is stored with the adapter's home region: 200", async () => {
    const { db: d, rpc } = db({ data: { new: true } });
    const body = JSON.stringify({ eventId: 'e-1', token: 't-1' });
    const headers = new Headers({ [FAKE_SIGNATURE_HEADER]: fakeSignature(body) });
    expect(await handleWebhook(d, psp, body, headers)).toBe(200);
    expect(rpc).toHaveBeenCalledWith('psp_webhook', {
      p_event_key: 'e-1',
      p_token: 't-1',
      p_psp_payment_id: null,
      p_payload: { eventId: 'e-1', token: 't-1' },
      p_home_region: 'TR',
    });
  });

  it('a bad signature is a 401 and stores nothing', async () => {
    const { db: d, rpc } = db({});
    expect(await handleWebhook(d, psp, '{}', new Headers({ [FAKE_SIGNATURE_HEADER]: 'bad' }))).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('no PSP configured is a 503', async () => {
    expect(await handleWebhook(db({}).db, createOffAdapter(), '{}', new Headers())).toBe(503);
  });

  it('a database failure is a 500, so the PSP sends it again', async () => {
    const body = '{"eventId":"e"}';
    const headers = new Headers({ [FAKE_SIGNATURE_HEADER]: fakeSignature(body) });
    expect(await handleWebhook(db({ error: { message: 'boom' } }).db, psp, body, headers)).toBe(500);
  });
});

describe('the daily reconcile (AC-12, R-11, R-14)', () => {
  it('the previous day in Istanbul, across midnight UTC', () => {
    // 2026-11-11 22:30 UTC is 2026-11-12 01:30 in Istanbul.
    expect(previousLocalDay(Date.UTC(2026, 10, 11, 22, 30), 'Europe/Istanbul')).toBe('2026-11-11');
    expect(previousLocalDay(Date.UTC(2026, 10, 11, 20, 30), 'Europe/Istanbul')).toBe('2026-11-10');
    expect(previousLocalDay(Date.UTC(2026, 2, 1, 0, 10), 'Europe/Istanbul')).toBe('2026-02-28');
  });

  it('the 01:50 UTC run is the last', () => {
    expect(isLastDailyRun(Date.UTC(2026, 10, 12, 1, 50))).toBe(true);
    expect(isLastDailyRun(Date.UTC(2026, 10, 12, 1, 40))).toBe(false);
    expect(isLastDailyRun(Date.UTC(2026, 10, 12, 0, 50))).toBe(false);
  });

  const fee = {
    kind: 'fee' as const,
    ref_id: 'f',
    psp_payment_id: 'p',
    status: 'paid' as const,
    amount: 100,
    currency: 'TRY',
    psp_fee_amount: 3,
  };
  const found = {
    status: 'paid' as const,
    amount: 100,
    currency: 'TRY' as const,
    pspFee: 3,
    refundedAmount: 0,
    raw: {},
  };

  it.each([
    ['a paid fee the PSP holds as paid', fee, found, false],
    ['another amount', fee, { ...found, amount: 101 }, true],
    ['another currency', fee, { ...found, currency: 'SAR' as const }, true],
    ['another cut', fee, { ...found, pspFee: 0 }, true],
    ['a cut the PSP does not give', fee, { ...found, pspFee: null }, true],
    [
      'a paid fee the PSP refunded',
      fee,
      { ...found, status: 'refunded' as const, refundedAmount: 100 },
      true,
    ],
    [
      'a refunded fee, refunded in full',
      { ...fee, status: 'refunded' as const },
      { ...found, status: 'refunded' as const, refundedAmount: 100 },
      false,
    ],
    [
      'a refunded fee, partially refunded',
      { ...fee, status: 'refunded' as const },
      { ...found, status: 'partially_refunded' as const, refundedAmount: 50 },
      true,
    ],
    [
      'a late refund done',
      { ...fee, kind: 'late' as const, status: 'refunded' as const, psp_fee_amount: null },
      { ...found, status: 'refunded' as const, refundedAmount: 100, pspFee: 3 },
      false,
    ],
  ])('%s', (_name, row, psp, mismatch) => {
    expect(dailyMismatch(row, psp)).toBe(mismatch);
  });
});
