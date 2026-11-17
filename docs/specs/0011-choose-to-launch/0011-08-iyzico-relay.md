# 0011-08. PSP door, relay, callbacks (position 08)

Child of [0011](index.md). Follows the cross child contract there. **High risk: PSP, secrets, money.**

> **Amended 2026-11-17 (D173)** against what 07 built (PR #35, migration `20261119090000_money_core`,
> `architecture.md` §39g), the way 0011-07 was amended (D169). Folds in D170 (the relay facing signatures as built),
> D172 (`payments_enabled`, built here) and the R13 items owned by 08 (three alert reasons, the card page URL held to
> the PSP host, a host for the fake). **Everything is built and tested against the fake PSP**; the iyzico adapter is
> one isolated slot that refuses until S1 lands (B3), with its unknowns named in AC-4. S32 and S33 are needed for the
> real route on a deployment, not for the build. New AC-0, AC-18 to AC-21; every other AC changed. Cross checked on
> Sonnet the same day (15 findings, all applied as the rules R-1 to R-15, plus R-16 found while applying).
> Accepted by the owner 2026-11-17. **Where a rule below and an AC differ, the rule wins.** The forms 08 was built
> with (D174) are recorded in *As built* below, which wins over both.

## Summary

`lib/psp` becomes the one door to the payment provider, with three drivers behind one interface: `off` (the default,
refuses every call), a deterministic `fake` for tests, development and previews, and standard iyzico checkout over plain
HTTPS, which ships as a slot that refuses until the sandbox facts (S1) are in. A relay route, `/api/relay`, run every
minute by `pg_cron` and woken at once when a checkout starts, takes rows from the outbox and does the PSP work. The
callback (the browser coming back from the card page) and the webhook (the PSP's server message) only store what they
receive and queue a check; the relay then asks the PSP for the real result and hands it to 07's functions, which decide.
Every read and write the relay needs is a service role database function, because 07 gave no role any table access. A
`payments_enabled` switch per region stops new card pages without a deploy, while payments already taken are still
booked and refunded. Reconciliation catches anything stuck, and money alerts move to a server only Sentry project so
nobody can fake them (R5).

## Requirements

**User stories**:
- As the owner, I want every PSP call in one place, retried safely, and every result checked with the PSP itself, so
  that a forged redirect or a lost message never changes money.
- As the owner, I want to stop new payments in a region at once, without a deploy, and still have money already taken
  booked and returned.
- As the owner, I want to hear at once when money is stuck or wrong, from an alert nobody outside can fake.

**Prerequisites**: 07 merged (PR #35) and its migration in the cloud (S36). Branch `feat/08-iyzico-relay`. One
migration, `relay`, after `20261119090000_money_core`, builds AC-6, AC-18 to AC-21. Not needed for the build or the
local checks: S1 (fills the iyzico slot later, 08b), S32 and S33 (needed before a relay runs on a deployment, A-1).

**Acceptance criteria**:
- **AC-0** (D170, 07 as built): the relay calls 07's functions exactly as built, with the service role client:
  `claim_outbox(p_limit, p_worker)` returns an array of `{id, kind, idempotency_key, payload, attempts, region,
  claim_token}`; `finish_outbox(p_id, p_ok, p_error, p_claim_token)` gets the `claim_token` string back exactly as
  received (never through a JavaScript `Date`, which drops microseconds); a `stale: true` answer means another relay owns
  the row now, so the relay logs `outbox_stale` and moves on (every handler is safe to run twice). `apply_fee_paid` and
  `apply_fee_refunded` results carry `alerts` and `replayed`; the relay raises each alert (AC-19) only when `replayed` is
  false. `record_psp_event(p_source, p_event_key, p_payload, p_region)` takes the owning row's region. `enqueue_outbox`
  and `post_journal` have no grant: the relay never calls them; it queues work only through 08's functions (AC-20).
- **AC-1**: `lib/psp/types.ts` defines one adapter interface: `initializeCheckout`, `retrieveCheckout` (by checkout
  token), `retrievePayment` (by PSP payment id, for the daily reconcile), `refundPayment`, `verifyWebhook`, plus
  `checkoutHosts` (AC-21) and `homeRegion`. Amounts cross it as integer minor units (`number`, at most `MAX_MINOR`); only
  an adapter turns them into its PSP's decimal text, and turns the PSP's figures back through `lib/money/parse`
  (`parseMinor` on the figure's text). A figure that does not parse is a failed call (`psp_bad_response`), never a guess
  (rule 4). Every call has a 15 second timeout. Results are typed unions: `paid`, `failed`, `pending` for a retrieve.
- **AC-2**: `PSP_DRIVER` is `off` (the default when unset), `fake` or `iyzico`, read through `lib/env.ts`. `off` refuses
  every call with `psp_not_configured`. A production deployment (`VERCEL_ENV=production`) refuses to boot with `fake`.
  `iyzico` on a deployment refuses to boot without `IYZICO_API_KEY`, `IYZICO_SECRET_KEY`, `IYZICO_BASE_URL` (https, an
  iyzico API host; the live host only in production), `RELAY_SECRET` and `SENTRY_SERVER_DSN`. With `off` or `fake` a
  deployment boots without them (`lib/deployment.ts`, with a test per case), so merging 08 never stops production.
- **AC-3**: Only the relay imports `lib/psp`: the existing lint rule (`**/relay/**`, `**/*relay*.ts`). The handlers live
  in `lib/relay/` (`drain.ts`, `callback.ts`, `webhook.ts`, `reconcile.ts`, `heartbeat.ts`, `fake-checkout.ts`); the
  route files only parse the request and call them. Lint proofs: a route under `app/api/psp/` importing `lib/psp` or
  `lib/db/admin` fails. `lib/psp` never imports `lib/db`; it receives plain values, and the fake receives its store as
  two functions (AC-15) (umbrella U-4).
- **AC-4** (the iyzico slot, B3): `lib/psp/iyzico.ts` implements the interface by refusing every call with
  `psp_not_configured`, and its header lists the facts S1 must settle before 08b fills it: (a) whether the existing
  account allows standard checkout (D93); (b) the placeholder identity number and its acceptance; (c) whether a
  registration and billing address line is required and what non street value is accepted; (d) the card page host per
  environment (`paymentPageUrl`); (e) the retrieve fields that mean paid (`status`, `paymentStatus`, `fraudStatus`),
  iyzico's cut, the payment id and the item transaction id; (f) the webhook signature scheme, its header, which secret
  signs it, and the event id; (g) cancel versus refund, by payment or by item transaction id, how to read a payment's
  existing refunds, and the refund id returned; (h) the callback form fields; (i) the decimal text format accepted; (j)
  the card page locales. 08b, after S1: standard checkout over `fetch` with the documented request signature, no SDK;
  price and paid price equal to the fee amount, currency, `conversationId` = attempt id, `basketId` = fee id, one basket
  item named after the fee kind, installments `[1]` only, locale `tr` for `tr` and `en` for `ar` and `en`, callback
  URL `appOrigin()` + `/api/psp/callback`, buyer: full name, the payer's profile id, city from `psp_buyer_city`, country
  Turkey, the payer's email or `EMAIL_FROM`'s address, the placeholder identity number, the request IP. No street line,
  no phone, no real identity number. The contract suite (AC-15) then runs on recorded S1 responses.
- **AC-5**: `/api/relay` accepts only `POST` with header `x-relay-secret` equal (timing safe) to `RELAY_SECRET`; without
  the secret configured, or anything else, it answers 404 and logs `relay_refused`. Body at most 1 KiB, JSON `{ task }`;
  an unknown task answers 400. Tasks: `drain` (claim up to 20 rows at a time and run each, stop claiming at 45 seconds),
  `reconcile_pending`, `reconcile_daily`, `heartbeat`, and from 21 `retention`. `maxDuration` 60. The worker name is
  `relay:<release>:<random>`.
- **AC-6**: The migration enables `pg_cron` and `pg_net` and adds `relay_kick(p_task)` (internal, definer): it reads
  `relay_url` and `relay_secret` from Vault and posts `{ task }` through `pg_net`; when either secret is missing (local,
  CI, before S33) it does nothing. Schedules: `drain` every minute, `heartbeat` every 5 minutes, `reconcile_pending`
  every 15 minutes, `reconcile_daily` at 00:00 UTC (03:00 Istanbul, which has no daylight saving). `start_checkout` (07)
  is replaced to call `relay_kick('drain')` after it queues its row (sent by `pg_net` after commit, nothing on rollback).
- **AC-7**: `checkout.initialize`: the relay reads `checkout_context(attempt)`; an attempt no longer `queued` finishes the
  row with no call. It reads `payments_enabled` for the attempt's region (AC-18); off: `mark_checkout_failed(attempt,
  'payments_disabled')`, no PSP call. On: `initializeCheckout`, then the URL check (AC-21), then
  `mark_checkout_ready(attempt, token, url)`. A refused URL is `mark_checkout_failed(attempt, 'url_refused')` and alerts
  `psp_bad_response`. `psp_not_configured` fails the attempt at once and alerts. Any other error retries by the outbox
  schedule; the last try fails the attempt (`init_failed`). The pay page (09) offers to try again.
- **AC-8**: `/api/psp/callback` (POST form, body at most 8 KiB, `token` 1 to 500 characters): calls
  `psp_callback(token, fields)` (AC-20), which finds the attempt by token, records a `callback` PSP event with the
  attempt's region, queues `payment.verify` with key `checkout:<attempt_id>:verify:callback`, and kicks the relay. The
  route answers 303 to `/<locale>/pay/<attempt_id>` (the attempt's locale, else the region's default locale). It
  changes no money state. An unknown token answers 303 to `/` and logs `psp_callback_unknown` (never the token).
- **AC-9**: `/api/psp/webhook` (POST, body at most 64 KiB, else 413): `verifyWebhook` checks the signature; invalid
  answers 401 and logs; `psp_not_configured` answers 503. A valid one calls `psp_webhook(event_key, token,
  psp_payment_id, payload)`, which records a `webhook` PSP event (key: the adapter's event id) with the region of the
  attempt found by token, else of the fee or refund found by PSP payment id, else the adapter's home region, and, when an
  attempt is found, queues `payment.verify` with key `checkout:<attempt_id>:verify:webhook:<psp_event_id>`. Answers 200
  within the request.
- **AC-10**: `payment.verify` (payload `{attempt_id, final}`): the relay reads `checkout_context`, calls
  `retrieveCheckout(token)` and records a `retrieve` PSP event (key `retrieve:<attempt_id>:<status>:<psp_payment_id or
  none>`). Paid: it checks the echoed conversation id and basket id equal the attempt and fee ids (else no apply, alert
  `reconcile_mismatch`, the row done), then always calls `apply_fee_paid` with what it retrieved (PSP payment id, amount,
  currency, the PSP's cut or null), so 07 decides accept, late or mismatch. Failed: `mark_checkout_failed(attempt,
  'psp_failed')`. Pending: with `final` set, `abandon_checkout(attempt)`; else the row retries by the schedule. Runs when
  `payments_enabled` is off (D172).
- **AC-11**: `refund.request` (payload as 07 writes it: `{fee_refund_id, psp_payment_id, amount, currency}`, key
  `refund:<fee_refund_id>`): `refundPayment` first reads the payment's refunds from the PSP, on every try, and returns the
  existing refund's id without a new call when one for that amount is there, because the PSP offers no idempotency key
  for refunds (rule 6); an existing refund of another amount refuses `reconcile_mismatch`. Then the relay calls
  `apply_fee_refunded(fee_refund_id, psp_refund_id)`, which stores the id and `done` in one statement (07's check ties
  them), and only then `finish_outbox`. After the last try: `mark_refund_failed(fee_refund_id)` and alert
  `refund_failed`. Runs when `payments_enabled` is off (D172).
- **AC-12**: `reconcile_pending` calls `reconcile_pending()` (AC-20), which queues `payment.verify` with key
  `checkout:<attempt_id>:verify:reconcile:<15 minute window>` for every attempt `ready` for more than 10 minutes (with
  `final` once it is older than 2 hours), and fails (`init_failed`) every attempt `queued` for more than 30 minutes whose
  `checkout.initialize` row is `failed`. `reconcile_daily` reads `reconcile_daily_list(region, day)` (fees paid or
  refunded and late refunds done on the previous Istanbul day, at most 500, an alert when cut), calls `retrievePayment`
  for each, records a `reconcile` PSP event (key `reconcile:<day>:<psp_payment_id>`), and alerts `reconcile_mismatch`
  (record: the fee or refund id) on any difference in status, amount, currency or the PSP's cut. It then runs
  `ledger_check` per active region and alerts `ledger_unbalanced` (record `<region>:<check>:<ref>`) for every imbalance.
  It corrects nothing (A-2).
- **AC-13**: `heartbeat` calls `outbox_health()` and alerts `relay_stalled` when the oldest due `pending` row is older
  than 5 minutes, and `outbox_failed` (record: the row id) for a row that turned `failed` since the last run (refund rows
  alert `refund_failed` instead). Each `drain` run checks in to one Sentry cron monitor (`relay-drain`, through a new
  `checkIn` door function in `lib/observability`), so a stopped schedule alerts too.
- **AC-14**: R5: with `SENTRY_SERVER_DSN` set, every server error, log and alert goes to the server only Sentry project
  and never to a browser; the browser DSN keeps browser errors only. Without it (local, or a deployment with `off` or
  `fake`), the server keeps today's DSN. A test proves no client bundle holds the server DSN. The alert rules of D80 and
  D84 are recreated on the server project after S32.
- **AC-15**: The fake adapter is deterministic. Its card page `/[locale]/dev/fake-checkout/<token>` exists only when
  `PSP_DRIVER=fake` and the deployment is not production (else 404), and offers success, failure, pending (two pending
  retrieves, then success), duplicate (a second payment id for the same token), amount mismatch (one minor unit more) and
  webhook only (no callback). The choice is stored through `fake_psp_set` and read through `fake_psp_get` (AC-20); the
  page then posts the real callback form, and the webhook case posts a webhook signed with a fixed test secret. One
  contract test suite runs against the fake now and against the iyzico adapter on recorded S1 responses in 08b.
- **AC-16**: No log line, event or alert carries buyer data, a checkout token, a card page URL or a card field. The
  scrubber gains `buyer`, `identityNumber`, `identity_number`, `token`, `psp_token`, `paymentPageUrl`,
  `checkoutFormContent`; a test feeds a full iyzico style response through it.
- **AC-17**: `/api/relay`, `/api/psp/callback`, `/api/psp/webhook` join the public machine endpoints list (`AGENTS.md`)
  and 01's action guard meta test by exact name, with lint proofs; the fake checkout page joins the guard's dev only list.
- **AC-18** (D172): a `payments_enabled` setting per region (a JSON boolean, the existing `_enabled` check), seeded
  `false` in both regions by the migration; the local seed turns `TR` on for the e2e suite. `MONEY_FLAGS` gains it, so
  `isEnabled` fails closed (a missing or bad row is off, logged, alerted `flag_read_failed`). The relay reads it with its
  service role client once per `checkout.initialize` row, never cached. `payments_enabled(p_region)` (internal SQL,
  same fail closed reading) is there for 09 and 10's pay functions. Off stops only new card pages: verify, refund and
  reconcile run as usual.
- **AC-19** (R13, R-3 of 07): `AlertReason` gains `idempotency_conflict`, `late_payment_refunded`, `reconcile_mismatch`,
  `refund_failed`, `relay_stalled`, `ledger_unbalanced`, `outbox_failed`, `psp_not_configured`, `psp_bad_response`,
  `checkout_settings_invalid` (R-16), each
  with its record id documented. An error `idempotency_conflict`, `validation_failed`, `not_found` or `invalid_state`
  from a 07 function retries by the schedule and alerts on the first try and when the row fails.
- **AC-20**: The migration adds these functions (definer, `search_path` empty, service role only unless said), each with
  pgTAP for its happy path, its refusals and a denied anonymous and customer call: `checkout_context(p_attempt_id)`
  (attempt status, locale, token, region; fee id, kind, amount, currency; payer id, full name, email),
  `mark_checkout_ready(p_attempt_id, p_token, p_url)` (from `queued` only), `mark_checkout_failed(p_attempt_id,
  p_reason)` (from `queued` or `ready`), `abandon_checkout(p_attempt_id)` (from `ready` only), `psp_callback(p_token,
  p_fields)`, `psp_webhook(p_event_key, p_token, p_psp_payment_id, p_payload)`, `mark_refund_failed(p_fee_refund_id)`
  (from `queued` only), `reconcile_pending()`, `reconcile_daily_list(p_region, p_day)`, `outbox_health()`,
  `fake_psp_set(p_token, p_outcome)`, `fake_psp_get(p_token)`; internal: `relay_kick(p_task)`,
  `payments_enabled(p_region)`. `checkout_attempts` gains `failure_reason` (`payments_disabled`, `psp_not_configured`,
  `url_refused`, `psp_failed`, `init_failed`; set only on the move to `failed`) and a unique index on `psp_token`. A
  table `fake_psp_outcomes` (token, outcome, region, timestamps; RLS on, no API grant) holds the fake's choices.
- **AC-21** (R13 S8): a card page URL is stored only when it parses, has no user info, and its host is in the active
  adapter's `checkoutHosts`, by exact match: the fake's is the host of `appOrigin()` (http only for `localhost`), iyzico's
  is the S1 list (empty until then, so every iyzico URL is refused). The check is one pure function,
  `isAllowedCheckoutUrl`, in `lib/payments/checkout-url.ts` (not a door, so 09's redirect calls it too).
  `mark_checkout_ready` checks the shape again in SQL (https, or http on `localhost`; no user info; at most 2,000
  characters).

## Author notes (D173)

- **A-1, one relay per database.** Previews and production share one Supabase project until S34 (R4), so the one
  `relay_url` in Vault decides which deployment runs every queued checkout, whoever started it. Until launch, production
  runs `PSP_DRIVER=off` and both regions keep `payments_enabled` false in the cloud. 08's check on a deployment (after
  S32 and S33) proves only the plumbing: the schedule reaches the relay (a `drain` run logged, the `relay-drain` check in
  seen in the server project), a wrong secret answers 404, and an alert lands in the server project only. Nothing in 08
  opens a checkout on a deployment (only 09's pay action does), so the first fake payment on a preview is 09's real call
  check; for it the owner points `relay_url` at that preview and turns `payments_enabled` on for `TR`, then back (S37).
- **A-2, the daily reconcile corrects nothing.** 07 built no correcting posting: a PSP cut posted as 0 (07 AC-8) or any
  other difference is alerted, and the owner fixes it by hand until 16 adds an admin correction with its own journal
  kind (and `ledger_check` learns it).
- **A-3, keys differ from the umbrella.** Verify keys are `checkout:<attempt_id>:verify:callback`,
  `…:verify:webhook:<psp_event_id>` and `…:verify:reconcile:<window>` in place of the umbrella's counted `<n>`: each is
  built from domain ids with no read before the write, and a replayed callback or webhook queues nothing new.
- **A-4, before 09.** 07's accept checks return false, so in 08 every payment, fake success included, goes the late path
  and is refunded. 09 and 10 replace the checks; the end to end loop of 08 stays as the late path test.

## Amendment rules (D173, cross check 2026-11-17)

Sonnet found 15 (1 Critical, 8 Major, 6 Minor), all checked against the migration and applied as R-1 to R-15; R-16 was
found while applying them. **A rule wins over an AC and over the author notes.**

- **R-1, a callback is never dead (Critical).** `psp_callback` records its event with key `callback:<attempt_id>:<UTC
  minute>` and queues `payment.verify` with key `checkout:<attempt_id>:verify:callback:<same minute>`: at most one per
  attempt per minute, so a forger is bounded and a later callback for the same token always queues a new check, even
  after an earlier verify failed or the attempt finished. `reconcile_pending` also queues a verify (R-10's key) for
  attempts `failed` with `psp_failed` or `abandoned` that finished less than 2 hours ago, because a payment can still
  land on their token. This replaces AC-8's constant key, A-3's callback key and the umbrella's "never checked again".
- **R-2, abandon only on a dead token.** The retrieve result gains `expired` (the token is past its lifetime or unknown
  to the PSP). `abandon_checkout` runs only when a `final` verify retrieves `expired`; `pending` on a `final` verify
  retries by the schedule. AC-4 gains (k): the token lifetime and the retrieve answer for an expired token; the 2 hour
  final window must be longer than that lifetime. The fake's token lives 30 minutes.
- **R-3, the drain fits its lease.** `drain` claims at most 5 rows per `claim_outbox` call, runs them concurrently,
  checks a 40 second deadline before each claim, and no handler runs longer than 60 seconds in total (PSP calls 15
  seconds each), well inside the 2 minute lease. A claimed row the run could not finish is logged `outbox_unfinished`;
  its lease runs out and it is claimed again (every handler is safe to run twice).
- **R-4, no card page for a fee that moved on.** `checkout_context` also returns `fee_status` and
  `attempt_age_seconds`. `checkout.initialize` calls `mark_checkout_failed(attempt, 'fee_not_pending')` when the fee is
  not `pending`, and `mark_checkout_failed(attempt, 'init_late')` when the attempt is older than `checkout_hold_minutes`
  (R-16), in both cases with no PSP call. Both join the closed `failure_reason` list.
- **R-5, the host list without the door.** `isAllowedCheckoutUrl(url, hosts)` takes the host list as an argument.
  `lib/payments/checkout-hosts.ts` derives the list from `PSP_DRIVER`, `appOrigin()` and the iyzico host constants (empty
  until S1), with no `lib/psp` import; the adapters read their `checkoutHosts` from it, and a test asserts they match. 09's
  redirect calls both, so no user path imports `lib/psp`.
- **R-6, PSP payloads lose tokens and page URLs too.** The `relay` migration replaces `psp_payload_strip` to also drop, at
  any depth and any case, `token`, `psp_token`, `paymentPageUrl`, `checkoutFormContent`. pgTAP feeds a full iyzico style
  retrieve and a callback form through `record_psp_event` and finds none of them, nor any card or buyer field.
- **R-7, the kick never cuts the run.** `/api/relay` checks the secret and the body, answers 202 at once, and does the
  task inside `after()`, within `maxDuration` 60. `relay_kick` passes `timeout_milliseconds := 10000`. A run cut at any
  point is safe (R-3).
- **R-8, the payer's IP.** `checkout_attempts` gains `payer_ip` (`inet`, null), set by 09 and 10's pay functions from
  the request (passed to `start_checkout`, which 09 replaces) and read by `checkout_context`. It is personal data: never
  logged, never sent to a PSP event, and cleared to null by `reconcile_pending` on every attempt finished more than 2
  hours ago. The fake ignores it. AC-4 gains (l): whether iyzico accepts a placeholder instead.
- **R-9, one lock order, no errors on a finished attempt.** Every new function that touches a request, fee, attempt or
  refund locks in 07's order: the request, then the fee, then the attempt, then the refund. `mark_checkout_ready`,
  `mark_checkout_failed`, `abandon_checkout` and `mark_refund_failed` return `{changed: false, status}` when the row is
  not in a state they act on (never an error), and never overwrite `succeeded` or `done`. The relay then finishes its
  outbox row as done.
- **R-10, reconcile keys carry their payload.** The reconcile verify key is
  `checkout:<attempt_id>:verify:reconcile:<15 minute window>:<final|open>`, so the same window never builds two payloads
  under one key. `reconcile_pending` enqueues each row inside its own exception block: one conflict is counted and
  returned, never aborting the rest.
- **R-11, the daily reconcile in chunks.** `reconcile_daily` handles at most 25 payments per call under a 40 second
  deadline and is scheduled every 10 minutes from 00:00 to 01:50 UTC. `reconcile_daily_list(p_region, p_day, p_limit)`
  leaves out payments that already have a `reconcile:<day>:<psp_payment_id>` event, so each run resumes where the last
  stopped. The 01:50 run also runs `ledger_check` and alerts `reconcile_mismatch` (record `<region>:<day>:unfinished`) if
  any payment of that day is still left.
- **R-12, failed rows alert once.** `outbox_events` gains `alerted_at` (null). `outbox_health()` returns the oldest due
  `pending` age and every `failed` row with `alerted_at` null, and stamps them. For each, the heartbeat alerts
  `outbox_failed` (or `refund_failed` for `refund.request`, after calling `mark_refund_failed`, which also covers rows 07's
  `claim_outbox` failed with `lease_expired`). This replaces AC-13's "since the last run".
- **R-13, alerts on every call.** The relay raises the `alerts` of every `apply_fee_paid` and `apply_fee_refunded`
  result, replays included (the fingerprint joins them in one issue per record), so a crash between commit and alert
  never loses one. This replaces AC-0's "only when `replayed` is false".
- **R-14, named shapes.** `retrieveCheckout` → `{status: paid | failed | pending | expired, pspPaymentId, amount,
  currency, pspFee | null, conversationId, basketId}`; `retrievePayment` → `{status: paid | refunded |
  partially_refunded | failed, amount, currency, pspFee | null, refundedAmount}`. The daily compare: fee `paid` expects
  `paid`; fee `refunded` and a `done` refund expect `refunded` with `refundedAmount` equal to the amount; anything else,
  `partially_refunded` included, alerts. Returns: `psp_callback` → `{attempt_id, locale, region}` or null;
  `psp_webhook` → `{psp_event_id, new, attempt_id | null}`; `reconcile_daily_list` → rows of `{kind (fee | late),
  ref_id, psp_payment_id, status, amount, currency, psp_fee_amount | null}`; `outbox_health` → `{oldest_due_seconds,
  failed: [{id, kind, region, payload}]}`; `reconcile_pending` → `{queued, failed, conflicts, cleared_ips}`.
- **R-15, a webhook without an event id.** When the PSP gives no event id, the webhook event key is the hex SHA-256 of the
  raw body.
- **R-16, the two settings 08 owes (umbrella table).** The migration adds `checkout_hold_minutes` (15 ☐, an integer 1 to
  1,440; at least the token lifetime once S1 says it) and `psp_buyer_city` (`Istanbul` ☐ for `TR`, `Riyadh` ☐ for `SA`; 1
  to 100 characters) per region, with row checks under the `pricing_settings_guard` pattern; a missing or malformed key
  makes its reader refuse `checkout_settings_invalid` and alert. This replaces the null seed in the value sourcing.

## As built (D174, recorded 2026-11-17)

08 was built, verified and reviewed twice (`docs/reviews/2026-11-17-feat-08-iyzico-relay*.md`). These forms differ from
the text above; **each wins over the AC or rule it names.**

- **B-1 (AC-9, AC-20).** `psp_webhook(p_event_key, p_token, p_psp_payment_id, p_payload, p_home_region)`: the fifth
  parameter is the adapter's home region, used when neither an attempt (by token) nor a fee or refund (by PSP payment id)
  names the region. A code that is not a region refuses `validation_failed`.
- **B-2 (AC-5, R-7, the API table).** `/api/relay` answers 202 `{ accepted }` once the secret and the body pass, then runs
  the task inside `after()`. Every method but `POST` answers 404.
- **B-3 (R-3).** `drain` stops claiming at 25 seconds and cuts a handler at 30 seconds, because R-3's 40 and 60 exceed
  `maxDuration` 60.
- **B-4 (AC-12, R-1, R-10).** A check queued by `reconcile_pending` carries `origin: reconcile` in its payload; when it
  retrieves `pending` it finishes instead of retrying, because the next 15 minute window asks again. No check is queued
  for an attempt started more than 26 hours ago.
- **B-5 (R-8).** A payer's IP is cleared 2 hours after the attempt started or finished, whichever comes first.
- **B-6 (R-12).** `outbox_health` itself marks the refund of a failed `refund.request` row `failed`
  (`mark_refund_failed`, each in its own exception block, so one error never stops the rest).
- **B-7 (AC-6, AC-8, AC-9, AC-12).** The relay is woken only for new work: `psp_callback` and `psp_webhook` kick it only
  when their event is new, `reconcile_pending` only when it queued at least one check.
- **B-8 (AC-15).** The fake's payment ids are `fp<n>_<attempt_id>_<amount>_<currency>` (`n` is 1, or 2 for the
  duplicate): the attempt id, never the token. Its webhook secret is derived from `RELAY_SECRET`, not a fixed test secret.
- **B-9 (the fake fence, new).** Triggers on `fee_payments` and `fee_refunds` refuse a `psp_payment_id` starting `fp1_`
  or `fp2_` with `fake_payment_refused` unless the Vault secret `fake_psp_allowed` is `true`. Only the local seed sets it;
  in the cloud it exists only inside an S37 window (0011-09 AC-16), so a fake preview on the shared database cannot pay
  a real fee.
- **B-10 (AC-3).** `@/lib/relay` may be imported only by its routes (`app/api/relay`, `app/api/psp/*`), the fake checkout
  page and tests (lint, with proofs).
- **B-11.** Supabase's own grants on the `pg_net` schema are accepted as they are: it is not an API schema.

- **B-12 (owed by 09, D175; built in 09).** The callback's 303 moves to `/<locale>/pay/<attempt_id>/return`, and a
  verify whose apply answers `late` fails the attempt `late_payment` (0011-09 AC-8, AC-12, R-2, R-15).
- **08b checklist (0011-09 R-12).** AC-4 (k) gains: `checkout_hold_minutes` is at least the card page token lifetime,
  so a payment after a cancel past the hold cannot happen.

## Decision

A Next route relay driven by `pg_cron` and `pg_net`; initialize checkout in the relay, kicked at once; callback and
webhook only store and queue; the relay retrieves and hands the facts to 07's functions. Every relay read and write is a
service role database function. iyzico over `fetch`, no SDK, built only after S1; everything else on the fake.

## Feature design

**Data model**: 07's tables, plus `checkout_attempts.failure_reason` and a unique index on `psp_token`;
`fake_psp_outcomes`; settings `payments_enabled` and `psp_buyer_city` per region; Vault secrets `relay_url`,
`relay_secret` (S33); extensions `pg_cron`, `pg_net`.

**API surface**:

| Route | Method | Input | Output | Auth | Errors |
| --- | --- | --- | --- | --- | --- |
| `/api/relay` | POST | `{ task }` | 202 `{ accepted }` (B-2) | `x-relay-secret` | 404, 400 |
| `/api/psp/callback` | POST (form) | `token` | 303 to the pay page (the return page from 09) | none (machine) | 303 home |
| `/api/psp/webhook` | POST | PSP event | 200 | PSP signature | 401, 413, 503 |
| `/[locale]/dev/fake-checkout/<token>` | GET, POST | outcome | posts the callback | fake driver, not production | 404 |

**Value sourcing**:

| Value | Source |
| --- | --- |
| Fee amount, currency, kind | `fee_payments`, through `checkout_context` |
| Buyer name, email | `profiles.full_name`, `profiles.email` (else `EMAIL_FROM`'s address), through `checkout_context` |
| Buyer city | `psp_buyer_city` setting, seeded `Istanbul` ☐ (R-16) |
| Payer IP | `checkout_attempts.payer_ip`, set by 09 and 10 (R-8) |
| Checkout hold | `checkout_hold_minutes` setting, 15 ☐ (R-16) |
| Placeholder identity number | iyzico's written answer in S1, a constant in `lib/psp/iyzico.ts` (08b) |
| Card page locale | `checkout_attempts.locale` (09, 10), else the region's default locale |
| Card page hosts | `checkoutHosts` of the active adapter (AC-21) |
| PSP payment id, amount, currency, PSP cut | the verified retrieve result (AC-10); the cut field is unknown (e) until S1 |
| Region of a PSP event | the attempt, fee or refund it belongs to; else the adapter's home region (AC-9) |
| Payments on or off | `payments_enabled` per region (AC-18) |
| Retry schedule | 07's `finish_outbox` (1, 5, 30, 120, 720 minutes, 6 tries) |
| Relay URL and secret | Vault (`relay_kick`) and `RELAY_SECRET` (route), both S33 |

**Security model**: the relay secret is the only way into `/api/relay`; the service role lives only in `lib/relay/` and
`lib/db`; the callback and webhook trust nothing until the relay retrieves the same payment from the PSP; money moves
only inside 07's functions.

**Configuration required**: `PSP_DRIVER`; `IYZICO_API_KEY`, `IYZICO_SECRET_KEY`, `IYZICO_BASE_URL` (08b: sandbox on
previews after S1, live at G3 after S2); `RELAY_SECRET` (S33); `SENTRY_SERVER_DSN` (S32).

**Critical test scenarios**: a forged callback with a real token and a failed payment changes nothing (AC-8, AC-10); a
webhook with a bad signature is refused (AC-9); a crash after the retrieve and before `apply_fee_paid` replays safely
(AC-10, 07 AC-8); a crash after the PSP refunds and before `apply_fee_refunded` never refunds twice (AC-11); a payment
confirmed after its verify ran out of tries is applied by reconcile (AC-12); two relays never finish one row twice
(AC-0); payments off opens no card page but still books and refunds a late payment (AC-18); a card page URL on another
host is refused (AC-21); with 07's stub accept checks, a fake success goes the late path and is refunded end to end
(AC-10, AC-11).

## Build plan

1. Tests first: the adapter contract suite, the fake, the `off` driver, `lib/psp`, the URL check, lint proofs; satisfies
   **AC-1** to **AC-3**, **AC-15**, **AC-21**.
2. The migration (`relay`): the functions, columns and table of AC-20, `payments_enabled` and `psp_buyer_city`, `relay_kick`,
   the schedules, `start_checkout` replaced; pgTAP `20_relay`; satisfies **AC-6**, **AC-18**, **AC-20**.
3. Relay route and handlers against the fake and the local stack, with the end to end loop (pay, late, refund); satisfies
   **AC-0**, **AC-5**, **AC-7**, **AC-10** to **AC-13**, **AC-19**.
4. Callback, webhook and fake page, exemptions; satisfies **AC-8**, **AC-9**, **AC-17**.
5. Deployment checks, the server only DSN path, `checkIn`, scrubber keys; the iyzico slot with its unknowns; satisfies
   **AC-2**, **AC-4**, **AC-14**, **AC-16**.
6. Owner: push the migration after a dry run; reviews with `security-reviewer`; merge. Then S32, S33 and the relay check
   on a deployment (A-1). 08b fills the iyzico slot after S1.

## Consequences

- Positive: rule 3 is enforced by structure; the fake makes 09 to 12 testable without iyzico; payments stop without a
  deploy.
- Negative: payments depend on `pg_cron`, `pg_net` and a Vercel function all working; one more secret to rotate; the
  launch still waits on S1 and 08b (B3).
- Neutral: the daily reconcile only compares; corrections are by hand until 16.

## Rationale

Storing first and retrieving later means the two inputs we cannot trust (a redirect and a webhook) can never move money.
Database functions for every relay read and write keep 07's rule that no role touches a money table. `fetch` keeps the
door small and reviewable; an SDK would add a dependency for four calls. Building against the fake keeps 08 off the B3
critical path; only the slot waits.
