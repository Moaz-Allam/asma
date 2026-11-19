'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { fail, guardedAction } from '@/lib/auth/action';
import { moveJob, providerCancelJob, withdrawApplication } from '@/lib/provider-feed';
import { PROVIDER_FEED_DB_CODES } from '@/lib/provider-feed/constants';
import { closeJob, REQUEST_DB_CODES } from '@/lib/requests';

/**
 * The work and close actions (spec 0011-11 AC-9). The provider presses Started and Done; the customer confirms or
 * closes. Each action takes its own role only and a request id; no money moves (D91). A refusal comes back as its
 * stable code, which the page maps to a catalogue string; a raw SQLSTATE never reaches a page.
 */

const JobInput = z.object({ requestId: z.string().uuid() }).strict();
const WithdrawInput = z.object({ applicationId: z.string().uuid() }).strict();
const PROVIDER = ['provider'] as const;
const CUSTOMER = ['customer'] as const;
const KNOWN_PROVIDER: readonly string[] = PROVIDER_FEED_DB_CODES;
const KNOWN_CUSTOMER: readonly string[] = REQUEST_DB_CODES;

export type JobMoveData = { replayed: boolean };

function providerAction(move: 'start' | 'finish', name: string) {
  return guardedAction(
    { name, access: PROVIDER, schema: JobInput },
    async (input, user): Promise<JobMoveData | ReturnType<typeof fail>> => {
      const outcome = await moveJob(move, input.requestId, { region: user.region });
      if (!outcome.ok) return fail(KNOWN_PROVIDER.includes(outcome.code) ? outcome.code : 'action_failed');
      revalidatePath('/', 'layout');
      return { replayed: outcome.replayed };
    },
  );
}

function customerAction(move: 'confirm' | 'mark_done', name: string) {
  return guardedAction(
    { name, access: CUSTOMER, schema: JobInput },
    async (input): Promise<JobMoveData | ReturnType<typeof fail>> => {
      const outcome = await closeJob(move, input.requestId);
      if (!outcome.ok) return fail(KNOWN_CUSTOMER.includes(outcome.code) ? outcome.code : 'action_failed');
      revalidatePath('/', 'layout');
      return { replayed: outcome.replayed };
    },
  );
}

/** Started (AC-2): from 00:00 of the start day in the region's time zone. */
export const startJobAction = providerAction('start', 'startJob');
/** Done (AC-3): after Started; the confirm window starts. */
export const finishJobAction = providerAction('finish', 'finishJob');
/** Confirm (AC-4): after the provider's Done. */
export const confirmJobAction = customerAction('confirm', 'confirmJob');
/** "Job done" without the provider (AC-5): from the start day. */
export const markJobDoneAction = customerAction('mark_done', 'markJobDone');

/**
 * Withdraw (spec 0011-12 AC-5): the provider's own application, before the reveal. The application id only; the
 * database finds the request, holds the matrix and refuses after the reveal.
 */
export const withdrawApplicationAction = guardedAction(
  { name: 'withdrawApplication', access: PROVIDER, schema: WithdrawInput },
  async (input, user): Promise<JobMoveData | ReturnType<typeof fail>> => {
    const outcome = await withdrawApplication(input.applicationId, { region: user.region });
    if (!outcome.ok) return fail(KNOWN_PROVIDER.includes(outcome.code) ? outcome.code : 'action_failed');
    revalidatePath('/', 'layout');
    return { replayed: outcome.replayed };
  },
);

/**
 * The unlocked provider cancels the job (spec 0011-12 AC-6, §36 row 9). The request id only; no fee comes back by
 * itself after the reveal.
 */
export const providerCancelJobAction = guardedAction(
  { name: 'providerCancelJob', access: PROVIDER, schema: JobInput },
  async (input, user): Promise<{ status: 'ok' } | ReturnType<typeof fail>> => {
    const outcome = await providerCancelJob(input.requestId, { region: user.region });
    if (!outcome.ok) return fail(KNOWN_PROVIDER.includes(outcome.code) ? outcome.code : 'action_failed');
    revalidatePath('/', 'layout');
    return { status: 'ok' };
  },
);
