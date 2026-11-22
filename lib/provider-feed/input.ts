import { z } from 'zod';

import { ANSWERS_MAX_KEYS, MESSAGE_INPUT_MAX, SETUP_LIMITS } from './constants';

/**
 * Action inputs (spec 0009, API surface). Unknown keys are refused, arrays are bounded, and the message
 * may be longer than the rule so the database gives the real refusal.
 */

const Uuid = z.string().uuid();

export const SaveSetupInput = z
  .object({
    serviceIds: z.array(Uuid).max(SETUP_LIMITS.services),
    zoneIds: z.array(Uuid).max(SETUP_LIMITS.zones),
    workDays: z.array(z.number().int().min(0).max(6)).max(7),
    startHour: z.number().int().min(0).max(23),
    endHour: z.number().int().min(1).max(24),
  })
  .strict();
export type SaveSetupInput = z.infer<typeof SaveSetupInput>;

/**
 * Spec 0011-19b AC-4, AC-7: a message, or the answers with the version of the form they were drawn from. Which one
 * the request needs is the database's call: it refuses the other with `questions_changed`.
 */
export const ApplyInput = z
  .object({
    requestId: Uuid,
    applicationMessage: z.string().max(MESSAGE_INPUT_MAX).nullable().default(null),
    applicationAnswers: z
      .record(
        z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
        z.union([z.string().max(MESSAGE_INPUT_MAX), z.boolean(), z.null()]),
      )
      .refine((value) => Object.keys(value).length <= ANSWERS_MAX_KEYS)
      .nullable()
      .default(null),
    questionsVersion: z
      .string()
      .regex(/^[0-9a-f]{32}$/)
      .nullable()
      .default(null),
  })
  .strict();
export type ApplyInput = z.input<typeof ApplyInput>;

/** Spec 0011-10 AC-8: Pay on My jobs sends the application id only; the database charges the frozen fee. */
export const PayProviderFeeInput = z.object({ applicationId: Uuid }).strict();
