# Review: feat/13-transactional-email (PR #45)

Reviewer: Sonnet (the code was written on Opus). Scope: `git diff master...HEAD` (40020c4, 6fb452b, 60c0f6d), read
against spec 0011-13 (rules R-1 to R-15 win over the ACs) and D192. The security review of the same day is not
repeated. Nothing was run: no npm script, build, Docker or database. Everything below comes from reading the
code and tracing the pgTAP file by hand against the migration. Line numbers are from the files on disk.

## Verdict

The migration, the relay task, the templates and the UI follow the spec closely, and I found no correctness bug in
the migration itself. The two things that will turn CI red are in the tests: the pgTAP file has a snapshot problem
that fails about 25 assertions, plus a SQL error in two more, and the e2e file has a locator that matches two
elements. Fix those three and the slice is in good shape.

## Blockers

### B1. pgTAP 29: STABLE helpers read the table in the same statement that writes it, so they see nothing

`supabase/tests/29_transactional_email.test.sql:189` (`pg_temp.mails`) and `:195` (`pg_temp.queued`) are declared
`LANGUAGE sql STABLE`. They are called in the same statement as a volatile function that does the write:

- `queued(audit(...))` at about 390 to 452 and 495 (every synthetic audit row: job.*, request.cancelled,
  provider_cancelled, failed_picks_limit, no_paid_pick, pick_expired, fee_expired, provider_withdrew, pick_dropped,
  carried pick_chosen, fee.late, fee.refunded, refund_done_by_hand, provider.*).
- `offer(9, 'a1') || ' ' || mails(9)` at about 384 to 387 (inside `probe`).

A STABLE function runs on the snapshot of the query that calls it. The rows that `audit()` or `offer()` insert, and
the outbox rows the trigger writes after them, belong to a later command id, so `queued` and `mails` return `''`.
Every assertion that expects a template (`'job_started>c1'`, `'pick_again>c1,pick_ended>a2'`, `'none new_offer>c1'`,
and so on) fails; the ones that expect `''` pass for the wrong reason. I count 25 failing assertions. The first
failure shows up at the "R-3: the same offer with the switch on" check.

Fix: declare `mails` and `queued` without `STABLE` (a volatile SQL function takes a fresh snapshot per call and sees
the earlier writes of the transaction). No other change is needed. `live`, `tok`, `ctoken`, `cfee`, `pfee` are
only called in a later statement than the write, so they are fine. A cheap guard: add a first assertion that
`queued(audit('job.started', ...))` returns a non empty value, so a regression of this kind fails loudly.

### B2. e2e: `page.getByRole('alert')` matches two elements (strict mode violation)

`e2e/transactional-email.spec.ts:218`:
`await expect(page.getByRole('alert')).toContainText(...link_used)`.

Next's route announcer is a `role="alert"` div inside an open shadow root
(`node_modules/next/dist/client/components/app-router-announcer.js`), and Playwright's role locators pierce open
shadow roots. After the page has hydrated there are two alerts, so `toContainText` throws a strict mode error in
`ar`, `tr` and `en`. The repo already knows this: `e2e/sign-in.spec.ts:270` uses `main [role="alert"]`, and
`catalog-pricing.spec.ts:292` filters by text.

Fix: `page.locator('main [role="alert"]')`, or `getByRole('alert').filter({ hasText: ... })`.

## Major

### M1. pgTAP 29: `ORDER BY 1 COLLATE "C"` is a SQL error (two assertions)

`:775` (the grants `results_eq`) and `:803` (the other three triggers `results_eq`). `1 COLLATE "C"` is no longer
an ordinal reference, it is an expression, and Postgres answers "collations are not supported by type integer".
`results_eq` reports a failed test with the error in the diagnostics. Fix: `ORDER BY p.proname COLLATE "C"` and
`ORDER BY tgname COLLATE "C"` (the other `ORDER BY` lines in the file name a column and are fine). The expected
`VALUES` order in both is already the C order, so only the `ORDER BY` changes.

## Minor

### m1. e2e: a race and a stale file

- `e2e/transactional-email.spec.ts` right after the first `waitForMail`: the has_token / status query runs once.
  The driver appends the line to the file before `finish_email` runs, so on a slow CI box the row can still be
  `claimed` with its token. Use `expect.poll` around that query.
- The fake file `.next/e2e-mail.jsonl` is never cleared. In CI it starts empty, but a local rerun finds the
  previous run's `confirm_email` line for the same address first (`find` returns the oldest) and takes a dead
  link. Truncate it in `scripts/e2e.mjs` before the server starts.
- `page.getByRole('status')` (the "confirmed" check) would clash if a `PageSkeleton` (`role="status"`) is on the
  page at that moment; `filter({ hasText: m(locale, 'Account.confirm.done') })` is safer.

### m2. Copy: `pick_again` blames the provider when the customer missed the window

`request.pick_expired` (the customer did not pay the commission in time) maps to `pick_again`, and the draft line
says "The provider you chose ... cannot go ahead". AC-3 maps both rows to the same template, so the code is right,
but the sentence will confuse a customer who simply paid late. Give `pick_again` a second lead for the expired
pick case, or word the line neutrally ("This pick ended"). Copy review is already owed before G3.

### m3. Copy: a commission of 0

For a commission of 0 (D171, no fee row) `commission_received` still says "We received your commission of ₺0,00".
Either skip the mail when `amount` is 0, or use a line without the amount. The e2e journey drives exactly this
case, so it passes either way.

### m4. The email task has no Sentry check in

`lib/relay/task.ts`: `drain` wraps its run in `checkIn('relay-drain', ...)`, `email` does not. `relay_stalled`
still watches the oldest due row of both lanes, so a stalled lane alerts, but a lane that errors every run does
not show on the cron monitor. Optional.

### m5. `tr` catalogue is English with a `[tr]` prefix

Known and held by `npm run launch:gate` (D100); noted so it is not forgotten for the `Email.*` strings (55 per
locale, all `[draft]`).

## What I traced and found correct

- Migration against AC-3: the 24 trigger actions equal the map; every audit row carries the ids the trigger reads
  (`application_id` on commission_paid, unlocked, job.*, pick_expired, fee_expired, provider_withdrew,
  pick_dropped; `fee_refund_id` on cancel_by_rule and fee.late). Keys are `email:<audit>:<recipient>:<template>`,
  `email:offer:<app>`, `email:confirm:<id>`.
- R-2 (failed row, then warning), R-3 (switch checked at queue and send), R-5 (`send_until`), R-8 (skips and the
  condition column), R-9 (digest only, one live, shared counter 3 an hour, token strip after the 07 guard because
  of trigger name order), R-10 (gate and its own fail closed reader), R-12 (both lanes, same lease rules,
  `finish_email` outcomes), R-14 (settings, guard keys, reader). The reminder queries match AC-6 including the
  short window rule and `greatest(selected_at, paid_at)` with a null paid_at.
- `claim_outbox` is re created with the same signature and grants; the partial indexes match the two lanes.
- Lock order in `start_email_confirmation` and `confirm_email` is the same (profile, then confirmations).
- Templates and links follow AC-5; `EmailContextSchema` is strict and matches the SQL keys one to one; the run loop
  paces sends, spends no wait on skips and caps each claim by the time left (security review item 1).
- pgTAP 29: the plan of 217 equals the number of assertions; settings, RLS, grants, lane, finish_email, token
  strip, apply gate, R-2 forced error, reminder and housekeeping sections trace correctly against the migration,
  apart from B1 and M1. Edited files 03, 10, 18, 19, 20 are consistent with the new kinds and schedules.
- UI: `guardPage('any')`, the `next` round trip for the token link (length and characters pass `safeNext`),
  the POST only confirm button, the nudge placement, and the catalogue keys the e2e reads all exist in three
  locales.

## Not checked

Nothing was executed, so the e2e journey, the unit tests (`tests/email-*.test.ts`, `tests/relay-email.test.ts`,
the lint additions) and the migration against a live database are unproven beyond reading. The unit tests looked
consistent with the code in the parts I sampled.
