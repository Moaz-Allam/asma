# 0009-11. Work and close (position 11)

Child of [0009](index.md). Follows the cross child contract there.

## Summary

After the reveal the platform still follows the job, with no money attached (D91). The provider presses Started (from the
start day) and Done (any time after starting). The customer confirms, or presses "Not done" to report a problem (from 14),
or the job closes by itself 72 hours after Done. If the provider never presses anything, the customer may mark the job
done themselves from the start day. G1 is checked after this position.

## Requirements

**User stories**:
- As a provider, I want to mark a job started and done, so that my record shows finished work.
- As a customer, I want to confirm the job or say it is not done, so that problems reach admin before the job closes.
- As a customer, I want to close a job myself when the provider forgets to press anything.

**Prerequisites**: 10 merged. Branch `feat/11-work-and-close`.

**Acceptance criteria**:
- **AC-1**: `start_job(p_request_id)` (the unlocked provider): refuses `invalid_state` unless `UNLOCKED`, `too_early`
  before 00:00 of the start day in `regions.timezone`; sets `IN_PROGRESS`, `actual_started_at`, the application
  `STARTED`, a `started` event.
- **AC-2**: `finish_job(p_request_id)` (that provider): refuses unless `IN_PROGRESS`; sets `AWAITING_CONFIRMATION`,
  `actual_completed_at`, `confirm_deadline = now() + confirm_window_hours`, the application `COMPLETED`, a `done` event.
- **AC-3**: `confirm_job(p_request_id)` (the customer): refuses unless `AWAITING_CONFIRMATION`; sets `COMPLETED`,
  `closed_at`, `closed_by` `customer`, the application `CONFIRMED`, a `confirmed` event.
- **AC-4**: `customer_mark_done(p_request_id)` (the customer): from `UNLOCKED` or `IN_PROGRESS`, refuses `too_early`
  before the start day; sets `COMPLETED`, `actual_completed_at` when empty, `closed_at`, `closed_by` `customer`, the
  application `CONFIRMED`, a `customer_closed` event. (12 adds: clears open deadline flags.)
- **AC-5**: A `pg_cron` job every 10 minutes runs `auto_close_jobs()`: every `AWAITING_CONFIRMATION` request past
  `confirm_deadline` becomes `COMPLETED` with `closed_by` `auto` and an `auto_closed` event, one transaction per request,
  skipping locked rows. (14 adds: skip a request with an open report.)
- **AC-6**: The provider's Active tab shows Started (enabled from the start day) and Done (after Started); the Done tab
  lists closed jobs. The customer's request page shows Confirm and, from 14, Not done while `AWAITING_CONFIRMATION`,
  and "Job done" from the start day while `UNLOCKED` or `IN_PROGRESS`. Each opens a confirm dialog.
- **AC-7**: The timeline lights Started, Done and Confirmed; the job count of 06 AC-2 counts `CONFIRMED`.
- **AC-8**: Analytics `job_started`, `job_done`, `job_confirmed`, `job_auto_closed` with ids only.
- **AC-9**: e2e in three locales: start, done, confirm; customer closes without the provider; auto close by moving the
  deadline in the test database; axe at 390px.
- **AC-10**: G1 passes (build plan gates): the full journey on a phone in three locales against the iyzico sandbox;
  property, race, idempotency and invariant tests green; Sentry live on both projects; uptime alert live (S10);
  `security-reviewer` and `/check review` on another model with no open Critical or Major; the real calls of 02 (D133)
  and 03 (D135) on the preview.

## Decision

Start and done are provider statements, confirm is the customer's; none moves money. The customer can always close a
job from the start day, so a silent provider never leaves a request open forever.

## Feature design

**Data model**: `requests.actual_started_at`, `actual_completed_at`, `confirm_deadline`, `closed_at`, `closed_by`
(umbrella table).

**API surface**: the four definer functions above, each through a Server Action in `actions/jobs.ts` with
`requireRole`; `auto_close_jobs()` granted to no API role.

**Value sourcing**:

| Value | Source |
| --- | --- |
| Start day | `scheduled_start_at` in `regions.timezone` |
| Confirm deadline | `confirm_window_hours` |
| Who closed | the function that closed it |

**Security model**: only the unlocked provider starts and finishes; only the customer confirms or closes; admin acts
through 16.

**Critical test scenarios**: start before the start day refused (AC-1); a second provider cannot start (AC-1); auto close
skips a locked row and gets it next run (AC-5).

## Build plan

1. Tests first, then the migration and the cron job; satisfies **AC-1** to **AC-5**.
2. Actions, analytics; satisfies **AC-8**.
3. UI on both sides; satisfies **AC-6**, **AC-7**.
4. e2e; satisfies **AC-9**. Owner push, reviews, merge.
5. G1 in a fresh context; satisfies **AC-10**.

## Consequences

- Positive: every job ends in a known state with an attribution, which 19's metrics will need.
- Negative: the start day rule uses the scheduled date, so a job moved earlier by phone can only be started on its day.
- Neutral: no notice is sent before 13.

## Rationale

Letting the customer close from the start day removes the need for an admin to chase forgotten jobs, at the cost of a
customer closing early, which harms nobody's money because none is attached.
