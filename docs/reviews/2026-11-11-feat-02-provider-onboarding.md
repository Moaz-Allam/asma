# Review, feat/02-provider-onboarding, 2026-11-11

**Reviewed by**: Sonnet 5.5 (author on a different model)
**Scope**: 41 modified + 53 untracked files (94), uncommitted vs HEAD (`.mcp.json` ignored)
**Verdict**: Changes requested

## Summary
Position 02 puts every provider rule in Postgres: private buckets, Storage policies, definer functions with their audit rows, a single contact scanner, and thin Server Actions and UI on top. The database layer is careful and well proven (locking, `object_id` comparisons, view-row-gated admin reads, fail-closed settings). I found no blocker and no violation of a rule that never bends. The one Major is a test gap on the action layer's error branches (AC-8 sweep compare, AC-16 "no audit, no link", submit outcome mapping). The three "fixed today" items (p7 follows standing, `break-words` on the admin heading, `clientWidth` in the e2e overflow check) are correct, but the heading fix covers only one of several free-text spots. `tsc --noEmit` is clean. I did not run pgTAP or e2e (no Docker/stack here); I relied on the author's recorded runs in `verify.md`.

## Major
### 🟠 No unit tests on the action layer's error and branching logic, `actions/provider.ts:68`, `actions/admin-providers.ts:45`, `lib/storage/server.ts:29`, `lib/provider/codes.ts:41`
**Problem**: pgTAP covers the database and e2e covers the happy path, but nothing exercises the TypeScript branches that carry AC-8, AC-16 and AC-24: `removeOld` working out `failed` by comparing asked paths with the returned names (and its `error`/throw paths); `registerDocument` logging `document_sweep_failed` only when something failed; `showDocument` returning no link and logging `document_view_audit_failed` when the view write throws, and `file_missing` when signing fails; `submitProviderFile` mapping `objectsMissing`/`missing`/`rejected` to `incomplete`; `databaseCode` mapping only known codes (so an unmapped error is rethrown and reported). A search for `removeOld|databaseCode|signedLink` in `tests/` and `e2e/` finds nothing.
**Why it matters**: these are the branches a real Storage hiccup or audit failure hits, and they are exactly where a regression (for example returning a link after a failed audit write, or silently swallowing a failed delete so old IDs stay in Storage) would pass every current test.
**Suggested fix**: add a vitest file with the Supabase server client and `rpc`/`storage` mocked: `removeOld` (all removed, one hidden, error, throw, empty list, duplicates), `databaseCode` (known, unknown, non-error), and the three action handlers through `guardedAction` with a signed-in user (audit throws then no `signedLink` call and the log event fires; sweep failure logs; submit outcome shapes).

## Minor
### 🟡 Free text can overflow the page; only the admin heading got `break-words`, `app/[locale]/(admin)/admin/providers/[id]/page.tsx:99`
**Problem**: an unbroken 200 to 600 character string in `bio` (admin file `<p>`, around line 99), `legal_name` (the `dd` facts, around line 89), `suspension_reason`, and in `ProviderProfileView.tsx` (bio), `AccountStateBanner.tsx` (rejection note, suspension reason) and `ProviderFileReview.tsx:401-404` (rejection note) has `whitespace-pre-line` or no wrapping at all. This is the same defect class as the 9 px overflow found in the visual pass.
**Why it matters**: input is provider- and admin-typed, so one long token breaks the admin file page at 360 px and the `/provider` pages. The e2e overflow check only sees the fixture names.
**Suggested fix**: add `break-words` to those text nodes and the `dd`, and add one e2e/overflow case with a long unbroken bio and legal name.

### 🟡 Client bio count disagrees with the database at whitespace edges, `lib/provider/options.ts:98`, `supabase/migrations/20261110090000_provider_onboarding.sql:94,669`
**Problem**: `bioLength` uses JS `trim()` (all whitespace); the database uses `btrim()` (spaces only). A 600-character bio plus a trailing newline, tab or NBSP passes the form and is refused by `save_provider_profile` as a generic `validation_failed`. AC-1 says the count is "as the database counts".
**Why it matters**: a confusing generic error on a form that says the count is fine; stored bios also keep leading and trailing newlines.
**Suggested fix**: make the form trim spaces only to match, or (new migration) trim all whitespace in `save_provider_profile` and keep JS `trim()`.

### 🟡 Stale "contact details" error flips to the length error on edit, `components/features/provider/ProfileForm.tsx:122,235`
**Problem**: a refused bio sets `errors=['bio']`; the first keystroke clears `formError` but not `errors`, so the field then shows `errors.bio` (the 30 to 600 length message).
**Why it matters**: wrong message under the field until the next submit.
**Suggested fix**: clear `'bio'` from `errors` in the same `onChange` branch.

### 🟡 A failed photo upload still looks like a saved photo, `components/features/provider/ProfileForm.tsx:308,347`
**Problem**: `start()` sets the local preview before the upload, and the button label uses `hasPhoto || preview`; if the upload or register fails, the avatar and "Replace" stay while the alert shows.
**Why it matters**: a provider can think the photo is saved and later fail Send for review.
**Suggested fix**: set the preview in the hook's `onDone` callback, or clear it when `error` is set.

### 🟡 A lost Storage object blocks Reject as well as Approve, `supabase/migrations/20261110090000_provider_onboarding.sql:1177`
**Problem**: `decide_provider` raises `file_missing` inside the shared loop, for `rejected` too. AC-18 attaches `file_missing` to approval. If an object is gone, admin can neither approve nor reject; only the provider re-registering unsticks it.
**Why it matters**: an abandoned file with a lost object stays in the pending queue forever.
**Suggested fix**: new migration (the old one is in the cloud): raise `file_missing` only for `approved`; on reject treat a missing object as a bad document.

### 🟡 Standing is queried twice per request, `app/[locale]/(provider)/layout.tsx:16`, `lib/provider/queries.ts:119`
**Problem**: the layout and every provider page each call `getStanding` (a separate RPC); `getProviderFile` then runs four queries and a sequential `provider_required_types` RPC.
**Why it matters**: wasted round trips on every provider navigation; the spec intends one read per request.
**Suggested fix**: wrap `getStanding` in React `cache` and run `requiredTypes` inside the same `Promise.all`.

### 🟡 `submitProviderFile` hides missing types when an object is also gone, `actions/provider.ts:98`
**Problem**: if `objectsMissing` is non-empty it returns only those types and drops `missing` and `rejected`.
**Why it matters**: the provider fixes one card, resubmits, and meets a second round of errors.
**Suggested fix**: return the union of all three, with code `file_missing` when any object is gone.

### 🟡 `provider_decided` fires for an idempotent replay, `components/features/admin/ProviderFileReview.tsx:142`
**Problem**: when a second admin clicks Approve after the first, the database returns `{status:'approved'}` and `status === decision` is true, so the event is tracked twice for one decision.
**Why it matters**: inflates the acceptance numbers.
**Suggested fix**: have `decide_provider` return a `changed` flag, or compare with the status the page rendered, and track only when it changed.

### 🟡 Dead PDF link after 60 s with no way to refresh, `components/features/admin/ProviderFileReview.tsx:105,421`
**Problem**: `shown[objectId]` keeps the URL in state; an image stays rendered (fine) but the PDF anchor stays and fails after the link expires, with no "Show again".
**Why it matters**: an admin opening the PDF late sees a raw storage error.
**Suggested fix**: store a timestamp and bring the Show button back after about 55 s for PDFs.

### 🟡 A network failure in `registerDocument` or `acceptDocsConsent` is unhandled, `components/features/provider/use-provider-upload.ts:40`, `components/features/provider/DocumentsStep.tsx:74`
**Problem**: the action call is awaited inside `startTransition` with no try/catch; a dropped connection after a successful upload throws into the error boundary instead of showing the `network` message.
**Why it matters**: phone users on weak mobile data are the main audience, and the uploaded object is left as an orphan.
**Suggested fix**: wrap in try/catch and set `error` to `network`.

## Nits
- ⚪ `supabase/migrations/20261110090000_provider_onboarding.sql:1355`, `on conflict (id) do nothing` leaves a pre-existing public bucket public; guard 08 and the cloud query cover it, but `do update set public = false, ...` would self-heal (new migration).
- ⚪ `lib/storage/buckets.ts:5`, the comment names `tests/storage-buckets.test.ts`; the file is `tests/storage-files.test.ts`.
- ⚪ `app/[locale]/(admin)/admin/providers/[id]/page.tsx:53`, `file.status === 'draft' ? 'pending'` is unreachable (drafts return null earlier) and would mislabel a draft.
- ⚪ `components/features/admin/AdminRail.tsx:48`, `hover:bg-surface-inverse/80` on a `surface-inverse` rail has no visible hover state.
- ⚪ `components/features/admin/ProviderFileReview.tsx:186,303`, the `reason_short` error shows both in the top alert and inside the dialog.
- ⚪ `components/features/provider/ProviderProfileView.tsx:54`, the `?? 'statusSuspended'` fallback would show the suspended text for an unreachable standing; prefer an exhaustive map.
- ⚪ `components/features/provider/AccountStateBanner.tsx:30`, the expired list ignores whether the type is currently required (a non-required expired record would be listed under a standing that is not `document_expired`).
- ⚪ `app/[locale]/(provider)/layout.tsx:16`, `.catch(() => null)` hides a standing outage as "no chip"; the pages show `ErrorState`, but the layout should at least log.
- ⚪ `supabase/migrations/20261110090000_provider_onboarding.sql:1329`, `provider_name_changed` refuses any `full_name` update on a suspended provider, including future system paths (21 anonymising); note it for that spec.

## Strengths
- The database design is tight and honestly threat-modelled: the provider row is locked first by both provider and admin functions, `object_id` is compared everywhere so a reused path cannot carry a verdict or a view, `admin_may_read` is tied to object id, path and 2 minutes, settings fail closed, no API role has a write grant, every function is revoked from PUBLIC with a pinned `search_path`.
- The test proof is strong where it matters: 225 planned pgTAP assertions covering forbidden paths for customer, admin and cross-provider, the 20-object cap with aged orphans, the replaced-file and reused-path case, races by state, plus a separate Storage meta guard (no public bucket, every policy names a bucket, none to anon or PUBLIC, exact policy set).
- The client upload path is careful: first-bytes sniff before any upload, EXIF rotation and downscale to JPEG (drops GPS), explicit content type with the Android empty-type PDF rewrap, `upsert:false`, `cacheControl:'0'`, stable error codes recorded from real Storage responses.
- Telemetry hygiene: `scrubUrl` cuts Storage object URLs after the bucket and drops all parameters; Replay masks `src` and `href`; `<img>` not `next/image` with the reason in the lint disable; the phone is masked on the server before any client component.
- Today's fixes check out: `ProviderProfileView` now keys every line off `standing` (and drops "ID verified" in `document_expired`), the e2e `noOverflow` now compares `scrollWidth` with `clientWidth` (correct, `innerWidth` includes the scrollbar), and the heading has `break-words`.
- Catalogues have exact key parity across `ar`, `tr` and `en` (526 keys each), `[tr]` markers on every new Turkish string, and `ProviderDocs.consent` is now covered by the launch-gate `[draft]` test.

## Test coverage
Covered: all database rules (pgTAP 07 and 08), the scanner corpus, option lists equal to the migration, file sniffing and Storage error mapping, progress rows, CSP and `scrubUrl`, the lint door rule, the action guard (anonymous refusal), and the full e2e journeys in three locales with axe and CSP checks. Not covered: the TypeScript action and Storage-server branches listed in the Major finding. `parseQueueQuery` has fallback tests, but `queuePage` clamping is exercised only through e2e. Open items outside this review: the AC-29 real calls and the Safari PDF check are still unticked in `verify.md`.
