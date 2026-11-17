import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Db } from '@/lib/db/types';
import { createFakeAdapter, fakeSignature, FAKE_SIGNATURE_HEADER, type FakeState } from '@/lib/psp/fake';
import type { PspAdapter, RetrievePaymentResult } from '@/lib/psp/types';

/**
 * The fixes from the 08 reviews (docs/reviews/2026-11-17-feat-08-iyzico-relay.md and its security twin): the daily
 * reconcile's orchestration (Major 2), a reconcile check finishing on pending (Major 1), alert and log gating,
 * the fake's opaque payment ids and its per deployment webhook secret (S2, S7), one choice per fake token (S4),
 * the relay route's other methods (S10), and the cloud default for payments (seed versus migration).
 */

const mocks = vi.hoisted(() => ({
  raiseAlert: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  isEnabled: vi.fn(async () => true),
  db: null as unknown,
}));
vi.mock('@/lib/observability/alert', () => ({ raiseAlert: mocks.raiseAlert }));
vi.mock('@/lib/observability/log', () => ({ log: mocks.log }));
vi.mock('@/lib/observability/server', () => ({ checkIn: vi.fn() }));
vi.mock('@/lib/flags', () => ({ isEnabled: mocks.isEnabled }));
vi.mock('@/lib/http/origin', () => ({ appOrigin: () => 'http://localhost:3100' }));
vi.mock('@/lib/env', () => ({ getEnv: () => ({ RELAY_SECRET: undefined }), pspDriver: () => 'fake' }));
vi.mock('@/lib/relay/db', async (load) => ({
  ...(await load<typeof import('@/lib/relay/db')>()),
  relayDb: () => mocks.db,
}));

const { reconcileDaily } = await import('@/lib/relay/reconcile');
const { verifyPayment, initializeCheckout } = await import('@/lib/relay/handlers');
const { runDrain } = await import('@/lib/relay/drain');
const { chooseFakeOutcome } = await import('@/lib/relay/fake-checkout');
const route = await import('@/app/api/relay/route');

const ATTEMPT = '11111111-1111-4111-8111-111111111111';
const FEE = '22222222-2222-4222-8222-222222222222';

type Call = { fn: string; args: Record<string, unknown> };

function scriptedDb(answers: Record<string, unknown>, regions: unknown[] = []) {
  const calls: Call[] = [];
  const db = {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
      calls.push({ fn, args });
      const answer = answers[fn];
      const value =
        typeof answer === 'function' ? (answer as (a: Record<string, unknown>) => unknown)(args) : answer;
      if (value instanceof Error) return { data: null, error: { message: value.message } };
      return { data: value ?? null, error: null };
    }),
    from: vi.fn(() => ({ select: async () => ({ data: regions, error: null }) })),
  } as unknown as Db;
  return { db, calls, names: () => calls.map((c) => c.fn) };
}

const alerts = () => mocks.raiseAlert.mock.calls.map(([reason, detail]) => [reason, detail.recordId]);

beforeEach(() => {
  mocks.raiseAlert.mockClear();
  for (const f of Object.values(mocks.log)) f.mockClear();
});

describe('reconcileDaily: the orchestration (review Major 2)', () => {
  const TR = [{ code: 'TR', timezone: 'Europe/Istanbul', active: true }];
  const row = (id: string, overrides: Record<string, unknown> = {}) => ({
    kind: 'fee',
    ref_id: id,
    psp_payment_id: `p-${id}`,
    status: 'paid',
    amount: 100,
    currency: 'TRY',
    psp_fee_amount: 3,
    ...overrides,
  });
  const paid: RetrievePaymentResult = {
    status: 'paid',
    amount: 100,
    currency: 'TRY',
    pspFee: 3,
    refundedAmount: 0,
    raw: { ok: 1 },
  };
  const psp = (answers: Record<string, RetrievePaymentResult | Error>) =>
    ({
      retrievePayment: vi.fn(async (id: string) => {
        const a = answers[id];
        if (a instanceof Error || a === undefined) throw a ?? new Error('none');
        return a;
      }),
    }) as unknown as PspAdapter;
  // 2026-11-12 10:00 UTC: the previous Istanbul day is 2026-11-11; not the last run.
  const MIDDAY = Date.UTC(2026, 10, 12, 10, 0);
  const LAST = Date.UTC(2026, 10, 12, 1, 55);

  it('compares each row once, records its event, and alerts each mismatch by its record id', async () => {
    const { db, calls } = scriptedDb(
      { reconcile_daily_list: [row('a'), row('b'), row('c')], record_psp_event: {} },
      TR,
    );
    const out = await reconcileDaily(
      db,
      psp({ 'p-a': paid, 'p-b': { ...paid, amount: 101 }, 'p-c': paid }),
      () => MIDDAY,
    );
    expect(out).toEqual({ compared: 3, mismatched: 1 });
    expect(calls.filter((c) => c.fn === 'record_psp_event').map((c) => c.args.p_event_key)).toEqual([
      'reconcile:2026-11-11:p-a',
      'reconcile:2026-11-11:p-b',
      'reconcile:2026-11-11:p-c',
    ]);
    expect(calls[0]).toEqual({
      fn: 'reconcile_daily_list',
      args: { p_region: 'TR', p_day: '2026-11-11', p_limit: 25 },
    });
    expect(alerts()).toEqual([['reconcile_mismatch', 'b']]);
  });

  it('a PSP failure records nothing for that row, so the next run tries it again', async () => {
    const { db, calls } = scriptedDb({ reconcile_daily_list: [row('a')], record_psp_event: {} }, TR);
    expect(await reconcileDaily(db, psp({ 'p-a': new Error('down') }), () => MIDDAY)).toEqual({
      compared: 0,
      mismatched: 0,
    });
    expect(calls.map((c) => c.fn)).toEqual(['reconcile_daily_list']);
    expect(mocks.log.warn).toHaveBeenCalledWith(
      'reconcile_cut',
      expect.objectContaining({ request_id: 'a' }),
    );
  });

  it('stops at the deadline, and starts no other region past it', async () => {
    let t = MIDDAY;
    const regions = [...TR, { code: 'KSA', timezone: 'Asia/Riyadh', active: true }];
    const { db, calls } = scriptedDb(
      { reconcile_daily_list: [row('a'), row('b')], record_psp_event: {} },
      regions,
    );
    await reconcileDaily(db, psp({ 'p-a': paid, 'p-b': paid }), () => (t += 15_000));
    expect(calls.filter((c) => c.fn === 'record_psp_event')).toHaveLength(1);
    expect(calls.filter((c) => c.fn === 'reconcile_daily_list').map((c) => c.args.p_region)).toEqual(['TR']);
  });

  it('only the last run checks the books and what is left, with one record format each', async () => {
    const answers = {
      reconcile_daily_list: (a: Record<string, unknown>) => (a.p_limit === 1 ? [row('left')] : []),
      ledger_check: { imbalances: [{ check: 'journal_unbalanced', ref: 'j-1' }] },
    };
    const midday = scriptedDb(answers, TR);
    await reconcileDaily(midday.db, psp({}), () => MIDDAY);
    expect(midday.names()).not.toContain('ledger_check');
    expect(alerts()).toEqual([]);

    const last = scriptedDb(answers, TR);
    await reconcileDaily(last.db, psp({}), () => LAST);
    expect(last.names()).toContain('ledger_check');
    expect(alerts()).toEqual([
      ['reconcile_mismatch', 'TR:2026-11-11:unfinished'],
      ['ledger_unbalanced', 'TR:journal_unbalanced:j-1'],
    ]);
  });

  it('a run delayed past 02:00 UTC is still the last (review minor)', async () => {
    const { db, names } = scriptedDb({ reconcile_daily_list: [], ledger_check: { imbalances: [] } }, TR);
    await reconcileDaily(db, psp({}), () => Date.UTC(2026, 10, 12, 2, 5));
    expect(names()).toContain('ledger_check');
  });

  it('an inactive region is skipped', async () => {
    const { db, names } = scriptedDb({ reconcile_daily_list: [] }, [
      { code: 'KSA', timezone: 'Asia/Riyadh', active: false },
    ]);
    await reconcileDaily(db, psp({}), () => MIDDAY);
    expect(names()).toEqual([]);
  });
});

function fake() {
  const states = new Map<string, FakeState>();
  const store = {
    get: async (k: string) => states.get(k) ?? null,
    set: async (k: string, s: FakeState) => void states.set(k, s),
  };
  return {
    psp: createFakeAdapter({ store, origin: 'http://localhost:3100', webhookSecret: 'deployment-secret' }),
    states,
  };
}

const ctx = (overrides: Record<string, unknown> = {}) => ({
  attempt_id: ATTEMPT,
  attempt_status: 'ready',
  locale: 'tr',
  psp_token: null,
  region: 'TR',
  attempt_age_seconds: 5,
  payer_ip: null,
  fee_payment_id: FEE,
  fee_kind: 'commission',
  fee_status: 'pending',
  amount: 10_000,
  currency: 'TRY',
  payer_id: 'p',
  full_name: null,
  email: null,
  settings: { hold_minutes: 15, buyer_city: 'Istanbul' },
  ...overrides,
});
const outboxRow = (kind: string, payload: Record<string, unknown>, attempts = 1) => ({
  id: 'r-1',
  kind,
  idempotency_key: 'k',
  payload,
  attempts,
  region: 'TR',
  claim_token: 't',
});

describe('a pending card page (review Major 1)', () => {
  async function pendingToken() {
    const { psp, states } = fake();
    const page = await psp.initializeCheckout({
      attemptId: ATTEMPT,
      feeId: FEE,
      feeKind: 'commission',
      amount: 10_000,
      currency: 'TRY',
      locale: 'tr',
      callbackUrl: 'x',
      buyer: { id: 'p', fullName: null, email: null, city: 'I', ip: null },
    });
    states.set(ATTEMPT, { outcome: 'pending', retrieves: 0, refunds: {} });
    return { psp, token: page.token };
  }

  it('a reconcile check finishes on pending, final or not; the next window asks again', async () => {
    for (const final of [false, true]) {
      const { psp, token } = await pendingToken();
      const { db } = scriptedDb({ checkout_context: ctx({ psp_token: token }), record_psp_event: {} });
      expect(
        await verifyPayment(
          db,
          psp,
          outboxRow('payment.verify', { attempt_id: ATTEMPT, final, origin: 'reconcile' }),
        ),
      ).toEqual({ ok: true });
    }
  });

  it('a callback or webhook check retries by the schedule', async () => {
    const { psp, token } = await pendingToken();
    const { db } = scriptedDb({ checkout_context: ctx({ psp_token: token }), record_psp_event: {} });
    expect(
      await verifyPayment(db, psp, outboxRow('payment.verify', { attempt_id: ATTEMPT, final: false })),
    ).toEqual({
      ok: false,
      error: 'pending',
    });
  });
});

describe('alert and log gating (review minors)', () => {
  it('psp_bad_response on initialize alerts on the first try only', async () => {
    const bad = {
      ...fake().psp,
      initializeCheckout: async () =>
        Promise.reject(Object.assign(new (await import('@/lib/psp/types')).PspError('psp_bad_response'))),
    } as PspAdapter;
    for (const attempts of [1, 2]) {
      const { db } = scriptedDb({ checkout_context: ctx({ attempt_status: 'queued' }) });
      await initializeCheckout(db, bad, outboxRow('checkout.initialize', { attempt_id: ATTEMPT }, attempts));
    }
    expect(alerts()).toEqual([['psp_bad_response', ATTEMPT]]);
  });

  it('an unexpected handler error is logged by class name, never its message', async () => {
    let served = false;
    const { db } = scriptedDb({
      claim_outbox: () =>
        served ? [] : ((served = true), [outboxRow('payment.verify', { attempt_id: ATTEMPT })]),
      checkout_context: () => {
        throw new TypeError('secret value 905551112233');
      },
      finish_outbox: {},
    });
    const psp = {
      ...fake().psp,
      retrieveCheckout: async () => Promise.reject(new TypeError('secret value 905551112233')),
    } as PspAdapter;
    await runDrain({ db, psp, worker: 'w' });
    expect(mocks.log.error).toHaveBeenCalledWith('relay_handler_failed', {
      request_id: 'r-1',
      code: 'handler:TypeError',
    });
    expect(JSON.stringify(mocks.log.error.mock.calls)).not.toContain('905551112233');
  });
});

describe('the fake (security S2, S4, S7)', () => {
  it('a payment id carries the attempt, never the token', async () => {
    const { psp, states } = fake();
    const page = await psp.initializeCheckout({
      attemptId: ATTEMPT,
      feeId: FEE,
      feeKind: 'commission',
      amount: 10_000,
      currency: 'TRY',
      locale: 'tr',
      callbackUrl: 'x',
      buyer: { id: 'p', fullName: null, email: null, city: 'I', ip: null },
    });
    states.set(ATTEMPT, { outcome: 'success', retrieves: 0, refunds: {} });
    const paid = await psp.retrieveCheckout(page.token);
    if (paid.status !== 'paid') throw new Error('not paid');
    expect(paid.pspPaymentId).toBe(`fp1_${ATTEMPT}_10000_TRY`);
    expect(paid.pspPaymentId).not.toContain(page.token);
  });

  it('a webhook signed with the public test secret is refused when the deployment has its own', async () => {
    const body = JSON.stringify({ eventId: 'e', token: 't' });
    const { psp } = fake();
    await expect(
      psp.verifyWebhook({
        rawBody: body,
        headers: new Headers({ [FAKE_SIGNATURE_HEADER]: fakeSignature(body) }),
      }),
    ).rejects.toMatchObject({ code: 'webhook_invalid' });
    await expect(
      psp.verifyWebhook({
        rawBody: body,
        headers: new Headers({ [FAKE_SIGNATURE_HEADER]: fakeSignature(body, 'deployment-secret') }),
      }),
    ).resolves.toMatchObject({ eventKey: 'e' });
  });

  it('a token takes one choice: a second one is refused, so a refund is never forgotten', async () => {
    const token = `fk1_${ATTEMPT}_${FEE}_10000_TRY_1800000000`;
    let stored: unknown = null;
    mocks.db = scriptedDb({
      fake_psp_get: () => stored,
      fake_psp_set: (a: Record<string, unknown>) => void (stored = a.p_outcome),
    }).db;
    expect(await chooseFakeOutcome(token, 'success')).toBe(true);
    expect(await chooseFakeOutcome(token, 'failure')).toBe(false);
    expect(stored).toEqual({ outcome: 'success', retrieves: 0, refunds: {} });
  });
});

describe('/api/relay other methods (security S10)', () => {
  it.each(['GET', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'] as const)('%s is a 404', (method) => {
    expect(route[method]().status).toBe(404);
  });
});

describe('the cloud default for payments (review minor)', () => {
  const migration = readFileSync('supabase/migrations/20261120090000_relay.sql', 'utf8');
  const seed = readFileSync('supabase/seed.sql', 'utf8');

  it('the migration seeds payments off in both regions', () => {
    expect(migration).toMatch(/\('TR',\s+'payments_enabled',\s+'false'\)/);
    expect(migration).toMatch(/\('KSA',\s+'payments_enabled',\s+'false'\)/);
    expect(migration).not.toMatch(/payments_enabled'[^\n]*'true'/);
  });

  it('only the local seed turns TR on, and it never touches KSA', () => {
    expect(seed).toMatch(/set value = 'true' where region = 'TR' and key = 'payments_enabled'/);
    expect(seed).not.toMatch(/KSA/);
  });
});
