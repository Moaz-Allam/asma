import 'server-only';

import { z } from 'zod';

import { createSupabaseServer } from '@/lib/db/server';
import { AGREEMENT_LINK_SECONDS, AGREEMENTS_BUCKET } from '@/lib/storage/buckets';
import { signedLink } from '@/lib/storage/server';

import { AgreementSectionsSchema } from './fields';

/**
 * The parties' door to the service agreement (spec 0011-20 AC-1, AC-9, AC-12). Each wrapper calls a definer function
 * as the signed in user; Postgres decides who is a party, whether the card still shows and whether the bucket lets the
 * caller read. No table is read directly. A link is signed as the signed in user, never with the service role, and is
 * never logged.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VERSION = /^[a-z0-9._-]{1,40}$/;

export const AGREEMENT_DB_CODES = ['not_found', 'forbidden', 'invalid_state', 'validation_failed'] as const;
export type AgreementCode = (typeof AGREEMENT_DB_CODES)[number];

const TemplateRead = z
  .object({ version: z.string(), active: z.boolean(), sections: AgreementSectionsSchema })
  .strict();
export type AgreementTemplate = z.infer<typeof TemplateRead>;

const MyAgreement = z
  .object({
    id: z.string().regex(UUID),
    number: z.string(),
    side: z.enum(['customer', 'provider']),
    opened: z.boolean(),
  })
  .strict();
export type MyAgreement = z.infer<typeof MyAgreement>;

function codeOf(error: unknown): AgreementCode | null {
  const message = typeof error === 'object' && error !== null && 'message' in error ? error.message : null;
  return typeof message === 'string' && (AGREEMENT_DB_CODES as readonly string[]).includes(message)
    ? (message as AgreementCode)
    : null;
}

type Fn = 'agreement_template' | 'my_agreement' | 'open_service_agreement' | 'my_accepted_agreement';

async function call(
  fn: Fn,
  args: Record<string, unknown>,
): Promise<{ data: unknown } | { ok: false; code: AgreementCode }> {
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.rpc(fn, args as never);
  if (error) {
    const code = codeOf(error);
    if (code) return { ok: false, code };
    throw error;
  }
  return { data };
}

/** AC-1, AC-12: the active template of the caller's region (no version), or the named version; null when unknown. */
export async function loadAgreementTemplate(version: string | null): Promise<AgreementTemplate | null> {
  if (version !== null && !VERSION.test(version)) return null;
  const result = await call('agreement_template', { p_version: version });
  if ('ok' in result) {
    if (result.code === 'not_found') return null;
    throw new Error(`agreement_template refused: ${result.code}`);
  }
  return TemplateRead.parse(result.data);
}

/** AC-2, AC-4: the version a customer accepts now (the region's active one), or null when none is active. */
export async function activeAgreementVersion(): Promise<string | null> {
  return (await loadAgreementTemplate(null))?.version ?? null;
}

/** AC-9: the card's read, or null (no agreement, not a party, or no longer shown). */
export async function loadMyAgreement(requestId: string): Promise<MyAgreement | null> {
  if (!UUID.test(requestId)) return null;
  const result = await call('my_agreement', { p_request_id: requestId });
  if ('ok' in result) {
    if (result.code === 'not_found') return null;
    throw new Error(`my_agreement refused: ${result.code}`);
  }
  return result.data === null ? null : MyAgreement.parse(result.data);
}

/** Try again (AC-2, AC-3): the version the caller already accepted for the request's current pick, or null. */
export async function myAcceptedAgreement(requestId: string): Promise<string | null> {
  if (!UUID.test(requestId)) return null;
  const result = await call('my_accepted_agreement', { p_request_id: requestId });
  if ('ok' in result) return null;
  return typeof result.data === 'string' && VERSION.test(result.data) ? result.data : null;
}

/** The file name a download is saved under. */
export function agreementFileName(number: string): string {
  return `Hizmet-Sozlesmesi-${number}.pdf`;
}

/**
 * AC-9: Download. Postgres stamps the caller's side once and returns the path in the same call; the link is signed as
 * the signed in user for 300 seconds, which the bucket's read policy allows for 10 minutes after the open.
 */
export async function openAgreement(
  agreementId: string,
  number: string,
): Promise<{ ok: true; url: string | null } | { ok: false; code: AgreementCode }> {
  if (!UUID.test(agreementId)) return { ok: false, code: 'not_found' };
  const result = await call('open_service_agreement', { p_id: agreementId });
  if ('ok' in result) return result;
  const path = z
    .object({ storage_path: z.string().min(1) })
    .strict()
    .parse(result.data).storage_path;
  return {
    ok: true,
    url: await signedLink(AGREEMENTS_BUCKET, path, AGREEMENT_LINK_SECONDS, {
      download: agreementFileName(number),
    }),
  };
}
