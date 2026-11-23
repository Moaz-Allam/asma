import 'server-only';

import { z } from 'zod';

import { agreementFileName } from '@/lib/agreements';
import { createSupabaseServer } from '@/lib/db/server';
import { AGREEMENTS_BUCKET, SIGNED_LINK_SECONDS } from '@/lib/storage/buckets';
import { signedLink } from '@/lib/storage/server';

/**
 * Admin's server only door to service agreements (spec 0011-20 AC-7, AC-10): `listAgreements`, `agreementLink`,
 * `rerenderAgreement` wrap `admin_agreements`, `admin_agreement_link` and `admin_rerender_agreement`, each checking
 * `is_admin()` again. A link is signed (60 seconds, as the signed in admin) only after the view's audit row exists. No
 * path edits, deletes or changes an agreement.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ADMIN_AGREEMENT_CODES = [
  'forbidden',
  'not_found',
  'invalid_state',
  'validation_failed',
] as const;
export type AdminAgreementCode = (typeof ADMIN_AGREEMENT_CODES)[number];
type Refused = { ok: false; code: AdminAgreementCode };

const Instant = z.string().min(1);
const AgreementRow = z
  .object({
    id: z.string().regex(UUID),
    number: z.string(),
    region: z.string(),
    timezone: z.string().min(1),
    request_id: z.string().regex(UUID),
    request_status: z.string(),
    customer_name: z.string().nullable(),
    provider_name: z.string().nullable(),
    created_at: Instant,
    rendered_at: Instant.nullable(),
    failed: z.boolean(),
    customer_opened_at: Instant.nullable(),
    provider_opened_at: Instant.nullable(),
  })
  .strict();
export type AdminAgreementRow = z.infer<typeof AgreementRow>;
const AgreementsPage = z.object({ rows: z.array(AgreementRow), has_more: z.boolean() }).strict();
export type AdminAgreementsPage = z.infer<typeof AgreementsPage>;

function codeOf(error: unknown): AdminAgreementCode | null {
  const message = typeof error === 'object' && error !== null && 'message' in error ? error.message : null;
  return typeof message === 'string' && (ADMIN_AGREEMENT_CODES as readonly string[]).includes(message)
    ? (message as AdminAgreementCode)
    : null;
}

type Fn = 'admin_agreements' | 'admin_agreement_link' | 'admin_rerender_agreement';

async function call(fn: Fn, args: Record<string, unknown>): Promise<{ data: unknown } | Refused> {
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.rpc(fn, args as never);
  if (error) {
    const code = codeOf(error);
    if (code) return { ok: false, code };
    throw error;
  }
  return { data };
}

/** AC-10: 50 a page, newest first, by number or request id; `after` is the last row's id. */
export async function listAgreements(
  query: string | null,
  after: string | null,
): Promise<AdminAgreementsPage | Refused> {
  const result = await call('admin_agreements', {
    p_query: query && query.trim().length > 0 ? query.trim().slice(0, 100) : null,
    p_after: after && UUID.test(after) ? after : null,
  });
  if ('ok' in result) return result;
  return AgreementsPage.parse(result.data);
}

/** AC-10: one audited view, then a 60 second link signed as the admin. */
export async function agreementLink(
  agreementId: string,
  number: string,
): Promise<{ ok: true; url: string | null } | Refused> {
  if (!UUID.test(agreementId)) return { ok: false, code: 'not_found' };
  const result = await call('admin_agreement_link', { p_id: agreementId });
  if ('ok' in result) return result;
  const view = z
    .object({ bucket: z.literal(AGREEMENTS_BUCKET), path: z.string().min(1) })
    .strict()
    .parse(result.data);
  return {
    ok: true,
    url: await signedLink(AGREEMENTS_BUCKET, view.path, SIGNED_LINK_SECONDS, {
      download: agreementFileName(number),
    }),
  };
}

/** AC-7: a new render of a failed agreement, with the same frozen content. */
export async function rerenderAgreement(
  agreementId: string,
): Promise<{ ok: true; attempt: number } | Refused> {
  if (!UUID.test(agreementId)) return { ok: false, code: 'not_found' };
  const result = await call('admin_rerender_agreement', { p_id: agreementId });
  if ('ok' in result) return result;
  return {
    ok: true,
    attempt: z
      .object({ status: z.literal('queued'), attempt: z.number().int() })
      .strict()
      .parse(result.data).attempt,
  };
}
