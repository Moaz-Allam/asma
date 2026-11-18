# Review: feat/11-work-and-close (spec 0011-11, D180)

Reviewer: fresh model, read only (git and file reads; nothing was run). Diff: `git diff feat/10-provider-fee-reveal...HEAD`
plus the uncommitted `e2e/work-and-close.spec.ts`. Author's results: verify 1258 unit green, pgTAP 2044/2044. **The
e2e for 11 has not run, so AC-11's e2e half is unverified.**

Verdict: no Blocker, no Major. The migration is tight: lock order, replays, guards, grants and R-2 to R-12 match the
spec. The findings below are small.

## Findings

| id | severity | file:line | finding | fix | resolution |
| --- | --- | --- | --- | --- | --- |
| F-1 | Minor | `components/features/jobs/JobActionButton.tsx` (new), `context/ui-registry.md` | The component is new but has no `ui-registry.md` row, which AGENTS.md requires in the same change. Its own comment cites a registry entry that does not exist. | Add the `JobActionButton` row. | Fixed: `JobActionButton` row in `ui-registry.md` |
| F-2 | Minor | `components/features/jobs/JobActionButton.tsx:63`, `lib/analytics/events.ts:48` | AC-10 says `job_confirmed: { by: 'customer' }`. The code sends `by: 'confirm' \| 'mark_done'`. It is a harmless property (no id), but it differs from the spec and from `tests/analytics.test.ts` expectations of the spec. | Either send `'customer'` or amend AC-10 to name the two values (D180 note). | Kept `confirm`/`mark_done` (it tells the two closes apart, no id); AC-10 amended |
| F-3 | Minor | `app/[locale]/(customer)/requests/[id]/page.tsx` (timeline, around the new `done` and `closed` steps) | AC-8 says the timeline lights Started, Done and Confirmed. The Done step is hidden once the request is `COMPLETED` (`current !== 'COMPLETED'`), so a normally confirmed job shows Started and Confirmed only. Also a job the customer closes after Started but before Done reads "Confirmed" although nobody confirmed a Done (R-7 names the Done wording for the no press case only). | Show Done whenever `actual_completed_at` is set and the provider pressed Done (use `closed_by` plus `actual_started_at`, or compare with the audit). Word the Started-without-Done close as "Closed by the customer". | Fixed: the Done step reads `confirm_deadline` (set only by the provider's Done) and stays lit after the close; the close reads "Closed by the customer" when there was no Done |
| F-4 | Minor | `supabase/tests/25_work_and_close.test.sql` | Gaps against AC-11, R-6, R-8, R-9, R-11: (a) no test that a request cancelled in between gives `invalid_state` (R-9); (b) the suspended in between case is tested for `start_job` only, not `finish_job`; (c) `status_changed_at` is asserted for `start_job` only, R-6 asks one test per function; (d) R-8 asks the edge at 23:59 and 00:00, the test uses 00:30 tomorrow (false) and 23:59 today (true), never exactly 00:00; (e) the window edge after a close (R-11, just inside and just past `contact_visible_days`) is not repeated in 25 (23 covers the window, not through 11's closes). | Add the missing cases; a few lines each with the existing `probe` helper. | Fixed in part: `status_changed_at` on Done, a provider suspended after Started, the exact 00:00 edge, the losing provider's Done row. The cancel-in-between case needs 12's cancels (carried); the contact window edge after a close is 10's pgTAP 23 (13 and 15 days) |
| F-5 | Minor | `supabase/migrations/20261123090000_work_and_close.sql:509` | `auto_close_jobs()` swallows every exception with `null`. A row that always fails (for example a future guard refusing the application move) is retried every 10 minutes and nothing records it. | `raise warning` with the request id (ids only), or count failures into the return or an `audit_log` row, so the failure is visible to the alert path. | Fixed with S11-3: a warning with the id and SQLSTATE; a counter and alert in 21 (R16) |
| F-6 | Minor | `lib/requests/index.ts` (`loadCloseInfo`) | Any refusal other than `not_found` throws, so a transient `forbidden` or auth refusal turns the customer's whole request page into a 500. The close panel is an extra. | Return null on any refusal and log, or alert on settings codes only. | Fixed: any refusal other than `not_found` logs `close_info_refused` and the buttons do not show |
| F-7 | Nit | `actions/jobs.ts:15-16`, `messages/*.json` `Jobs.errors` | `KNOWN_CUSTOMER` is the whole `REQUEST_DB_CODES` list (about 30 codes), but `Jobs.errors` has 10 keys. A code outside them would hit a missing catalogue key. Unreachable today, fragile later. | Narrow each action's allowed codes to the keys in `Jobs.errors`; everything else becomes `action_failed`. | |
| F-8 | Nit | migration:239 | `start_day_reached` returns null for an unknown request id, and `not null` skips the `too_early` raise. Safe now (callers hold the row). | `coalesce(..., false)` for defence in depth. | |
| F-9 | Nit | `messages/tr.json` | All new `Jobs.*` and timeline strings are `[tr]` placeholders. Allowed until the launch gate (D100); noted only. | Owner copy before G3. | |

## AC coverage

| AC | Status | Evidence |
| --- | --- | --- |
| AC-0 | Met | Uses `closed_at`, `unlocked_at`, `contacts_visible`, `confirm_window_hours`, `provider_jobs`, `pg_cron` as built. |
| AC-1 | Met | Columns, four checks, widened `requests_guard` (once per move), `confirm_window_hours` row check and required key, `confirm_settings` and `confirm_settings_invalid` alert. Test: pgTAP 25 settings and guard cases. |
| AC-2 | Met | `start_job`: order not_found, provider_suspended, invalid_state, too_early; replay; audit. pgTAP 25, 26. |
| AC-3 | Met | `finish_job`: deadline from `confirm_settings`; replay; audit. pgTAP 25. |
| AC-4 | Met | `confirm_job` customer only; R-3 replay and auto refusal. pgTAP 25. |
| AC-5 | Met | `customer_mark_done`: `too_early`, sets `actual_completed_at` when empty. pgTAP 25 (F-4 gaps). |
| AC-6 | Met | `auto_close_jobs`: skip locked, 200 cap, subtransaction, cron every 10 minutes, switch off by default (R-2), revokes (R-10). pgTAP 25, race in 26. (F-5.) |
| AC-7 | Met | Tabs per A-3, `can_start`, Started, Done, waiting line, contact card in Done for `CONFIRMED`, `ConfirmDialog`. e2e unverified. |
| AC-8 | Partly | Confirm panel, deadline wording by switch, "Job done" from the start day all present. Timeline drops Done after close (F-3). |
| AC-9 | Met | `startJob`/`finishJob` (as `moveJob`), `confirmJob`/`markJobDoneAction` (as `closeJob`), `guardedAction` roles, alert for `confirm_settings_invalid`. Unit tests in `tests/work-and-close.test.ts`. |
| AC-10 | Partly | Three events, no ids; `job_confirmed.by` value differs from spec (F-2). Auto close sends no event. |
| AC-11 | Partly | pgTAP 25 (62) and 26 (8) cover most of the list (F-4 gaps); unit tests present; e2e written for three locales with axe, covering start, done, confirm, customer close, auto close, contacts in Done, but **has not run**. |

Rules that never bend: money untouched (R-12, tests prove no money table changes); RLS and grants: every new function
revokes public and has a grant only to `authenticated` for the four customer or provider doors, `auto_close_jobs` has
none; no client price; contacts still decided by Postgres; single doors respected (no SDK imports added); logical
properties and semantic tokens used in the new markup; strings in all three catalogues (key parity holds).
