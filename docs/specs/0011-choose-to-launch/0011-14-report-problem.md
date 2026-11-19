# 0011-14. Report a problem (position 14)

Child of [0011](index.md). Follows the cross child contract there. **High risk: personal data (report text, photos),
storage, a migration, the lifecycle (an admin move back to work).**

> **Amended 2026-11-19 (D193)** against what 06 to 13 built (spec 0010, 0011-07 to 0011-13, D168 to D192), the way
> 0011-10 to 0011-13 were amended. There is no `selections` table: the pick is `requests.selected_application_id`, and
> after the reveal it never changes (12's `end_pick` only clears `SELECTED` and `AWAITING_FEE` picks), so the other
> party is always that application's provider. There is no `request_events` table: every move writes one `audit_log`
> row, and 13's `audit_log_email` trigger sends mail from those rows. 11 built `auto_close_jobs` (behind
> `auto_close_enabled`, seeded off), `close_job`, `confirm_settings`; 12 built `admin_refund_fee(p_payment_id,
> p_reason)`, the `closed_by` values `customer`, `provider`, `platform`, `admin`, `auto`, and `closed_at` on every
> close; 02 built `suspend_provider(p_provider_id, p_reason)` (providers only), `log_document_view` and the storage
> pattern of D116. The agreement statement is already on sign up (01) and above every Pay button (09) as `[draft]`;
> S16 is still open. Every choice below is the recommended one, by the owner's standing rule (D183). Cross checked on
> Sonnet the same day (25 findings: 3 Critical, 14 Major, 8 Minor), applied as X-1 to X-25. **Where a rule below and an
> AC differ, the rule wins; an X rule wins over an R rule.** Accepted by the owner's standing rule, 2026-11-19.

## Amendment rules (D193)

- **R-1, who reports and against whom.** A party is the request's `customer_id`, or the `provider_id` of the
  application `requests.selected_application_id` when that application has `unlocked_at is not null`. `against_id` is
  the other party. Nobody else may report (admin included).
- **R-2, the window.** Open while the request is `UNLOCKED`, `IN_PROGRESS` or `AWAITING_CONFIRMATION`; after a close
  (`COMPLETED` or `CANCELLED`, both carry `closed_at` since 12 R-5) while `now() < closed_at + report_window_days`. A
  request cancelled before the reveal never qualifies (no unlocked application). Settings come from a fail closed
  reader `report_settings(region)` (raises `report_settings_invalid`), the 11 `confirm_settings` pattern.
- **R-3, no contact scanner on report text.** The original AC-1 ran 02's scanner. Both parties already hold each
  other's contacts (the reveal is a precondition), only admin reads the text, and the evidence for
  `asked_money_off_platform` is often a number or an IBAN. So the text gets 04's byte cap first (`octet_length <=
  4000`), then `catalog_trim`, then 20 to 1000 characters, and no scanner; `contact_in_text` is dropped.
- **R-4, the rate limit counts rows.** `reports_per_user_day` is checked by counting the reporter's own
  `problem_reports` with `created_at > now() - interval '24 hours'` (rows are never deleted), not with
  `action_counters`. `open_report` locks the request row, then the reporter's `profiles` row, so two reports from one
  person on two requests cannot both pass the count.
- **R-5, the guards are replaced** (the 12 R-1 pattern). `requests_guard` gains `AWAITING_CONFIRMATION → IN_PROGRESS`,
  allowed only with `actual_completed_at` and `confirm_deadline` both set to null in the same update, and a
  `confirm_deadline` change while the status stays `AWAITING_CONFIRMATION`, allowed only to a value later than
  `now()`. `applications_guard` gains `COMPLETED → STARTED` (the return to work). Every other rule of 12's guards stays
  word for word. A pgTAP case for each new move and each refusal.
- **R-6, `auto_close_jobs` is replaced** with one added filter: `and not exists (select 1 from public.problem_reports p
  where p.request_id = r.id and p.status = 'open')`, backed by a partial index `problem_reports_open_idx on
  (request_id) where status = 'open'`. The customer's own Confirm still works while a report is open (the customer's
  word wins, 11 R-3); the report stays open.
- **R-7, 13's `closes_soon` mail.** `email_context` is replaced with its 13 body word for word plus one condition: a
  `closes_soon` send needs no open report on the request (otherwise `skip`, `condition`). Nothing else in 13 changes.
- **R-8, mail rows 15 and 16** (13 left them to 14). The `audit_log_email` trigger's `when` list gains
  `report.opened` and `report.handled`; `queue_audit_email` maps `report.opened` to `report_received` for the reporter
  and `report_new_admin` for every admin profile, and `report.handled` to `report_handled` for the reporter. No topic
  (the notice row `problemReports` has none). The template check and `lib/email`'s template table widen together, with
  `Email.*` strings carrying `[draft] ` as in D192 (11). The reported party gets no mail.
- **R-9, the warning text is a reason code.** `user_warnings.reason` is one of the six report reason codes, copied from
  the report. The banner shows a fixed, translated sentence per code. Admin's free text never reaches the warned person:
  it would be in one language only, and it could carry the reporter's words.
- **R-10, `suspended` is for providers only.** The brief has admin "warn or suspend the provider"; there is no customer
  suspension. `suspended` against a customer refuses `invalid_outcome`; against a provider who is not `approved`, it
  refuses `already_suspended`. For `suspended`, `handle_report` first locks every request of that provider in ascending
  id order (the same set and order as `suspend_provider`), then the report row, then calls `suspend_provider(provider,
  note)`, so it cannot deadlock with a plain suspend from `/admin/providers`.
- **R-11, the refund argument.** It is `p_refund_payment_id` (a `fee_payments.id`), and it must belong to the
  report's request, else `invalid_refund`. It calls 12's `admin_refund_fee(p_refund_payment_id, p_note)`; that
  function's own refusals (`invalid_state`) pass through and nothing of the handle is kept.
- **R-12, the note.** 10 to 500 characters after the trim (it satisfies both `admin_refund_fee`, 10, and
  `suspend_provider`, 5). Stored in `problem_reports.admin_note`, read by admin only. The audit row holds ids, the
  reason code and the outcome, never the note or the report text.
- **R-13, the agreement text stays draft.** S16 is open, so AC-8 keeps 01's and 09's `[draft]` strings and
  `terms_version` (`launch:gate` holds them, D100). 14 adds only the forbidden phrase catalogue test. When S16 lands,
  the text and a new `terms_version` go in as a small follow up, before G3.
- **R-14, auto close stays off.** `auto_close_enabled` is not switched on by this migration (D180 said "once 13 and 14
  are live"; 13's mail is still off). It goes on for `TR` together with S43, which turns mail on, so the
  `closes_soon` reminder exists when jobs start closing by themselves. The "Not done" button R16 asked for lands here.
- **R-15, reads only through functions.** `problem_reports`, `report_photos` and `user_warnings` have RLS on, a deny
  policy (`using (false)`, as `action_counters`, test 00), and no table grant to `authenticated`. Every read and write
  goes through a definer function that checks `auth.uid()` or `is_admin()`. Storage policies call a definer helper,
  `report_photo_allowed(p_name text, p_write boolean)`, because a storage policy runs as the caller.

## Cross check rules (Sonnet, 2026-11-19)

25 findings (3 Critical, 14 Major, 8 Minor), each fixed with the recommended option. **These win over R-1 to R-15 and
over the ACs where they differ.**

- **X-1, one lock pass** (Critical). For every outcome, `handle_report` collects the report's request id, plus for
  `suspended` every request `suspend_provider` would lock (applications `APPLIED` to `COMPLETED` of that provider), and
  locks them all in one ascending id pass; then the report row; then the rest. Replaces the lock wording of R-10.
- **X-2, no admin text in a suspension** (Critical). `providers.suspension_reason` is readable by the provider
  (`providers_read_own`), so `handle_report` passes the fixed string `report:<reason>` (the warning reason of X-19) to
  `suspend_provider`, never the note. The provider's pages show a `report:` reason as `Reports.warning.<reason>`.
- **X-3, admin photo reads are audit gated** (Critical), the `admin_may_read` pattern. `report_photo_allowed` admits an
  admin only when a `report.photo_viewed` row by that admin for that `object_id` and path exists from the last 2
  minutes. `log_report_photo_view(p_photo_id)` writes `{ object_id, path, report_id }` and returns the path; the server
  then signs the link. The reporter's own read is not audited.
- **X-4, a storage guard trigger** (Major). Policies do not run for a service role write, so a `storage.objects`
  trigger for `report-photos` repeats `report_photo_allowed` for every API role (the `provider_files_guard` pattern).
  The insert check takes `pg_advisory_xact_lock` on the report id before it counts. `add_report_photo`'s cap under the
  report row lock is the real limit.
- **X-5, the path and type are pinned** (Major). The bucket allows `image/jpeg` only. Names must match
  `^<region>/<report uuid>/<uuid>\.jpg$`, with the region segment equal to the report's region; `add_report_photo`
  also requires `metadata.mimetype = 'image/jpeg'`.
- **X-6, orphans** (Major). The insert count is registered rows plus unregistered objects younger than 24 hours, as
  `provider_may_store`. Older unregistered objects are swept by 21's retention job (added to its list).
- **X-7, the reminder is queued, not skipped** (Major). `queue_reminders` is replaced too: its `closes_soon` key
  becomes `email:<request>:closes_soon:<confirm_deadline epoch>`, and it queues nothing while a report is open. R-7's
  send time condition stays as a second fence. So a reset deadline or a second Done gets its own reminder.
- **X-8, the settings guard** (Major). The list is 13's (`pricing_settings_guard` in `20261125090000`) plus the two new
  keys. Seeds for `TR` and `KSA`: `report_window_days` 14, `reports_per_user_day` 5; checks: integer, 1 to 90 and 1 to
  50; `report_settings` raises `report_settings_invalid` on a missing or malformed value.
- **X-9, `queue_email` is replaced** (Major): its template list gains `report_received`, `report_new_admin`,
  `report_handled` (with `email_context`'s case list and `lib/email`'s table, 13's source test keeps them equal).
- **X-10, the mail branches** (Major). In `queue_audit_email` the report branches come before the request lookup. The
  payload carries `request_id` and `entity_id` = the report id. `email_context` values for `report_*` add `report_id`
  and the reason code only; `report_new_admin` links to `/admin/reports/<id>`; `side` is null for an admin.
- **X-11, what the mails say** (Major). `report_handled` says only that admin reviewed the report, never the outcome.
  `report_new_admin` goes to admin profiles of the report's region. An address that is not confirmed gets nothing
  (13's rule); the queue and the rail count stay the source of truth.
- **X-12, the other side's close date** (Major). Accepted mismatch: when the provider reported, the customer's page and
  13's `please_confirm` mail keep the old close date, and the close waits silently. Privacy (AC-7) wins; the handle
  resets the window to a full one. Recorded in D193.
- **X-13, the four guard clauses** (Major). `requests_guard`: the transition list gains the return move;
  `actual_completed_at` may go to null only on `AWAITING_CONFIRMATION → IN_PROGRESS`; `confirm_deadline` may go to null
  only on that move, and to a later value than both the old one and `now()` only while the status stays
  `AWAITING_CONFIRMATION`. `applications_guard`'s work moves gain `COMPLETED → STARTED`. `actual_started_at` is not
  touched, so `requests_started_has_time` holds. pgTAP refuses a deadline moved earlier, and a clear on any other move.
- **X-14, error mapping** (Major). `suspend_provider`'s `not_approved` becomes `already_suspended` (the provider may also
  be pending or rejected: the admin message says "not an active provider"). The note is checked (10 to 500) before any
  inner call, so `validation_failed` and `reason_required` never come from inside.
- **X-15, an admin close mails like a confirm** (Major). `job.closed_by_admin` joins the trigger's `when` list and maps
  as `job.confirmed` does; test 29's equality check is updated.
- **X-16, repeat reports** (Major). At most 2 reports per (request, reporter) in total, never two open; a third
  refuses `report_limit`.
- **X-17, a return needs an active provider** (Major). `returned_to_work` refuses `provider_not_approved` unless the
  selected provider is `approved` (a suspended one cannot press Done; `job_for_provider` refuses). One outcome per
  handle stays; warn plus return to work is two reports' work or 16's.
- **X-18, flags on return** (Minor). The return calls `clear_deadline_flags(request, array['completion_late'])`;
  12's job may raise it again later by its own rule.
- **X-19, admin picks the warning reason** (Minor). `handle_report` gains `p_warning_reason text default null` (one of
  the six codes, default the report's); used by `warned` and by X-2.
- **X-20, a refund replay** (Minor). A replayed `admin_refund_fee` stores the returned `fee_refund_id`. The handle
  dialog names the payer and the amount. R-8 reads "the reported party gets no mail from the report, except 13's
  refund or suspension mail".
- **X-21, the queue shape** (Minor). `admin_reports(p_tab, p_page)` returns `{ rows, total }`, offset paging, row fields
  `id, created_at, region, reason, side, request_id, service, status, outcome, handled_at`.
  `admin_reports_open_count()` feeds the rail.
- **X-22, reuse 12's detail** (Minor). The detail page calls 12's `admin_request_detail` for the request, fees and
  refunds; `admin_report_detail` returns only the report, the two parties with their counts, and the photo list.
- **X-23, scrubber** (Minor). `note` is already a personal key; add `text` and the suffixes `_text`, `_note`.
- **X-24, row rules** (Minor). The `problem_reports` guard allows one update only: `open → handled` with `outcome`,
  `admin_note`, `handled_by`, `handled_at`, `fee_refund_id` set together, once; no delete or truncate. Foreign keys
  `on delete restrict`, as elsewhere.
- **X-25, the photo sequence** (Minor). Create the report, then upload, then register each photo. A failed photo shows a
  retry while the report is open; the report is never rolled back. Admin's mail may arrive before the photos.

## Summary

From the reveal until 14 days after the job closes, either side can report a problem: a reason chip, a short text and
up to three photos. Admin works through a queue and can do nothing, warn, suspend the provider, refund a fee, send the
job back to work or close it. A warning shows to the warned person as a banner until they acknowledge it; the reported
person hears nothing else unless admin acts. An open report pauses the auto close of a job waiting for confirmation.
The reporter and admin get mail (rows 15 and 16). G2 is checked after this position.

## Requirements

**User stories**:
- As a customer or provider, I want to tell admin what went wrong, with photos, so that something happens.
- As admin, I want one queue of reports with the job's history, so that I can act fairly and fast.

**Prerequisites**: 13 merged (`fab75be`). Branch `feat/14-report-problem`. Migration
`supabase/migrations/20261126090000_report_problem.sql`.

**Acceptance criteria**:
- **AC-1**: `open_report(p_request_id uuid, p_reason text, p_text text)` returns `{ status: 'ok', report_id }`. Caller
  a party (R-1), inside the window (R-2); reason one of `no_show`, `did_not_pay_cash`, `poor_work`,
  `safety_or_behaviour`, `asked_money_off_platform`, `other`; text per R-3; one open report per (request, reporter)
  by a partial unique index, at most 2 in total (X-16); at most `reports_per_user_day` per R-4. Errors: `not_allowed`
  (not a party, outside the window, or never revealed), `validation_failed`, `report_open`, `report_limit`,
  `too_many_reports`, `report_settings_invalid`. One
  `audit_log` row `report.opened` (entity `problem_reports`, new value `{ request_id, reason, side }`).
- **AC-2**: Up to 3 photos per report in a private bucket `report-photos` (10 MB, `image/jpeg` and `image/png`), path
  `<region>/<report_id>/<uuid>.jpg`, uploaded from the browser through `lib/storage/client.ts` (`uploadReportPhoto`:
  first bytes check, EXIF rotation, downscale, JPEG re-encode that drops EXIF, upsert off), then registered by
  `add_report_photo(p_report_id uuid, p_object_path text)` (reporter only, report `open`, size and type read from
  `storage.objects`, at most 3 rows). Storage insert is allowed only to the reporter, only under an open report's own
  folder, only while it holds fewer than 3 objects; select only to the reporter and admin; no update or delete for
  anyone through the API. Errors: `not_allowed`, `too_many_photos`, `file_invalid`.
- **AC-3**: While a report is open, `auto_close_jobs()` skips its request (R-6), and `closes_soon` mail skips (R-7). In
  `AWAITING_CONFIRMATION` the customer's request page shows a second button, **Not done, report a problem**, beside
  Confirm, opening the report form with `poor_work` preselected. While the caller's own report is open,
  `request_close_info` (replaced: its 11 body plus this one field) returns `my_report_open: true` and the page says the close waits for admin instead of the date;
  the other side's page is unchanged (AC-7).
- **AC-4**: `/[locale]/admin/reports` (admin) with tabs Open (oldest first) and Handled (newest handled first), 20 a
  page, through `admin_reports(p_tab text, p_page integer)`. The detail `/[locale]/admin/reports/[id]` through
  `admin_report_detail(p_report_id uuid)` shows the reason, the text, the dates, the request summary (status, service,
  start, close and `closed_by`, its fee rows with kind, amount and status) with a link to 12's
  `/admin/requests/[id]`, both parties (name, role, for a provider their status) each with reports filed, reports
  against and warnings received (this report left out), and photos behind **Show**: `log_report_photo_view(p_photo_id)`
  writes one `audit_log` row `report.photo_viewed`, then the server signs a 60 second link (02's pattern). The admin
  rail gains **Reports** with the open count.
- **AC-5**: `handle_report(p_report_id uuid, p_outcome text, p_note text, p_refund_payment_id uuid default null,
  p_warning_reason text default null)` (X-19)
  (admin) locks the request, then the report (R-10 for `suspended`). Outcomes: `no_action`; `warned` (one
  `user_warnings` row for `against_id`, reason per R-9); `suspended` (R-10); `returned_to_work` (request must be
  `AWAITING_CONFIRMATION`: to `IN_PROGRESS` with `actual_completed_at` and `confirm_deadline` cleared, the application
  `COMPLETED → STARTED`, audit `job.returned_to_work`); `job_closed` (request must be `AWAITING_CONFIRMATION`:
  `close_job(request, 'admin', 'job.closed_by_admin')`). The optional refund per R-11. Note per R-12. Any outcome that
  leaves the request `AWAITING_CONFIRMATION` sets `confirm_deadline = now() + confirm_window_hours` (11's
  `confirm_settings`). The report becomes `handled` with `outcome`, `admin_note`, `handled_by`, `handled_at`,
  `fee_refund_id`; one `audit_log` row `report.handled` (`{ request_id, outcome, refund }`). Errors: `forbidden`,
  `not_found`, `already_handled`, `invalid_outcome`, `invalid_state`, `already_suspended`, `invalid_refund`,
  `provider_not_approved` (X-17).
- **AC-6**: A customer or provider with an unacknowledged warning sees a banner on every page of their area (the
  `(customer)` and `(provider)` layouts) with the reason sentence (R-9), until they press **Acknowledge**:
  `my_warning()` returns the oldest unacknowledged one (`{ id, reason, created_at }` or null);
  `acknowledge_warning(p_warning_id uuid)` sets `acknowledged_at` on the caller's own row, a replay is `ok`, any other
  row is `not_found`. The reported party learns nothing else unless warned or suspended (02's suspension mail).
- **AC-7**: `my_report(p_request_id uuid)` returns `{ can_report, report }` for the caller only; `report` is the
  caller's latest report on that request (`status`, `reason`, `created_at`, `handled_at`), never the outcome, the note
  or the other side's report. The customer sees it on `/requests/[id]`; the provider on the My jobs card in
  `/provider/applications`. The report form is `/requests/[id]/report` and
  `/provider/applications/[requestId]/report`, one shared `ReportForm`. The other side never sees a report exists.
- **AC-8**: The agreement text stays as built (R-13). A catalogue test fails if any locale holds one of: en
  `guarantee`, `guaranteed`, `money back`, `money-back`, `we collect`, `escrow`; tr `garanti`, `emanet`, `para iade`;
  ar `نضمن`, `ضمان`, `مضمون` (case insensitive, the Turkish rule of `i18n.md` for case folding). Today's catalogues
  pass (checked 2026-11-19).
- **AC-9**: Analytics `report_opened { request_id, reason, side }` and `report_handled { report_id, outcome }` in
  `lib/analytics/events.ts` and `filter.ts`; no text or note in any event, log or audit row. The scrubber's personal
  keys gain `text` and `note`.
- **AC-10**: e2e in `ar`, `tr`, `en` at 390px (`e2e/report-problem.spec.ts`): the customer reports with a photo, admin
  sees the photo and warns, the provider sees the banner and acknowledges; an open report keeps an
  `AWAITING_CONFIRMATION` job open past its deadline while `auto_close_jobs()` runs (switch on by SQL in the test);
  admin returns a job to work and the provider can press Done again; axe clean on the form, the banner and both admin
  pages.
- **AC-11**: G2 (`build-plan.md`): expiry, cancellation, fee refund and report tests green on GitHub's checks, and two
  independent reviews (`security-reviewer` and `/check review` on another model) with no open Critical or Major.

## Decision

Reports are an intermediary's tool (§34): admin acts on accounts and on our own fees, never on the cash or the work.
Everything lives in Postgres functions over three tables with no API grant; mail rides 13's audit trigger.

## Feature design

**Data model**:

| Table | Columns | Rules |
| --- | --- | --- |
| `problem_reports` | id, region, request_id, reporter_id, against_id, side (`customer`, `provider`: the reporter's), reason, text, status (`open`, `handled`), outcome null, admin_note null, handled_by null, handled_at null, fee_refund_id null, created_at | Partial unique (request_id, reporter_id) where open; partial index on request_id where open; checks: reason list, outcome list, handled columns together, reporter ≠ against. No delete, no truncate (guard trigger), only the handle update |
| `report_photos` | id, region, report_id, object_id (`storage.objects.id`), object_path, created_at | Unique object_path; at most 3 per report (checked in `add_report_photo` under the report row lock) |
| `user_warnings` | id, region, user_id, report_id null, reason, created_by, created_at, acknowledged_at null | Reason list; `acknowledged_at` written once |

Settings (per region, 13's guard list widened, X-8): `report_window_days` 14, `reports_per_user_day` 5.

**API surface**: authenticated: `open_report`, `add_report_photo`, `my_report`, `my_warning`, `acknowledge_warning`;
admin: `admin_reports`, `admin_report_detail`, `handle_report`, `log_report_photo_view`; internal (no grant):
`report_settings`, `report_photo_allowed` (storage policies only). Doors: `lib/reports/` (customer and provider:
`openReport`, `addReportPhoto`, `myReport`, `myWarning`, `acknowledgeWarning`) and `lib/admin-reports/` (`loadReports`,
`loadReport`, `handleReport`, `reportPhotoLink`), both server only with strict schemas, as `lib/admin-requests/`.
Actions in `actions/reports.ts` and `actions/admin-reports.ts`. `lib/storage/buckets.ts` gains `REPORTS_BUCKET`.

**Value sourcing**:

| Value | Source |
| --- | --- |
| Party, against party | `requests.customer_id`; the provider of `selected_application_id` with `unlocked_at` (R-1) |
| Window end | `closed_at + report_window_days` (R-2) |
| Daily limit | `reports_per_user_day`, counted on rows (R-4) |
| New confirm deadline | `now() + confirm_window_hours` (`confirm_settings`) |
| Past counts | `problem_reports` (filed, against) and `user_warnings`, this report left out |
| Warning sentence | `Reports.warning.<reason>` in the catalogues (R-9) |
| Admin mail recipients | every `profiles` row with `role = 'admin'` (R-8; `is_admin()` reads the same column) |
| Photo size and type | `storage.objects` metadata, never the client |
| Agreement text | unchanged until S16 (R-13) |

**Security model**: report text, note and photos readable by the reporter (text, photos) and admin only; every admin
photo view audited; the warned person sees only a reason sentence; the other side never sees a report. All writes in
definer functions with `set search_path = ''`, locks request first (umbrella order).

**Critical test scenarios**: the other side, a stranger and a second provider cannot read a report, a photo or a
warning, nor upload into a report folder (AC-2, AC-7); a report after the window, before the reveal or by a non party
refuses (AC-1); a fourth photo refuses in Storage and in the function (AC-2); a paused job is not auto closed and gets no
`closes_soon` (AC-3); `returned_to_work` and `job_closed` refuse outside `AWAITING_CONFIRMATION`, and the guard refuses
those moves from anywhere else (R-5); a replayed handle refuses `already_handled`; `suspended` against a customer
refuses; a refund of another request's fee refuses; two concurrent reports by one person past the limit, and a handle
racing the customer's Confirm (pgTAP races file).

## Build plan

1. Tests first: pgTAP `30_report_problem.test.sql` and `31_report_races.test.sql`; then the migration (tables, guards
   R-5, settings, functions, bucket and storage policies, `auto_close_jobs` R-6, `email_context` R-7, mail map R-8);
   satisfies **AC-1** to **AC-3**, **AC-5** to **AC-7**.
2. `lib/db/database.types.ts`, the two doors, the storage upload, actions, analytics and scrubber keys, `lib/email`
   templates; unit tests; satisfies **AC-2**, **AC-8**, **AC-9**.
3. UI: report form and pages, Not done, status on the request page and the My jobs card, warning banner, admin queue,
   detail, handle dialog, rail item; `ui-registry.md` rows; satisfies **AC-3**, **AC-4**, **AC-6**, **AC-7**.
4. e2e; PR; GitHub's three checks; reviews (`security-reviewer`, `/check review` on another model); migration push (dry
   run lists only `20261126090000_report_problem.sql`); merge; G2 in a fresh context; satisfies **AC-10**, **AC-11**.

## Consequences

- Positive: disagreements have a path that never touches the cash; admin can undo a too early Done.
- Negative: report photos and text are personal data to keep and delete (21's `report_photo_retention_days` job);
  `email_context`, `queue_email`, `queue_reminders`, `queue_audit_email`, `auto_close_jobs`, `request_close_info` and
  the two guards are replaced again, so their bodies must be copied exactly from their latest migration.
- Neutral: reason codes are ready for 19's metrics; a returned job becomes cancellable again under 12's `IN_PROGRESS`
  row.

## Follow-up

- S16: the final agreement text and a new `terms_version` (R-13), before G3.
- With S43: switch `auto_close_enabled` on for `TR` (R-14).
- No mail to the provider when admin returns a job to work (no brief row); the job shows in Active again. Ask the owner
  whether a row is wanted.
- 16: a warning without a report (`report_id` null) and a customer suspension, if the owner wants one.

## Rationale

Telling the reported party only when admin acts avoids revenge reports while keeping warnings visible to the person
they concern. A reason code instead of admin text keeps the banner in the reader's locale and the reporter's words
private.
