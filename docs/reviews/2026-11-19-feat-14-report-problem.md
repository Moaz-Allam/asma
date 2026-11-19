# Review: feat/14-report-problem (PR #48), 2026-11-19

Two independent reviews of position 14 (spec 0011-14): `security-reviewer` (Opus) and a code review on Sonnet.
Neither found a Critical. Verdicts: security "fix then ship", code review two Major in the report form.

## Security review (Opus)

| id | sev | finding | resolution |
| --- | --- | --- | --- |
| F-1 | Major | Production parses `request_close_info` strictly; the migration adds `my_report_open`, so between the push and the deploy the request page of a working job throws. Code before the migration throws on `my_report`. | Accepted with an order: the migration is pushed right before the merge (pre launch, no real customers). The customer page now catches a failed `my_report` read and hides the entry. Recorded in D194. |
| F-2 | Minor | `auto_close_jobs` could close a job whose report committed after the loop's snapshot. | Fixed: the loop checks for an open report again under the row lock, in a fresh snapshot. |
| F-3 | Minor | A `report:<reason>` suspension showed raw to the provider. | Fixed: `AccountStateBanner` shows `Reports.warning.<reason>`. |
| F-4 | Minor | The photo path used the profile's region, not the request's (rule 10). | Fixed: `my_report` returns the request's region; the form builds the path from it. |
| F-5 | Minor | With a refund, the note reached `fee.refund_by_admin`'s audit row (R-12). | Fixed: the refund reason is `report:<report id>`; pgTAP 30 asserts it. |
| F-6 | Minor | `add_report_photo` trusts the declared type Storage recorded, not the bytes. | Carried over (R19): the browser re-encodes every photo; a server first bytes check is owed. Comment corrected. |

## Code review (Sonnet)

| id | sev | finding | resolution |
| --- | --- | --- | --- |
| F1 | Major | `openReportAction`'s revalidate and the form's refresh re-rendered the page, which then swapped the form (its "sent" panel and the photo retry, X-25) for the "already open" notice. | Fixed: no revalidate on open, no refresh in the form. |
| F2 | Major | The hidden file input had no name and took focus (axe `label`). | Fixed: `aria-label` and `tabIndex={-1}`; the remove button is 44px. |
| F3 | Minor | Unit fixtures lacked `region`. | Fixed. |
| gaps | Minor | Tests missing for X-6 (orphans over 24 hours), X-4 (concurrent uploads), X-1 (handle against a plain suspend), X-11 (unconfirmed reporter), X-20 (refund replay), X-24 (the handled check). X-23 scrub keys. | X-23 added to `tests/observability-scrub.test.ts`. The rest carried over (R19). |
