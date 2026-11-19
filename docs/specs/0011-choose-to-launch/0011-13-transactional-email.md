# 0011-13. Transactional email (position 13)

Child of [0011](index.md). Follows the cross child contract there. **Touches personal data (email addresses), a
migration, a trigger on the money paths, and the relay.**

> **Amended 2026-11-19 (D191)** against what 06 to 12 built (spec 0010, 0011-07 to 0011-12, D168 to D186), the way
> 0011-09 to 0011-12 were amended. There is no `request_events` table: every lifecycle move writes one `audit_log` row
> (`action`, `entity_type`, `entity_id`, `old_value`, `new_value`) in its own transaction, so mail hangs on those rows.
> There is no `selections` table: a pick is `requests.selected_application_id` and its application. 07 built the
> `email.send` outbox kind, `enqueue_outbox`, `claim_outbox` and `finish_outbox`; 08's relay drains every kind and today
> fails an `email.send` row as `kind_not_built`. 01 built `profiles.email`, `profiles.email_confirmed_at` (no writer
> yet), `profiles.locale`, `notification_preferences` (topics `new_offer`, `new_matching_request`, `work_updates`,
> `ratings`) and the notice table on the account page, and its profile trigger already writes a
> `profile.email_changed` audit row. Every choice below is the recommended one, by the owner's standing rule (D183: "do
> not ask me always do the recommended"). Cross checked on Sonnet the same day (17 findings: 7 Major, 10 Minor), each
> applied as its recommended fix and folded into the rules below (X-1 to X-17 in D191). **Where a rule below and an AC
> differ, the rule wins.** Accepted by the owner's standing rule, 2026-11-19.

## Amendment rules (D191)

- **R-1, mail hangs on `audit_log`; the decision to send is made at send time** (X-5). An `after insert` row trigger on
  `audit_log`, with a `when` list of the mapped actions, calls `queue_audit_email(audit_id)`. It derives the
  recipients from the audit row and the rows it names, and writes one small `email.send` row each (ids, template,
  `send_until`, no values). A second trigger on `applications` insert covers a new offer, because 05 writes no audit
  row on apply. Whether a mail still makes sense (the "only if" column of AC-3) and every value it shows are read by
  the relay at send time through `email_context(p_outbox_id)` (R-8), so a reopen that the same or a later transaction
  cancels sends no `pick_again`. Rejected: a trigger deferred to commit (pgTAP never commits, and the state is still
  stale minutes later when the relay sends); a `queue_email` call inside each 06 to 12 function (about fifteen money
  functions replaced for a side effect); building `request_events` now (a second event log).
- **R-2, mail never breaks a move** (X-5). Each trigger body runs inside an exception block. On any error it writes one
  `email.send` row already `failed` (key `email:<audit_id>:queue_failed`, or `email:offer:<application_id>:queue_failed`;
  payload the id and the SQLSTATE, no values), which 08's heartbeat alerts as `outbox_failed`. If that insert fails
  too, a second exception block does `raise warning` with the id and swallows it. The move always commits. A pgTAP case
  forces an error and proves the state change commits.
- **R-3, one switch per region.** `emails_enabled` (`false` in both regions, as `payments_enabled` was, D172). The
  triggers write nothing while it is off, confirmations included, so nothing piles up while S4 and S5 are owed; the
  relay checks it again at send time and finishes a row queued before a switch off as `email_off`. The local seed turns
  it on for `TR`, as it does payments, so e2e runs against the fake driver.
- **R-4, the driver** (X-11, X-17). `EMAIL_DRIVER` is `off` (default), `fake` or `resend`. The variables join
  `lib/env.ts`'s schema the way 08's `IYZICO_*` did (`EMAIL_DRIVER` an enum defaulting to `off`; `EMAIL_API_KEY`,
  `EMAIL_FROM`, `EMAIL_FAKE_FILE` optional strings), and the door's lint rule exempts `lib/env.ts` and
  `lib/deployment.ts` the same way. `lib/email` exports `emailDriver()`; `lib/deployment.ts` calls it and refuses `fake`
  on a production deployment, like the PSP's fake fence. `EMAIL_API_KEY` and `EMAIL_FROM` are required by `lib/email`
  only when the driver is `resend`, so merging 13 never stops a deployment before S5. `off` finishes each row
  `email_off`, unsent. `fake` appends each rendered mail as one JSON line to the file named by `EMAIL_FAKE_FILE`, which
  only the e2e wrapper sets; e2e reads that file and nothing else (an in memory record does not survive across server
  workers).
- **R-5, freshness.** Each row carries `send_until`: the deadline the mail names (a pay window, a confirm window, a
  link's expiry), else the queue time plus 24 hours. The relay finishes a row past it as `stale`, unsent. 08's retry
  schedule (1, 5, 30, 120, 720 minutes) ends well inside Resend's 24 hour idempotency key life.
- **R-6, what a mail never carries.** No phone, street line, notes, answers, reason text, or other party's name or
  email; no amount the database did not store; no token except in `confirm_email`. A mail says what happened and links
  to the page that shows it. Admin text (service names) is escaped like any value.
- **R-7, language and formats** (X-6). The language is the recipient's `profiles.locale` read at send time (01 keeps it
  current: onboarding, the account page, and `/continue` after each sign in), else the region's default; the original
  "update on each locale switch" Server Action is dropped, 01's `updateLocale` owns it. Names use 04's
  `localized(value, locale, regionDefault)` (the recipient's locale, then the region's default). Instants use
  `instantLabel(iso, regions.timezone, locale)` and money `formatMoney(amount, currency, locale)`: the formats the
  pages show, Western digits in all three locales (D52). A template change deployed between two tries of one row can
  change its bytes; a 409 then still means a mail already went (R-11), so no template version is stored (X-15).
- **R-8, `email_context(p_outbox_id)`** (service role only, the relay's one reader at send time; X-8). It returns
  either `skip` with a reason or the address, the locale and the template's values. Skips: `email_off` (the switch),
  `unconfirmed` (no `email_confirmed_at`), `stale` (past `send_until`, or for `confirm_email` a confirmation that is
  used, revoked or expired, or an address that changed), `condition` (the AC-3 "only if" no longer holds). No payload
  ever holds an address.
- **R-9, the confirmation** (X-1, X-2, X-9, X-16). Made in Postgres: 32 random bytes from
  `extensions.gen_random_bytes`, base64url in the link, only the `sha256` digest stored. A changed address (01's
  `profile.email_changed` row with a new address) starts one through R-1's trigger, in the same transaction as the
  save; the account page's "Send link again" calls `request_email_confirmation()`. Both use key
  `email:confirm:<confirmation_id>` and share one counter in 09's `action_counters`: action `email_confirm` (its check
  widened to `('checkout', 'email_confirm')`), `subject_id` the profile, `window_start` `date_trunc('hour', now())`, at
  most 3 an hour. Over the limit the trigger queues nothing and the button refuses `rate_limited`. A new confirmation
  revokes the older live ones. The token sits in the outbox payload only until the row ends: a `before update` trigger
  on `outbox_events` removes `token` from an `email.send` payload whenever its status becomes `done` or `failed`,
  whichever path ends it (07's `claim_outbox` fails an expired lease without `finish_outbox`). `confirm_email` needs a
  signed in caller who owns the confirmation (no public route, rule 11 stands); a signed out visitor signs in through
  01's `next` and comes back. Ended confirmations are deleted 30 days after they end by a daily job,
  `emails-housekeeping`.
- **R-10, the apply gate** (the umbrella's "a provider needs a confirmed email to apply"; 05 did not build it; X-16). A
  `before insert` trigger on `applications` refuses `email_unconfirmed` when the region's `apply_needs_email` is on and
  the provider has no confirmed email. `apply_needs_email` is `false` in both regions and in the local seed, so the
  older e2e fixtures stay valid. Sign in is by phone, so most profiles have no address: the new owner step S43 turns on
  `emails_enabled` first (the banner and the prompt ask everyone to add and confirm one), and `apply_needs_email` only
  some days later, on a day the owner announces. pgTAP proves the gate on and off.
- **R-11, Resend's answers** (`.claude/skills/resend/`; X-3). 2xx: `sent`. 409 `invalid_idempotent_request` (the key
  was used with another payload, so a mail already went): `already_sent`. 409 `concurrent_idempotent_requests`, 429, 5xx
  or a timeout: retry. Any other 4xx (400, 401, 403, 422): `rejected`, failed at once and alerted by the heartbeat. Only
  the HTTP status and Resend's error `name` are ever stored (`last_error` such as `http_422:validation_error`), never its
  message, which can quote the address.
- **R-12, mail has its own lane** (X-2, X-4). `claim_outbox` (07) is replaced with the same signature and body except
  that it leaves `email.send` rows out, so mail never delays a payment or a refund. `claim_email_outbox(p_limit,
  p_worker)` claims only them, with the same lease rules (an expired lease after the sixth try fails the row).
  `finish_email(p_id, p_outcome, p_claim_token)` ends one: `sent` → `done`; `email_off`, `unconfirmed`, `stale`,
  `condition`, `already_sent` → `done` with the outcome in `last_error`; `rejected` → `failed` at once; `retry` → 07's
  backoff, `failed` after the sixth try; any other kind is refused. The relay gains a task `email` (cron `relay-email`,
  every minute, through `relay_kick`) that drains the lane until its deadline, sending at most 2 a second (Resend's
  default limit); skips do not count against it. `relay_stalled` (08) still watches the oldest due row of both lanes.
- **R-13, strings live in the catalogues.** Each template's subject and lines live in `messages/<locale>.json` under
  `Email.<template>`, read with next-intl's `createTranslator` (installed, 4.13.7). First drafts carry the `[draft]`
  marker, so `npm run launch:gate` holds them until the copy is reviewed (D100). The HTML shell is one plain function: a
  table layout, inline styles from the token values, `dir` and `lang` from the locale. No React Email.
- **R-14, the settings** (X-12). The migration inserts `emails_enabled` and `apply_needs_email` (`false`),
  `pay_reminder_hours` (4), `email_link_hours` (24) and `confirm_reminder_hours` (24, new ☐) for both regions; they
  join `pricing_settings_guard`'s required keys; one reader, `email_settings(region)`, validates them (booleans; whole
  hours from 1 to 168) and raises on a bad value, which inside a trigger takes R-2's path and is alerted.
- **R-15, not mailed in 13.** `request.provider_suspended` (a job kept after the reveal; admin reaches the customer,
  carried to 16), `request.flag_raised` (admin only), `request.created`, `contacts.viewed`, `fee.paid` (the request
  rows cover both fees), `fee.checkout_requested`, `fee.refund_by_admin` (the mail goes when the refund is done),
  `provider.back_to_review`, `provider.company_changed`, `provider.submitted`, the applicants who were not picked, and
  the brief's notice rows 1 (a new matching request), 13 and 14 (ratings, P2). The topics `new_matching_request` and
  `ratings` keep their switches and send nothing yet. Report mails (rows 15, 16) come with 14.

## Summary

Email becomes a side effect of the moves 06 to 12 already make. When a move writes its audit row, a trigger writes one
small outbox row for each person who needs to know; the relay, in its own lane, checks at send time that the mail still
makes sense and sends it through Resend with the row's key, so a retry never sends twice. Mail goes only to confirmed
addresses, in the person's language, and never carries anyone else's personal data. You confirm an address with a one
time link. Everything stays off in the cloud until the domain and the Resend key exist (S4, S5), then one switch per
region turns it on.

## Requirements

**User stories**:
- As a customer or provider, I want an email at each step that needs me, in my language, so that I never miss a deadline.
- As a user, I want to confirm my email with one click, so that mail reaches me and not a stranger.
- As the owner, I want mail off until the domain is ready, so that nothing is lost or sent late when it goes live.

**Prerequisites**: 12 merged (PR #44) and its migration in the cloud. Branch `feat/13-transactional-email` from
`master`. S4 and S5 only for real sending; the fake driver covers the build and the e2e.

**Acceptance criteria**:
- **AC-1** (the door): `lib/email/` is the only module that reads `EMAIL_API_KEY`, `EMAIL_FROM`, `EMAIL_DRIVER` or
  `EMAIL_FAKE_FILE` (besides `lib/env.ts` and `lib/deployment.ts`, R-4), or calls Resend (REST over `fetch`, 15 second
  timeout, no SDK), with a lint rule and its proof in `tests/lint/eslint-rules.test.ts`; only `lib/relay` imports it
  (umbrella U-4, a source test). Drivers by R-4.
- **AC-2** (templates): one plain function per template returns `{ subject, text, html }` from the values R-8 returns
  and the catalogue strings (R-13), formatted by R-7; every interpolated value is escaped in the HTML; every link is
  `appOrigin()` + `/<locale>` + a path with ids only. A test renders every template in `ar`, `tr` and `en` with hostile
  values (markup, quotes, a very long service name, direction marks) and proves the escaping, `dir="rtl"` and
  `lang="ar"` for Arabic, and that no value outside the given values appears.
- **AC-3** (the map): R-1's triggers write `email.send` rows by this table, each keyed
  `email:<audit_id>:<recipient_id>:<template>` (a new offer `email:offer:<application_id>`, a confirmation
  `email:confirm:<confirmation_id>`), only while `emails_enabled` is on and, except `confirm_email`, only for a
  recipient with a confirmed email (AC-4). A replay writes nothing twice (the key is unique). The last column is checked
  by `email_context` at send time; when it no longer holds, the row ends `condition`, unsent.

  | Audit action (or row) | Template | Recipient | Only if, at send time |
  | --- | --- | --- | --- |
  | `applications` insert | `new_offer` | the customer | request `OPEN` |
  | `request.provider_chosen`, new status `SELECTED` | `chosen` | the chosen provider | request still `SELECTED` on that application |
  | `request.provider_chosen`, new status `COMMISSION_PAID` (carried) | `pay_your_fee` | the chosen provider | request still `COMMISSION_PAID` on that application |
  | `request.commission_paid` | `commission_received` | the customer | |
  | `request.commission_paid` | `pay_your_fee` | the chosen provider | request still `COMMISSION_PAID` on that application |
  | `request.unlocked` | `contacts_ready` | the customer, and the provider (each their own) | |
  | `job.started` | `job_started` | the customer | |
  | `job.done` | `please_confirm` | the customer | request `AWAITING_CONFIRMATION` |
  | `job.confirmed`, `job.customer_closed`, `job.auto_closed` | `job_completed` | the provider | |
  | `request.cancelled` (the customer cancelled) | `request_cancelled` | the provider of `selected_application_id`, when set | |
  | `request.provider_cancelled` | `request_cancelled` | the customer | |
  | `request.failed_picks_limit`, `request.no_paid_pick` | `request_cancelled` (with its refund line) | the customer | |
  | `request.pick_expired` | `pick_again` | the customer | request `OPEN` |
  | `request.pick_expired` | `pick_ended` | the provider of the expired application (`new_value.application_id`) | |
  | `request.fee_expired` | `pick_again` (the commission carries) | the customer | request `OPEN` |
  | `request.fee_expired` | `window_missed` | the provider of the expired application (`new_value.application_id`) | |
  | `request.provider_withdrew`, when `new_value.request` is not `none` (it was the pick) | `pick_again` | the customer | request `OPEN` |
  | `request.pick_dropped` | `pick_again` | the customer | request `OPEN` |
  | `fee.late` | `payment_too_late` | the payer | |
  | `fee.refunded`, `fee.refund_done_by_hand` | `fee_refunded` | the payer | |
  | `profile.email_changed`, new address not null | `confirm_email` (R-9) | that profile | the confirmation live, the address unchanged |
  | `provider.approved`, `provider.reinstated` | `account_approved` | the provider | provider still `approved` |
  | `provider.rejected` | `account_rejected` | the provider | |
  | `provider.suspended` | `account_suspended` | the provider | |

  The payer (X-7): `fee.late` has entity `fee_payments` and `entity_id` the fee, so its `payer_id`. `fee.refunded` and
  `fee.refund_done_by_hand` have entity `fee_refunds`: a `fee` refund names its fee (`fee_payment_id`, its `payer_id`);
  a `late` refund has no fee row (07's `fee_refunds_kind_fee` check), so its payer is the `payer_id` of the fee whose
  `fee.late` row names this refund in `new_value.fee_refund_id`. A pgTAP meta test proves the trigger's `when` list
  equals this table's actions, so renaming a mapped action fails CI.
- **AC-4** (who gets mail): `new_offer` follows the `new_offer` topic, and `job_started` and `job_completed` follow
  `work_updates`, in `notification_preferences` (no row means on), read at queue time; every other template is always
  on, as the account page's notice rows with no topic say. `new_offer` is one mail per offer, so at most 05's
  `max_applicants_per_request` per request; a digest is not in 13 (X-13). A customer without a confirmed email sees a
  banner on My requests and in the choose dialog, linking to the account page, never a block; a provider sees a prompt
  on the feed and the apply page while `apply_needs_email` is on (R-10).
- **AC-5** (links): the customer's links go to `/requests/<request_id>` (or `/receipts/<fee_id>` for a paid commission
  or a refunded fee), the provider's to `/provider/applications`, account mails to `/account`, the confirmation to
  `/account/email/confirm?t=<token>`.
- **AC-6** (reminders; X-14): `queue_reminders()` runs every 15 minutes (pg_cron as `postgres`, no API grant), only
  where `emails_enabled` is on. It writes `pay_window_closing` to the customer of a `SELECTED` request when
  `payment_deadline` is in the future and less than `pay_reminder_hours` away (key
  `email:<application_id>:commission:pay_window_closing`); to the chosen provider of a `COMMISSION_PAID` request when
  `fee_deadline` is (key `email:<application_id>:provider_fee:pay_window_closing`); and `closes_soon` to the customer
  of an `AWAITING_CONFIRMATION` request, only where `auto_close_enabled` is on, when `confirm_deadline` is in the future
  and less than `confirm_reminder_hours` away (key `email:<request_id>:closes_soon`). A pay window shorter than
  `pay_reminder_hours` gets no reminder, because its first mail already named the deadline: the commission window is
  measured from `selected_at`; the fee window from the later of `selected_at` and the commission's `paid_at`, to
  `fee_deadline` as stored (09 already caps it by the start). `send_until` is the deadline.
- **AC-7** (confirm an address): `request_email_confirmation()` (authenticated, own profile) refuses `no_email`,
  `already_confirmed`, `emails_off` or `rate_limited`; else it does what R-9's trigger does: revokes older live
  confirmations, inserts one with `expires_at = now() + email_link_hours`, and queues `confirm_email` with
  `send_until` the expiry. The account page shows the address as confirmed or not, with "Send link again". The link
  opens a signed in page with one Confirm button: a POST through the `confirmEmail` Server Action, so a mail scanner
  that opens links confirms nothing. `confirm_email(p_token)` (authenticated) sets `profiles.email_confirmed_at` once,
  when the token's digest matches a live confirmation of the caller, unexpired, with the address unchanged, and marks
  it used; it is the column's first writer (01's grants leave it to no API role, and 01's guard clears it on any
  address change). Every other case shows one message (`invalid_link`, `link_expired`, `link_used`) with "Send link
  again". The scrubber drops `t` (D85 keeps only `page` and `utm_*`); a test proves it on this path.
- **AC-8** (send): the relay's `email` task claims through `claim_email_outbox`, asks `email_context` (R-8), renders,
  sends with the `Idempotency-Key` header set to the outbox key, and ends each row through `finish_email` with the
  outcome of R-8 or R-11. Open and click tracking stay off (S5 turns them off on the domain; the request turns nothing
  on).
- **AC-9** (no leaks; X-3, X-10): mail goes from `EMAIL_FROM`. No address, subject or body is logged, stored outside
  Resend, or sent to Sentry or PostHog: relay logs carry only the outbox id, the template and the outcome, `last_error`
  only R-11's status and name, and the scrubber's personal keys gain `subject` and `html` (exact matches; `to` is
  already a URL key there, and `text` is too common to drop everywhere), with a proof test.
- **AC-10** (the apply gate): R-10, with the prompt of AC-4, and `lib/provider-feed` mapping `email_unconfirmed` to its
  catalogue message.
- **AC-11** (safety): R-2, and R-12's lane: no email row is ever claimed by the payment lane.
- **AC-12** (tests): pgTAP `29_transactional_email`: every map row (recipients and keys at queue time, each "only if"
  through `email_context`), a replay writing nothing twice, the preference and switch cases, the reminders (a short
  window skipped, a passed deadline skipped, the keys, auto close off), the confirmation (digest only, one live, expiry,
  used, revoked, a changed address, someone else's token, the shared rate limit), the token strip on every ending path
  (including an expired lease), the two lanes (`claim_outbox` never returns mail, `claim_email_outbox` only mail),
  `finish_email`'s outcomes, the apply gate on and off, R-2's forced error, the settings reader, RLS on
  `email_confirmations` (no API role reads or writes it), and no `anon` or `authenticated` grant on the internal
  functions. Unit tests: the templates (AC-2), the door and drivers, the `email` task's answers and pacing (R-11, R-12),
  the scrubber keys, the lint proof. e2e with the fake driver in `ar`, `tr` and `en` at 390px with axe: save an email,
  take the link from the fake file, confirm once, a second use refused; and a choose and a paid commission, driven
  through the database functions as each user (as 05's e2e does), write the expected templates to the expected people,
  read from `outbox_events` and from the fake file after a drain kicked through `/api/relay` (task `email`, with the
  secret).

## Decision

Mail is a side effect like a payment: written to the outbox in the move's own transaction and sent only by the relay,
in a lane of its own. The source is the audit row every move already writes, read by one small trigger that only names
recipients; whether to send, and what to say, is decided at send time from the current state, so no money function
changes its logic and no mail goes out about a move that was undone. Plain template functions with catalogue strings,
no React Email. One switch per region keeps all of it off until the domain and the key exist.

**Implementation skills**: `resend` (`resend/resend-skills`, `.claude/skills/resend/`) for the REST facts (idempotency
key life and length, answers, rate limit) · `supabase-postgres-best-practices` (`supabase/agent-skills`,
`.agents/skills/supabase-postgres-best-practices/`) for the triggers, grants and RLS.

## Feature design

**Data model**: `email_confirmations` (`id`, `region`, `profile_id`, `email` collate "C", `token_hash` bytea unique,
`expires_at`, `used_at` null, `revoked_at` null, `created_at`; a partial unique index on `profile_id` where `used_at`
and `revoked_at` are both null; RLS on, no policy for any API role, no grant). `action_counters`' action check widened
to `email_confirm`. The five settings of R-14. An `email.send` payload is `{ template, recipient_id, request_id,
entity_id, send_until }`, plus `token` only in `confirm_email` and only until the row ends. No new column on
`profiles` or `outbox_events`.

**State transitions**: an `email.send` row goes `pending → claimed → done` (`sent`, `email_off`, `unconfirmed`,
`stale`, `condition`, `already_sent`) or `failed` (`rejected`, out of tries, or an expired lease). A confirmation is
live, then used, revoked or expired, and is deleted 30 days after it ends.

**API surface**:

| Function or route | Grant or guard | Errors |
| --- | --- | --- |
| `queue_audit_email(audit_id)`, `queue_offer_email(application_id)` (trigger bodies) | none | never raises (R-2) |
| `applications_need_email` (`before insert` trigger on `applications`) | none | `email_unconfirmed` |
| `outbox_strip_token` (`before update` trigger on `outbox_events`) | none | |
| `queue_reminders()`, the daily `emails-housekeeping` | none (cron) | |
| `email_settings(region)` | none (internal) | `email_settings_invalid` |
| `request_email_confirmation()` | authenticated, own profile | `no_email`, `already_confirmed`, `emails_off`, `rate_limited` |
| `confirm_email(p_token text)` | authenticated | `invalid_link`, `link_expired`, `link_used` |
| `claim_outbox` (replaced, same signature) | service role, as 07 | as 07; leaves `email.send` out |
| `claim_email_outbox(p_limit, p_worker)`, `finish_email(p_id, p_outcome, p_claim_token)`, `email_context(p_outbox_id)` | service role (the relay only) | `validation_failed`, `not_found`, `invalid_state` |
| Relay task `email` (`/api/relay`, cron `relay-email` every minute) | `RELAY_SECRET`, as 08 | |
| Server Actions `requestEmailConfirmation`, `confirmEmail` (`actions/account.ts`) | `guardedAction`, any role | the codes above |
| Page `/[locale]/account/email/confirm` | `guardPage`, any role | the codes above as one message |

**Value sourcing**:

| Value | Source |
| --- | --- |
| Recipient address | `profiles.email` while `email_confirmed_at` is set, read by `email_context` at send time |
| Language | `profiles.locale` at send time, else the region's default |
| Service name | `requests.pricing_snapshot.service.name`, through `localized()` (R-7) |
| Start date and time | `requests.scheduled_start_at` in `regions.timezone`, through `instantLabel()` |
| Commission amount | the commission's `fee_payments.amount` and `currency`, or 0 when no fee row exists (D171) |
| Provider fee amount | `applications.provider_fee_amount` (frozen at the pick, 07) and the request's currency |
| Refund amount | `fee_refunds.amount` and `currency`; all amounts through `formatMoney()` |
| Refund line on a cancel | the cancel row's `commission_outcome` and `fee_refund_id` |
| The payer | AC-3's payer paragraph |
| Whether the commission carries | `carried_commission(request_id)` (12) at send time |
| Deadlines | `requests.payment_deadline`, `requests.fee_deadline`, `requests.confirm_deadline` |
| Reminder lead, link life | `pay_reminder_hours`, `confirm_reminder_hours`, `email_link_hours` (R-14) |
| Links | `appOrigin()` + `/<locale>` + the paths of AC-5 |
| Sender | `EMAIL_FROM` |
| `send_until` | the deadline the mail names, else queue time plus 24 hours (R-5) |
| Rate limit window | `date_trunc('hour', now())` in `action_counters` (R-9) |

**Security model**: tokens stored only as digests, one live per profile, confirmed only by their own signed in owner
with a POST, and gone from the outbox once the row ends; addresses read only by the relay at send time, never in a
payload, a log, `last_error` or telemetry; no other party's personal data in any mail (R-6); `email_confirmations`
unreadable by every API role and purged after 30 days; trigger bodies are `security definer` with `search_path = ''`
and no grant; `lib/email` is imported only by `lib/relay`; the confirmation and the resend share one rate limit.

**Configuration required**:
- `EMAIL_DRIVER`: `off` (default), `fake` or `resend`.
- `EMAIL_API_KEY`: Resend sending key (S5); required only with `resend`.
- `EMAIL_FROM`: the sender, such as `Aldebyani <no-reply@domain>` once S4 exists; required only with `resend`.
- `EMAIL_FAKE_FILE`: the e2e wrapper's file for the fake driver; never set on Vercel.

**Critical test scenarios**: a retry sends one mail (AC-8, the same key); an expired pick that the failed pick limit
cancels sends no `pick_again` (R-1, `condition`); an unconfirmed address gets nothing but its confirmation (AC-4); an
address changed after queueing gets the mail at the new address only once it is confirmed, else none (R-8); a mapping
error never rolls back a payment (R-2); a burst of mail never delays a payment row (R-12); a reminder for a window
shorter than the lead, or already passed, is skipped (AC-6); a scanner's GET confirms nothing (AC-7); a token never
outlives its row (R-9).

## Build plan

Tracer Bullet: one thin thread first (the `chosen` mail, from the audit row through the email lane to the fake
driver's file), then the rest of the map, then the confirmation and the UI.

1. Tests first: pgTAP `29` for the triggers, the map, keys, switch, lanes, outcomes, gate, confirmation and reminders;
   template, door and `email` task unit tests; the lint proof. Satisfies **AC-1**, **AC-2**, **AC-11**, **AC-12**.
2. The migration `20261125090000_transactional_email`: the settings and their reader, `email_confirmations`, the
   widened counter check, the triggers and their bodies, `email_context`, the two lanes and `finish_email`, the token
   strip, `queue_reminders`, the housekeeping job and the cron schedules, the confirmation functions, the apply gate;
   the local seed turns `emails_enabled` on for `TR`; the database types updated. Satisfies **AC-3** to **AC-7**,
   **AC-10**, **AC-11**.
3. `lib/email` (the door, `emailDriver()`, the three drivers, the templates, the catalogue strings in three locales),
   the env schema and the deployment check, the relay's `email` task, the scrubber keys. Satisfies **AC-1**, **AC-2**,
   **AC-8**, **AC-9**.
4. The account confirm page and actions, the customer banner and the provider prompt; e2e. Satisfies **AC-4**,
   **AC-7**, **AC-10**, **AC-12**.
5. Reviews: `slice-reviewer` (Sonnet) and `security-reviewer` (Opus); PR; GitHub's `checks`, `database` and `e2e`; the
   migration pushed; merge.

## Consequences

- Positive: every money and deadline step reaches people without a notification centre; no money function changes its
  logic (07's `claim_outbox` only learns to leave mail to its own lane); one switch per region turns mail on; a mail
  about an undone move is never sent.
- Negative: users without a confirmed email get nothing, and sign in is by phone, so most start without one; Resend is
  one more provider to watch; a small trigger now runs on every mapped audit row (kept harmless by R-2); one more cron
  call a minute; twenty templates of draft copy in three locales wait for review before G3.
- Neutral: the outbox's retries and alerts cover mail too; the mapped audit actions become a contract, guarded by the
  meta test.

## Follow-up

- [ ] S43 (new owner step, after S4 and S5): set `EMAIL_DRIVER=resend`, `EMAIL_API_KEY` and `EMAIL_FROM` in Vercel; turn
  on `emails_enabled` for `TR`; announce a day, then turn on `apply_needs_email` for `TR` (R-10).
- [ ] The brief's notice row 1 (a new matching request, topic `new_matching_request`): P1, after 16; its switch on the
  account page sends nothing until then.
- [ ] Rows 13 and 14 (ratings): with 17 (P2). Rows 15 and 16 (report mails): 14 adds its actions to the map.
- [ ] `request.provider_suspended` (a job kept after the reveal): a customer notice with 16.
- [ ] Copy review of the templates in three locales (the `[draft]` markers) before G3, with S16 and S17 where they touch
  legal or money wording.
- [ ] Bounces and complaints (Resend webhooks): not in 13; a hard bounce should clear `email_confirmed_at` (with 21).
- [ ] A digest of new offers, if one mail per offer proves noisy (X-13).

## Rationale

The audit rows already exist, in the same transaction as every move, with the ids a mail needs; a small trigger on them
keeps mail atomic with the move without touching a money function, and deciding at send time keeps mail true to the
current state. Reading the address at send time avoids mailing a stale address; a POST to confirm stops link scanners
confirming an address nobody clicked; a lane of its own keeps a burst of mail from delaying a payment; one switch per
region keeps the cloud quiet until the domain exists, as `payments_enabled` did for payments.
