import 'server-only';

import { AgreementRenderError, renderAgreementPdf } from '@/lib/agreements/render';
import { AgreementTemplateError } from '@/lib/agreements/fields';
import type { Db } from '@/lib/db/types';
import { raiseAlert } from '@/lib/observability/alert';
import { log } from '@/lib/observability/log';
import { isRegion } from '@/lib/region';
import { agreementPath } from '@/lib/storage/buckets';
import { uploadAgreement } from '@/lib/storage/agreements';

import { call } from './db';
import type { Outcome, OutboxRow } from './handlers';

/**
 * `agreement.render` (spec 0011-20 AC-6, AC-7): the relay turns one agreement's frozen content and accepted template
 * into the Turkish PDF, uploads it to `service-agreements` under this attempt's own path, and ends it with
 * `finish_agreement_render`, which records the file once and queues the two mails and notices. Safe to run twice: a
 * rendered agreement is done, and an upload that already exists counts only when its bytes are the same. A failure
 * goes back to the outbox schedule; the last one marks the agreement failed and alerts (`agreementGaveUp`). Logs carry
 * ids and codes only, never a path, a name or a byte.
 */

type RenderContext = {
  id: string;
  region: string;
  number: string;
  rendered: boolean;
  content: unknown;
  sections: unknown;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The agreement id and the attempt number from the row's key `agreement.render:<id>:<n>`, or null. */
export function renderTarget(
  row: Pick<OutboxRow, 'idempotency_key' | 'payload'>,
): { id: string; attempt: number } | null {
  const match = /^agreement\.render:([0-9a-f-]{36}):(\d{1,3})$/.exec(row.idempotency_key);
  if (!match || !UUID.test(match[1]!) || row.payload.agreement_id !== match[1]) return null;
  return { id: match[1]!, attempt: Number(match[2]) };
}

export async function renderAgreement(db: Db, row: OutboxRow): Promise<Outcome> {
  const target = renderTarget(row);
  if (!target) return { ok: false, error: 'agreement_row_invalid' };
  const ctx = await call<RenderContext>(db, 'agreement_render_context', { p_id: target.id });
  if (ctx.rendered) return { ok: true };

  let rendered: { bytes: Buffer; sha256: string };
  try {
    rendered = await renderAgreementPdf({ content: ctx.content, sections: ctx.sections });
  } catch (error) {
    const code =
      error instanceof AgreementRenderError || error instanceof AgreementTemplateError
        ? error.code
        : 'render_failed';
    log.warn('agreement_render_failed', { request_id: target.id, code });
    return { ok: false, error: `render:${code}` };
  }

  // The number's year is the reveal's year in the region's time zone (HS-<region>-<year>-<seq>).
  const year = ctx.number.split('-')[2] ?? '';
  const path = agreementPath(ctx.region, year, target.id, target.attempt);
  const upload = await uploadAgreement(db, path, rendered.bytes);
  if (!upload.ok) {
    log.warn('agreement_upload_failed', { request_id: target.id, code: upload.code });
    return { ok: false, error: `upload:${upload.code}` };
  }
  await call(db, 'finish_agreement_render', {
    p_id: target.id,
    p_path: path,
    p_sha256: rendered.sha256,
    p_byte_size: rendered.bytes.length,
  });
  log.info('agreement_rendered', { request_id: target.id });
  return { ok: true };
}

/** AC-7: the last explicit failure, and a lease that ran out (the heartbeat): mark it failed and alert, ids only. */
export async function agreementGaveUp(db: Db, row: Pick<OutboxRow, 'payload' | 'region' | 'id'>) {
  const id = row.payload.agreement_id;
  const region = isRegion(row.region) ? row.region : undefined;
  if (typeof id !== 'string' || !UUID.test(id)) {
    raiseAlert('outbox_failed', { recordId: row.id, region });
    return;
  }
  const result = await call<{ status: 'failed' | 'rendered' }>(db, 'fail_agreement_render', { p_id: id });
  if (result.status === 'failed') raiseAlert('agreement_render_failed', { recordId: id, region });
}

/** AC-5: every pick unlocked in the last day without an agreement alerts `agreement_missing` (the heartbeat). */
export async function alertAgreementGaps(db: Db): Promise<number> {
  const gaps = await call<{ application_id: string; region: string }[]>(db, 'agreement_gaps');
  for (const gap of gaps) {
    raiseAlert('agreement_missing', {
      recordId: gap.application_id,
      region: isRegion(gap.region) ? gap.region : undefined,
    });
  }
  return gaps.length;
}
