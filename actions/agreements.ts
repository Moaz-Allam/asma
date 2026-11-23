'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { agreementLink, ADMIN_AGREEMENT_CODES, rerenderAgreement } from '@/lib/admin-agreements';
import { AGREEMENT_DB_CODES, openAgreement } from '@/lib/agreements';
import { fail, guardedAction } from '@/lib/auth/action';

/**
 * The service agreement actions (spec 0011-20 AC-7, AC-9, AC-10). The parties open their own card's agreement (the
 * customer and the provider of that pick; Postgres decides); admin views (audited first) and renders a failed one again.
 * Each takes an id and the number (for the file name) and nothing else; a link lives 300 seconds for a party and 60
 * for admin, and is never logged.
 */

const PARTIES = ['customer', 'provider'] as const;
const ADMIN = ['admin'] as const;
const KNOWN: readonly string[] = AGREEMENT_DB_CODES;
const KNOWN_ADMIN: readonly string[] = ADMIN_AGREEMENT_CODES;

const OpenInput = z
  .object({ agreementId: z.string().uuid(), number: z.string().regex(/^HS-[A-Z]{2,3}-\d{4}-\d{6}$/) })
  .strict();
const IdInput = z.object({ agreementId: z.string().uuid() }).strict();

/** AC-9: Download (and Download again within 10 minutes). */
export const openAgreementAction = guardedAction(
  { name: 'openAgreement', access: PARTIES, schema: OpenInput },
  async (input): Promise<{ url: string | null } | ReturnType<typeof fail>> => {
    const outcome = await openAgreement(input.agreementId, input.number);
    if (!outcome.ok) return fail(KNOWN.includes(outcome.code) ? outcome.code : 'action_failed');
    return { url: outcome.url };
  },
);

/** AC-10: View. The audit row is written before the link is signed. */
export const adminAgreementLinkAction = guardedAction(
  { name: 'adminAgreementLink', access: ADMIN, schema: OpenInput },
  async (input): Promise<{ url: string | null } | ReturnType<typeof fail>> => {
    const outcome = await agreementLink(input.agreementId, input.number);
    if (!outcome.ok) return fail(KNOWN_ADMIN.includes(outcome.code) ? outcome.code : 'action_failed');
    return { url: outcome.url };
  },
);

/** AC-7: Render again, for a failed agreement only. */
export const rerenderAgreementAction = guardedAction(
  { name: 'rerenderAgreement', access: ADMIN, schema: IdInput },
  async (input): Promise<{ attempt: number } | ReturnType<typeof fail>> => {
    const outcome = await rerenderAgreement(input.agreementId);
    if (!outcome.ok) return fail(KNOWN_ADMIN.includes(outcome.code) ? outcome.code : 'action_failed');
    revalidatePath('/admin/agreements');
    return { attempt: outcome.attempt };
  },
);
