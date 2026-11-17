# 0009-08. iyzico door, relay, callbacks (position 08)

Child of [0009](index.md). Follows the cross child contract there. **High risk: PSP, secrets.**

## Summary

`lib/psp` becomes the one door to the payment provider, with two adapters behind one interface: a fake for tests and
development, and standard iyzico checkout over plain HTTPS. A relay route, `/api/relay`, run every minute by `pg_cron`
and woken at once when a payment starts, takes rows from the outbox and does the PSP work. The callback (the browser
coming back from the card page) and the webhook (iyzico's server message) only store what they receive; the relay then
asks iyzico for the real result and applies it. A reconciliation job catches anything stuck, and money alerts move to a
server only Sentry project so nobody can fake them (R5).

## Requirements

**User stories**:
- As the owner, I want every PSP call in one place, retried safely, and every result checked with iyzico itself, so that
  a forged redirect or a lost message never changes money.
- As the owner, I want to hear at once when money is stuck or wrong, from an alert nobody outside can fake.

**Prerequisites**: 07 merged. Branch `feat/08-iyzico-relay`. S1 for the iyzico adapter's real calls (the fake covers
the rest); S31 and S32 before the preview check.

**Acceptance criteria**:
- **AC-1**: `lib/psp/types.ts` defines one adapter interface: `initializeCheckout`, `retrieveCheckout`,
  `refundPayment`, `verifyWebhook`. Amounts cross it as integer minor units; the iyzico adapter alone turns them into
  iyzico's decimal text with integer string formatting (no floating point, rule 4).
- **AC-2**: `PSP_DRIVER` picks `fake` or `iyzico`. `lib/deployment.ts` refuses to boot a production deployment with
  `fake` or without the iyzico keys (fail closed, as 00b). Previews may run either.
- **AC-3**: Only files named `*relay*` import `lib/psp` (the existing lint rule), with a lint proof; `lib/psp` never
  imports `lib/db` client code for a user (it receives plain values) (umbrella U-4).
- **AC-4**: The iyzico adapter calls standard checkout over `fetch` with iyzico's documented request signature, no SDK.
  It sends: price and paid price equal to the fee amount, currency, `conversationId` = attempt id, `basketId` = fee id,
  one basket item named after the fee kind, enabled installments `[1]` only, locale `tr` for `tr` and `en` for `ar` and
  `en`, callback URL `appOrigin()` + `/api/psp/callback`, and buyer: real full name, the payer's profile id, city from
  `psp_buyer_city`, country Turkey, the no reply address (`EMAIL_FROM`'s address) as email when the payer has none,
  iyzico's documented placeholder identity number, and the request IP. No street line, no phone, no real identity
  number. Until S1 confirms the placeholder value and its acceptance, the adapter refuses with `psp_not_configured`.
- **AC-5**: `/api/relay` accepts only `POST` with header `x-relay-secret` equal (timing safe) to `RELAY_SECRET`; anything
  else answers 404 and logs. Tasks by body: `drain` (claim up to 20 outbox rows and run each, stop at 45 seconds),
  `reconcile_pending`, `reconcile_daily`, `heartbeat`, and from 21 `retention` (Storage objects and Auth users can only
  be deleted through their APIs, so the cleanup jobs run here with the service role). `maxDuration` 60.
- **AC-6**: A migration schedules with `pg_cron`: `drain` every minute, `reconcile_pending` every 15 minutes,
  `reconcile_daily` at 03:00 Europe/Istanbul; each posts through `pg_net` with URL and secret read from Supabase Vault.
  `start_checkout` (07) also posts one `drain` kick through `pg_net` (sent after commit).
- **AC-7**: `checkout.initialize`: the relay calls `initializeCheckout` and stores token and URL, attempt `ready`. On a
  final failure the attempt becomes `failed` and the pay page offers to try again.
- **AC-8**: `/api/psp/callback` (iyzico posts the form with a token): records a `callback` PSP event, finds the attempt by
  token, queues `payment.verify` (key `checkout:<attempt_id>:verify:<n>`, the next n), kicks the relay, and answers 303 to
  `/[locale]/pay/<attempt_id>`. It changes no money state. An unknown token answers 303 to the home page and logs.
- **AC-9**: `/api/psp/webhook`: `verifyWebhook` checks the signature with the scheme S1 confirms; an invalid one answers
  401 and logs; a valid one records a `webhook` PSP event (key: iyzico's event id or payment id plus status) and queues
  the same `payment.verify`. Body capped at 64 KiB. Answers 200 within the request.
- **AC-10**: `payment.verify`: the relay calls `retrieveCheckout`, records a `retrieve` PSP event, and: on a paid result
  always calls `apply_fee_paid` with what it retrieved (iyzico's payment id, amount, currency, its cut, or no cut), so
  07 decides accept, late or mismatch; on a failed result marks the attempt `failed`; while still pending retries by the
  outbox schedule.
- **AC-11**: `refund.request` (key `refund:<fee_refund_id>`): before every call, first try and retries alike, the
  adapter retrieves the payment's refund state from iyzico and skips the call when a refund is already there, because
  iyzico offers no idempotency key for refunds (rule 6). The relay stores `psp_refund_id` on the refund row before it
  marks the outbox row `done`, then calls `apply_fee_refunded`. After the last try the refund row becomes `failed` and
  `refund_failed` alerts. Which iyzico call (cancel the same day, refund after) is the adapter's choice, from S1's
  facts.
- **AC-12**: `reconcile_pending` queues a new `payment.verify` (next n) for every attempt `ready` for more than 10
  minutes with no result, and makes an attempt `ready` for 2 hours `abandoned` after one final unpaid retrieve. `reconcile_daily` retrieves every fee paid or refunded the previous Istanbul day and compares status, amount
  and currency; any difference alerts `reconcile_mismatch`; it then runs `ledger_check` per region and alerts
  `ledger_unbalanced` on any row.
- **AC-13**: `heartbeat` alerts `relay_stalled` when the oldest due `pending` outbox row is older than 5 minutes, and the
  relay checks in to one Sentry cron monitor each minute, so a stopped schedule alerts too.
- **AC-14**: R5: server errors and alerts go to a new server only Sentry project through `SENTRY_SERVER_DSN`, never sent
  to a browser; the alert rules of D80 and D84 are recreated there; the browser DSN keeps errors only. A test proves no
  client bundle contains the server DSN.
- **AC-15**: The fake adapter is deterministic: its card page `/[locale]/dev/fake-checkout/<token>` exists only when
  `PSP_DRIVER=fake` and offers success, failure, slow and duplicate; it posts back to the real callback. One contract
  test suite runs against both adapters (the iyzico one on recorded S1 responses).
- **AC-16**: No log line, event or alert carries buyer data, a checkout token or a card field; the scrubber gains
  `buyer`, `identity_number`, `psp_token`; a test feeds a full iyzico response through it.
- **AC-17**: The three routes join the public machine endpoints list (`AGENTS.md`) and 01's action guard meta test by
  exact name, with lint proofs.

## Decision

Next Route Handler relay driven by `pg_cron` and `pg_net`; initialize checkout in the relay, kicked at once; callback and
webhook only store; the relay retrieves and applies. iyzico over `fetch`, no SDK.

## Feature design

**Data model**: none new (07's tables). Vault secrets `relay_url`, `relay_secret`. `pg_cron` and `pg_net` extensions.

**API surface**:

| Route | Method | Input | Output | Auth | Errors |
| --- | --- | --- | --- | --- | --- |
| `/api/relay` | POST | `{ task }` | `{ ran, failed }` | `x-relay-secret` | 404 |
| `/api/psp/callback` | POST (form) | `token` | 303 to pay page | none (machine) | 303 home |
| `/api/psp/webhook` | POST (JSON) | iyzico event | 200 | iyzico signature | 401, 413 |

**Value sourcing**:

| Value | Source |
| --- | --- |
| Fee amount, currency | `fee_payments` |
| Buyer name | `profiles.full_name` |
| Buyer city | `psp_buyer_city` setting |
| Buyer email | `profiles.email`, else the address in `EMAIL_FROM` |
| Placeholder identity number | iyzico's written answer in S1, held as a constant in `lib/psp/iyzico.ts` |
| Card page locale | `checkout_attempts.locale` (set by 09 and 10's pay action from the page locale), mapped `tr→tr`, `ar` and `en` → `en` |
| PSP cut | the retrieve result field S1 confirms |

**Security model**: the relay secret is the only way in; the service role lives only in the relay route and jobs; the
webhook trusts nothing until the relay retrieves the same payment from iyzico.

**Configuration required**:
- `PSP_DRIVER`: `fake` or `iyzico`.
- `IYZICO_API_KEY`, `IYZICO_SECRET_KEY`, `IYZICO_BASE_URL`: sandbox on previews (S1), live at G3 (S2).
- `RELAY_SECRET`: shared with Vault (S32).
- `SENTRY_SERVER_DSN`: the server only project (S31).

**Critical test scenarios**: a forged callback with a real token but a failed payment changes nothing (AC-8, AC-10); a
webhook with a bad signature is refused (AC-9); a crash after `retrieveCheckout` and before `apply_fee_paid` is replayed
safely on the next run (AC-10, 07 AC-8); a crash after iyzico refunds and before the row is marked never refunds twice
(AC-11); a payment confirmed after a verify ran out of tries is still applied by reconcile (AC-12); two relay runs never process one row twice (07 AC-10); a stalled schedule
alerts (AC-13).

## Build plan

1. Tests first: the adapter contract suite and the fake; `lib/psp`; lint proof; satisfies **AC-1** to **AC-3**, **AC-15**.
2. iyzico adapter on recorded responses (live sandbox once S1 is done); satisfies **AC-4**, **AC-11**.
3. Relay route and handlers, the migration for cron, net and Vault; satisfies **AC-5** to **AC-7**, **AC-10** to
   **AC-13**.
4. Callback and webhook routes, exemptions; satisfies **AC-8**, **AC-9**, **AC-17**.
5. Server only DSN and alert rules (with S31), scrubber keys; satisfies **AC-14**, **AC-16**.
6. Owner: S31, S32, push the migration after a dry run; a sandbox payment on the preview; reviews with
   `security-reviewer`; merge.

## Consequences

- Positive: rule 3 is enforced by structure; the fake makes every later position testable without iyzico.
- Negative: payments depend on `pg_cron`, `pg_net` and a Vercel function all working; one more secret to rotate.
- Neutral: the daily reconcile is our only settlement check until iyzico's report API is known.

## Rationale

Storing first and retrieving later means the two inputs we cannot trust (a redirect and a webhook before its signature is
known) can never move money. `fetch` keeps the door small and reviewable; the old iyzico SDK would add a dependency for
three calls.
