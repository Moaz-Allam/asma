import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createPsp, isPspError, PspError, type CheckoutRequest, type PspAdapter } from '@/lib/psp';
import {
  createFakeAdapter,
  FAKE_SIGNATURE_HEADER,
  FAKE_TOKEN_LIFETIME_SECONDS,
  fakeCut,
  fakeSignature,
  makeFakeToken,
  parseFakeToken,
  type FakeOutcome,
  type FakeState,
} from '@/lib/psp/fake';
import { createIyzicoAdapter } from '@/lib/psp/iyzico';
import { createOffAdapter } from '@/lib/psp/off';

/**
 * Spec 0011-08 AC-1, AC-2, AC-4, AC-11, AC-15, R-2, R-14, R-15: the PSP contract. One suite states what every
 * adapter must do; it runs against the fake now, and against the iyzico adapter on recorded S1 responses in 08b.
 * Then the fake's own outcomes, the `off` driver, the iyzico slot, and the 15 second timeout.
 */

const ATTEMPT = '11111111-1111-4111-8111-111111111111';
const FEE = '22222222-2222-4222-8222-222222222222';
const ORIGIN = 'http://localhost:3100';

const request: CheckoutRequest = {
  attemptId: ATTEMPT,
  feeId: FEE,
  feeKind: 'commission',
  amount: 12_345,
  currency: 'TRY',
  locale: 'tr',
  callbackUrl: `${ORIGIN}/api/psp/callback`,
  buyer: { id: 'p', fullName: 'Ad Soyad', email: 'a@example.test', city: 'Istanbul', ip: '10.0.0.1' },
};

function memoryStore() {
  const rows = new Map<string, FakeState>();
  return {
    rows,
    store: {
      get: async (token: string) => rows.get(token) ?? null,
      set: async (token: string, state: FakeState) => {
        rows.set(token, structuredClone(state));
      },
    },
  };
}

type Harness = {
  adapter: PspAdapter;
  /** Make the buyer pay (or fail) on the card page for this token. */
  pay(token: string, outcome: FakeOutcome): Promise<void>;
  /** A webhook body the PSP would sign, and its headers. */
  webhook(body: string, valid: boolean): { rawBody: string; headers: Headers };
};

function fakeHarness(now: () => number = Date.now): Harness {
  const { store } = memoryStore();
  return {
    adapter: createFakeAdapter({ store, origin: ORIGIN, now }),
    // The fake keys its state by the attempt id its token carries.
    pay: (token, outcome) =>
      store.set(parseFakeToken(token)?.attemptId ?? token, { outcome, retrieves: 0, refunds: {} }),
    webhook: (body, valid) => ({
      rawBody: body,
      headers: new Headers({ [FAKE_SIGNATURE_HEADER]: valid ? fakeSignature(body) : 'f'.repeat(64) }),
    }),
  };
}

const code = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return 'none';
  } catch (error) {
    return isPspError(error) ? error.code : 'other';
  }
};

describe.each([['fake', () => fakeHarness()]])('the PSP contract: %s', (_name, make) => {
  it('opens a card page on one of its own hosts, and a token', async () => {
    const { adapter } = make();
    const page = await adapter.initializeCheckout(request);
    expect(page.token.length).toBeGreaterThan(0);
    expect(page.token.length).toBeLessThanOrEqual(500);
    expect(adapter.checkoutHosts).toContain(new URL(page.paymentPageUrl).host);
  });

  it('a page nobody paid on is pending', async () => {
    const { adapter } = make();
    const page = await adapter.initializeCheckout(request);
    expect((await adapter.retrieveCheckout(page.token)).status).toBe('pending');
  });

  it('a paid page echoes our attempt and fee, the amount in minor units, the currency and an integer cut', async () => {
    const h = make();
    const page = await h.adapter.initializeCheckout(request);
    await h.pay(page.token, 'success');
    const result = await h.adapter.retrieveCheckout(page.token);
    expect(result).toMatchObject({
      status: 'paid',
      amount: 12_345,
      currency: 'TRY',
      conversationId: ATTEMPT,
      basketId: FEE,
    });
    if (result.status !== 'paid') throw new Error('not paid');
    expect(Number.isSafeInteger(result.pspFee)).toBe(true);
    expect(result.pspPaymentId.length).toBeLessThanOrEqual(200);
  });

  it('a failed page is failed', async () => {
    const h = make();
    const page = await h.adapter.initializeCheckout(request);
    await h.pay(page.token, 'failure');
    expect((await h.adapter.retrieveCheckout(page.token)).status).toBe('failed');
  });

  it('a token it never issued is expired (R-2)', async () => {
    expect((await make().adapter.retrieveCheckout('no-such-token')).status).toBe('expired');
  });

  it('refunds once: a second refund returns the same id with no new refund (AC-11)', async () => {
    const h = make();
    const page = await h.adapter.initializeCheckout(request);
    await h.pay(page.token, 'success');
    const paid = await h.adapter.retrieveCheckout(page.token);
    if (paid.status !== 'paid') throw new Error('not paid');
    const refund = { pspPaymentId: paid.pspPaymentId, amount: paid.amount, currency: paid.currency };
    const first = await h.adapter.refundPayment(refund);
    const second = await h.adapter.refundPayment(refund);
    expect(first.existing).toBe(false);
    expect(second).toEqual({ pspRefundId: first.pspRefundId, existing: true });
    expect(first.pspRefundId.length).toBeLessThanOrEqual(200);
  });

  it('an existing refund of another amount refuses reconcile_mismatch', async () => {
    const h = make();
    const page = await h.adapter.initializeCheckout(request);
    await h.pay(page.token, 'success');
    const paid = await h.adapter.retrieveCheckout(page.token);
    if (paid.status !== 'paid') throw new Error('not paid');
    await h.adapter.refundPayment({ pspPaymentId: paid.pspPaymentId, amount: paid.amount, currency: 'TRY' });
    expect(
      await code(
        h.adapter.refundPayment({
          pspPaymentId: paid.pspPaymentId,
          amount: paid.amount - 1,
          currency: 'TRY',
        }),
      ),
    ).toBe('reconcile_mismatch');
  });

  it('retrievePayment reads paid, then refunded with the refunded amount (R-14)', async () => {
    const h = make();
    const page = await h.adapter.initializeCheckout(request);
    await h.pay(page.token, 'success');
    const paid = await h.adapter.retrieveCheckout(page.token);
    if (paid.status !== 'paid') throw new Error('not paid');
    expect(await h.adapter.retrievePayment(paid.pspPaymentId)).toMatchObject({
      status: 'paid',
      amount: 12_345,
      currency: 'TRY',
      pspFee: paid.pspFee,
      refundedAmount: 0,
    });
    await h.adapter.refundPayment({ pspPaymentId: paid.pspPaymentId, amount: paid.amount, currency: 'TRY' });
    expect(await h.adapter.retrievePayment(paid.pspPaymentId)).toMatchObject({
      status: 'refunded',
      refundedAmount: 12_345,
    });
  });

  it('a webhook with a bad signature refuses webhook_invalid (AC-9)', async () => {
    const h = make();
    const input = h.webhook(JSON.stringify({ eventId: 'e-1', token: 't' }), false);
    expect(await code(h.adapter.verifyWebhook(input))).toBe('webhook_invalid');
  });

  it('a signed webhook gives its event id, token and payment id', async () => {
    const h = make();
    const input = h.webhook(JSON.stringify({ eventId: 'e-1', token: 't-1', paymentId: 'p-1' }), true);
    expect(await h.adapter.verifyWebhook(input)).toMatchObject({
      eventKey: 'e-1',
      token: 't-1',
      pspPaymentId: 'p-1',
    });
  });

  it('a webhook without an event id is keyed by the SHA-256 of its raw body (R-15)', async () => {
    const h = make();
    const body = JSON.stringify({ token: 't-1' });
    const event = await h.adapter.verifyWebhook(h.webhook(body, true));
    expect(event.eventKey).toBe(createHash('sha256').update(body).digest('hex'));
  });
});

describe('the iyzico contract on recorded S1 responses', () => {
  it.todo('runs the same suite once 08b fills the adapter (B3, S1)');
});

describe('the fake (AC-15): deterministic outcomes', () => {
  it('its token carries the attempt, the fee, the amount, the currency and when it was issued', () => {
    const token = makeFakeToken({
      attemptId: ATTEMPT,
      feeId: FEE,
      amount: 500,
      currency: 'SAR',
      issuedAt: 1_800_000_000,
    });
    expect(parseFakeToken(token)).toEqual({
      attemptId: ATTEMPT,
      feeId: FEE,
      amount: 500,
      currency: 'SAR',
      issuedAt: 1_800_000_000,
    });
    expect(token).not.toMatch(/[./]/);
    expect(parseFakeToken(`${token}x`)).toBeNull();
    expect(parseFakeToken(token.replace('_500_', '_0_'))).toBeNull();
  });

  it('pending: two pending retrieves, then paid', async () => {
    const h = fakeHarness();
    const page = await h.adapter.initializeCheckout(request);
    await h.pay(page.token, 'pending');
    const seen = [];
    for (let i = 0; i < 3; i += 1) seen.push((await h.adapter.retrieveCheckout(page.token)).status);
    expect(seen).toEqual(['pending', 'pending', 'paid']);
  });

  it('duplicate: the next retrieve brings a second payment id for the same token', async () => {
    const h = fakeHarness();
    const page = await h.adapter.initializeCheckout(request);
    await h.pay(page.token, 'duplicate');
    const first = await h.adapter.retrieveCheckout(page.token);
    const second = await h.adapter.retrieveCheckout(page.token);
    if (first.status !== 'paid' || second.status !== 'paid') throw new Error('not paid');
    expect(second.pspPaymentId).not.toBe(first.pspPaymentId);
  });

  it('mismatch: one minor unit more than asked', async () => {
    const h = fakeHarness();
    const page = await h.adapter.initializeCheckout(request);
    await h.pay(page.token, 'mismatch');
    expect(await h.adapter.retrieveCheckout(page.token)).toMatchObject({ status: 'paid', amount: 12_346 });
  });

  it('a token with no outcome expires after 30 minutes (R-2)', async () => {
    let now = 1_800_000_000_000;
    const h = fakeHarness(() => now);
    const page = await h.adapter.initializeCheckout(request);
    now += FAKE_TOKEN_LIFETIME_SECONDS * 1000;
    expect((await h.adapter.retrieveCheckout(page.token)).status).toBe('pending');
    now += 1000;
    expect((await h.adapter.retrieveCheckout(page.token)).status).toBe('expired');
  });

  it('its cut is 3 percent rounded down, in integers', () => {
    expect(fakeCut(12_345)).toBe(370);
    expect(fakeCut(1)).toBe(0);
  });

  it('refuses an amount that is not whole minor units', async () => {
    expect(await code(fakeHarness().adapter.initializeCheckout({ ...request, amount: 1.5 }))).toBe(
      'psp_bad_response',
    );
  });
});

describe('off and the iyzico slot refuse every call (AC-2, AC-4)', () => {
  it.each([
    ['off', createOffAdapter()],
    ['iyzico before S1', createIyzicoAdapter()],
  ])('%s', async (_name, adapter) => {
    expect(await code(adapter.initializeCheckout(request))).toBe('psp_not_configured');
    expect(await code(adapter.retrieveCheckout('t'))).toBe('psp_not_configured');
    expect(await code(adapter.retrievePayment('p'))).toBe('psp_not_configured');
    expect(await code(adapter.refundPayment({ pspPaymentId: 'p', amount: 1, currency: 'TRY' }))).toBe(
      'psp_not_configured',
    );
    expect(await code(adapter.verifyWebhook({ rawBody: '{}', headers: new Headers() }))).toBe(
      'psp_not_configured',
    );
  });
});

describe('createPsp: the driver, and every call bounded (AC-1)', () => {
  it('picks the driver', () => {
    expect(createPsp({ driver: 'off', origin: ORIGIN }).name).toBe('off');
    expect(createPsp({ driver: 'iyzico', origin: ORIGIN }).name).toBe('iyzico');
    expect(createPsp({ driver: 'fake', origin: ORIGIN, fakeStore: memoryStore().store }).name).toBe('fake');
    expect(() => createPsp({ driver: 'fake', origin: ORIGIN })).toThrow(/store/);
  });

  it('a call with no answer in time refuses psp_timeout', async () => {
    const hanging = { get: () => new Promise<never>(() => undefined), set: async () => undefined };
    const psp = createPsp({ driver: 'fake', origin: ORIGIN, fakeStore: hanging, timeoutMs: 20 });
    const token = makeFakeToken({
      attemptId: ATTEMPT,
      feeId: FEE,
      amount: 5,
      currency: 'TRY',
      issuedAt: 1_800_000_000,
    });
    expect(await code(psp.retrieveCheckout(token))).toBe('psp_timeout');
  });

  it('PspError carries its code', () => {
    expect(new PspError('psp_error').code).toBe('psp_error');
  });
});
