'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { markRefundDone, refundFee } from '@/lib/admin-requests';
import { ADMIN_REQUEST_DB_CODES, REASON_MAX } from '@/lib/admin-requests/constants';
import { fail, guardedAction } from '@/lib/auth/action';

/**
 * Admin's two writes on a request's money trail (spec 0011-12 AC-8, AC-9). Admin only; each database function
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
