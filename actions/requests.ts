'use server';

import { revalidatePath } from 'next/cache';

import { fail, guardedAction } from '@/lib/auth/action';
import {
  cancelRequest,
  type CancelRefund,
  chooseProvider,
  createRequest,
  quoteRequest,
  rateProvider,
  REQUEST_DB_CODES,
  type RequestQuote,
} from '@/lib/requests';
import {
  CancelRequestInput,
  ChooseProviderInput,
  CreateRequestInput,
  QuoteRequestInput,
  RateProviderInput,
} from '@/lib/requests/input';

/**
 * The customer's request actions (spec 0008, API surface). Customers and admins may call them (AC-23);
 * the database decides everything else. Every figure the form shows comes back from the database
 * (rule 1): the client sends answers and choices, and the two figures it last saw, which are only compared.
 * A refusal comes back as its stable code, which the page maps to a catalogue string, and reaches no
 * Sentry report (AC-22).
 */

const ACCESS = ['customer', 'admin'] as const;
const KNOWN: readonly string[] = REQUEST_DB_CODES;

type AnswerError = { key: string | null; code: string };

export type QuoteActionData =
  { status: 'ok'; quote: RequestQuote } | { status: 'invalid'; errors: AnswerError[] };

/** A live quote for the form (AC-5, AC-6), counted against the hourly limit (AC-28). */
export const quoteRequestAction = guardedAction(
  { name: 'quoteRequest', access: ACCESS, schema: QuoteRequestInput },
  async (input, user): Promise<QuoteActionData | ReturnType<typeof fail>> => {
    const outcome = await quoteRequest(input, { region: user.region, userId: user.id });
    if (outcome.ok) return { status: 'ok', quote: outcome.quote };
    if (outcome.code === 'invalid') return { status: 'invalid', errors: outcome.errors };
    return fail(KNOWN.includes(outcome.code) ? outcome.code : 'action_failed');
  },
);

export type CreateActionData =
  | { status: 'ok'; id: string }
  | { status: 'invalid'; errors: AnswerError[] }
  | { status: 'price_changed'; quote: RequestQuote };

/** Publish (AC-7, AC-22). On `price_changed` the review step shows the new figures and asks again. */
export const createRequestAction = guardedAction(
  { name: 'createRequest', access: ACCESS, schema: CreateRequestInput },
  async (input, user): Promise<CreateActionData | ReturnType<typeof fail>> => {
    const outcome = await createRequest(input, { region: user.region, userId: user.id });
    if (outcome.ok) return { status: 'ok', id: outcome.id };
    if (outcome.code === 'invalid') return { status: 'invalid', errors: outcome.errors };
    if (outcome.code === 'price_changed') return { status: 'price_changed', quote: outcome.quote };
    return fail(KNOWN.includes(outcome.code) ? outcome.code : 'action_failed');
  },
);

/**
 * Cancel (AC-15, spec 0011-12 AC-6): the matrix decides, and the refund queued, if any, comes back so the page can
 * say so; refused `checkout_open` during a card page (spec 0011-09 AC-2).
 */
export const cancelRequestAction = guardedAction(
  { name: 'cancelRequest', access: ACCESS, schema: CancelRequestInput },
  async (input, user): Promise<{ status: 'ok'; refund: CancelRefund | null } | ReturnType<typeof fail>> => {
    const outcome = await cancelRequest(input.requestId, input.reason, {
      region: user.region,
      userId: user.id,
    });
    if (outcome.ok) return { status: 'ok', refund: outcome.refund };
    return fail(KNOWN.includes(outcome.code) ? outcome.code : 'action_failed');
  },
);

/**
 * Choose one offer (spec 0010 AC-7, AC-8). Nothing is paid here; the page shows the next step. A paid commission
 * carries to the new pick (spec 0011-12 AC-4).
 */
export const chooseProviderAction = guardedAction(
  { name: 'chooseProvider', access: ACCESS, schema: ChooseProviderInput },
  async (
    input,
    user,
  ): Promise<
    | {
        replayed: boolean;
        selectedAt: string;
        paymentDeadline: string | null;
        carried: boolean;
        feeDeadline: string | null;
      }
    | ReturnType<typeof fail>
  > => {
    const outcome = await chooseProvider(input, { region: user.region, userId: user.id });
    if (!outcome.ok) return fail(KNOWN.includes(outcome.code) ? outcome.code : 'action_failed');
    if (!outcome.replayed) revalidatePath('/', 'layout');
    return {
      replayed: outcome.replayed,
      selectedAt: outcome.selectedAt,
      paymentDeadline: outcome.paymentDeadline,
      carried: outcome.carried,
      feeDeadline: outcome.feeDeadline,
    };
  },
);

/**
 * Rate the provider of a COMPLETED job (spec 0011-17 AC-1). Customers only: admin can never rate for anyone. It
 * changes nothing else (D4); a second rating is `already_rated`, which the form answers by showing the stored one.
 */
export const rateProviderAction = guardedAction(
  { name: 'rateProvider', access: ['customer'] as const, schema: RateProviderInput },
  async (input, user): Promise<{ ratingId: string } | ReturnType<typeof fail>> => {
    const outcome = await rateProvider(input, { region: user.region, userId: user.id });
    if (!outcome.ok) return fail(KNOWN.includes(outcome.code) ? outcome.code : 'action_failed');
    revalidatePath('/', 'layout');
    return { ratingId: outcome.ratingId };
  },
);
