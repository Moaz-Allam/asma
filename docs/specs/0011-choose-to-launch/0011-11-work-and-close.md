# 0011-11. Work and close (position 11)

Child of [0011](index.md). Follows the cross child contract there. **A migration and the job's lifecycle; no money moves
(D91).**

> **Amended 2026-11-18 (D180)** against what 06 to 10 built (spec 0010, 0011-07 to 0011-10, D168 to D179), the way
> 0011-09 (D175) and 0011-10 (D178) were amended. There is no `request_events` table: each move writes one `audit_log`
> row, as 09 and 10 do. `requests.closed_at` exists since 10, and 10's contact window counts from it. 06 built no job
> count (D159 moved counts to 17 and 19), so the old AC-7 count goes. G1 is no longer an AC of 11 (A-1). Owner answers
> A-1 to A-3 (the recommended option each); the rest by the owner's standing rule of 2026-11-18 ("always do
> recommended"). Cross checked on Sonnet the same day (13 findings: 5 Major, 8 Minor), applied as R-1 to R-13 below,
> each the recommended fix. **Where a rule below and an AC differ, the rule wins.** Accepted by the owner 2026-11-18
> ("accept the spec, do not ask me").

## Summary

After the reveal the platform follows the job with no money attached. The provider presses Started (from 00:00 of the
start day in the region's time zone) and Done (any time after Started). The customer confirms; or the job closes by
itself `confirm_window_hours` (72 ☐) after Done. If the provider never presses anything, the customer may mark the job
done from the start day. Every close writes `closed_at` and `closed_by`, so 10's contact window starts. "Not done"
arrives with 14.

## Requirements

**User stories**:
- As a provider, I want to mark a job started and done, so that my record shows finished work.
- As a customer, I want to confirm the job, so that it closes with my word on it.
- As a customer, I want to close a job myself when the provider forgets to press anything.

**Prerequisites**: 10 built (PR, unmerged while its push is owed: stacked, D-deferred pushes). Branch
`feat/11-work-and-close`, cut from `feat/10-provider-fee-reveal`. One migration, `work_and_close`, after
`20261122090000_provider_fee_reveal`.

**Acceptance criteria**:
- **AC-0** (what 11 calls, as built): `requests.closed_at` and its guard (10: set once, only with a move to `COMPLETED`
  or `CANCELLED`); `applications.unlocked_at` (10); `contacts_visible` counts the window from
  `coalesce(closed_at, cancelled_at)` (10, D179); the setting `confirm_window_hours` (07, seeded 72 from 00's
  `hold_hours`); `provider_jobs` and its tabs (10, R-11); `pg_cron` (08). Application statuses `STARTED`, `COMPLETED`,
  `CONFIRMED` and request statuses `IN_PROGRESS`, `AWAITING_CONFIRMATION`, `COMPLETED` exist since 04 and 05.
- **AC-1** (columns, a setting reader, the guard): `requests.actual_started_at`, `actual_completed_at`,
  `confirm_deadline` (timestamptz, null) and `closed_by` (text, null, `customer` or `auto`; 12 adds `provider`,
  `admin`, `platform`). Checks: `closed_by` set exactly when `closed_at` is; every `COMPLETED` request has `closed_at`
  and `closed_by` (R15 G-1, the `COMPLETED` half; 12 adds the `CANCELLED` half). `requests_guard` widened for exactly
  the moves of AC-2 to AC-5, each new column written once with its move. `confirm_window_hours` held to an integer 1 to
  720 by a row check and joins the guard's required keys; `confirm_settings(region)` refuses `confirm_settings_invalid`
  (a new `AlertReason`).
- **AC-2** (`start_job(p_request_id)`, definer, `authenticated`): the request locked, the caller's provider row shared
  (D156); not the provider of the selected application: `not_found`; provider status not `approved`:
  `provider_suspended`; the request not `UNLOCKED` or the application not `UNLOCKED`: `invalid_state`; before 00:00 of
  the start day in `regions.timezone`: `too_early`. Sets the request `IN_PROGRESS` with `actual_started_at`, the
  application `STARTED`; one `audit_log` row `job.started`. A replay on `IN_PROGRESS` returns `{status: 'ok',
  replayed: true}`.
- **AC-3** (`finish_job(p_request_id)`, same caller rules): from `IN_PROGRESS` and `STARTED` only (else
  `invalid_state`); sets `AWAITING_CONFIRMATION`, `actual_completed_at`, `confirm_deadline = now() +
  confirm_window_hours`, the application `COMPLETED`; `audit_log` `job.done`. Replay safe as AC-2.
- **AC-4** (`confirm_job(p_request_id)`, definer, the customer only, else `not_found`): from `AWAITING_CONFIRMATION`
  only; sets `COMPLETED`, `closed_at`, `closed_by = 'customer'`, the application `CONFIRMED`; `audit_log`
  `job.confirmed`. Replay safe.
- **AC-5** (`customer_mark_done(p_request_id)`, the customer): from `UNLOCKED` or `IN_PROGRESS`, `too_early` before the
  start day; sets `COMPLETED`, `actual_completed_at` when empty, `closed_at`, `closed_by = 'customer'`, the application
  `CONFIRMED`; `audit_log` `job.customer_closed`. (12 clears deadline flags.)
- **AC-6** (`auto_close_jobs()`, definer, no API grant): every `AWAITING_CONFIRMATION` request past `confirm_deadline`
  becomes `COMPLETED`, `closed_by = 'auto'`, the application `CONFIRMED`, `audit_log` `job.auto_closed`. Rows are
  claimed `for update skip locked`, at most 200 a run, each in its own subtransaction, so one bad row never stops the
  rest and a locked row is taken next run. A `pg_cron` job `jobs-auto-close` runs it every 10 minutes. (14 skips a
  request with an open report.)
- **AC-7** (My jobs, A-3): 10's tabs change: Active = `UNLOCKED`, `STARTED`, `COMPLETED` (waiting for the customer);
  Done = `CONFIRMED` and the final rows. Active shows the contact card and Started (from the start day; the database
  says when, as `can_start`) or Done (after Started), or "Waiting for the customer to confirm, until <deadline>". Done
  shows the contact card while `request_contacts` still returns it (the 14 day window). Each button opens the existing
  `ConfirmDialog`.
- **AC-8** (the customer's request page): `AWAITING_CONFIRMATION`: Confirm (and, from 14, Not done), with the
  deadline after which the job closes by itself. `UNLOCKED` or `IN_PROGRESS` from the start day: "Job done" (AC-5),
  with a dialog that says the job closes for good. The timeline lights Started (`actual_started_at`), Done
  (`actual_completed_at`) and Confirmed (`closed_at`, with who closed it).
- **AC-9** (the doors and actions): `lib/provider-feed` gains `startJob`, `finishJob`; `lib/requests` gains
  `confirmJob`, `markJobDone`; `actions/jobs.ts` runs `guardedAction` with the provider role for the first two and the
  customer role for the last two. Codes map to typed results; `confirm_settings_invalid` alerts.
- **AC-10** (analytics, D68): `job_started`, `job_done`, `job_confirmed: { by: 'confirm' | 'mark_done' }` (as built, D182) with no ids (no event
  carries an id, D68). The auto close is server side and sends no event; its count is the `audit_log` rows.
- **AC-11** (tests): pgTAP `25_work_and_close` (each refusal in order for each function, replays, the time zone start
  day edge, `auto_close_jobs` with a locked row skipped and taken next run, the guard and checks, grants, a second
  provider and a stranger refused) and unit tests for the doors and actions. e2e in three locales at 390px with axe:
  start, done, confirm; the customer closes without the provider; the auto close (the deadline moved into the past by
  the test, then `auto_close_jobs()` called); contacts still shown in Done.

## Owner answers (D180, 2026-11-18)

- **A-1** G1 is split out of 11: its own checklist, run when S1, S10, S32 and S33 are done. 11 merges on its own checks.
- **A-2** Job events go to `audit_log` (one row per move, ids only), as 09 and 10; `request_events` waits for 13.
- **A-3** Active keeps a job until it closes (`COMPLETED` waiting for the customer included); Done shows the contact
  card while the 14 day window lasts.

## Amendment rules (D180, cross check 2026-11-18)

- **R-1, stuck jobs are an accepted gap** (X-1). Only a job that reaches Done closes by itself. A job left in
  `UNLOCKED` or `IN_PROGRESS` closes when the customer marks it done (from the start day), or through 12 (deadline
  flags) and 16 (admin close). A provider suspended after Started cannot finish (`provider_suspended`); the customer
  still can. Recorded in the risk table for 12 and 16; the Decision's "never open forever" reads "never open forever
  once Done".
- **R-2, the auto close ships off** (X-2). A per region setting `auto_close_enabled` (a JSON boolean, fails closed like
  `payments_enabled`, seeded `false` in both regions). `auto_close_jobs()` closes nothing while it is false. It is
  turned on once 13 (the done notice) and 14 (Not done) are live; that switch is an owner step recorded with 14. The
  confirm deadline is still written and shown, worded "Confirm by <date>" while the switch is off and "Closes by
  itself on <date>" while it is on (the page reads the switch through `request_close_info`, R-5).
- **R-3, locks and replays** (X-3). Every function locks the request row first, then the application, then (provider
  functions) the caller's provider row for share. A replay answers `{status: 'ok', replayed: true}` only when the state
  already matches the caller's own move (`start_job` on `IN_PROGRESS`, `finish_job` on `AWAITING_CONFIRMATION`,
  `confirm_job` or `customer_mark_done` on `COMPLETED` with `closed_by = 'customer'`); a `COMPLETED` row closed by
  `auto` answers `invalid_state`. A non party always gets `not_found` first. A confirm after `confirm_deadline` but
  before the auto close ran is accepted: the customer's word wins until the job is closed.
- **R-4, the guards exactly** (X-4, X-11). `requests_guard` adds the moves `UNLOCKED → IN_PROGRESS`,
  `UNLOCKED → COMPLETED`, `IN_PROGRESS → AWAITING_CONFIRMATION`, `IN_PROGRESS → COMPLETED`,
  `AWAITING_CONFIRMATION → COMPLETED`, and strips the four new columns from its immutability compare. Each is written
  once with its move: `actual_started_at` with `→ IN_PROGRESS`; `actual_completed_at` with `→ AWAITING_CONFIRMATION`
  or a customer close that finds it empty; `confirm_deadline` with `→ AWAITING_CONFIRMATION`; `closed_by` with
  `closed_at`. `applications_guard` gains a transition list for the selected application: `UNLOCKED → STARTED`,
  `STARTED → COMPLETED`, `COMPLETED → CONFIRMED`, `UNLOCKED → CONFIRMED`, `STARTED → CONFIRMED`, besides 10's moves;
  `CONFIRMED → RATED` stays for 13 and 17 (a note, not built). The check "every `COMPLETED` has `closed_at` and
  `closed_by`" is added validated: no row is `COMPLETED` before launch.
- **R-5, the reads** (X-5). `provider_jobs` is replaced with the same signature and adds per row `request_status`,
  `actual_started_at`, `confirm_deadline`, `closed_at`, `can_start` (the start day rule, R-8). Its tabs follow A-3:
  Active `UNLOCKED`, `STARTED`, `COMPLETED`; Done `CONFIRMED`, `RATED`, `NOT_SELECTED`, `WITHDRAWN`, `EXPIRED`,
  `CANCELLED`. 10's pgTAP 23 tab case is amended. The customer page reads its own request columns (RLS) and one new
  definer read `request_close_info(p_request_id)` (the customer only): `{auto_close_enabled, can_mark_done}`.
- **R-6, `status_changed_at`** (X-6). Every application move sets `status_changed_at = now()`; a test per function.
- **R-7, the timeline after a customer close** (X-7). Started stays unlit when `actual_started_at` is null; the Done
  step reads "Closed by the customer" when `closed_by = 'customer'` and the provider never pressed Done.
- **R-8, the start day** (X-8). In Postgres: `now() >= (date_trunc('day', scheduled_start_at at time zone tz)) at time
  zone tz`, `tz` from `regions.timezone` (not null since 00; an unknown zone raises, which the door reports). pgTAP sets
  the start so the edge falls at 23:59 and 00:00 local.
- **R-9, codes** (X-9). `confirm_job` never raises `too_early`. Tests add: a request cancelled in between
  (`invalid_state`), a provider suspended in between (`provider_suspended`).
- **R-10, the cron job** (X-10). `auto_close_jobs()` revokes all from `public`, `anon`, `authenticated`,
  `service_role`; `pg_cron` runs it as `postgres`. Its audit rows carry a null actor and ids only. The 200 a run cap is
  a constant in the function (no setting).
- **R-11, the customer after close** (X-12). The customer's request page keeps the contact card while
  `request_contacts` returns it; pgTAP tests the window edge (just inside and just past `contact_visible_days`).
- **R-12, no money moves** (X-13, D91). pgTAP proves `fee_payments`, `ledger_journals`, `ledger_entries` and
  `outbox_events` are unchanged by every function, and adds: `anon` and `authenticated` cannot call
  `auto_close_jobs`; a direct update of the new columns by the customer is refused; `customer_mark_done` from
  `AWAITING_CONFIRMATION` answers `invalid_state`; a `NOT_SELECTED` provider and another customer get `not_found`.
- **R-13, the race** (X-3, X-13). pgTAP `26_job_races` (dblink): the auto close against a concurrent `confirm_job`
  (one wins, the other is a replay or `invalid_state`, never two closes), and two `start_job` presses.

## Decision

Start and done are the provider's statements, confirm and close are the customer's; none moves money. The customer can
always close a job from the start day, and the job closes by itself after the confirm window, so no request stays open
forever and every close carries who closed it.

## Feature design

**Data model**: `requests.actual_started_at`, `actual_completed_at`, `confirm_deadline`, `closed_by`; `closed_at`
exists (10).

**State transitions**: request `UNLOCKED → IN_PROGRESS → AWAITING_CONFIRMATION → COMPLETED`, and `UNLOCKED` or
`IN_PROGRESS → COMPLETED` (the customer); application `UNLOCKED → STARTED → COMPLETED → CONFIRMED`, and `UNLOCKED` or
`STARTED → CONFIRMED`.

**API surface**:

| Function or action | Kind | Inputs | Outputs | Auth | Errors |
| --- | --- | --- | --- | --- | --- |
| `start_job`, `finish_job` | definer | request id | `{status, replayed}` | the unlocked provider | `not_found`, `provider_suspended`, `invalid_state`, `too_early` |
| `confirm_job`, `customer_mark_done` | definer | request id | `{status, replayed}` | the customer | `not_found`, `invalid_state`, `too_early` |
| `auto_close_jobs` | definer, cron | none | count closed | none | |
| `confirm_settings` | internal | region | hours | none | `confirm_settings_invalid` |
| `actions/jobs.ts` | Server Actions | request id | typed result | `guardedAction` | mapped |

**Value sourcing**:

| Value | Source |
| --- | --- |
| Start day | 00:00 of `scheduled_start_at`'s date in `regions.timezone`, computed in Postgres |
| `can_start` on My jobs | `provider_jobs`, from the same rule |
| Confirm deadline | `now()` at Done + `confirm_window_hours` |
| Who closed | the function that closed it (`customer`, `auto`) |

**Security model**: only the selected, unlocked, approved provider starts and finishes; only the customer confirms or
closes; admin acts through 16. No API role writes `requests` or `applications` (10's meta test).

**Critical test scenarios**: start before the start day refused, at 00:00 local accepted (AC-2); a second provider and a
suspended provider cannot start (AC-2); auto close skips a locked row and takes it next run (AC-6); every `COMPLETED`
has `closed_at` and `closed_by` (AC-1).

## Build plan

1. Tests first: pgTAP `25`, then the migration `work_and_close` and the cron job; `npm run db:types`; satisfies
   **AC-0** to **AC-6**.
2. Doors, actions, analytics, unit tests; satisfies **AC-9**, **AC-10**.
3. UI on both sides; satisfies **AC-7**, **AC-8**.
4. e2e and axe; satisfies **AC-11**. Reviews, PR; the owner pushes the migration later (deferred), then merge in order.

## Consequences

- Positive: every job ends in a known state with an attribution, which 19's metrics will need; 10's contact window
  starts at every close.
- Negative: the start day rule uses the scheduled date, so a job moved earlier by phone can only be started on its day
  (the customer can still close it).
- Neutral: no notice is sent before 13; "Not done" arrives with 14.

## Rationale

Letting the customer close from the start day removes the need for an admin to chase forgotten jobs, at the cost of a
customer closing early, which harms nobody's money because none is attached.
