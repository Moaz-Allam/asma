import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtempSync, readFileSync as readText } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Db } from '@/lib/db/types';
import type { EmailDriver, OutgoingEmail, SendResult } from '@/lib/email';

/**
 * Spec 0011-20 AC-5 to AC-8, AC-14: the relay's `agreement.render` handler, its give up and the heartbeat's gap alert,
 * the mail step that attaches the PDF, and the drivers' attachments, against scripted databases. The SQL is proven in
 * supabase/tests/42 and 43.
 */

const mocks = vi.hoisted(() => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  raiseAlert: vi.fn(),
}));
vi.mock('@/lib/observability/log', () => ({ log: mocks.log }));
vi.mock('@/lib/observability/alert', () => ({ raiseAlert: mocks.raiseAlert }));

const { renderAgreement, renderTarget, agreementGaveUp, alertAgreementGaps } =
  await import('@/lib/relay/agreement');
const { runEmail } = await import('@/lib/relay/email');
const { createFakeDriver, createResendDriver } = await import('@/lib/email/drivers');

const sql = readFileSync('supabase/migrations/20261204090000_service_agreement.sql', 'utf8');
const SECTIONS = JSON.parse(sql.slice(sql.indexOf('$json$[') + 6, sql.lastIndexOf(']$json$') + 1)) as unknown;

const ID = '6f1c2d3e-4a5b-4c6d-8e7f-001122334455';
const CONTENT = {
  agreement_number: 'HS-TR-2026-000007',
  agreement_date: '2026-11-23',
  timezone: 'Europe/Istanbul',
  unlocked_at: '2026-11-23T07:30:00.000Z',
  customer_name: 'Ayşe Müşteri',
  customer_phone: '+905551112233',
  provider_name: 'İlker Usta',
  provider_phone: '+905554445566',
  platform_name: 'Aldebyani',
  service_name: 'Temizlik',
  category_name: 'Ev',
  addon_names: [],
  district: 'Moda',
  street_line: 'Moda Cad. No 9',
  scheduled_start: '2026-11-25T07:00:00.000Z',
  scheduled_end: '2026-11-25T09:00:00.000Z',
  job_price: 100000,
  commission: 10000,
  provider_fee: 5000,
  cash_due: 90000,
  currency: 'TRY',
  customer_accepted_at: '2026-11-23T07:00:00.000Z',
  provider_accepted_at: '2026-11-23T07:29:00.000Z',
  template_version: 'draft-1',
};

type Upload = { path: string; bytes: Uint8Array; options: unknown };

/** A relay database: the render context, a bucket that keeps what it is given, and the function calls it saw. */
function relayDb(
  over: {
    rendered?: boolean;
    existing?: Uint8Array;
    uploadError?: { statusCode: string; message: string };
  } = {},
) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const uploads: Upload[] = [];
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    if (fn === 'agreement_render_context') {
      return {
        data: {
          id: ID,
          region: 'TR',
          number: CONTENT.agreement_number,
          rendered: over.rendered ?? false,
          content: CONTENT,
          sections: SECTIONS,
        },
        error: null,
      };
    }
    if (fn === 'finish_agreement_render')
      return { data: { status: 'rendered', replayed: false }, error: null };
    return { data: null, error: { message: 'unexpected' } };
  });
  const bucket = {
    upload: vi.fn(async (p: string, bytes: Uint8Array, options: unknown) => {
      uploads.push({ path: p, bytes, options });
      return over.uploadError ? { data: null, error: over.uploadError } : { data: { path: p }, error: null };
    }),
    download: vi.fn(async () =>
      over.existing
        ? { data: new Blob([new Uint8Array(over.existing)]), error: null }
        : { data: null, error: { message: 'missing' } },
    ),
  };
  const storage = { from: vi.fn(() => bucket) };
  return { db: { rpc, storage } as unknown as Db, calls, uploads, bucket };
}

const renderRow = (attempt = 1) => ({
  id: '00000000-0000-4000-8000-0000000000aa',
  kind: 'agreement.render',
  idempotency_key: `agreement.render:${ID}:${attempt}`,
  payload: { agreement_id: ID },
  attempts: 1,
  region: 'TR',
  claim_token: '2026-11-23T08:00:00.000000+00:00',
});

beforeEach(() => {
  mocks.log.info.mockClear();
  mocks.log.warn.mockClear();
  mocks.log.error.mockClear();
  mocks.raiseAlert.mockClear();
});

describe('renderTarget', () => {
  it('reads the agreement id and the attempt from the key, and checks the payload names the same id', () => {
    expect(renderTarget(renderRow(3))).toEqual({ id: ID, attempt: 3 });
    expect(
      renderTarget({ ...renderRow(), payload: { agreement_id: '6f1c2d3e-4a5b-4c6d-8e7f-001122334400' } }),
    ).toBeNull();
    expect(renderTarget({ ...renderRow(), idempotency_key: 'agreement.render:not-an-id:1' })).toBeNull();
  });
});

describe('renderAgreement (AC-6)', () => {
  it('renders, uploads to the attempt path without upsert, and finishes with the file fields', async () => {
    const { db, calls, uploads } = relayDb();
    expect(await renderAgreement(db, renderRow(2))).toEqual({ ok: true });
    expect(uploads).toHaveLength(1);
    expect(uploads[0]?.path).toBe(`TR/2026/${ID}-r2.pdf`);
    expect(uploads[0]?.options).toEqual({ contentType: 'application/pdf', upsert: false });
    const finish = calls.find((c) => c.fn === 'finish_agreement_render');
    const bytes = uploads[0]!.bytes;
    expect(finish?.args).toEqual({
      p_id: ID,
      p_path: `TR/2026/${ID}-r2.pdf`,
      p_sha256: createHash('sha256').update(bytes).digest('hex'),
      p_byte_size: bytes.length,
    });
  });

  it('does nothing for an agreement already rendered (a replay)', async () => {
    const { db, uploads, calls } = relayDb({ rendered: true });
    expect(await renderAgreement(db, renderRow())).toEqual({ ok: true });
    expect(uploads).toHaveLength(0);
    expect(calls.some((c) => c.fn === 'finish_agreement_render')).toBe(false);
  });

  it('counts an existing object as done only when its bytes are the same', async () => {
    const first = relayDb();
    await renderAgreement(first.db, renderRow());
    const same = first.uploads[0]!.bytes;
    const exists = { statusCode: '409', message: 'The resource already exists' };
    const again = relayDb({ uploadError: exists, existing: same });
    expect(await renderAgreement(again.db, renderRow())).toEqual({ ok: true });
    expect(again.calls.some((c) => c.fn === 'finish_agreement_render')).toBe(true);
    const other = relayDb({ uploadError: exists, existing: new Uint8Array([1, 2, 3]) });
    expect(await renderAgreement(other.db, renderRow())).toEqual({
      ok: false,
      error: 'upload:exists_differs',
    });
    expect(other.calls.some((c) => c.fn === 'finish_agreement_render')).toBe(false);
  });

  it('returns an upload failure to the outbox schedule, logging ids only', async () => {
    const { db } = relayDb({ uploadError: { statusCode: '500', message: 'boom with a path TR/2026/x.pdf' } });
    expect(await renderAgreement(db, renderRow())).toEqual({ ok: false, error: 'upload:upload_failed' });
    expect(JSON.stringify(mocks.log.warn.mock.calls)).not.toContain('TR/2026');
  });

  it('refuses a row whose key does not name its agreement', async () => {
    const { db, calls } = relayDb();
    expect(await renderAgreement(db, { ...renderRow(), idempotency_key: 'agreement.render:x:1' })).toEqual({
      ok: false,
      error: 'agreement_row_invalid',
    });
    expect(calls).toHaveLength(0);
  });
});

describe('agreementGaveUp and the gap alert (AC-5, AC-7)', () => {
  function failDb(status: 'failed' | 'already_failed' | 'rendered') {
    const rpc = vi.fn(async (fn: string) =>
      fn === 'fail_agreement_render'
        ? { data: { status }, error: null }
        : fn === 'agreement_gaps'
          ? { data: [{ application_id: ID, region: 'TR' }], error: null }
          : { data: null, error: { message: 'unexpected' } },
    );
    return { db: { rpc } as unknown as Db, rpc };
  }

  it('marks a failed render failed and alerts agreement_render_failed with the agreement id', async () => {
    const { db, rpc } = failDb('failed');
    await agreementGaveUp(db, renderRow());
    expect(rpc).toHaveBeenCalledWith('fail_agreement_render', { p_id: ID });
    expect(mocks.raiseAlert).toHaveBeenCalledWith('agreement_render_failed', { recordId: ID, region: 'TR' });
  });

  it('alerts once: a second give up (drain, then the heartbeat) stays quiet', async () => {
    const { db } = failDb('already_failed');
    await agreementGaveUp(db, renderRow());
    expect(mocks.raiseAlert).not.toHaveBeenCalled();
  });

  it('stays quiet when the file exists after all', async () => {
    const { db } = failDb('rendered');
    await agreementGaveUp(db, renderRow());
    expect(mocks.raiseAlert).not.toHaveBeenCalled();
  });

  it('alerts agreement_missing for every pick unlocked without an agreement', async () => {
    const { db } = failDb('failed');
    expect(await alertAgreementGaps(db)).toBe(1);
    expect(mocks.raiseAlert).toHaveBeenCalledWith('agreement_missing', { recordId: ID, region: 'TR' });
  });
});

describe('the agreement mail (AC-8)', () => {
  const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3]);
  const sha = createHash('sha256').update(PDF).digest('hex');
  const mailRow = {
    id: '00000000-0000-4000-8000-0000000000b1',
    idempotency_key: `agreement:${ID}:customer`,
    claim_token: '2026-11-23T08:00:00.000000+00:00',
    attempts: 1,
  };
  const context = {
    status: 'send',
    template: 'agreement_ready_customer',
    email: 'c-20@example.com',
    locale: 'tr',
    region_locale: 'tr',
    timezone: 'Europe/Istanbul',
    values: {
      side: 'customer',
      request_id: '11111111-1111-4111-8111-111111111111',
      service: { tr: 'Temizlik' },
      start_at: null,
      deadline: null,
      amount: null,
      currency: 'TRY',
      fee_id: null,
      carried: null,
      token: null,
      agreement_id: ID,
      agreement_number: CONTENT.agreement_number,
    },
  };

  function mailDb(file: { storage_path: string; sha256: string } | null) {
    const finishes: Array<{ outcome: string; detail: unknown }> = [];
    let claimed = false;
    const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
      if (fn === 'claim_email_outbox') {
        const rows = claimed ? [] : [mailRow];
        claimed = true;
        return { data: rows, error: null };
      }
      if (fn === 'email_context') return { data: context, error: null };
      if (fn === 'agreement_file') {
        return file
          ? { data: { number: CONTENT.agreement_number, byte_size: PDF.length, ...file }, error: null }
          : { data: null, error: { message: 'not_found' } };
      }
      if (fn === 'finish_email') {
        finishes.push({ outcome: args.p_outcome as string, detail: args.p_detail });
        return { data: { stale: false }, error: null };
      }
      return { data: null, error: { message: 'unexpected' } };
    });
    const bucket = { download: vi.fn(async () => ({ data: new Blob([PDF]), error: null })) };
    return { db: { rpc, storage: { from: vi.fn(() => bucket) } } as unknown as Db, finishes, bucket };
  }

  function driver(): EmailDriver & { sent: OutgoingEmail[] } {
    const sent: OutgoingEmail[] = [];
    return {
      name: 'fake',
      sent,
      send: async (mail): Promise<SendResult> => (sent.push(mail), { outcome: 'sent' }),
    };
  }

  it('attaches the stored PDF under its Turkish file name', async () => {
    const { db, finishes, bucket } = mailDb({ storage_path: `TR/2026/${ID}-r1.pdf`, sha256: sha });
    const d = driver();
    await runEmail({ db, driver: d, worker: 'w', origin: 'http://localhost:3100', sleep: async () => {} });
    expect(bucket.download).toHaveBeenCalledWith(`TR/2026/${ID}-r1.pdf`);
    expect(d.sent).toHaveLength(1);
    expect(d.sent[0]?.attachments?.map((a) => [a.filename, a.content.byteLength])).toEqual([
      [`Hizmet-Sozlesmesi-${CONTENT.agreement_number}.pdf`, PDF.length],
    ]);
    expect(finishes).toEqual([{ outcome: 'sent', detail: null }]);
  });

  it('ends the row as retry when the file cannot be read, or its hash differs', async () => {
    for (const file of [null, { storage_path: `TR/2026/${ID}-r1.pdf`, sha256: 'f'.repeat(64) }]) {
      const { db, finishes } = mailDb(file);
      const d = driver();
      await runEmail({ db, driver: d, worker: 'w', origin: 'http://localhost:3100', sleep: async () => {} });
      expect(d.sent).toHaveLength(0);
      expect(finishes).toEqual([{ outcome: 'retry', detail: 'attachment_unavailable' }]);
    }
  });
});

describe('the drivers carry attachments (AC-8)', () => {
  const mail: OutgoingEmail = {
    subject: 's',
    text: 't',
    html: '<p>h</p>',
    to: 'p-20@example.com',
    key: 'agreement:x:provider',
    template: 'agreement_ready_provider',
    locale: 'en',
    attachments: [
      { filename: 'Hizmet-Sozlesmesi-HS-TR-2026-000007.pdf', content: new Uint8Array([1, 2, 3, 4]) },
    ],
  };

  it('the fake driver records each attachment name, size and SHA256, never its bytes', async () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'agreement-mail-')), 'mail.jsonl');
    await createFakeDriver(file).send(mail);
    const line = JSON.parse(readText(file, 'utf8').trim()) as { attachments: unknown };
    expect(line.attachments).toEqual([
      {
        filename: 'Hizmet-Sozlesmesi-HS-TR-2026-000007.pdf',
        size: 4,
        sha256: createHash('sha256')
          .update(new Uint8Array([1, 2, 3, 4]))
          .digest('hex'),
      },
    ]);
    expect(readText(file, 'utf8')).not.toContain('AQIDBA');
  });

  it('Resend gets each file as base64 content', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    await createResendDriver({
      apiKey: 'k',
      from: 'a@b.c',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).send(mail);
    const body = JSON.parse(
      (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    ) as {
      attachments: unknown;
    };
    expect(body.attachments).toEqual([
      { filename: 'Hizmet-Sozlesmesi-HS-TR-2026-000007.pdf', content: 'AQIDBA==' },
    ]);
  });

  it('a mail without attachments sends none', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    await createResendDriver({
      apiKey: 'k',
      from: 'a@b.c',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).send({
      ...mail,
      attachments: undefined,
    });
    const body = JSON.parse(
      (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    ) as object;
    expect('attachments' in body).toBe(false);
  });
});
