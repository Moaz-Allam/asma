# 0011-14. Report a problem (position 14)

Child of [0011](index.md). Follows the cross child contract there. **Touches personal data (report text, photos).**

## Summary

From the reveal until 14 days after the job closes, either side can report a problem: a reason chip, a short text and up
to three photos. Admin works through a queue and can do nothing, warn, suspend, refund a fee, send the job back to work
or close it. A warning shows to the warned person as a banner until they acknowledge it; the reported person hears nothing
unless admin acts. A report on a job waiting for confirmation pauses its auto close. The agreement statement text goes
live here. G2 is checked after this position.

## Requirements

**User stories**:
- As a customer or provider, I want to tell admin what went wrong, with photos, so that something happens.
- As admin, I want one queue of reports with the job's history, so that I can act fairly and fast.

**Prerequisites**: 13 merged. Branch `feat/14-report-problem`. S16 for the agreement text and the copy rule of §34.

**Acceptance criteria**:
- **AC-1**: `open_report(p_request_id, p_reason, p_text)` (the request's customer or its unlocked provider): allowed
  when the request reached `UNLOCKED` (it has an `unlocked` selection) and is open or closed less than
  `report_window_days` ago; reason one of `no_show`, `did_not_pay_cash`, `poor_work`, `safety_or_behaviour`,
  `asked_money_off_platform`, `other`; text 20 to 1000 characters through 02's contact scanner; `against_id` is the
  other party; one open report per (request, reporter); at most `reports_per_user_day`. Errors: `not_allowed`,
  `report_open`, `contact_in_text`, `too_many_reports`.
- **AC-2**: Up to 3 photos per report in a private bucket `report-photos` (path `<region>/<report_id>/<uuid>`), through
  `lib/storage/client.ts` (first bytes check, downscale, EXIF dropped, 10 MB cap) and `add_report_photo` (reporter only,
  report open). Storage refuses every other path, user and a fourth object.
- **AC-3**: While a report on an `AWAITING_CONFIRMATION` request is open, `auto_close_jobs()` skips it (11 AC-5). The
  customer's Not done button opens the report form.
- **AC-4**: `/[locale]/admin/reports` lists open reports oldest first, 20 a page, with tabs Open and Handled; the detail
  shows the report, the request summary, both names, each side's past report and warning counts, and photos behind Show
  (one audit row per view, 60 second links, the 02 pattern).
- **AC-5**: `handle_report(p_report_id, p_outcome, p_note, p_refund_fee_id)` (admin): outcome one of `no_action`,
  `warned` (inserts `user_warnings` for `against_id`), `suspended` (02's suspend with the note), `returned_to_work`
  (`AWAITING_CONFIRMATION → IN_PROGRESS`, `confirm_deadline` cleared), `job_closed` (`AWAITING_CONFIRMATION →
  COMPLETED`, `closed_by` `admin`); an optional fee refund calls 12's `admin_refund_fee` with the note. Note required;
  the report becomes `handled`; one `audit_log` row. Any outcome that leaves the request `AWAITING_CONFIRMATION`
  (`no_action`, `warned`, `suspended`) resets `confirm_deadline` to `now() + confirm_window_hours`, so the customer gets a
  full confirm window again instead of an instant auto close.
- **AC-6**: A user with an unacknowledged warning sees a banner with the reason on every page until they press
  Acknowledge (`acknowledge_warning`). The reported party is told nothing else unless warned or suspended.
- **AC-7**: The reporter sees their report's status on the request page; the other side never sees the report.
- **AC-8**: The agreement statement (D92) replaces its draft in three locales from S16, with a new `terms_version`; sign
  up and the payment reminder line show it. No copy promises a guarantee or that the platform collects cash (§34); a
  catalogue test fails on the listed forbidden phrases in any locale.
- **AC-9**: Analytics `report_opened`, `report_handled` with ids and reason codes only; no report text anywhere in logs.
- **AC-10**: e2e in three locales: report with a photo, admin warns, banner then acknowledge; report pauses auto close;
  admin returns a job to work; axe at 390px.
- **AC-11**: G2 passes: expiry, cancellation, fee refund and report tests green; a second independent review
  (`security-reviewer` and `/check review` on another model) with no open Critical or Major.

## Decision

Reports are an intermediary's tool (§34): admin acts on accounts and on our own fees, never on the cash or the work.

## Feature design

**Data model**: `problem_reports`, `report_photos`, `user_warnings` (umbrella table); bucket `report-photos` with policies
keyed on the path and `problem_reports`.

**API surface**: `open_report`, `add_report_photo`, `my_reports`, `acknowledge_warning` (authenticated, own rows);
`admin_reports`, `admin_report_detail`, `handle_report` (admin). Actions in `actions/reports.ts`.

**Value sourcing**:

| Value | Source |
| --- | --- |
| Report window end | `requests.closed_at` + `report_window_days` |
| Against party | the request's customer or the unlocked selection's provider |
| Past counts | `problem_reports` and `user_warnings` |
| Agreement text | S16, `terms_version` |

**Security model**: report text and photos readable by the reporter and admin only; photo views by admin audited;
reported party sees only a warning reason that admin wrote.

**Critical test scenarios**: the other side and a stranger cannot read a report or a photo (AC-2, AC-7); a report after
the window refuses (AC-1); a paused job is not auto closed (AC-3).

## Build plan

1. Tests first, then the migration with bucket and policies; satisfies **AC-1** to **AC-3**, **AC-5** to **AC-7**.
2. Actions, storage client use, analytics; satisfies **AC-2**, **AC-9**.
3. Report form, banner, admin queue and detail; satisfies **AC-4**, **AC-6**, **AC-7**.
4. Agreement text and the copy test; satisfies **AC-8**.
5. e2e; owner push; reviews with `security-reviewer`; merge; G2 in a fresh context; satisfies **AC-10**, **AC-11**.

## Consequences

- Positive: disagreements have a path that never touches the cash.
- Negative: report photos are personal data to keep and delete (21's job).
- Neutral: reason codes are ready for 19's metrics.

## Rationale

Telling the reported party only when admin acts avoids revenge reports while keeping warnings visible to the person they
concern.
