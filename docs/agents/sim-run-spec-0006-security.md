# Security critic on spec 0006 (2026-11-02)

Run `sec-spec0006-1` of `security-critic` (`701772bb-789c-409a-8095-e691cb73f36e`) in the Sim workspace
`415c6b54-fe94-424c-9b5c-569bd284f501`. Model `gemini-4-argon`, thinking low. Input: spec 0006 `index.md`, security parts only (8.2K
tokens in; the UI only parts were left out and the input said so). Result: 49 s, 13 credits ($0.065), verdict `ready_after_fixes`, six
findings (Sim labels: 4 major, 2 minor). Balance afterwards: 987 of 1,000.

Each finding was checked against `index.md`, `rationale.md` and `verify.md`. Spec edits belong to `/architect`; nothing in the repo was
changed.

| # | Sim label | Where | Verdict | Our grade | Recommended |
| --- | --- | --- | --- | --- | --- |
| 1 | major | AC-12, AC-15, value sourcing (approved name) | Partly true, overstated | minor | Optional: keep `approved_name` on `providers` |
| 2 | major | AC-8, AC-12, AC-18, AC-20 | True, no access impact | minor | Mark the other ID side `rejected` (`document_expired`) at register time |
| 3 | minor | AC-7, AC-8, AC-22, failure handling | True, rare | minor | Count only registered or recent orphan objects, or sweep older orphans |
| 4 | minor | Storage policy `admin_may_read(name)` | True; already recorded (trial row 1, finding 1) | medium on audit integrity, low likelihood | Pass the row id: `admin_may_read(id, name)` and match the audit row on the object id too |
| 5 | major | Functions table | True as a spec gap; AC-22 and its negative tests would catch a build slip | medium | Write "provider inside"; require a `providers` row in every provider function and in `provider_may_store`; add customer and admin negatives |
| 6 | major | AC-12 vs AC-18 | True but by design (`verify.md` tests "stays approved") | owner decision, not a bug | Owner chooses: back to review (recommended), flag in the admin queue, or keep |

## Details

1. **Approved name hint.** AC-15 shows the approved name only when `review_reason = name_changed`, read from the latest
   `provider.back_to_review` row. Gap: approved A, replaces a document, file is `pending` (`document_replaced`, no name in the row),
   renames to B while pending (status stays, AC-12). The admin then sees B with no hint of A. Not a hole: the admin still sees the current
   name and must match it to the ID (`name_mismatch`), and `stale_profile` covers a rename after the page loaded. The critic's own
   two-renames story shows the right hint. Fix if wanted: `decide_provider` stores the approved name on `providers`; show it whenever it
   differs from the current name.
2. **Expired ID, one side replaced.** AC-8 couples the two sides only when the other is `rejected`. An expired side stays `approved` with a
   past `valid_until`. A one-sided replace puts the file in `pending` (AC-12) with an expired back side, Approve stays closed (AC-18, "in
   date"), the admin must reject the back side, the provider uploads again. `/provider` names expired documents only in standing
   `document_expired` (AC-10), which ends once the file is `pending`. A wasted round trip and a confusing state.
3. **Orphans and the 20 object cap.** An unregistered object is swept at the next upload of that type, but the cap refuses at 20 objects
   before that upload can happen, so 20 orphans block the provider until support steps in. Needs 20 failed registers or a script, so rare.
   The spec's "an honest user does not reach this" ignores orphans from failed registers.
4. **`admin_may_read(name)` by path.** The audit row is matched by path, not object. Already recorded as trial row 1, finding 1
   (`docs/agents/sim-critics.md`), and the accepted spec still binds the policy to a path. Exploit: a provider re-uploads at the freed path
   inside the admin's 2 minute window and an admin reads it directly; the audit row then names a different object. The critic's second
   half (a server render signed link for the admin) misreads the value sourcing row, which is the provider's own photo.
5. **Provider functions have no stated role check.** The functions table says only "authenticated" for `save_provider_profile`,
   `accept_provider_docs_consent`, `register_provider_document`, `submit_provider_file` and `provider_may_store`; admin functions say
   "admin inside". `accept_provider_docs_consent` writes a `terms_acceptances` row for any user. If `provider_may_store` only tests "not
   suspended", a customer with that row passes (no `providers` row to be suspended) and could fill a private bucket. AC-22 says
   "Customers and admins upload nothing" and demands negative tests, so the build would fail the tests, but the table does not say how.
6. **Company fields after approval.** AC-12: bio and company fields save at once; entity type, legal name and tax number write
   `provider.company_changed` and the provider stays `approved`. `verify.md` lines 86 to 87 test exactly that. `rationale.md` gives no
   reason (line 130 covers only documents). Consequence: tax identity and legal name can change after approval, while fee invoicing
   (B9, G18) will use them.

## Applied

2026-11-02, in spec 0006 (D120): #1, #3, #4 and #5 as recommended, #3 as "count only registered objects or orphans younger than 24 hours". Owner picks: #2 the
other side of an expired ID is rejected at register; #6 company changes go back to review.

## What this run does not show

The critic sees only the pasted text. It found nothing on `provider_may_store`'s path shape, the scanner or the signed link lifetime, and
that is not assurance. At 13 credits it is cheap enough to run again on the amended spec.
