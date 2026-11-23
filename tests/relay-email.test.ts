import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Db } from '@/lib/db/types';
import type { EmailDriver, OutgoingEmail, SendResult } from '@/lib/email';

/**
 * Spec 0011-13 AC-8, AC-9, R-8, R-11, R-12: the relay's `email` task against a scripted database. It claims through
 * claim_email_outbox, asks email_context, renders, sends with the outbox key, and ends each row through
 * finish_email with the outcome; sends are paced to 2 a second and skips cost nothing; the logs carry only the
 * id, the template and the outcome. The SQL itself is proven in supabase/tests/29.
 */

const mocks = vi.hoisted(() => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/observability/log', () => ({ log: mocks.log }));

const { runEmail, claimLimit, EMAIL_SEND_INTERVAL_MS } = await import('@/lib/relay/email');

const ADDRESS = 'person-13@example.com';
const REQUEST = '11111111-1111-4111-8111-111111111111';

const send = (template: string, over: Record<string, unknown> = {}) => ({
  status: 'send',
  template,
  email: ADDRESS,
  locale: 'en',
  region_locale: 'tr',
  timezone: 'Europe/Istanbul',
  values: {
    side: 'customer',
    request_id: REQUEST,
    service: { tr: 'Temizlik', en: 'Cleaning' },
    start_at: '2026-11-22T10:00:00+00:00',
    deadline: null,
    amount: null,
    currency: 'TRY',
    fee_id: null,
    carried: false,
    token: null,
    ...over,
  },
});

type Row = { id: string; idempotency_key: string; claim_token: string; attempts: number };
const row = (n: number): Row => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  idempotency_key: `email:${n}:x:new_offer`,
  claim_token: '2026-11-19T10:00:00.000000+00:00',
  attempts: 1,
});

/** A database that answers claim_email_outbox from `batches`, email_context from `contexts`, and records finishes. */
function scripted(batches: Row[][], contexts: Record<string, unknown>) {
  const finishes: Array<{ id: string; outcome: string; detail: unknown }> = [];
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    if (fn === 'claim_email_outbox') return { data: batches.shift() ?? [], error: null };
    if (fn === 'email_context') {
      const answer = contexts[args.p_outbox_id as string];
      return answer instanceof Error
        ? { data: null, error: { message: answer.message } }
        : { data: answer ?? null, error: null };
    }
    if (fn === 'finish_email') {
      finishes.push({ id: args.p_id as string, outcome: args.p_outcome as string, detail: args.p_detail });
      return { data: { stale: false }, error: null };
    }
    return { data: null, error: { message: 'unexpected' } };
  });
  return { db: { rpc } as unknown as Db, rpc, finishes };
}

function driver(answers: SendResult[] = []): EmailDriver & { sent: OutgoingEmail[] } {
  const sent: OutgoingEmail[] = [];
  return {
    name: 'fake',
    sent,
    send: async (mail) => {
      sent.push(mail);
      return answers.shift() ?? { outcome: 'sent' };
    },
  };
}

function clock() {
  let t = 1_000_000;
  return {
    now: () => t,
    sleep: vi.fn(async (ms: number) => {
      t += ms;
    }),
    advance: (ms: number) => {
      t += ms;
    },
  };
}

beforeEach(() => {
  mocks.log.info.mockClear();
  mocks.log.warn.mockClear();
  mocks.log.error.mockClear();
});

describe('the email task (AC-8, R-12)', () => {
  it('claims, asks, renders, sends with the outbox key and finishes each row', async () => {
    const { db, rpc, finishes } = scripted([[row(1), row(2)]], {
      [row(1).id]: send('new_offer'),
      [row(2).id]: send('job_started'),
    });
    const d = driver();
    const c = clock();
    const result = await runEmail({
      db,
      driver: d,
      worker: 'w',
      origin: 'http://localhost:3100',
      now: c.now,
      sleep: c.sleep,
    });
    expect(result).toEqual({ sent: 2, skipped: 0, failed: 0, retried: 0 });
    // 50 seconds of budget at 20.5 seconds a row in the worst case (an agreement mail downloads its PDF): 2 rows.
    expect(rpc).toHaveBeenCalledWith('claim_email_outbox', { p_limit: 2, p_worker: 'w' });
    expect(d.sent.map((m) => [m.key, m.to, m.template])).toEqual([
      [row(1).idempotency_key, ADDRESS, 'new_offer'],
      [row(2).idempotency_key, ADDRESS, 'job_started'],
    ]);
    expect(d.sent[0]?.html).toContain(`http://localhost:3100/en/requests/${REQUEST}`);
    expect(finishes).toEqual([
      { id: row(1).id, outcome: 'sent', detail: null },
      { id: row(2).id, outcome: 'sent', detail: null },
    ]);
    expect(rpc).toHaveBeenCalledWith(
      'finish_email',
      expect.objectContaining({ p_claim_token: row(1).claim_token }),
    );
  });

  it('a skip finishes with its reason, sends nothing and costs no wait', async () => {
    const { db, finishes } = scripted([[row(1), row(2), row(3), row(4)]], {
      [row(1).id]: { status: 'skip', reason: 'condition' },
      [row(2).id]: { status: 'skip', reason: 'stale' },
      [row(3).id]: { status: 'skip', reason: 'unconfirmed' },
      [row(4).id]: { status: 'skip', reason: 'email_off' },
    });
    const d = driver();
    const c = clock();
    const result = await runEmail({ db, driver: d, worker: 'w', origin: 'o', now: c.now, sleep: c.sleep });
    expect(result.skipped).toBe(4);
    expect(d.sent).toEqual([]);
    expect(c.sleep).not.toHaveBeenCalled();
    expect(finishes.map((f) => f.outcome)).toEqual(['condition', 'stale', 'unconfirmed', 'email_off']);
  });

  it('paces sends to 2 a second', async () => {
    const rows = [row(1), row(2), row(3)];
    const { db } = scripted([rows], Object.fromEntries(rows.map((r) => [r.id, send('new_offer')])));
    const c = clock();
    await runEmail({ db, driver: driver(), worker: 'w', origin: 'o', now: c.now, sleep: c.sleep });
    expect(c.sleep.mock.calls.map(([ms]) => ms)).toEqual([EMAIL_SEND_INTERVAL_MS, EMAIL_SEND_INTERVAL_MS]);
  });

  it('maps every driver answer to finish_email (R-11)', async () => {
    const rows = [row(1), row(2), row(3), row(4)];
    const { db, finishes } = scripted([rows], Object.fromEntries(rows.map((r) => [r.id, send('new_offer')])));
    const c = clock();
    const result = await runEmail({
      db,
      driver: driver([
        { outcome: 'already_sent', detail: 'http_409:invalid_idempotent_request' },
        { outcome: 'rejected', detail: 'http_422:validation_error' },
        { outcome: 'retry', detail: 'http_429:rate_limit_exceeded' },
        { outcome: 'retry', detail: 'Timeout For person@x.com' },
      ]),
      worker: 'w',
      origin: 'o',
      now: c.now,
      sleep: c.sleep,
    });
    expect(finishes).toEqual([
      { id: row(1).id, outcome: 'already_sent', detail: 'http_409:invalid_idempotent_request' },
      { id: row(2).id, outcome: 'rejected', detail: 'http_422:validation_error' },
      { id: row(3).id, outcome: 'retry', detail: 'http_429:rate_limit_exceeded' },
      { id: row(4).id, outcome: 'retry', detail: null },
    ]);
    expect(result).toEqual({ sent: 1, skipped: 0, failed: 1, retried: 2 });
  });

  it('the off driver ends a sendable mail email_off and sends nothing', async () => {
    const { db, finishes } = scripted([[row(1)]], { [row(1).id]: send('new_offer') });
    const off: EmailDriver = { name: 'off', send: vi.fn(async () => ({ outcome: 'email_off' as const })) };
    await runEmail({ db, driver: off, worker: 'w', origin: 'o' });
    expect(off.send).not.toHaveBeenCalled();
    expect(finishes).toEqual([{ id: row(1).id, outcome: 'email_off', detail: null }]);
  });

  it('a context it cannot read, or a refusal, retries; a mail it cannot render is rejected', async () => {
    const { db, finishes } = scripted([[row(1), row(2), row(3)]], {
      [row(1).id]: { status: 'send', template: 'unknown_template' },
      [row(2).id]: new Error('invalid_state'),
      [row(3).id]: send('new_offer', { request_id: null }),
    });
    const d = driver();
    const result = await runEmail({ db, driver: d, worker: 'w', origin: 'o' });
    expect(finishes).toEqual([
      { id: row(1).id, outcome: 'retry', detail: 'context_invalid' },
      { id: row(2).id, outcome: 'retry', detail: 'context_invalid' },
      { id: row(3).id, outcome: 'rejected', detail: 'render:request_id_missing' },
    ]);
    expect(d.sent).toEqual([]);
    expect(result).toEqual({ sent: 0, skipped: 0, failed: 1, retried: 2 });
  });

  it('drains batch after batch, and stops at the deadline before the next claim', async () => {
    const { db, rpc } = scripted([[row(1)], [row(2)], [row(3)]], {
      [row(1).id]: { status: 'skip', reason: 'stale' },
      [row(2).id]: { status: 'skip', reason: 'stale' },
      [row(3).id]: { status: 'skip', reason: 'stale' },
    });
    const c = clock();
    let claims = 0;
    rpc.mockImplementationOnce(async () => {
      claims += 1;
      c.advance(30_000);
      return { data: [row(1)], error: null };
    });
    await runEmail({ db, driver: driver(), worker: 'w', origin: 'o', now: c.now, sleep: c.sleep });
    expect(claims).toBe(1);
    expect(rpc.mock.calls.filter(([fn]) => fn === 'claim_email_outbox')).toHaveLength(1);
  });

  it('claims only as many rows as the time left lets finish, at least 1 and at most 10', () => {
    // Spec 0011-20 AC-8: every row counts at 20.5 seconds (an agreement mail downloads its PDF first).
    expect(claimLimit(50_000)).toBe(2);
    expect(claimLimit(41_000)).toBe(2);
    expect(claimLimit(40_000)).toBe(1);
    expect(claimLimit(25_000)).toBe(1);
    expect(claimLimit(1_000)).toBe(1);
    expect(claimLimit(1_000_000)).toBe(10);
  });

  it('logs only the outbox id, the template and the outcome (AC-9)', async () => {
    const { db } = scripted([[row(1), row(2)]], {
      [row(1).id]: send('new_offer'),
      [row(2).id]: { status: 'skip', reason: 'condition' },
    });
    await runEmail({ db, driver: driver(), worker: 'w', origin: 'o' });
    const logged = JSON.stringify([
      ...mocks.log.info.mock.calls,
      ...mocks.log.warn.mock.calls,
      ...mocks.log.error.mock.calls,
    ]);
    expect(logged).not.toContain(ADDRESS);
    expect(logged).not.toContain('Cleaning');
    expect(mocks.log.info).toHaveBeenCalledWith('email_finished', {
      request_id: row(1).id,
      code: 'new_offer:sent',
    });
    expect(mocks.log.info).toHaveBeenCalledWith('email_finished', {
      request_id: row(2).id,
      code: 'condition',
    });
  });
});
