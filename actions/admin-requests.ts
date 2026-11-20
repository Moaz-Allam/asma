'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import {
  cancelRequest,
  clearFlag,
  extendDeadline,
  markRefundDone,
  refundFee,
  showAddress,
} from '@/lib/admin-requests';
import {
  ADMIN_REQUEST_DB_CODES,
  CANCEL_ATTRIBUTIONS,
  EXTEND_HOURS_MAX,
  EXTEND_HOURS_MIN,
  EXTEND_WHICH,
  REASON_MAX,
} from '@/lib/admin-requests/constants';
import { fail, guardedAction } from '@/lib/auth/action';

/**
 * Admin's writes on a request (spec 0011-12 AC-8, AC-9; spec 0011-16 R-3, R-5, R-7, R-8). Admin only; each database function
 * checks `is_admin()` again, locks, and audits the free text. No amount is ever sent: a refund is the paid fee's
 * own (AC-7). The reason's length is Postgres's to judge (`reason_required`); the schema only bounds the input.
 */

const ADMIN = ['admin'] as const;
const KNOWN: readonly string[] = ADMIN_REQUEST_DB_CODES;
/** The input bound: past the database's limit, so a long reason reaches it and comes back `reason_required`. */
const Text = z.string().max(REASON_MAX * 4);

const RefundFeeInput = z.object({ paymentId: z.string().uuid(), reason: Text }).strict();
const RefundDoneInput = z.object({ refundId: z.string().uuid(), note: Text }).strict();

export type AdminMoveData = { replayed: boolean };

/** Refund a paid fee by hand with a reason (AC-8, §36 row 11). */
export const adminRefundFeeAction = guardedAction(
  { name: 'adminRefundFee', access: ADMIN, schema: RefundFeeInput },
  async (input): Promise<AdminMoveData | ReturnType<typeof fail>> => {
    const outcome = await refundFee(input);
    if (!outcome.ok) return fail(KNOWN.includes(outcome.code) ? outcome.code : 'action_failed');
    revalidatePath('/', 'layout');
    return { replayed: outcome.replayed };
  },
);

/** Record a refused refund as refunded by hand in the PSP panel, with a note (AC-9, R-10). */
export const adminMarkRefundDoneAction = guardedAction(
  { name: 'adminMarkRefundDone', access: ADMIN, schema: RefundDoneInput },
  async (input): Promise<AdminMoveData | ReturnType<typeof fail>> => {
    const outcome = await markRefundDone(input);
    if (!outcome.ok) return fail(KNOWN.includes(outcome.code) ? outcome.code : 'action_failed');
    revalidatePath('/', 'layout');
    return { replayed: outcome.replayed };
  },
);

const CancelInput = z
  .object({ requestId: z.string().uuid(), attributedTo: z.enum(CANCEL_ATTRIBUTIONS), reason: Text })
  .strict();
const ExtendInput = z
  .object({
    requestId: z.string().uuid(),
    which: z.enum(EXTEND_WHICH),
    hours: z.number().int().min(EXTEND_HOURS_MIN).max(EXTEND_HOURS_MAX),
    reason: Text,
  })
  .strict();
const AddressInput = z.object({ requestId: z.string().uuid(), reason: Text }).strict();
const ClearFlagInput = z.object({ flagId: z.string().uuid(), note: Text }).strict();

/** Spec 0011-16 R-3: cancel as admin, attributed, with a reason; nothing is refunded here. */
export const adminCancelRequestAction = guardedAction(
  { name: 'adminCancelRequest', access: ADMIN, schema: CancelInput },
  async (input): Promise<AdminMoveData | ReturnType<typeof fail>> => {
    const outcome = await cancelRequest(input);
    if (!outcome.ok) return fail(KNOWN.includes(outcome.code) ? outcome.code : 'action_failed');
    revalidatePath('/', 'layout');
    return { replayed: outcome.replayed };
  },
);

/** Spec 0011-16 R-5: extend one deadline once. */
export const adminExtendDeadlineAction = guardedAction(
  { name: 'adminExtendDeadline', access: ADMIN, schema: ExtendInput },
  async (input): Promise<{ deadline: string } | ReturnType<typeof fail>> => {
    const outcome = await extendDeadline(input);
    if (!outcome.ok) return fail(KNOWN.includes(outcome.code) ? outcome.code : 'action_failed');
    revalidatePath('/', 'layout');
    return { deadline: outcome.deadline };
  },
);

/**
 * Spec 0011-16 R-8, X-13: the street line, returned only to the client component that asked. Nothing is revalidated
 * or cached; the audit row is written in Postgres before the line comes back.
 */
export const adminShowAddressAction = guardedAction(
  { name: 'adminShowAddress', access: ADMIN, schema: AddressInput },
  async (input): Promise<{ line: string } | ReturnType<typeof fail>> => {
    const outcome = await showAddress(input);
    if (!outcome.ok) return fail(KNOWN.includes(outcome.code) ? outcome.code : 'action_failed');
    return { line: outcome.line };
  },
);

/** Spec 0011-16 R-7: clear an open flag by hand with a note. */
export const adminClearFlagAction = guardedAction(
  { name: 'adminClearFlag', access: ADMIN, schema: ClearFlagInput },
  async (input): Promise<AdminMoveData | ReturnType<typeof fail>> => {
    const outcome = await clearFlag(input);
    if (!outcome.ok) return fail(KNOWN.includes(outcome.code) ? outcome.code : 'action_failed');
    revalidatePath('/', 'layout');
    return { replayed: false };
  },
);
