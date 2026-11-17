import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Db } from '@/lib/db/types';
import { createFakeAdapter, type FakeState } from '@/lib/psp/fake';
import { createOffAdapter } from '@/lib/psp/off';
import { PspError, type PspAdapter } from '@/lib/psp/types';

/**
 * Spec 0011-08 AC-0, AC-7, AC-10, AC-11, AC-13, AC-18, AC-19, R-2 to R-4, R-12, R-13: the relay's handlers, its
 * drain loop and its heartbeat, against a scripted database (each function's answer, as 07 and 08 built them)
 * and the fake PSP. The SQL itself is proven in supabase/tests/20; the whole loop on the real stack in e2e.
 */

const mocks = vi.hoisted(() => ({
  raiseAlert: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  isEnabled: vi.fn(async () => true),
}));
vi.mock('@/lib/observability/alert', () => ({ raiseAlert: mocks.raiseAlert }));
vi.mock('@/lib/observability/log', () => ({ log: mocks.log }));
vi.mock('@/lib/flags', () => ({ isEnabled: mocks.isEnabled }));
vi.mock('@/lib/http/origin', () => ({ appOrigin: () => 'http://localhost:3100' }));

const { initializeCheckout, verifyPayment, refundPayment } = await import('@/lib/relay/handlers');
const { runDrain } = await import('@/lib/relay/drain');
const { heartbeat } = await import('@/lib/relay/heartbeat');

const ATTEMPT = '11111111-1111-4111-8111-111111111111';
const FEE = '22222222-2222-4222-8222-222222222222';
const REFUND = '33333333-3333-4333-8333-333333333333';
const ROW = '44444444-4444-4444-8444-444444444444';

type Call = { fn: string; args: Record<string, unknown> };
type Answer = unknown | ((args: Record<string, unknown>) => unknown);

/** A database that answers each function from a script; an Error answer is a refusal with that code. */
function scriptedDb(answers: Record<string, Answer>) {
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
  } as unknown as Db;
  return { db, calls, names: () => calls.map((c) => c.fn) };
}

function context(overrides: Record<string, unknown> = {}) {
  return {
    attempt_id: ATTEMPT,
    attempt_status: 'queued',
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
    full_name: 'Ad',
    email: null,
    settings: { hold_minutes: 15, buyer_city: 'Istanbul' },
    ...overrides,
  };
}

function row(kind: string, payload: Record<string, unknown>, attempts = 1) {
  return {
    id: ROW,
    kind,
    idempotency_key: 'k',
    payload,
    attempts,
    region: 'TR',
    claim_token: '2026-11-17T10:00:00.123456+00:00',
  };
}

function fakePsp() {
  const states = new Map<string, FakeState>();
  const store = {
    get: async (t: string) => states.get(t) ?? null,
    set: async (t: string, s: FakeState) => void states.set(t, s),
  };
  return { psp: createFakeAdapter({ store, origin: 'http://localhost:3100' }), states };
}

beforeEach(() => {
  mocks.raiseAlert.mockClear();
  mocks.isEnabled.mockReset();
  mocks.isEnabled.mockResolvedValue(true);
  for (const f of Object.values(mocks.log)) f.mockClear();
});

const alerts = () => mocks.raiseAlert.mock.calls.map(([reason, detail]) => [reason, detail.recordId]);

describe('checkout.initialize (AC-7, R-4, AC-18)', () => {
  const init = row('checkout.initialize', { attempt_id: ATTEMPT, fee_payment_id: FEE });

  it('opens a card page on the fake host and stores it', async () => {
    const { db, calls } = scriptedDb({ checkout_context: context(), mark_checkout_ready: { changed: true } });
    expect(await initializeCheckout(db, fakePsp().psp, init)).toEqual({ ok: true });
    const ready = calls.find((c) => c.fn === 'mark_checkout_ready');
    expect(ready?.args.p_url).toMatch(/^http:\/\/localhost:3100\/tr\/dev\/fake-checkout\/fk1_/);
    expect(mocks.isEnabled).toHaveBeenCalledWith('payments_enabled', 'TR', db);
  });

  it('an attempt no longer queued finishes with no call', async () => {
    const { db, names } = scriptedDb({ checkout_context: context({ attempt_status: 'ready' }) });
    expect(await initializeCheckout(db, fakePsp().psp, init)).toEqual({ ok: true });
    expect(names()).toEqual(['checkout_context']);
    expect(mocks.isEnabled).not.toHaveBeenCalled();
  });

  it.each([
    ['payments off', () => mocks.isEnabled.mockResolvedValue(false), context(), 'payments_disabled'],
    ['the fee moved on', () => undefined, context({ fee_status: 'paid' }), 'fee_not_pending'],
    ['older than the hold', () => undefined, context({ attempt_age_seconds: 15 * 60 + 1 }), 'init_late'],
  ])('%s fails the attempt with no PSP call', async (_name, arrange, ctx, reason) => {
    arrange();
    const psp = { ...fakePsp().psp, initializeCheckout: vi.fn() } as unknown as PspAdapter;
    const { db, calls } = scriptedDb({ checkout_context: ctx, mark_checkout_failed: { changed: true } });
    expect(await initializeCheckout(db, psp, init)).toEqual({ ok: true });
    expect(calls.find((c) => c.fn === 'mark_checkout_failed')?.args).toEqual({
      p_attempt_id: ATTEMPT,
      p_reason: reason,
    });
    expect(psp.initializeCheckout).not.toHaveBeenCalled();
  });

  it('a missing checkout setting retries and alerts checkout_settings_invalid (R-16)', async () => {
    const { db } = scriptedDb({ checkout_context: context({ settings: null }) });
    expect(await initializeCheckout(db, fakePsp().psp, init)).toEqual({
      ok: false,
      error: 'checkout_settings_invalid',
    });
    expect(alerts()).toEqual([['checkout_settings_invalid', ATTEMPT]]);
  });

  it('the off driver fails the attempt at once and alerts psp_not_configured', async () => {
    const { db, calls } = scriptedDb({ checkout_context: context(), mark_checkout_failed: {} });
    expect(await initializeCheckout(db, createOffAdapter(), init)).toEqual({ ok: true });
    expect(calls.at(-1)?.args).toEqual({ p_attempt_id: ATTEMPT, p_reason: 'psp_not_configured' });
    expect(alerts()).toEqual([['psp_not_configured', ATTEMPT]]);
  });

  it('a card page URL off the hosts is refused, never stored (AC-21)', async () => {
    const psp = {
      ...fakePsp().psp,
      initializeCheckout: async () => ({ token: 't', paymentPageUrl: 'https://evil.example/p' }),
    } as PspAdapter;
    const { db, calls, names } = scriptedDb({ checkout_context: context(), mark_checkout_failed: {} });
    expect(await initializeCheckout(db, psp, init)).toEqual({ ok: true });
    expect(names()).not.toContain('mark_checkout_ready');
    expect(calls.at(-1)?.args).toEqual({ p_attempt_id: ATTEMPT, p_reason: 'url_refused' });
    expect(alerts()).toEqual([['psp_bad_response', ATTEMPT]]);
  });

  it('any other PSP error retries by the schedule', async () => {
    const psp = {
      ...fakePsp().psp,
      initializeCheckout: async () => Promise.reject(new PspError('psp_error')),
    } as PspAdapter;
    const { db } = scriptedDb({ checkout_context: context() });
    expect(await initializeCheckout(db, psp, init)).toEqual({ ok: false, error: 'psp_error' });
  });
});

describe('payment.verify (AC-10, R-2, R-13)', () => {
  async function paidToken(outcome: FakeState['outcome'] = 'success') {
    const { psp, states } = fakePsp();
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
    states.set(ATTEMPT, { outcome, retrieves: 0, refunds: {} });
    return { psp, token: page.token };
  }
  const verify = (final = false, attempts = 1) =>
    row('payment.verify', { attempt_id: ATTEMPT, final }, attempts);

  it('a paid retrieve is recorded, then handed to apply_fee_paid, whose alerts are all raised (replays too)', async () => {
    const { psp, token } = await paidToken();
    const { db, calls, names } = scriptedDb({
      checkout_context: context({ attempt_status: 'ready', psp_token: token }),
      record_psp_event: { new: true },
      apply_fee_paid: { status: 'late', alerts: ['late_payment_refunded'], replayed: true },
    });
    expect(await verifyPayment(db, psp, verify())).toEqual({ ok: true });
    expect(names()).toEqual(['checkout_context', 'record_psp_event', 'apply_fee_paid']);
    expect(calls[1]?.args.p_event_key).toBe(`retrieve:${ATTEMPT}:paid:fp1_${ATTEMPT}_10000_TRY`);
    expect(calls[2]?.args).toEqual({
      p_fee_payment_id: FEE,
      p_attempt_id: ATTEMPT,
      p_psp_payment_id: `fp1_${ATTEMPT}_10000_TRY`,
      p_amount: 10_000,
      p_currency: 'TRY',
      p_psp_fee: 300,
    });
    expect(alerts()).toEqual([['late_payment_refunded', FEE]]);
  });

  it('a paid retrieve whose echoed ids differ is never applied, and alerts', async () => {
    const { psp, token } = await paidToken();
    const { db, names } = scriptedDb({
      checkout_context: context({ attempt_status: 'ready', psp_token: token, fee_payment_id: REFUND }),
      record_psp_event: {},
    });
    expect(await verifyPayment(db, psp, verify())).toEqual({ ok: true });
    expect(names()).not.toContain('apply_fee_paid');
    expect(alerts()).toEqual([['reconcile_mismatch', REFUND]]);
  });

  it('a failed retrieve fails the attempt (psp_failed)', async () => {
    const { psp, token } = await paidToken('failure');
    const { db, calls } = scriptedDb({
      checkout_context: context({ attempt_status: 'ready', psp_token: token }),
      record_psp_event: {},
      mark_checkout_failed: {},
    });
    expect(await verifyPayment(db, psp, verify())).toEqual({ ok: true });
    expect(calls.at(-1)?.args).toEqual({ p_attempt_id: ATTEMPT, p_reason: 'psp_failed' });
  });

  it('expired: abandoned only on a final check (R-2)', async () => {
    const answers = {
      checkout_context: context({ attempt_status: 'ready', psp_token: 'unknown-token' }),
      record_psp_event: {},
      abandon_checkout: {},
    };
    const open = scriptedDb(answers);
    expect(await verifyPayment(open.db, fakePsp().psp, verify(false))).toEqual({ ok: true });
    expect(open.names()).not.toContain('abandon_checkout');
    const final = scriptedDb(answers);
    expect(await verifyPayment(final.db, fakePsp().psp, verify(true))).toEqual({ ok: true });
    expect(final.names()).toContain('abandon_checkout');
  });

  it('pending retries by the schedule, even on a final check (R-2)', async () => {
    const { psp, token } = await paidToken('pending');
    const { db } = scriptedDb({
      checkout_context: context({ attempt_status: 'ready', psp_token: token }),
      record_psp_event: {},
    });
    expect(await verifyPayment(db, psp, verify(true))).toEqual({ ok: false, error: 'pending' });
  });

  it('a finished attempt is only checked for a payment (R-1): pending finishes the row', async () => {
    const { psp, token } = await paidToken('pending');
    const { db, names } = scriptedDb({
      checkout_context: context({ attempt_status: 'abandoned', psp_token: token }),
      record_psp_event: {},
    });
    expect(await verifyPayment(db, psp, verify())).toEqual({ ok: true });
    expect(names()).toEqual(['checkout_context', 'record_psp_event']);
  });

  it('an attempt with no token has nothing to check', async () => {
    const { db, names } = scriptedDb({ checkout_context: context() });
    expect(await verifyPayment(db, fakePsp().psp, verify())).toEqual({ ok: true });
    expect(names()).toEqual(['checkout_context']);
  });
});

describe('refund.request (AC-11)', () => {
  const payload = (pspPaymentId: string, amount: number) => ({
    fee_refund_id: REFUND,
    psp_payment_id: pspPaymentId,
    amount,
    currency: 'TRY',
  });

  async function paid() {
    const { psp, states } = fakePsp();
    await psp.initializeCheckout({
      attemptId: ATTEMPT,
      feeId: FEE,
      feeKind: 'commission',
      amount: 10_000,
      currency: 'TRY',
      locale: 'en',
      callbackUrl: 'x',
      buyer: { id: 'p', fullName: null, email: null, city: 'I', ip: null },
    });
    states.set(ATTEMPT, { outcome: 'success', retrieves: 0, refunds: {} });
    return { psp, paymentId: `fp1_${ATTEMPT}_10000_TRY` };
  }

  it('refunds, then hands the refund id to apply_fee_refunded; a crash before it never refunds twice', async () => {
    const { psp, paymentId } = await paid();
    const first = scriptedDb({ apply_fee_refunded: new Error('db down') });
    // The drain turns this refusal into a retry (apply_fee_refunded:db_error); the PSP already refunded.
    await expect(
      refundPayment(first.db, psp, row('refund.request', payload(paymentId, 10_000))),
    ).rejects.toThrow('apply_fee_refunded: db_error');
    const refundPaymentSpy = vi.spyOn(psp, 'refundPayment');
    const second = scriptedDb({ apply_fee_refunded: { status: 'refunded', alerts: [] } });
    expect(await refundPayment(second.db, psp, row('refund.request', payload(paymentId, 10_000), 2))).toEqual(
      {
        ok: true,
      },
    );
    await expect(refundPaymentSpy.mock.results[0]?.value).resolves.toEqual({
      pspRefundId: `fr_${paymentId}`,
      existing: true,
    });
    expect(second.calls[0]?.args).toEqual({ p_fee_refund_id: REFUND, p_psp_refund_id: `fr_${paymentId}` });
  });

  it('an existing refund of another amount retries and alerts reconcile_mismatch', async () => {
    const { psp, paymentId } = await paid();
    await psp.refundPayment({ pspPaymentId: paymentId, amount: 10_000, currency: 'TRY' });
    const { db } = scriptedDb({});
    expect(await refundPayment(db, psp, row('refund.request', payload(paymentId, 9_999)))).toEqual({
      ok: false,
      error: 'reconcile_mismatch',
    });
    expect(alerts()).toEqual([['reconcile_mismatch', REFUND]]);
  });
});

describe('drain (AC-0, R-3, AC-19)', () => {
  const claimed = (rows: unknown[]) => {
    let served = false;
    return () => {
      if (served) return [];
      served = true;
      return rows;
    };
  };

  it('claims at most 5 rows, runs them, and finishes each with its claim token exactly as received', async () => {
    const r = row('payment.verify', { attempt_id: ATTEMPT, final: false });
    const { db, calls } = scriptedDb({
      claim_outbox: claimed([r]),
      checkout_context: context(),
      finish_outbox: { stale: false },
    });
    expect(await runDrain({ db, psp: fakePsp().psp, worker: 'relay:test:1' })).toEqual({
      ran: 1,
      failed: 0,
      unfinished: 0,
    });
    expect(calls[0]).toEqual({ fn: 'claim_outbox', args: { p_limit: 5, p_worker: 'relay:test:1' } });
    expect(calls.find((c) => c.fn === 'finish_outbox')?.args).toEqual({
      p_id: ROW,
      p_ok: true,
      p_error: null,
      p_claim_token: '2026-11-17T10:00:00.123456+00:00',
    });
  });

  it('a stale finish is logged and the run moves on', async () => {
    const { db } = scriptedDb({
      claim_outbox: claimed([row('payment.verify', { attempt_id: ATTEMPT })]),
      checkout_context: context(),
      finish_outbox: { stale: true },
    });
    await runDrain({ db, psp: fakePsp().psp, worker: 'w' });
    expect(mocks.log.info).toHaveBeenCalledWith('outbox_stale', expect.objectContaining({ request_id: ROW }));
  });

  it('a 07 refusal retries, alerting idempotency_conflict on the first and the last try only', async () => {
    for (const [attempts, alerted] of [
      [1, true],
      [3, false],
      [6, true],
    ] as const) {
      mocks.raiseAlert.mockClear();
      const { db, calls } = scriptedDb({
        claim_outbox: claimed([row('payment.verify', { attempt_id: ATTEMPT }, attempts)]),
        checkout_context: new Error('not_found'),
        finish_outbox: {},
      });
      await runDrain({ db, psp: fakePsp().psp, worker: 'w' });
      expect(calls.find((c) => c.fn === 'finish_outbox')?.args).toMatchObject({
        p_ok: false,
        p_error: 'checkout_context:not_found',
      });
      expect(alerts()).toEqual(alerted ? [['idempotency_conflict', ROW]] : []);
    }
  });

  it('the last try of an initialize row fails the attempt with init_failed', async () => {
    const { db, calls } = scriptedDb({
      claim_outbox: claimed([row('checkout.initialize', { attempt_id: ATTEMPT }, 6)]),
      checkout_context: context(),
      mark_checkout_failed: {},
      finish_outbox: {},
    });
    const psp = {
      ...fakePsp().psp,
      initializeCheckout: async () => Promise.reject(new PspError('psp_error')),
    } as PspAdapter;
    await runDrain({ db, psp, worker: 'w' });
    expect(calls.find((c) => c.fn === 'mark_checkout_failed')?.args).toEqual({
      p_attempt_id: ATTEMPT,
      p_reason: 'init_failed',
    });
  });

  it('the last try of a refund row marks it failed and alerts refund_failed', async () => {
    const { db, calls } = scriptedDb({
      claim_outbox: claimed([
        row('refund.request', { fee_refund_id: REFUND, psp_payment_id: 'x', amount: 1, currency: 'TRY' }, 6),
      ]),
      mark_refund_failed: {},
      finish_outbox: {},
    });
    await runDrain({ db, psp: fakePsp().psp, worker: 'w' });
    expect(calls.find((c) => c.fn === 'mark_refund_failed')?.args).toEqual({ p_fee_refund_id: REFUND });
    expect(alerts()).toContainEqual(['refund_failed', REFUND]);
  });

  it('a handler past its limit is left unfinished, for its lease to run out (R-3)', async () => {
    const psp = {
      ...fakePsp().psp,
      retrieveCheckout: () => new Promise<never>(() => undefined),
    } as unknown as PspAdapter;
    const { db, names } = scriptedDb({
      claim_outbox: claimed([row('payment.verify', { attempt_id: ATTEMPT })]),
      checkout_context: context({ psp_token: 't' }),
    });
    expect(await runDrain({ db, psp, worker: 'w', handlerMs: 10 })).toEqual({
      ran: 0,
      failed: 0,
      unfinished: 1,
    });
    expect(names()).not.toContain('finish_outbox');
    expect(mocks.log.warn).toHaveBeenCalledWith('outbox_unfinished', expect.anything());
  });

  it('stops claiming at the deadline', async () => {
    let t = 0;
    const { db, names } = scriptedDb({
      claim_outbox: [row('payment.verify', { attempt_id: ATTEMPT })],
      checkout_context: context(),
      finish_outbox: {},
    });
    await runDrain({ db, psp: fakePsp().psp, worker: 'w', now: () => (t += 20_000) });
    expect(names().filter((n) => n === 'claim_outbox')).toHaveLength(1);
  });
});

describe('heartbeat (AC-13, R-12)', () => {
  it('alerts a stalled outbox, a failed row once, and a failed refund as refund_failed', async () => {
    const { db, calls } = scriptedDb({
      outbox_health: {
        oldest_due_seconds: 301,
        failed: [
          { id: ROW, kind: 'payment.verify', region: 'TR', payload: {} },
          { id: 'r2', kind: 'refund.request', region: 'TR', payload: { fee_refund_id: REFUND } },
        ],
      },
      mark_refund_failed: {},
    });
    expect(await heartbeat(db)).toEqual({ stalled: true, failed: 2 });
    expect(alerts()).toEqual([
      ['relay_stalled', 'outbox'],
      ['outbox_failed', ROW],
      ['refund_failed', REFUND],
    ]);
    expect(calls.find((c) => c.fn === 'mark_refund_failed')?.args).toEqual({ p_fee_refund_id: REFUND });
  });

  it('a healthy outbox alerts nothing', async () => {
    const { db } = scriptedDb({ outbox_health: { oldest_due_seconds: 300, failed: [] } });
    expect(await heartbeat(db)).toEqual({ stalled: false, failed: 0 });
    expect(alerts()).toEqual([]);
  });
});
