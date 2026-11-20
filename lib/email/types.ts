import { z } from 'zod';

/**
 * The shapes the email door works with (spec 0011-13). The send time answer of `email_context(p_outbox_id)` (R-8)
 * is parsed here before anything renders, so a mail is built only from values the database returned.
 */

export const EMAIL_TEMPLATES = [
  'new_offer',
  'chosen',
  'pay_your_fee',
  'commission_received',
  'contacts_ready',
  'job_started',
  'please_confirm',
  'job_completed',
  'request_cancelled',
  'pick_again',
  'pick_ended',
  'window_missed',
  'payment_too_late',
  'fee_refunded',
  'confirm_email',
  'account_approved',
  'account_rejected',
  'account_suspended',
  'pay_window_closing',
  'closes_soon',
  // Spec 0011-14 R-8 (rows 15 and 16).
  'report_received',
  'report_new_admin',
  'report_handled',
  // Spec 0012 AC-10.
  'password_changed',
] as const;
export type EmailTemplate = (typeof EMAIL_TEMPLATES)[number];

export const EMAIL_LOCALES = ['ar', 'tr', 'en'] as const;
export type EmailLocale = (typeof EMAIL_LOCALES)[number];

/** R-8's skips, and R-11's answers; `finish_email` takes exactly these. */
export const SKIP_REASONS = ['email_off', 'stale', 'unconfirmed', 'condition'] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];
export type SendOutcome = 'sent' | 'already_sent' | 'rejected' | 'retry' | 'email_off';
export type FinishOutcome = SendOutcome | SkipReason;

// Any 8-4-4-4-12 hex id (zod's z.uuid() also checks the version, which test ids do not carry).
const id = z.guid();

export const EmailValuesSchema = z
  .object({
    side: z.enum(['customer', 'provider']).nullable(),
    request_id: id.nullable(),
    // requests.pricing_snapshot.service.name, the admin's text in up to three languages; read through localized().
    service: z.record(z.string(), z.unknown()).nullable(),
    start_at: z.string().min(1).nullable(),
    deadline: z.string().min(1).nullable(),
    amount: z.number().int().nonnegative().nullable(),
    currency: z.enum(['TRY', 'SAR']).nullable(),
    fee_id: id.nullable(),
    carried: z.boolean().nullable(),
    // R-9: 32 random bytes, base64url, for confirm_email only.
    token: z
      .string()
      .regex(/^[A-Za-z0-9_-]{43}$/)
      .nullable(),
    // Spec 0011-14 X-10: the report mails only.
    report_id: id.nullable().optional(),
    // Spec 0012 AC-10: password_changed only, the change's time.
    changed_at: z.string().min(1).nullable().optional(),
    reason: z
      .enum([
        'no_show',
        'did_not_pay_cash',
        'poor_work',
        'safety_or_behaviour',
        'asked_money_off_platform',
        'other',
      ])
      .nullable()
      .optional(),
  })
  .strict();
export type EmailValues = z.infer<typeof EmailValuesSchema>;

export const EmailContextSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('skip'), reason: z.enum(SKIP_REASONS) }).strict(),
  z
    .object({
      status: z.literal('send'),
      template: z.enum(EMAIL_TEMPLATES),
      email: z.string().min(3).max(254),
      locale: z.enum(EMAIL_LOCALES),
      region_locale: z.enum(EMAIL_LOCALES),
      timezone: z.string().min(1),
      values: EmailValuesSchema,
    })
    .strict(),
]);
export type EmailContext = z.infer<typeof EmailContextSchema>;
export type SendContext = Extract<EmailContext, { status: 'send' }>;

/** One rendered mail (AC-2). */
export type RenderedEmail = { subject: string; text: string; html: string };

/** What a driver is handed: the rendered mail, its address, and the outbox key (the Idempotency-Key, AC-8). */
export type OutgoingEmail = RenderedEmail & {
  to: string;
  key: string;
  template: EmailTemplate;
  locale: EmailLocale;
};

/** A driver's answer: the outcome, and for `rejected` or `retry` a code (`http_422:validation_error`), never a message. */
export type SendResult = { outcome: SendOutcome; detail?: string };

export type EmailDriver = {
  name: 'off' | 'fake' | 'resend';
  send: (mail: OutgoingEmail) => Promise<SendResult>;
};
