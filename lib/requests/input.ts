import { z } from 'zod';

import { CANCEL_REASONS } from './constants';

/**
 * The inputs of the three request actions (spec 0008, API surface). Shapes only: the database is the
 * check (D106, D125). The two expected figures are what the form showed; `create_request` compares them
 * and never stores them (rule 1, D140).
 */

const Uuid = z.string().uuid();

/** One answer as the form sends it: a number, a string, a boolean, a list of option values, or none. */
const Answer = z.union([
  z.number().finite(),
  z.string().max(4000),
  z.boolean(),
  z.array(z.string().max(40)).max(30),
  z.null(),
]);

export const Answers = z
  .record(z.string().max(40), Answer)
  .refine((answers) => Object.keys(answers).length <= 100, { message: 'too_many_answers' });

export const QuoteRequestInput = z.object({
  serviceId: Uuid,
  zoneId: Uuid,
  addonIds: z.array(Uuid).max(50),
  answers: Answers,
});
export type QuoteRequestInput = z.infer<typeof QuoteRequestInput>;

export const CreateRequestInput = QuoteRequestInput.extend({
  clientKey: Uuid,
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startHour: z.number().int().min(0).max(23),
  addressLine: z.string().max(1000),
  notes: z.string().max(2000).nullable(),
  expectedPrice: z.number().int().positive(),
  expectedCommission: z.number().int().nonnegative(),
});
export type CreateRequestInput = z.infer<typeof CreateRequestInput>;

export { CANCEL_REASONS, type CancelReason } from './constants';

export const CancelRequestInput = z.object({
  requestId: Uuid,
  reason: z.enum(CANCEL_REASONS).nullable(),
});

/** Spec 0010 AC-7: two ids, nothing else. */
export const ChooseProviderInput = z
  .object({
    requestId: Uuid,
    applicationId: Uuid,
  })
  .strict();

export const REQUEST_TABS = ['all', 'active', 'closed'] as const;
export type RequestTab = (typeof REQUEST_TABS)[number];

/** `?tab=`, falling back to All (AC-13). */
export function parseTab(value: unknown): RequestTab {
  return typeof value === 'string' && (REQUEST_TABS as readonly string[]).includes(value)
    ? (value as RequestTab)
    : 'all';
}
