# 0006. Provider onboarding and approval (position 02)

**Date**: 2026-11-01
**Status**: Accepted (confirmed by the owner 2026-11-01, after a cross check on a second model; amended 2026-11-02 from the security critic, D120)

## Summary

A new provider fills in a short profile, uploads a face photo and identity papers, and sends the file to
admin. Admin checks each document by hand, approves or rejects with a reason, and can later suspend the
account. No money moves here: the output of this position is one answer, may this provider apply, which
position 05 reads. Files go straight from the browser into private Supabase Storage, and every rule that
matters lives in the database, because a hostile browser can call the database and Storage directly.
Step 3 of the design (services, districts, work days) moves to 05, because its tables do not exist until 03.

## Requirements

**User stories**:
- As a new provider, I want to finish my file on my phone in one sitting, so that I can start applying.
- As a provider, I want to see what is missing, what admin decided and why, so that I can fix it myself.
- As admin, I want to look at each document, decide per document and leave a reason, so that review takes
  minutes and is recorded.
- As the owner, I want IDs and criminal records readable only by their owner and admins, with every view
  recorded, so that we hold this data the safest way we can.
- As the owner, I want contact details kept out of anything a customer will read, so that neither side
  goes around the fees.

**Prerequisites** (not acceptance criteria):
- **01 part 2 merged**, with `20261101090000_account_notifications` pushed. Branch `feat/02-provider-onboarding`
  starts from that `master`.
- **Design source.** The owner's live Claude Design project
  (`https://claude.ai/design/p/33f193f1-0d49-40a1-8330-b18d6869bb4e`), read through the `claude_design` MCP
  (owner, 2026-11-01). Frames: `p2`, `p3`, `p5`, `p7`, `p14` in `Nazzafly Provider Web.dc.html`; `app-03`, `a1`,
  `a2`, `a4` in `Nazzafly Admin.dc.html`. The MCP has been registered and working since 2026-11-02 (D124). If it
  ever cannot connect, `docs/design/source/` is the fallback, and `/develop` says so out loud. That export was
  checked against the live project for the customer and admin files, not the provider file.
- **S16, added.** The consent wording for the documents tick; the KVKK basis for the selfie and the criminal
  record; how long a rejected or abandoned file may stay.
- **S21.** New strings go to the translator as `[tr]` keys.
- **The scanner lists.** The owner reads the must catch and must pass table in [verify.md](verify.md) before the build.

**Acceptance criteria** (the contract):

*Provider: profile.*

- **AC-1**: `/{locale}/provider/profile` shows step 1 of a two step `Stepper` (`p2`) to a provider in `draft`,
  `rejected` or `pending`: the gate line, full name read only (from `profiles`, with a note that it must match the
  ID and a link to `/account`), entity type as `ChoiceChips` (individual or company), legal name and tax number
  when company, years of experience, bio with a live count to 600 (code points, `[...text].length`, as the database
  counts), languages as multi select `ToggleChips` (Turkish, Arabic, English; at least one), the profile photo, and the
  `FileProgress` panel. Each status behaves as the table in Feature design says.
- **AC-2**: `save_provider_profile` holds the rules, so a direct call gets the same refusals as the form: bio 30
  to 600 characters after trim, years an integer 0 to 60, languages a non empty subset of the list, a company needs
  a legal name of 2 to 200 characters and a tax number of exactly 10 digits in TR or 15 in KSA, after folding Arabic
  Indic digits and stripping spaces and dashes, so an 11 digit Turkish national ID cannot land here. An individual
  stores neither. Saving twice changes only `updated_at`.
- **AC-3**: `public.has_contact_info(text)` is the one scanner. `save_provider_profile` refuses a bio it flags with
  the stable code `contact_info_in_bio`. It first normalises: NFKC, lower case with no Turkish locale, zero width
  characters, tatweel and Arabic marks removed, Arabic Indic and Persian digits folded. Then it flags: a run of 7 or
  more digits with gaps of at most 2 characters between them; 5 or more spelled number words in a row, in `ar`, `tr` or
  `en`; emails, including spelled `at` and `dot`; links and bare domains on a fixed list of endings; `wa.me`, `t.me` and
  `@` followed by 3 or more word characters; the names of WhatsApp, Telegram and Instagram in the three languages. The
  must catch and must pass table in `verify.md` is the pgTAP corpus. When the field equals the saved bio, the `p2` chip
  "checked, no contact details" shows. There is no live chip while typing. Position 05 calls the same function.
- **AC-4**: The profile photo is required to submit. The browser applies EXIF rotation, downscales to a longest side of
  1024 px and re encodes as JPEG (quality 0.85), which also drops EXIF location. It uploads to `provider-photos`, shows
  from a local blob until reload, and from a short signed link after.

*Provider: documents.*

- **AC-5**: `/{locale}/provider/profile/documents` is step 2 (`p3`), with one card each for: ID or residence permit
  (front and back), selfie holding the ID (camera on phones through `capture="user"`, a file picker on desktop),
  criminal record (only when required for the region), and skill certificate (optional). Every card shows not started,
  uploading, uploaded, approved, or rejected with its translated reason and note, plus a replace action, and states
  what it accepts: JPEG or PNG for the ID and selfie; JPEG, PNG or PDF for the others; 10 MB at most. Valid until shows
  when admin has set it. A suspended provider sees the cards read only. The ID number is never asked for or stored.
- **AC-6**: A required tick sits above the document cards, and the cards stay disabled until it is on. Once accepted
  it stays ticked; a new version in `platform_settings` asks again. Its text ships with the `[draft] ` marker.
  `accept_provider_docs_consent` writes one `terms_acceptances` row with that version, the locale and database time;
  a retry adds nothing. Without that row Storage itself refuses a document upload, so the rule holds against a direct
  call. The photo bucket does not need it.
- **AC-7**: Upload order. The browser reads the first bytes and refuses a file that is not what the card accepts
  (`FF D8 FF`, `89 50 4E 47`, `%PDF-`) with `file_type_refused`, before any upload. It applies EXIF rotation and
  downscales an image (longest side 2400 px, JPEG quality 0.85), and passes a PDF as it is. An image over 25 MB raw is
  refused before encoding; the 10 MB limit applies to what is uploaded. It uploads to `{provider_id}/{type}/{uuid}.{ext}`
  with `upsert` off and an explicit `contentType`, because Android can report an empty type for a PDF. Then
  `registerDocument` calls `register_provider_document`, which derives the bucket from the type, reads the object's id,
  size and type from `storage.objects`, never from the client, and cross checks type, extension, size and folder. A
  failed step shows a plain message with retry and leaves the row as it was. A retry with the object already registered
  returns the row and writes nothing.
- **AC-8**: A provider holds one row per document type, replaced in place: new path and `object_id`, `pending`, reason,
  reviewer and `valid_until` cleared, one `document.registered` audit row. After the row commits, the action deletes
  `previous_path`, which the function returns, plus any object in that type's folder that no row points to and that is
  older than the new one, so the old file goes at once. `remove()` reports what it deleted and the action compares. If a
  delete fails the row is still right, a `document_sweep_failed` log event fires, and the next upload of that type tries
  again. Replacing one ID side while the other is `rejected` returns the other to `pending`, so a good side need not be
  uploaded twice, unless its code is `document_expired`: an expired ID is one document, so that side stays `rejected` until
  it is replaced itself. For the same reason, when one side registers and the other side's `valid_until` is before today,
  the database marks the other side `rejected` with `document_expired`, `reviewed_by` null, and one `document.reviewed` row.
- **AC-9**: "Send for review" sits at the end of step 2, in `draft` and `rejected` only. `submit_provider_file` needs the
  profile saved, the photo and every required document present with its object still in Storage, no required document
  `rejected`, and the current consent version accepted. If any is missing it writes nothing and returns the missing and
  rejected types, which the action maps to `file_incomplete`, so the cards can name them. Otherwise it sets `pending`,
  `submitted_at` and `review_reason` (`first_submission` or `resubmitted`), clears the file's rejection code and note, and
  writes the audit row. From `pending` or `approved` it returns the status and writes nothing, and from `suspended` it
  refuses with `provider_suspended`.

*Provider: what they see after.*

- **AC-10**: `/{locale}/provider` follows `provider_standing()`. `draft`: a call to finish, with `FileProgress`.
  `pending`: `p5` with the file list and "usually within two working days", no SMS promise; a side rejected under AC-8 shows
  there with its reason and a link to step 2. `rejected`: `p14` with each
  rejected document, its reason and note, the file note, and a link to step 2. `suspended`: `p14` with admin's reason and
  no action. `document_expired`: `p14` naming each expired document, with a link to step 2. `approved`: `EmptyState`
  until 05. A null standing renders `ErrorState`, never `draft`. Every provider page shows the standing as a `StatusChip`
  in the header (mapping in Feature design). The provider layout reads it once per request, and every action that changes
  it calls `revalidatePath('/', 'layout')`.
- **AC-11**: `/{locale}/provider/profile` for `approved` or `suspended` shows `p7` as far as data exists: photo, full name,
  chips (ID verified when approved, security checked when the criminal record row is approved, member since the year of
  `approved_at`), years and languages, the account status card with valid until dates and the note that replacing a
  document returns the file to review. `approved` also has Edit, which opens the AC-1 form. `suspended` is read only.
- **AC-12**: Back to review. Registering any document or the photo while `approved` moves the provider to `pending` with
  `review_reason = document_replaced`, in the same transaction, even for the optional certificate. The replace action
  on an approved file asks first in a `ConfirmDialog`, because new applications stop until admin approves. Bio, years and
  languages save at once with no review. A change to entity type, legal name or tax number writes `provider.company_changed`
  with old and new, except on the first save, and on an approved provider it also asks first in a `ConfirmDialog` and moves
  them to `pending` with `review_reason = company_changed` in the same transaction. `save_provider_profile` compares the
  stored values with the normalised new ones, because the form sends every field on every save, and returns
  `{ backToReview }`. On `/account`, which reads `provider_standing()`,
  an approved provider who edits their name first confirms in a `ConfirmDialog` that the file returns to review. The same
  database transaction moves them to `pending` with `review_reason = name_changed`, and `updateAccount` returns
  `{ done, backToReview }`. The trigger compares old and new, because the form sends the name on every save. Each entry to
  `pending` resets `submitted_at` and writes `provider.back_to_review` with old and new status, the reason and, for a
  rename, the approved name. In `draft`, `pending` and `rejected` a name change leaves the status alone. A suspended
  provider cannot change their name: `updateAccount` maps `provider_suspended`, with no Sentry report, and
  `Account.errors.provider_suspended` exists in all three catalogues.

*Admin.*

- **AC-13**: `AdminShell` draws `AdminRail` (navy, as `app-03`) from `lg`, and the normal header and `BottomTabBar` below it.
  Built pages only: Dashboard and Providers (menu key `providers`, three tabs with Account), with a count badge of `pending`
  files. No region switch and no console search. Later positions add their rows.
- **AC-14**: `/{locale}/admin/providers` has tabs for under review, approved, rejected and suspended, oldest first with
  newest as the other sort, 20 per page. The pending tab shows and sorts on `submitted_at`, the others on `decided_at`, ties
  broken on `id`. A row shows the initial avatar, name, date and `StatusChip`, and on the pending tab the review reason
  chip. An invalid `tab`, `sort` or `page` falls back silently to pending, oldest, with the page clamped. Each tab has an
  empty state (`a4`). A `ProviderQueue` Server Component renders in both the list page and the file page, because a layout
  gets no `searchParams` and does not rerender. Row links carry the query. Below `lg` it is hidden on the file page.
  `draft` providers appear nowhere.
- **AC-15**: `/{locale}/admin/providers/[id]` shows name, masked phone (last four digits), region, years, languages,
  bio, entity type, legal name, tax number, status, dates and the review reason. Whenever `providers.approved_name` is set
  and differs from the current name, it also shows the approved name against the current one, whatever the review reason. A
  `draft` or unknown id is 404, and a malformed id is refused before any query.
- **AC-16**: No file loads with the page. "Show" calls `showDocument(documentId, objectId)`. `log_document_view` refuses a
  changed object with `stale_document` and writes `document.viewed` with type, path and object id. Only then does the
  action sign a 60 second link, and Storage refuses an admin with no fresh view row, so no admin token reads an ID
  unrecorded. If the audit write fails there is no link, and a `document_view_audit_failed` log event fires. An image opens
  inside its card in a plain `<img>` (never `next/image`, whose optimizer would fetch and cache a signed link; the lint
  disable carries that reason). A PDF opens from an anchor with `rel="noreferrer"` drawn after the action returns, because
  Safari blocks `window.open` after an await. `stale_document` shows "this file was replaced" and refreshes.
- **AC-17**: While the file is `pending`, admin marks a document match or reject, and may change the verdict until the
  decision. ID front and back take one verdict in one click. Match opens after Show: the database needs a `document.viewed`
  row by this admin for this object, both sides for the ID (`view_required`). Match on the ID and on the criminal record
  needs a `valid_until` after today and at most 15 years ahead (`valid_until_invalid`); for the record that is its issue
  date plus six months, and for a paper with no expiry the limit. Other types refuse a date. All typed by admin. Reject
  needs one of six chips, offered per type as Feature design lists, with an optional note of up to 300 characters. A
  verdict names the provider and the `object_id` it saw: a replaced file gets `stale_document`, and an id of another
  provider is refused. One `document.reviewed` row per document.
- **AC-18**: Approve opens only when every required document, photo included, is `approved` and in date; the page shows the
  count reviewed. A pending or rejected certificate does not block it and is never shown as verified. Reject opens when a
  required document is `rejected`, or when admin writes a file note, with a chip if one fits (a rude bio has no document to
  reject). `decide_provider` takes the `providers.updated_at` the page saw and refuses `stale_profile` on a mismatch, so
  nobody approves a name, legal name or bio they did not see. It checks that each required object still exists
  (`file_missing`). It locks the provider row, so a second click or a second admin gets the same state and one audit row.
  `approved_at` is set once and survives later reviews, and `approved_name` takes the current name at every approval. The
  decision is shown on `/provider`; nothing is sent, because no notice sender exists yet.
- **AC-19**: `a2`: admin suspends an `approved` provider with a required reason of 5 to 500 characters, shown to the
  provider as written, and can lift it, back to `approved`, which clears the reason (`audit_log` keeps it). Both set
  `decided_at` and `decided_by`. While suspended: uploads, profile saves and submit are refused with `provider_suspended`,
  in the database and in Storage. Sign in and reading their own file still work.

*Database, Storage, signals.*

- **AC-20**: `provider_standing(uuid)` returns `draft`, `pending`, `approved`, `rejected`, `suspended` or `document_expired`.
  The last applies to an `approved` provider with a required document whose `valid_until` is before today, so it needs no
  scheduled job. `provider_can_apply(uuid)` is true only for standing `approved`. Position 05's insert policy calls it.
  `provider_required_types(region)` is the one list: `profile_photo`, `id_front`, `id_back`, `selfie`, plus `criminal_record`
  unless `criminal_record_required` is the JSON value `false`, so a missing or odd value reads as required. Changing that
  setting applies from the next submit or approval, and approved providers are not checked again.
- **AC-21**: RLS (rule 7), each with a negative pgTAP test in the same change: a provider reads only their own rows in
  `providers`, `provider_profiles` and `provider_documents`, an admin reads all, a customer and anon read nothing. No API
  role, `service_role` included, holds a write grant on these tables: all writes go through the functions below. A provider
  cannot set `status` or a verdict by any path. Every new policy and function decides who is admin through
  `public.is_admin()`, which reads `profiles.role`, so a demotion counts at once and a token cannot lag. Admin functions
  refuse anyone else with `forbidden`. Every provider function needs a `providers` row for `auth.uid()` and refuses anyone
  else with `forbidden`, so a customer or an admin cannot save a profile, accept the documents consent, register or submit.
- **AC-22**: Storage rules, each with a negative test: both buckets are private. A provider writes only what
  `provider_may_store` allows: a `providers` row for `auth.uid()`, own folder from `auth.uid()`, right type and extension for
  that bucket, not suspended, consent for documents, and under 20 counted objects. Counted means an object a
  `provider_documents` row points to, or an orphan (no row points to it) younger than 24 hours. Customers and admins upload
  nothing, even with a `terms_acceptances` row. A provider reads their own objects. An admin reads an object only with a
  `document.viewed` row by that admin for that object id and that path in the last 2 minutes, so a view row for a replaced
  file never opens a new object at a reused path. Another provider and a
  customer cannot read or sign a link. There is no update policy, so overwrite and move fail. A provider deletes only an
  object in their own folder that no `provider_documents` row points to, so a file under review cannot be erased through
  the API. Admins delete nothing.
- **AC-23**: `audit_log` records, with who, when, old, new and region: `provider.submitted`, `provider.approved`,
  `provider.rejected`, `provider.suspended`, `provider.reinstated`, `provider.back_to_review`, `provider.company_changed`,
  `document.registered` (old status and object in `old_value`, null on a first upload), `document.reviewed`,
  `document.viewed`. The database writes them, in the same transaction as the change.
- **AC-24**: Events `provider_file_submitted`, `provider_decided { decision: 'approved' | 'rejected' }` and
  `document_upload_failed { reason: 'too_large' | 'wrong_type' | 'refused' | 'network' }` are typed in
  `lib/analytics/events.ts` and added to `project-overview.md` §17. No name, phone, bio, tax number or signed link reaches
  Sentry or PostHog, proven on captured payloads. Internal uuids may, as spec 0004 allows. `scrubUrl` cuts a Storage URL
  after its bucket, so an object name stays out of breadcrumbs and spans. `LogEvent` gains `document_sweep_failed` and
  `document_view_audit_failed`.
- **AC-25**: The CSP adds the Supabase origin to `img-src`, with no other change, and `tests/security-headers.test.ts` moves
  with it. Objects upload with `cacheControl: '0'`, so a browser revalidates instead of reusing a copy of an ID.
  `Permissions-Policy` keeps `camera=()`, because `capture` opens the system camera with no `getUserMedia`; the comment in
  `lib/security/headers.ts` changes to say so. No CSP violation fires on the provider or admin pages, proven in a real
  browser.
- **AC-26**: Tooling (owner approved 2026-11-01): only `lib/storage/` may call `.storage`, with a lint proof. pgTAP fails if
  any bucket is public, if a policy on `storage.objects` names no bucket, or if one is granted to `anon` or `public`. The
  same query runs against the cloud before the real calls, because a policy made in the dashboard would widen ours.
- **AC-27**: UI: every value comes from the design source and `ui-tokens.md`. Every new string lives in all three
  catalogues, Turkish as `[tr] `, stored codes map to catalogue keys, and admin's free text shows escaped, as written.
  Client Components get small new namespaces in `CLIENT_NAMESPACES`. Loading, empty and error states exist for each page;
  file inputs work by keyboard and have labels; targets are at least 44 px; state is never colour alone. Screens pass at
  360, 390, 430 and 1280 px, `tr` first, with no overflow on Turkish strings. New components get `ui-registry.md` rows.
  Bodies keep to `Feature design`'s list of differences from the design.
- **AC-28**: `scripts/e2e.mjs` stops excluding `storage-api`. The e2e journey passes in `ar`, `tr`, `en` at 390 px with axe,
  against real local Storage: sign up as provider, fill step 1, a bio with a phone refused, upload real fixture files,
  submit, sign in as admin, show a file, reject one document with a reason, see it as the provider, replace it, submit,
  approve, see `approved`, replace a document, see `pending`. A separate journey covers suspend and lift, and a customer on
  `/admin/providers` and `/provider`. Each project has its own admin, created by signing up through real Auth and running
  `promote_to_admin` with `supabase db query --local`, and its own provider names, because one queue is shared and tests run
  in parallel. No test counts the whole queue.
- **AC-29**: Real calls, recorded in `verify.md`, because a stub proves the SDK and never the handler. On a preview against
  the cloud project: a real phone camera photo uploads from iPhone Safari and Android Chrome and shows for admin, with
  `camera=()` in place; a file over 10 MB and a renamed `.exe` are refused; direct Storage and REST calls with a real provider
  token are refused: read another provider's object, overwrite, delete a current file, upload with no consent, call an admin
  function, set a status; with a real admin token, reading an object with no view row is refused.

## Decision

**Chosen option**: browser straight to private Supabase Storage, then a registering Server Action and a database function,
with every rule in Postgres.

A provider writes only into their own folder, by Storage policy. No API role writes the three tables directly: definer
functions do, in one transaction with their audit row. The service role stays out of every request path. Reasoning and
options: see [rationale.md](rationale.md).

**Implementation skills**: `supabase` (`supabase/agent-skills`, `.agents/skills/supabase/`) ·
`supabase-postgres-best-practices` (`supabase/agent-skills`, `.agents/skills/supabase-postgres-best-practices/`) ·
`shadcn` (`shadcn-ui/ui`, `.claude/skills/shadcn/`) · `tailwind-design-system` (`.claude/skills/tailwind-design-system/`).

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

**Data model** (owner confirmed 2026-11-01; `object_id` added after the cross check). The migration is `provider_onboarding`,
one file. CI greps migrations, so the phrase `create table` stays out of its comments.

`providers`, one row per provider, created with the profile. Customers never read this table:

| Column | Type | Rules |
| --- | --- | --- |
| `id` | uuid PK | FK `profiles(id)` on delete restrict |
| `region` | text not null | FK `regions(code)`, copied from the profile |
| `status` | text not null | Default `draft`. Check in `draft`, `pending`, `approved`, `rejected`, `suspended` |
| `entity_type` | text null | Check in `individual`, `company`. Null until step 1 is saved |
| `legal_name` | text null | 2 to 200 after trim |
| `tax_number` | text collate "C" null | D16 style check, literal: `(region = 'TR' and tax_number ~ '^[0-9]{10}$') or (region = 'KSA' and tax_number ~ '^[0-9]{15}$')` |
| `review_reason` | text null | Check in `first_submission`, `resubmitted`, `document_replaced`, `name_changed`, `company_changed` |
| `rejection_code` | text null | Same six codes as documents. Optional |
| `rejection_note` | text null | Up to 300 |
| `suspension_reason` | text null | 5 to 500 |
| `submitted_at` | timestamptz null | Reset on every entry to `pending` |
| `decided_at` | timestamptz null | Set by a decision, a suspension and a lift |
| `decided_by` | uuid null | No FK, history outlives users |
| `approved_at` | timestamptz null | First approval, never cleared |
| `approved_name` | text null | `profiles.full_name` at the latest approval, set by `decide_provider`. Admin only, like the rest of this table |
| `created_at`, `updated_at` | timestamptz not null | `updated_at` is the version `decide_provider` compares. A verdict does not touch it |

Checks: a company has `legal_name` and `tax_number`; anything else has neither. Indexes on `(status, submitted_at, id)`,
`(status, decided_at, id)` and `region`.

`provider_profiles`, one row per provider, the only table customers will read (position 06 adds that policy):

| Column | Type | Rules |
| --- | --- | --- |
| `provider_id` | uuid PK | FK `providers(id)` on delete restrict |
| `region` | text not null | FK `regions(code)` |
| `bio` | text not null | 30 to 600 after trim |
| `years_experience` | smallint not null | 0 to 60 |
| `languages` | text[] not null | At least one, subset of `tr`, `ar`, `en` |
| `created_at`, `updated_at` | timestamptz not null | |

`provider_documents`, one row per file, replaced in place:

| Column | Type | Rules |
| --- | --- | --- |
| `id` | uuid PK | |
| `provider_id` | uuid not null | FK `providers(id)` on delete restrict. Unique with `type` |
| `region` | text not null | FK `regions(code)`. Index |
| `type` | text not null | Check in `profile_photo`, `id_front`, `id_back`, `selfie`, `criminal_record`, `skill_certificate` |
| `storage_path` | text collate "C" not null | Unique. The bucket follows from `type` |
| `object_id` | uuid not null | `storage.objects.id`, new at each creation. Verdicts and views compare this, because a path can be used twice |
| `mime_type` | text not null | From `storage.objects` |
| `size_bytes` | bigint not null | From `storage.objects` |
| `status` | text not null | Default `pending`. Check in `pending`, `approved`, `rejected` |
| `rejection_code` | text null | The six codes. Required when `rejected` |
| `rejection_note` | text null | Up to 300 |
| `valid_until` | date null | ID and criminal record only, set by admin |
| `reviewed_by` | uuid null | No FK |
| `reviewed_at` | timestamptz null | |
| `uploaded_at` | timestamptz not null | |

New `platform_settings` keys per region: `criminal_record_required` (`true`, C21; edited on the settings page when it lands,
SQL until then), `provider_docs_consent_version` (`"provider-docs-draft-1"`). The consent reuses `terms_acceptances`, whose
uniqueness on user and version already fits.

**Buckets**, created in the migration:

| Bucket | Public | Size | Types | Paths |
| --- | --- | --- | --- | --- |
| `provider-documents` | no | 10 MB | `image/jpeg`, `image/png`, `application/pdf` | `{id}/{id_front, id_back, selfie}/{uuid}.{jpg, png}`, `{id}/{criminal_record, skill_certificate}/{uuid}.{jpg, png, pdf}` |
| `provider-photos` | no | 2 MB | `image/jpeg` | `{id}/profile_photo/{uuid}.jpg` |

**Policies on `storage.objects`**, each limited to these two buckets: insert to `authenticated` with
`provider_may_store(bucket_id, name)`; select to `authenticated` where the first folder is `auth.uid()`; select to
`authenticated` with `admin_may_read(id, name)`; delete to `authenticated` where the first folder is `auth.uid()` and no
`provider_documents` row has that path. No update policy.

**Database functions** (each revokes `PUBLIC`, pins `search_path`, passes `supabase/tests/02`):

| Function | Kind | Executable by | Job |
| --- | --- | --- | --- |
| `is_admin()` | definer, stable | `authenticated` | `profiles.role` of `auth.uid()`. Policies wrap it in a subselect, so it runs once per query |
| `admin_may_read(p_object_id, p_name)` | definer, stable | `authenticated` | AC-22: `is_admin()` and a `document.viewed` row by this admin for this object id and this path in the last 2 minutes |
| `provider_row()` | definer, trigger | none | After insert on `profiles`, role `provider`: creates the `draft` row. The migration backfills existing providers |
| `provider_name_changed()` | definer, trigger | none | After update of `full_name` on `profiles`, when old and new differ: AC-12. Touches `providers.updated_at` |
| `has_contact_info(text)` | invoker, immutable | none | AC-3. Only definer functions call it, so nobody can probe it through the API |
| `provider_required_types(p_region)` | invoker, stable | `authenticated` | AC-20 |
| `provider_standing(p_provider_id)` | invoker, stable | `authenticated` | AC-20. Null for a row the caller cannot read |
| `provider_can_apply(p_provider_id)` | invoker, stable | `authenticated` | AC-20 |
| `provider_may_store(p_bucket, p_name)` | definer, stable | `authenticated`, provider inside | AC-22. Identity from `auth.uid()` only, never from the path. False with no `providers` row, so it never reads "not suspended" as yes for a customer. Storage runs it twice per upload |
| `save_provider_profile(p_entity_type, p_legal_name, p_tax_number, p_bio, p_years, p_languages)` | definer | `authenticated`, provider inside | AC-2, AC-3, AC-12, AC-21. Touches `providers.updated_at` |
| `accept_provider_docs_consent(p_locale)` | definer | `authenticated`, provider inside | AC-6, AC-21 |
| `register_provider_document(p_type, p_path)` | definer | `authenticated`, provider inside | AC-7, AC-8, AC-12, AC-21. Locks the provider row first. Returns the row and `previous_path` |
| `submit_provider_file()` | definer | `authenticated`, provider inside | AC-9, AC-21. Returns `{ status, missing }` |
| `review_provider_documents(p_provider_id, p_ids, p_object_ids, p_verdict, p_code, p_note, p_valid_until)` | definer | `authenticated`, admin inside | AC-17 |
| `decide_provider(p_provider_id, p_decision, p_seen_updated_at, p_code, p_note)` | definer | `authenticated`, admin inside | AC-18. Sets `approved_name` |
| `suspend_provider(p_provider_id, p_reason)`, `reinstate_provider(p_provider_id)` | definer | `authenticated`, admin inside | AC-19 |
| `log_document_view(p_document_id, p_object_id)` | definer | `authenticated`, admin inside | AC-16. Returns bucket and path |

Grants (D77): `select` on the three tables to `authenticated`, `service_role`. Nothing else.

**State transitions**:

| From | To | Trigger | Who |
| --- | --- | --- | --- |
| none | `draft` | Profile created with role provider | Database |
| `draft`, `rejected` | `pending` | `submit_provider_file` | Provider |
| `pending` | `approved` | `decide_provider` | Admin |
| `pending` | `rejected` | `decide_provider` | Admin |
| `approved` | `pending` | Document or photo registered, name changed, or entity type, legal name or tax number changed | Provider, through the database |
| `approved` | `suspended` | `suspend_provider` | Admin |
| `suspended` | `approved` | `reinstate_provider` | Admin |

Document: `pending` to `approved` or `rejected` by admin, and back and forth while the file is `pending`; any state to
`pending` on replace; `approved` to `rejected` by the database for the other side of an expired ID (AC-8). The standing
`document_expired` is a reading of `valid_until`, not a stored state.

**Pages by standing**:

| Standing | `/provider/profile` | `/provider/profile/documents` | Send for review |
| --- | --- | --- | --- |
| `draft`, `rejected` | Step 1 form. Save goes to step 2 | Open | Shown |
| `pending` | Step 1 form. Save stays on the page | Open. Replace keeps `pending` | Hidden |
| `approved`, `document_expired` | `p7`. `?edit=1` opens the form, and Save returns to `p7` | Open. Replace behind `ConfirmDialog` | Hidden |
| `suspended` | `p7`, read only. `?edit=1` is ignored | Read only | Hidden |

**Status chip**, one `StatusChip` (D59 for the first three):

| Standing | Label (from the catalogue) | Token |
| --- | --- | --- |
| `pending` | «قيد المراجعة», under review | `bg-warning-light` |
| `approved` | «معتمد», approved | `bg-warning-light` |
| `rejected` | «مرفوض», rejected | `bg-error-light` |
| `suspended` | «موقوف», suspended | `bg-error-light` |
| `document_expired` | «انتهت صلاحية مستند», document expired | `bg-error-light` |
| `draft` | Incomplete | `bg-surface-secondary` |

**Reject chips**, offered per type. The database checks only that a code is one of the six:

| Chip | Offered on |
| --- | --- |
| `document_unclear` | Every type |
| `selfie_mismatch` | `selfie` |
| `criminal_record_invalid` | `criminal_record` |
| `document_expired` | `id_front`, `id_back`, `criminal_record`, `skill_certificate` |
| `name_mismatch` | `id_front`, `id_back`, `criminal_record`, `skill_certificate` |
| `photo_not_suitable` | `profile_photo` |

**Routes**:

| Path | Group | Who | Notes |
| --- | --- | --- | --- |
| `/{locale}/provider` | `(provider)` | provider | AC-10 |
| `/{locale}/provider/profile` | `(provider)` | provider | Step 1 or `p7`, by standing |
| `/{locale}/provider/profile/documents` | `(provider)` | provider | Step 2 |
| `/{locale}/admin/providers` | `(admin)` | admin | `?tab=`, `?sort=`, `?page=`, each validated |
| `/{locale}/admin/providers/[id]` | `(admin)` | admin | Same query, for the queue beside the file |

**API surface**:

| Name | Kind | Key inputs | Key outputs | Auth | Key errors |
| --- | --- | --- | --- | --- | --- |
| `saveProviderProfile` in `actions/provider.ts` | Server Action | entity fields, `bio`, `years`, `languages` | `backToReview` | `['provider']` | `validation_failed`, `contact_info_in_bio`, `provider_suspended` |
| `acceptDocsConsent` | Server Action | none | ok | `['provider']` | `provider_suspended` |
| `uploadProviderFile` in `lib/storage/client.ts` | Browser to Storage | `type`, `File` | `path` | session | `file_too_large`, `file_type_refused`, `upload_refused`, `network` |
| `registerDocument` | Server Action | `type`, `path` | document row | `['provider']` | `file_missing`, `file_type_refused`, `provider_suspended` |
| `submitProviderFile` | Server Action | none | `status`, `missing` | `['provider']` | `file_incomplete`, `file_missing`, `provider_suspended` |
| `reviewDocuments` in `actions/admin-providers.ts` | Server Action | `providerId`, `ids`, `objectIds`, `verdict`, `code`, `note`, `validUntil` | ok | `['admin']` | `not_under_review`, `stale_document`, `view_required`, `valid_until_required`, `valid_until_invalid`, `reason_required` |
| `decideProvider` | Server Action | `providerId`, `decision`, `seenUpdatedAt`, `code`, `note` | `status` | `['admin']` | `not_under_review`, `documents_not_reviewed`, `reason_required`, `stale_profile`, `file_missing` |
| `suspendProvider`, `reinstateProvider` | Server Action | `providerId`, `reason` | `status` | `['admin']` | `not_approved`, `not_suspended`, `validation_failed` |
| `showDocument` | Server Action | `documentId`, `objectId` | signed link | `['admin']` | `stale_document`, `file_missing` |
| `updateAccount` (exists) | Server Action | `fullName` | `done`, `backToReview` | any role | adds `provider_suspended` |

`lib/storage/` is the new door: `buckets.ts` (names, limits, `SIGNED_LINK_SECONDS = 60`), `client.ts` (byte check, downscale,
upload), `server.ts` (`signedLink`, `removeOld`). `lib/provider/` holds server queries, the Zod schemas and the option lists.
Browser code imports no Zod (D106): forms do plain checks, and the action and database decide. Actions map the stable codes
the functions raise, as `actions/onboarding.ts` does, and a mapped code reaches no Sentry report.

**Value sourcing**:

| Action | Value | Source |
| --- | --- | --- |
| Step 1 | Full name | `profiles.full_name` |
| Step 1 | Language list | `PROVIDER_LANGUAGES` in `lib/provider/options.ts` (owner, 2026-11-01). A test proves it equals the check |
| Step 1 | Checked chip | The field equals the saved `bio` |
| Any write | Region | `profiles.region`, read inside the function. Never from the client |
| Step 2 | Which cards | `provider_required_types(region)` plus the optional certificate |
| Step 2 | Consent text | `Provider.documents.consent`, `[draft] ` until S16 |
| Consent | Version | `platform_settings (region, 'provider_docs_consent_version')`, read inside the function |
| Consent | Locale | `getLocale()` |
| Upload | Object path | `lib/storage/client.ts`: the user id from the page, `crypto.randomUUID()`. `provider_may_store` checks the shape |
| Upload | Real file type | The file's first bytes, read in the browser |
| Register | Object id, size, type | `storage.objects`, inside the function |
| `FileProgress` | Rows | Phone (always done), profile (profile row and photo row), ID (both sides), selfie, criminal record when required |
| `FileProgress` | Done, percent | A row exists and is not `rejected`. `floor(done / total * 100)` |
| Header chip | Standing | `provider_standing()`, once per request in the provider layout |
| Status page | Reason text | `Provider.rejection.{code}`; `rejection_note` and `suspension_reason` as written |
| Status page | Two working days | Catalogue (owner, 2026-11-01) |
| `/account` | Warn before rename | `provider_standing()`, read by the account page |
| Step 1 | Warn before a company change | The standing from the layout, and the form's fields against the saved row |
| `p7` | Member since | Year of `providers.approved_at` |
| `p7` | Security checked | `criminal_record` row `approved` |
| Photo | Signed link | `signedLink` in the server render, 300 seconds |
| Rail | Count | `providers` where `status = 'pending'`, through RLS |
| File | Masked phone | Last four of `profiles.phone`, masked on the server before any Client Component |
| File | Approved and current name | `providers.approved_name`, and `profiles.full_name` |
| File | Version seen | `providers.updated_at`, rendered with the page, sent back unchanged as a string |
| Verdict | Today | `current_date` in the database. UTC, up to three hours off Turkey, accepted |
| Admin check | Is admin | `public.is_admin()` |

**Key invariants**:
- A customer never reads a document, a tax number or a phone from this position (rule 2).
- `approved` means every required document was `approved` at that moment, seen by a named admin, with audit rows.
- An admin cannot read a file without leaving a row.
- A provider cannot change `status`, a verdict, `valid_until` or a reviewer by any path. The one verdict their action can cause is the
  database's own rejection of an expired ID side (AC-8), which can never approve anything.
- Every `provider_documents` row points at a real object this provider owns, checked at register, submit and approve.
- No bucket is public. No service role in a request path.
- The ID number is never stored.
- `has_contact_info` is the only scanner: there is no second copy to keep equal.
- Replacing a file deletes the old one: admin has no history of replaced files, only the audit rows.

**Security model**: compliance scope is KVKK. A selfie and a criminal record are special categories (S16), a phone and a name are
personal data. The threat model is a signed in provider, and an admin, with their own token calling `/rest/v1` and `/storage/v1`
directly, so every rule above sits in Postgres. A provider reads only their own file. Admins are global (D15), trusted but recorded:
every read of a document needs a fresh audit row, which Storage itself checks. The first bytes are checked in the browser, for
honest mistakes. A hostile client can skip that, and the bucket checks only the declared type, so this overrides the letter of
`architecture.md` §14: the server has no way to read the bytes that a hostile client could not also avoid. The worst result is a
useless file in their own private folder, which admin rejects. Files are served from the Supabase origin, never ours, so a file
cannot run on our origin. A signed link works for anyone holding it for 60 seconds, so it is never logged, never in a URL of
ours, and never sent to telemetry. Replay blocks all media already (`blockAllMedia`). Admin two step login ships in 21 (D96).

**Differences from the design, on purpose**:

| Screen | Left out or changed | Why |
| --- | --- | --- |
| `p2` | Past work photos; work type is individual or company chips, not text; `p4` removed, so two steps; the gate line says "these steps" | Owner 2026-11-01; D9 |
| `p3` | "Number ends in 4821" (valid until only); "Next" becomes "Send for review"; the optional certificate joins | No ID number; `p4` moved; `a1` draws it |
| `p5` | Blurred requests, the while you wait panel, the SMS promise | 05; no such features; D97 |
| `p7` | Metrics, services, past work, ratings, customer preview, the bank card | 19, 05, 17, 06; D87 |
| `p14` | The confirmed jobs panel | No jobs before 10 |
| `app-03` | Thumbnails become Show, and Match opens after it; region switch and console search; reject chips sit on each document | View audit; one live region; owner 2026-11-01 |
| `a1` | Lifecycle bar, metrics, ratings, bank row, the founding, legacy, invitation and edit actions | 19, 17, D87 |

**Failure handling**:
- Upload fails or the tab closes: the row is unchanged. An unregistered object is swept at the next upload of that type.
- At 20 counted objects Storage refuses, and the message offers the support link. With replacement deleting at once, an honest user does
  not reach this. An orphan stops counting after 24 hours, so failed registers block nobody for longer than a day. A script can still
  leave 20 orphans a day in its own private folder, until the job in 21 sweeps them. The cap counts inside the policy, so parallel uploads
  can pass it slightly; it stops a storage attack, not one extra file.
- A provider replaces a file while admin reads it: Show and the verdict both get `stale_document`, because the `object_id` changed.
- A name, legal name or bio changes after admin loads the page: Approve gets `stale_profile`, and the page reloads.
- A provider and an admin act at once: both functions lock the provider row, so one waits, and the checks run on what is true then.
- Two admins decide: the second gets the state as it stands, with no second audit row.
- A second tab uploads while the first registers: the sweep keeps anything newer than the registered object.
- A suspended provider's document expires: lifting gives `document_expired`, not a working account.
- Storage down: upload shows an error and nothing changes. The review page still loads, and Show says the file cannot be shown.
- A signed link expires before the image loads: Show again.
- HEIC from a desktop: the file input does not list it. iOS converts to JPEG on pick. A browser that cannot decode the image shows the
  plain "use another photo" message.

**Configuration required**: no new variable, and no seed file. Local only: new numbers in `[auth.sms.test_otp]`. `e2e/numbers.ts` pads
its last part to two digits (the same strings for 1 to 9), because `testPhone` would build 11 digits past 9. A local stack started
before this change must be restarted, so `storage-api` comes up.

**Critical test scenarios**:
- Happy path: the whole AC-28 journey in three locales, verifies **AC-1**, **AC-5**, **AC-7**, **AC-9**, **AC-10**, **AC-17**, **AC-18**.
- Failure: a bio with a spelled phone number in Turkish is refused through the form and through a direct RPC call, verifies **AC-3**.
- Failure: a provider replaces a file, and reuses the old path, between admin opening it and marking match, verifies **AC-16**, **AC-17**.
- Failure: a rename between admin loading the page and clicking Approve, verifies **AC-18**.
- Race: two sessions decide the same file; a registered document races an approval, verifies **AC-18**, **AC-23**.
- Permission: a second provider, a customer and anon are each denied each table and each object; a provider calling `decide_provider`
  gets `forbidden`, verifies **AC-21**, **AC-22**.
- Permission: a provider with a real token deletes a current file through Storage and is refused; an admin token with no view row reads
  nothing, verifies **AC-22**, **AC-29**.
- Permission: a customer and an admin each call every provider function and get `forbidden`; `provider_may_store` is false for both, even
  with a `terms_acceptances` row, verifies **AC-21**, **AC-22**.
- Permission: an admin holds a fresh view row, the provider replaces the file and reuses the path, and the admin's direct read of the new
  object is refused, verifies **AC-22**.
- Limit: 20 orphans older than 24 hours do not block an upload, 20 fresh orphans do, verifies **AC-22**.
- Permission: pgTAP proves deletes with `SET LOCAL storage.allow_delete_query = 'true'` and asserts surviving rows, because
  `storage.protect_delete()` refuses every SQL delete without it and a hidden row raises no error, verifies **AC-22**.
- Expiry: a required document with a past `valid_until` gives `document_expired` and `provider_can_apply` false, verifies **AC-20**.
- Expiry: an approved provider with an expired ID replaces one side. The other side is `rejected` with `document_expired`, stays so when the
  first side is replaced again, and Approve stays closed until it is replaced, verifies **AC-8**, **AC-18**.
- Back to review: an approved provider changes the tax number through a direct call that skips the dialog, and lands in `pending` with
  `company_changed`, verifies **AC-12**.
- Telemetry: no name, signed link or object name in any captured payload, verifies **AC-24**.

## Build plan

Tracer bullet, tests first on every access rule and door. One pull request, `feat/02-provider-onboarding`. The thin thread is tasks 1 to
9 (a provider gets approved); the rest thickens it.

1. `lib/storage` door rule and its proof; `scrubUrl` cuts Storage URLs, with tests; `scripts/e2e.mjs` keeps `storage-api`; satisfies
   **AC-24**, **AC-26**, **AC-28**.
2. Tests first, then the migration: tables, RLS, grants, buckets, Storage policies, every function and trigger, settings seeds, the backfill;
   pgTAP files `07_provider_onboarding` (rules, corpus, races by state) and `08_storage` (the meta guards); `npm run db:types`; satisfies **AC-2**,
   **AC-3**, **AC-20** to **AC-23**, **AC-26**.
3. `e2e/numbers.ts`, test numbers, fixture files (no real person), the per project admin; satisfies **AC-28**.
4. `lib/storage/`, `lib/provider/`, the CSP line, the two log events; record real Storage error responses for the code map; satisfies
   **AC-7**, **AC-8**, **AC-24**, **AC-25**.
5. Read the frames from the live project (see Prerequisites). Shared pieces: `FormField`, `ChoiceChips`, `ToggleChips`, `Stepper`, `StatusChip`,
   `ConfirmDialog`, `ErrorState`, a textarea, the provider header chip; satisfies **AC-27**.
6. Step 1: form, `saveProviderProfile`, `FileProgress`, photo upload; satisfies **AC-1**, **AC-2**, **AC-3**, **AC-4**.
7. Step 2: consent, `DocumentUpload`, `registerDocument`, replace, `submitProviderFile`; satisfies **AC-5** to **AC-9**.
8. `AdminShell`, `AdminRail`, the menu row, `ProviderQueue`; satisfies **AC-13**, **AC-14**.
9. The review page, `showDocument`, `reviewDocuments`, `decideProvider`; satisfies **AC-15** to **AC-18**.
10. `/provider` by standing, `AccountStateBanner`, `p7`; satisfies **AC-10**, **AC-11**, **AC-20**.
11. Back to review and suspend: the `/account` dialog and its code, `a2`; satisfies **AC-12**, **AC-19**.
12. Events, catalogues, the `[tr]` count, the screen pass, `[draft]` covered by the launch gate; satisfies **AC-24**, **AC-27**.
13. e2e journeys and axe; satisfies **AC-28**.
14. Owner: dry run, then push the migration. Stop rule: if the cloud refuses the buckets or the policies on `storage.objects`, stop and return to
    `/architect`. Then the guard query against the cloud, the real calls of `verify.md`, `/check verify`, `slice-reviewer`, `security-reviewer`,
    `/check review` on another model, merge; satisfies **AC-25**, **AC-26**, **AC-29**.

Docs in the same change: `project-overview.md` §13, §17, §25 (statuses, documents, no ID number); `architecture.md` §4, §14 (the override), §42 (the
new door) and a position section that overrides `providers` and `provider_documents` as written in §13, §20, §23, including what stays in 19;
`ui-registry.md`; `ui-tokens.md` §4 (the three new chips); `docs/design/README.md` (`p4` moves to 05, `p7` and `a1` lose the bank rows); `library-docs.md`
(Storage facts, including the real error responses and `storage.protect_delete()`); `build-plan.md` (row 02 links this spec, row 05 gains `p4`); the
tracker's decision log, risks and owner steps.

## Consequences

**Positive**:
- 05 gets one call to answer who may apply, and a scanner it does not have to build.
- A direct API call meets the same rules as the form, so the UI can stay plain.
- No new dependency, no new secret, no service role in a request path, no scheduled job.
- KSA later is a data change: the required list and every limit read the region's row.

**Negative / tradeoffs**:
- This is more than the one day the plan gives 02, and no buffer is left (R2). Expect about a day and a half, so 03 starts late unless something gives.
- 18 database functions, the scanner among them: harder to read than TypeScript, proven only by pgTAP.
- Replaced files are gone (owner's choice): if a provider swaps a forged ID for a clean one, no copy remains to show. Audit rows remain.
- A rejected file, or the file of a provider who never returns, stays until the job in 21. That job needs S16's period. A failed delete also leaves
  a replaced file there, with a log event.
- The byte check is a courtesy, as the security model says.
- Match needs Show first, one more click per document, on purpose.
- Replacing even the optional certificate stops new applications until reviewed. So does any change to entity type, legal name or tax number.
- Providers with no confirmed email learn the decision only by opening the site, until 13, and after it if they never give one. `p5`'s text changes for this.
- With no ID number there is no check for one person holding two accounts.
- With no search, a provider named in a complaint is hard to find past page 1 until 16.
- A better scanner later does not rescan stored bios.
- Storage grows past the Free plan's 1 GB at a few hundred providers. Pro lands at launch (D63).

**Neutral**:
- `/account` gains one dialog for approved providers, on a page from spec 0005, and `updateAccount` returns one more field.
- New tables decide admin through `is_admin()`, while the tables of 01 still read the token claim.
- `complete_onboarding` does not change: a trigger on `profiles` creates the row.
- `profile_photo` is a row in `provider_documents` but its file sits in its own bucket, so 06 can open photos without any rule touching IDs.
- Admin decisions fire events from the admin's browser, because the server side PostHog client arrives at 08 or 09 (D68).

## Follow-up

- [ ] Position 05: build `p4` as step 3 with `provider_zones`, services and availability; add the blurred requests of `p5`; the insert policy calls
      `provider_can_apply()`; messages call `has_contact_info()`. Its tests carry "a pending provider cannot apply".
- [ ] Position 06: a customer read policy on `provider_profiles`, and on `provider-photos` for approved providers; the display name; the verified badge.
- [ ] Position 13: notice 18 (approved or rejected) by email to a confirmed address.
- [ ] Position 16: console search; the `criminal_record_required` switch on the settings page.
- [ ] Position 19: the funnel stages beside `status`, the `a1` lifecycle bar, reminders before expiry, the acceptance rate, a rescan of stored bios when
      the scanner changes.
- [ ] Position 20: invoicing reads `legal_name` and `tax_number` (B9).
- [ ] Position 21: a job, with the service role, that deletes files of rejected and abandoned providers after the S16 period, and sweeps orphans;
      anonymising. STRIDE on file upload. Whether the tables of 01 move to `is_admin()`.
- [ ] Owner: `/design-login` before task 5; the S16 additions above.
- [ ] `/sync`: the `lib/storage` door row in `AGENTS.md`.
