'use server';

import { fail, guardedAction } from '@/lib/auth/action';
import {
  cancelRequest,
  createRequest,
  quoteRequest,
  REQUEST_DB_CODES,
  type RequestQuote,
} from '@/lib/requests';
import { CancelRequestInput, CreateRequestInput, QuoteRequestInput } from '@/lib/requests/input';

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

/** Cancel while OPEN (AC-15). */
export const cancelRequestAction = guardedAction(
  { name: 'cancelRequest', access: ACCESS, schema: CancelRequestInput },
  async (input): Promise<{ status: 'ok' } | ReturnType<typeof fail>> => {
    const outcome = await cancelRequest(input.requestId, input.reason);
    if (outcome.ok) return { status: 'ok' };
    return fail(KNOWN.includes(outcome.code) ? outcome.code : 'action_failed');
  },
);
