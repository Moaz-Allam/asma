# Review, feat/02-provider-onboarding, 2026-11-13

**Reviewed by**: Sonnet 5.5, in a fresh context. Author model not confirmed: AGENTS.md says the author is Opus, but the commit trailer on 9f67dd6 names Sonnet 5.5, so treat the cross model guarantee as unconfirmed.
**Scope**: 100 files, `3c8ca33..9f67dd6` (PR #26), the committed state only.
**Verdict**: Changes requested (one Major, plus Minors). No Blocker.

Brief from the coordinator: another reviewer covers the security side (Storage policies, definer functions, the contact scanner). This review concentrates on correctness, reuse and simplification, error handling, tests, and the i18n and RTL rules. Two items below sit in the scanner and function area because I verified them by running them; they may overlap with that review.

## Summary

Position 02 puts the rules in Postgres and keeps the TypeScript thin, and that holds up: the database tests pass (I re ran them), the action layer now has unit tests, the three catalogues match key for key, and no physical direction class slipped in. The one real defect is in the contact scanner's letter folding: two Turkish digit words are never recognised, so the "spelled Turkish" rule of AC-3 is only partly true in the launch locale. The rest is smaller: network failures that crash forms, a few silent catches, duplicated helpers, thin tests around `updateAccount` and the standing pages, and some stale docs. Outside the diff, GitHub Actions has not started a single run on this branch, so nothing proves CI for this head.

## Major

### Spelled Turkish digits "üç" and "dört" are never recognised, `supabase/migrations/20261110090000_provider_onboarding.sql:411`
**Problem**: `contact_normalise` folds Turkish letters with `translate(..., 'ığüşöçâîû…', 'iguscoaiu…')`. The fifth and sixth pairs are crossed: `ö` becomes `c` and `ç` becomes `o`. It should read `igusocaiu`. So `üç` becomes `uo` and `dört` becomes `dcrt`, and neither matches the word list (`uc`, `dort`) in `has_contact_info`. I ran it on the local database: `select public.has_contact_info('beş üç dört üç dört beş üç')` returns `false`, while `bes uc dort uc dort bes uc` returns `true`. The corpus row `sıfır beş beş beş bir iki üç dört` (verify.md:25, pgTAP 07:101, and the e2e bio at `e2e/provider-onboarding.spec.ts:169`) passes only because five recognised words come before `üç`.
**Why it matters**: Turkish is the launch locale and the scanner is what keeps phone numbers out of bios (the fees are the revenue). Every spelled `3` or `4` cuts the run of five words, so a number written in words gets through whenever its digits are spread around those two.
**Suggested fix**: a new migration (both earlier ones are in the cloud) that replaces `contact_normalise` with the correct third argument, a corpus row such as `beş üç dört üç dört beş üç` and a capitals row, in pgTAP 07 and in verify.md. The uncommitted follow up `20261114090000_provider_onboarding_review_fixes_2.sql` replaces `has_contact_info` but still calls the same `contact_normalise`, so it does not fix this.

## Minor

### A provider can read an admin id through a register retry, `supabase/migrations/20261110090000_provider_onboarding.sql:817` and `20261111120000_provider_onboarding_review_fixes.sql:402`
**Problem**: the "object already registered" branch returns `to_jsonb(v_old)`, which includes `reviewed_by` and `reviewed_at`. I confirmed it in a rolled back transaction on the local database: after an admin reviews a document, the provider calling `register_provider_document` again with the same path gets the admin's uuid back. D129 item 4 took `reviewed_by` out of the column grants so providers never read an admin id.
**Why it matters**: it defeats the stated invariant by another door. Low impact (an internal uuid), but it is the kind of leak the column grants were meant to close.
**Suggested fix**: build both return values from an explicit column list (or subtract `reviewed_by` and `reviewed_at`) in a new migration, and add a pgTAP assertion that the result has no admin id.

### A dropped connection throws into the error boundary from three forms, `components/features/provider/ProfileForm.tsx:112`, `components/features/admin/ProviderFileReview.tsx:103` to `:183`, `components/features/account/AccountForm.tsx:42`
**Problem**: `save`, `show`, `verdict`, `decide`, `suspend`, `lift` and the account `save` await a Server Action inside `startTransition` with no try and catch. If the request itself fails, the promise rejects and React replaces the page with the error boundary. The 2026-11-11 fix covered only `use-provider-upload.ts` and `DocumentsStep.tsx`.
**Why it matters**: phone users on weak mobile data are the main audience, and the provider loses a typed bio on a failed save.
**Suggested fix**: one small wrapper that turns a throw into the same `{ success: false, error: 'network' }` shape, used by all of them, with a `network` message in the `AdminReview.errors` and `Account.errors` catalogues.

### `updateAccount` works out `backToReview` itself, and nothing tests it, `actions/account.ts:33` to `:43`
**Problem**: for a provider the action reads the status and the profile before the write, then answers `current !== null && current.fullName !== fullName`. The database trigger is what moves the file, so the answer can disagree with what happened (an admin approving between the read and the write leaves the provider moved to pending and told nothing). It also costs two extra queries on every provider rename. In `AccountForm.tsx:42` to `:52`, if the name saves and the email save then fails, `saved` stays false, so the "your file went back to review" line never shows.
**Why it matters**: AC-12 promises the provider is told, and there is no unit or e2e test of this action at all (the guard test only proves anonymous refusal). The `provider_suspended` mapping is proven only by pgTAP on the trigger.
**Suggested fix**: read the status once after the write, or have the trigger path report it, show the review notice even when the email step fails, and add tests in the style of `tests/provider-actions.test.ts`: approved plus a new name gives `backToReview: true`, the same name gives false, and a suspended provider maps `provider_suspended` with no `reportServerError`.

### Provider side free text can still overflow, `components/features/provider/AccountStateBanner.tsx:64`, `:77`, `:89` and `components/features/provider/ProviderProfileView.tsx:81`
**Problem**: the suspension reason, the file note, the per document note and the bio use `whitespace-pre-line` with no `break-words`. The 2026-11-11 review asked for this; the admin page and `DocumentsStep` got it, these did not.
**Why it matters**: an admin who pastes a long link into a suspension reason (up to 500 characters) gives the provider a sideways scroll at 360 px.
**Suggested fix**: add `break-words` (and `dir="auto"` as the admin page does) and one e2e overflow case with a long unbroken suspension reason.

### The page and the database disagree on what counts as the documents consent, `lib/provider/queries.ts:199`
**Problem**: `hasDocsConsent` reimplements `provider_has_docs_consent` in TypeScript with two queries and has no `provider-docs-` prefix rule, which D129 item 5 added in SQL.
**Why it matters**: if the setting ever holds a version users already accepted for other terms, the page shows consent as given and enables the cards, and every upload is then refused by Storage as `upload_refused`.
**Suggested fix**: ask the database (a small function that calls `provider_has_docs_consent` for the caller and region) so there is one definition.

### Two silent catches hide outages, `app/[locale]/(provider)/layout.tsx:17` and `components/features/admin/AdminShell.tsx:21`
**Problem**: `.catch(() => null)` and `.catch(() => 0)` drop the error with no log. A broken function or a policy regression shows up as "no chip" or "badge 0".
**Suggested fix**: log with ids only (a new `LogEvent`) before returning the fallback.

### Count and digit wording is wrong in two locales, `messages/en.json` and `messages/ar.json`, used at `components/features/admin/AdminRail.tsx:48` and `components/layout/BottomTabBar.tsx:60`
**Problem**: `AdminReview.pendingCount` is `{count} files under review`, so one file reads "1 files under review", and the Arabic `{count} ملفات` is wrong for 1, 2 and 11 or more. `ProviderForm.taxNumberNote` in Arabic is `{digits} رقمًا`, which is right for 15 (KSA) and wrong for 10 (TR, the launch region), where the noun takes the plural.
**Suggested fix**: an ICU plural for the count (Arabic needs the one, two, few, many and other forms), and a separate Arabic string, or a plural, for the digit note.

### Duplicated helpers that should be one, `lib/provider/codes.ts:35`, `actions/onboarding.ts:19` to `:24`, `actions/provider.ts:27`, `actions/admin-providers.ts:30`
**Problem**: `databaseCode(error, known)` is a copy of the private `databaseCode` and `DB_FAILURES` in `actions/onboarding.ts`; the `mapped()` wrapper is pasted into both new action files; `actions/account.ts:38` imports a generic helper from `lib/provider/`. The calendar day formatter `format.dateTime(new Date(`${v}T00:00:00Z`), { dateStyle: 'medium', timeZone: 'UTC' })` is copied in `app/[locale]/(admin)/admin/providers/[id]/page.tsx:52`, `app/[locale]/(provider)/provider/profile/documents/page.tsx:54` and `components/features/provider/ProviderProfileView.tsx:44`. `VALID_UNTIL_MAX_YEARS` (`lib/provider/options.ts:59`) is never used.
**Suggested fix**: one `mapCodes` helper next to `guardedAction` in `lib/auth/action.ts`, used by all four callers; one date helper; feed `VALID_UNTIL_MAX_YEARS` to `min` and `max` on the admin date input, so admin learns a date is out of range before the click and not from `valid_until_invalid` after it. Also, `STANDING_TONE` lives in a feature component but the admin queue imports it, and `BottomTabBar` (a shared layout piece) reads admin copy.

### Test gaps
- `updateAccount`: no test (see above).
- No automated test of the standing to page mapping (`AccountStateBanner`, `ProviderProfileView`, `StandingChip`, `/provider`). verify.md:88 records that `p7` once said "approved, you can apply" in `document_expired`, fixed by hand with no regression test. The e2e never reaches `document_expired`, the account rename dialog or the company change dialog; the AC-12 dialogs are proven by hand only.
- `tests/provider-options.test.ts:31` only checks that each rejection code appears somewhere in the migration, so it passes if one table lost its check.
- The scanner corpus has no Turkish word with a diacritic late in the run, which is how the Major above stayed hidden.

### Stale documents, `context/architecture.md:1508`, `docs/specs/0006-provider-onboarding/index.md:628` and the position 21 follow up bullet, `AGENTS.md:48`
**Problem**: the architecture note and the spec still say the tables of 01 read the token claim and that position 21 will decide whether they move. D129 and migration `20261111120000` already moved them to `is_admin()`. The AGENTS.md status line says 02 is "not committed" and its migration is in the cloud, but the head is committed and carries a second migration.
**Suggested fix**: edit the architecture and spec lines by hand; `/sync` will catch the status line.

## Outside the diff: CI has not run

Every Actions run on this branch (push 43423796159, pull request 43423806928) and on master (43423644558, and the Dependabot runs) ended `startup_failure`, "likely failed because of a workflow file issue". PR #26 shows only the Vercel status. `checks`, `database` and `e2e` are all required on master (D46), so the merge, and the auto merge of D126, cannot happen until Actions runs again, and all evidence for pgTAP and e2e is local. One thing to watch when it does run: the `database` job uses `supabase db start` (database only, no storage-api) while the migrations insert into `storage.buckets` and add policies and triggers on `storage.objects`. It is unproven that a database only stack has those tables and columns.

## Nits
- `lib/provider/options.ts` exports `ProviderStatus` and `ReviewReason`, and `lib/provider/db.ts` exports `Registered` and `Submitted`; none is imported.
- `components/features/provider/use-provider-upload.ts:68`: after a register refusal that is not `file_missing` (type or size), the bad object is kept as "unregistered", so picking the same file again re registers the same bad object instead of uploading again. The browser checks make this hard to reach.
- `submitProviderFile` returns `pending` both for a first submit and for a replay, so `provider_file_submitted` can be counted twice on a double tap. The button is disabled while pending, so it is rare.
- `components/features/admin/AdminRail.tsx:48`: an `aria-label` on a `span` works only through name from content; axe passes, but a visible text or `sr-only` span would be safer.

## Strengths
- The e2e and unit fixtures are synthetic (I opened the selfie and ID images: plain "TEST" cards), so no real person's papers sit in the repo.
- `tests/provider-actions.test.ts` and `tests/storage-server.test.ts` close the action layer gap the 2026-11-11 review found: the sweep compare, no link after a failed audit write, the submit outcomes, and the replay flag are all driven on purpose.
- Catalogues: 532 keys in each of `ar`, `tr` and `en`, no placeholder mismatch, no ICU left half done, every new Turkish string carries `[tr]`, every code the functions raise has a message in `ProviderErrors` and `AdminReview.errors`, and `tests/i18n.test.ts` guards `CLIENT_NAMESPACES` by scanning the client files.
- RTL: `lint:rtl` is clean (165 files), free text uses `dir="auto"`, numeric and tax fields are `dir="ltr"` with `text-start`, the stepper separator mirrors, and the badge uses `-end-3`.
- The storage door has a lint rule with proofs in both directions, and `scrubUrl` cuts Storage URLs after the bucket with a test for every object route.

## Test coverage
What I ran: pgTAP `07_provider_onboarding` (248 of 248 ok) and `08_storage` (6 of 6 ok) inside their own rolled back transactions against the local asma database container (row counts unchanged afterwards); vitest on `provider-actions`, `provider-options`, `provider-progress`, `storage-files`, `storage-server`, `i18n` and `action-guard` (68 passed); `node scripts/check-logical-classes.mjs` (clean); a rolled back probe of the register retry; and one select probe of the scanner.
What is not covered: see the Test gaps above.

## What I did not check
- I did not run typecheck, lint, the format check, the full unit suite, the production build or the e2e journeys, to avoid writing files in the owner's checkout. I relied on the runs recorded in the tracker and verify.md.
- A new uncommitted migration `20261114090000_provider_onboarding_review_fixes_2.sql`, edits to pgTAP 07 and 08, the spec files and verify.md, and a new `tests/scanner-property.test.ts` appeared in the working tree while I was reviewing (another session is working there). I did not review them; I only searched the migration to confirm it does not touch `contact_normalise` or `register_provider_document`, so the Major and the first Minor stay open. My pgTAP run used whatever the local database held at the time, which already had both committed migrations applied.
- Storage policies, definer function design, the scanner's design and its false positive rate: left to the other reviewer.
- No real device checks (AC-29 is still unticked): iPhone Safari camera and EXIF handling (including whether `createImageBitmap(file, { imageOrientation: 'from-image' })` works on the Safari versions in use; a failure there shows as "use another photo"), Android PDF picking, the Safari PDF link, and `camera=()` with `capture="user"`.
- The cloud state, the real Twilio and Auth calls, the design fidelity against the live Claude Design project, and the screens at 360, 390, 430 and 1280 px beyond what the e2e overflow check asserts.
- I did not read any `.env*` file or `.mcp.json`.
