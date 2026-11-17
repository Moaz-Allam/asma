'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { getLocale } from 'next-intl/server';

import { fail, guardedAction } from '@/lib/auth/action';
import { checkoutStatus, payCommission, REQUEST_DB_CODES, type CheckoutStatus } from '@/lib/requests';
import { CheckoutStatusInput, PayCommissionInput } from '@/lib/requests/input';

/**
 * The customer's payment actions (spec 0011-09 AC-9). Only the customer role pays. The client sends a request id
 * or an attempt id, never a figure (rule 1): the database charges the stored commission. A refusal comes back as
 * its stable code, which the page maps to a catalogue string; a raw SQLSTATE never reaches a page.
 */

const ACCESS = ['customer'] as const;
const KNOWN: readonly string[] = REQUEST_DB_CODES;
const LOCALES = ['ar', 'tr', 'en'] as const;
type Locale = (typeof LOCALES)[number];

/** The page locale; the attempt carries it to the card page (08's R-8). */
async function pageLocale(): Promise<Locale> {
  const locale = await getLocale();
  return (LOCALES as readonly string[]).includes(locale) ? (locale as Locale) : 'tr';
}

/**
 * The payer's IP as Vercel saw it (`x-real-ip`), else null. The caller's word for their own fraud signal (N-1);
 * the database keeps it only if it is one full length address, and never logs it (R-10).
 */
async function payerIp(): Promise<string | null> {
  const value = (await headers()).get('x-real-ip');
  return value && value.length <= 45 ? value : null;
}

export type PayActionData =
  { status: 'settled' } | { status: 'checkout'; attemptId: string; reused: boolean };

/** Pay (AC-4, AC-9): a card page attempt to wait on, or settled at once for a commission of 0. */
export const payCommissionAction = guardedAction(
  { name: 'payCommission', access: ACCESS, schema: PayCommissionInput },
  async (input, user): Promise<PayActionData | ReturnType<typeof fail>> => {
    const outcome = await payCommission(
      { requestId: input.requestId, locale: await pageLocale(), payerIp: await payerIp() },
      { region: user.region, userId: user.id },
    );
    if (!outcome.ok) return fail(KNOWN.includes(outcome.code) ? outcome.code : 'action_failed');
    if (outcome.status === 'settled') {
      revalidatePath('/', 'layout');
      return { status: 'settled' };
    }
    return { status: 'checkout', attemptId: outcome.attemptId, reused: outcome.reused };
  },
);

/** The pay and return pages poll this (AC-11, AC-12). `not_found` for another's, unknown or malformed id. */
export const checkoutStatusAction = guardedAction(
  { name: 'checkoutStatus', access: ACCESS, schema: CheckoutStatusInput },
  async (input): Promise<CheckoutStatus | ReturnType<typeof fail>> => {
    const status = await checkoutStatus(input.attemptId);
    return status ?? fail('not_found');
  },
);
