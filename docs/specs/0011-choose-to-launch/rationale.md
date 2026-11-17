# 0011. From choosing a provider to launch: rationale

Decision record for [index.md](index.md) and its children. `/develop` does not need this file.

## Context

> ⚠️ Premise note: on 2026-11-17 positions 05 to 21 are unbuilt and the plan still says launch on 2026-11-20. At the
> observed pace of about one position a day, 05 plus the thirteen positions here is about two and a half weeks of work,
> before the owner steps. The owner chose not to change the date in this spec. The cut list stays the lever: P2 is
> already out, then 16's report, then 15. Nothing in this spec cuts P0 reliability (expiry, refunds, idempotency, the
> reveal policy, the security review, backups).

From this point the product touches real money and reveals personal data. Forces that shaped every child:

- **The cash model (D87).** The platform only takes two fees; the job price never enters our books. Every refund is our
  own fee, and the PSP card fee is never recovered (D13).
- **Rules that never bend.** Server side amounts (1), contacts only when both have paid, by RLS (2), no external call in a
  request path and only the relay mutates through `lib/psp` (3), integer minor units (4), append only ledger (5),
  idempotent, atomic, balanced money operations (6), RLS with negative tests per table (7).
- **Unknown PSP facts (B3).** The callback signature, the event id, the refund call and the card fee are not confirmed
  until the iyzico sandbox (S1). The design has to work against a fake and switch without code changes in callers.
- **Hosting limits.** Vercel Hobby allows only daily cron jobs; the relay needs to run every minute. Supabase has
  `pg_cron` and `pg_net`.
- **A solo build at one position a day,** with reviews on a second model. Specs must stay small enough per position.
- **KVKK.** Phones, emails, street lines, report text and photos are personal data. Who reads them, when, and for how
  long must be decided, audited and limited.
- **Open owner steps** (S1, S16, S17, S24) block real values, legal copy and the money design, not the code.

## Options considered

### Spec shape

- **Umbrella with children (chosen).** One survey, one shared contract (states, settings, ledger, outbox), one child per
  position. Con: a big document set written at once may need edits as 05 lands.
- **One spec per position, surveyed in turn.** Matches the past loop. Con: thirteen more surveys, and the shared contract
  would be rediscovered and could drift.
- **Three grouped specs.** Fewer files. Con: one spec per several pull requests breaks the one position, one PR rhythm.

### Where the relay runs

- **A Next Route Handler `/api/relay`, called by `pg_cron` through `pg_net` every minute and kicked at once (chosen).**
  One TypeScript codebase, `lib/psp` stays one door under the existing lint rules, Hobby friendly. Con: each run is a
  function invocation, and the route must refuse anything without the secret.
- **Supabase Edge Function plus `pg_cron`** (build plan wording). Con: Deno runtime, so `lib/psp` would exist twice or be
  shared across runtimes, and the door lint rules do not cover it.
- **Vercel Cron.** Con: daily only on Hobby; needs Pro now.

### Opening the card page (initialize checkout)

- **Through the relay, kicked at once (chosen).** Rule 3 stays whole; the page waits one to three seconds for the URL.
  Con: one more moving part between the button and the card page.
- **Directly in the Server Action.** Faster and simpler. Con: a written exemption to rule 3 for an external call in a
  request path.
- **Relay on cron only.** Con: up to a minute of waiting.

### Other applicants when one is chosen

- **Stay `APPLIED` until the reveal (chosen).** A pick that fails leaves the list intact for the next pick (D90). Con:
  providers wait longer before they learn they were not chosen.
- **`NOT_SELECTED` at once, revived on a new pick.** Con: two status flips per failed pick and confusing notices.
- **`NOT_SELECTED` at once, final.** Con: fewer people to pick from, so more commission refunds.

### How a payment becomes verified

- **Callback and webhook only store; the relay retrieves the result and checks it (chosen).** A redirect never changes
  money (rule 3) and both channels feed the same check. Con: a short pending page after the card page.
- **Webhook only.** Con: the customer waits for the webhook.
- **Retrieve inside the callback.** Con: an external call in a request path.

### Posting the card fee

- **From the PSP fact per payment (chosen).** No guessed rate in code; reconciliation catches a difference. Con: depends
  on the retrieve result carrying the cut (S1 confirms).
- **Estimate from a setting, true up later.** Con: two postings per payment and a rate nobody has confirmed.
- **Post at settlement.** Con: the ledger lags by days.

### Email templates

- **Plain TypeScript template functions with escaped interpolation (chosen).** No new dependency; user text is always
  escaped (Q10's candidate rule 12). Con: less tooling for previews.
- **React Email.** Good previews. Con: new pinned packages and their review, for a dozen short messages.

### Admin two step login

- **Supabase Auth MFA with an authenticator app (chosen).** Built in; `aal2` (the stronger sign in level) checked in
  `guardPage` and `is_admin()`. Con: every admin token without `aal2` loses its rights the day it ships.
- **A second SMS code.** Con: same channel as sign in, and R7's SMS risk.
- **Passkeys.** Con: newer support, more build risk.

## Rationale

The umbrella keeps one contract for twelve pull requests: states, settings and ledger rules are defined once, so a child
cannot quietly invent its own transition or setting. The money path is shaped by rules 3 and 6 and by B3: everything that
reaches iyzico goes through one relay with deterministic keys, both callback channels only store, and the ledger takes the
card fee from the PSP's own figure, so nothing depends on a fact we do not have yet. The relay lives in Next because a
second runtime would split the one PSP door the lint rules protect, and `pg_cron` gives the minute schedule Hobby does
not. Keeping other applicants waiting follows directly from D90's carried commission. Privacy choices (contacts end 14
days after close, first reads audited, admin sees a street line only on click, the reported party learns only of an
action) keep KVKK exposure small without blocking the job.

### Owner overrides recorded by this spec

- 2026-11-17: no kill switches in 21 (build plan said "kill switches").
- 2026-11-17: the launch date is not changed by this spec.
- 2026-11-17: email shows in the reveal before it is confirmed, marked unconfirmed (the agent had recommended confirmed
  only).
- 2026-11-17: the applicant card also shows the job count and reviews when they exist; the full provider profile opens
  only for the chosen provider once the commission is paid.
- 2026-11-17: the relay runs as a Next route, not an Edge Function (build plan row 08).
- 2026-11-17: a carried commission with no applicant left waits for new applicants until the start, then is refunded
  (overrides "or no applicant left" in `project-overview.md` §36 row 7).

## Cross check (2026-11-17, Sonnet, read only)

25 findings: 1 Critical, 11 Major, 13 Minor. Applied on the owner's standing answer ("do recommended"):

- Critical: a payment in the wrong state set the fee `paid` before the state check, so a stale provider could be
  revealed. Now the state check runs first, and a payment that is not accepted leaves the fee `pending` and is refunded
  as `late` (index Money, 07 AC-8, 09 AC-5, 10 AC-2).
- Major: one lock order for every function; admin refunds bound to state; the reveal is a one way fact after unlock;
  `fee_refunds` covers late payments too (kind `late`); verify keys carry a sequence and attempts get `abandoned`;
  refund retries check iyzico's refund state first (no idempotency key there); customer notices for expiry,
  withdrawal and suspension; providers need a confirmed email to apply; retention runs through the relay; the restore
  drill never touches staging.
- Minor: the event kind list and a provider view without `meta`; `closed_at` on every close and its backfill; extension
  limits stored and capped at the start; the reminder email key; the confirm window reset after a handled report; flags
  can be raised again; counter subjects and `already_paid`; named defaults for D128 and D98.
- Kept as the owner decided: no applicant left waits until the start (above); a payment after the hold is refunded, not
  carried; the launch date is not changed here.
