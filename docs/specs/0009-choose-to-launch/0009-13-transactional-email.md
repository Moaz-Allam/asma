# 0009-13. Transactional email (position 13)

Child of [0009](index.md). Follows the cross child contract there. **Touches personal data (email addresses).**

## Summary

`lib/email` becomes the one door to Resend, called only by the relay. Each lifecycle event writes outbox rows for the
right people in the same transaction, and the relay sends them with an idempotency key, so a retry never sends twice.
Emails go only to confirmed addresses, in the person's last used language. Confirming an address works through a one time
link we send ourselves, valid for 24 hours.

## Requirements

**User stories**:
- As a customer or provider, I want an email at each step that needs me, in my language, so that I never miss a deadline.
- As a user, I want to confirm my email with one click, so that mail reaches me and not a stranger.

**Prerequisites**: 12 merged. Branch `feat/13-transactional-email`. S4 and S5 for real sending (the fake driver covers the
rest).

**Acceptance criteria**:
- **AC-1**: `lib/email/` is the only module that reads `EMAIL_API_KEY` or calls Resend (REST over `fetch`, no SDK), with a
  lint rule and proof; only the relay imports it (umbrella U-4). `EMAIL_DRIVER` picks `fake` (stores the rendered mail
  for tests) or `resend`; a production deployment refuses `fake`.
- **AC-2**: Templates are plain TypeScript functions per template and locale returning subject, text and HTML; every
  interpolated value is escaped; a test renders every template in `ar`, `tr`, `en` with hostile text and proves it is
  escaped and that `ar` sets `dir="rtl"`.
- **AC-3**: The event to email map (one trigger on `request_events`, plus one on `applications` insert, `fee_refunds`
  done and `problem_reports` changes), each row keyed `email:<event_id>:<recipient_id>:<template>`:

  | Event | Template | Recipient |
  | --- | --- | --- |
  | application inserted | `applied` | customer |
  | `chosen` | `chosen` | chosen provider |
  | `commission_paid` | `commission_received` | customer |
  | `commission_paid`, or `chosen` with a carried commission | `pay_your_fee` | chosen provider |
  | reminder job (AC-6) | `pay_window_closing` | the payer of the open window |
  | `unlocked` | `contacts_ready` | customer and provider (each their own) |
  | `started` | `job_started` | customer |
  | `done` | `please_confirm` | customer |
  | `confirmed`, `auto_closed`, `customer_closed` | `job_completed` | provider |
  | `cancelled` | `request_cancelled` | every party who did not cancel: the customer, and the provider of the active or unlocked selection |
  | `pick_expired`, `fee_expired`, `provider_withdrew`, `provider_suspended` | `pick_again` | customer (says the commission carries when it was paid) |
  | `pick_expired`, `fee_expired` | `window_missed` | the pick's provider |
  | `no_paid_pick` | `request_cancelled` (refund line) | customer |
  | fee refund `done` or `done_by_hand` (kind `fee` or `late`) | `fee_refunded` | the payer |
  | report opened, report handled | `report_received`, `report_handled` | the reporter |

- **AC-4**: A row is written only for a recipient with a confirmed email; notification preferences from 01 part 2 are
  honoured, and money and deadline mails (`pay_your_fee`, `pay_window_closing`, `contacts_ready`, `pick_again`,
  `fee_refunded`) cannot be turned off. Providers cannot apply without a confirmed email (05 prerequisite); a customer
  without one sees a banner on My requests and on the choose dialog asking for it, but is not blocked.
- **AC-5**: The language is `profiles.locale`; it is updated by a Server Action when the user switches locale and on
  each sign in. Every link in a mail is `appOrigin()` + the locale + a path with ids only.
- **AC-6**: `queue_pay_reminders()` every 15 minutes writes one `pay_window_closing` per selection and window (key
  `email:<selection_id>:<payment|fee>:pay_window_closing`) when the deadline is less than `pay_reminder_hours` away and
  the window was longer than that.
- **AC-7**: Saving an email (01's account action) creates an `email_confirmations` row (random 32 byte token, only its
  SHA-256 stored, expires after `email_link_hours`) and a `confirm_email` mail with the link
  `/[locale]/account/email/confirm?t=<token>`; a Route Handler calls `confirm_email(p_token)`, which sets
  `profiles.email_confirmed_at` once, only if the address is unchanged, and marks the token used. Expired or used links
  show a message with Resend (at most 3 an hour). The scrubber drops `t` (D85 allow list already does; a test proves it).
- **AC-8**: The relay sends with Resend's `Idempotency-Key` header set to the outbox key; open and click tracking are off
  (S5); a 4xx answer other than 429 is final (`failed`, logged without the address), 429 and 5xx retry.
- **AC-9**: Email from `EMAIL_FROM`; no mail body, subject or address is logged; the scrubber gains `to`, `subject`,
  `html`.
- **AC-10**: e2e with the fake driver: the full journey writes the expected mails per locale; the confirm link works
  once and refuses a second time.

## Decision

Mail is a side effect like a payment: written to the outbox in the state change's transaction and sent only by the relay.
Plain template functions, no React Email.

## Feature design

**Data model**: `email_confirmations` (umbrella table). Outbox kind `email.send` with payload template, locale,
recipient id and template values (no address: the relay reads it at send time, so a changed address never gets an old
mail).

**API surface**: `confirm_email` (authenticated or anon by token), `request_email_confirmation` (authenticated, own),
`queue_pay_reminders` (cron), route `/[locale]/account/email/confirm` (GET, then a POST form to confirm, so mail scanners
that prefetch links do not confirm).

**Value sourcing**:

| Value | Source |
| --- | --- |
| Recipient address | `profiles.email` read by the relay at send time |
| Language | `profiles.locale` |
| Template values | the event row and the request snapshot (service name, dates, amounts from stored columns) |
| Reminder time | `pay_reminder_hours`, the selection deadlines |

**Security model**: tokens stored only as hashes; one live token per profile; the confirm page needs a click (POST), not
just a GET.

**Configuration required**:
- `EMAIL_DRIVER`: `fake` or `resend`.
- `EMAIL_API_KEY`: Resend sending key (S5).
- `EMAIL_FROM`: sender, for example `Aldebyani <no-reply@domain>` once S4 exists.

**Critical test scenarios**: an outbox retry sends one mail (AC-8); an unconfirmed address gets nothing but the
confirmation (AC-4); a changed address after queueing gets the mail at the new confirmed address or none (AC-7).

## Build plan

1. Tests first: templates, escaping, door lint proof; satisfies **AC-1**, **AC-2**, **AC-9**.
2. Migration: confirmations, triggers and the map, reminder job; satisfies **AC-3** to **AC-7**.
3. Relay handler for `email.send`; satisfies **AC-8**.
4. Account page confirm flow; e2e; satisfies **AC-7**, **AC-10**. Owner push, reviews, merge.

## Consequences

- Positive: every money and deadline step reaches people without a notification centre.
- Negative: users without a confirmed email get nothing; Resend is one more provider to watch.
- Neutral: the outbox's retry and alerts cover mail too.

## Rationale

Reading the address at send time avoids mailing a stale address; a POST to confirm avoids link scanners confirming an
address nobody clicked.
