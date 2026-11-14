# Verify: Provider onboarding and approval (02) · spec 0006

_Steps derived from the spec's acceptance criteria and its Value sourcing table. `/check verify` runs these; `/test` locks
the durable ones. A stub proves the SDK, never the handler, so the real call section stays manual on purpose. Never paste a
phone number, a signed link, a token, a tax number or a real person's file into this file. Test files only. A local stack
started before this position must be restarted, so `storage-api` comes up._

## Scanner corpus (AC-3): read this before the build

The pgTAP corpus. Every number below is made up. The owner reads this table before task 2: anything that should move, moves
here first.

**Must catch**

| Kind | Text |
| --- | --- |
| Phone | `0555 123 45 67` |
| Phone | `+90 555 123 4567` |
| Arabic Indic digits | `٠٥٥٥١٢٣٤٥٦٧` |
| Persian digits | `۰۵۵۵۱۲۳۴۵۶۷` |
| Split digits | `0 5 5 5 1 2 3 4 5 6 7` |
| Split digits | `0555.123.45.67` |
| Split digits | `0555-123-45-67` |
| Hidden characters | The first phone above with zero width spaces between digits |
| Wide separators | `0555 - 123 - 45 - 67`, `0555   123   4567`, `0555 x 123 x 4567`, `0555 / 123 / 4567` |
| Wide separators | `0 5 5 5 - 1 2 3 - 4 5 6 7` |
| Spelled, Turkish | `sıfır beş beş beş bir iki üç dört` |
| Spelled, Turkish with diacritics first | `üç dört beş altı sıfır`, `dört dört beş üç üç`, `altı yedi sekiz dokuz üç`, `ÜÇ DÖRT BEŞ ALTI SIFIR`, `beş üç dört üç dört beş üç` (ö and ç were crossed in the fold until 2026-11-14) |
| Spelled, English | `zero five five five one two three` |
| Spelled, Arabic | `صفر خمسة خمسة خمسة واحد اثنان ثلاثة` |
| Email | `ali@example.com` |
| Spelled email | `ali at example dot com` |
| Spelled email | `ali [at] example [dot] com` |
| Link | `https://example.com` |
| Link | `www.example.com` |
| Bare domain | `example.com`, `example.net`, `example.com.tr` |
| Short links | `wa.me/905551234567`, `t.me/ali` |
| Handle | `@ali_temizlik` |
| Brand, Latin | `WhatsApp`, `whatsapp'tan yaz`, `telegram`, `Instagram`, `insta` |
| Brand, Arabic | `واتساب`, `وتساب`, `تلجرام`, `تيليجرام`, `انستقرام`, `انستا` |

**Must pass**

| Language | Text |
| --- | --- |
| English | `6 years of experience in homes and villas` |
| English | `since 2019` |
| English | `5 rooms and 2 bathrooms` |
| English | `3 bedrooms, 2 bathrooms, 1 kitchen` |
| English | `I work Monday to Friday, 9 to 5.` |
| English | `Marble, parquet and glass: safe for children and pets.` |
| Turkish | `10 yıldır temizlik yapıyorum` |
| Turkish | `2019'dan beri evlerde çalışıyorum` |
| Turkish | `bir iki saatte biter` |
| Turkish | `Mutfak, banyo ve cam temizliği yaparım.` |
| Arabic | `خبرة 6 سنوات في تنظيف المنازل والفلل` |
| Arabic | `بدأت العمل عام 2019` |
| Arabic | `أعمل من 9 إلى 5` |
| English | `9 to 5, 10 years since 2015` (7 digits inside 22 characters: the row that set the window at 21) |
| English | `3 bedrooms, 2 bathrooms, 1 kitchen, 6 years since 2019` |

**Known false positives, accepted (D131):** the rule is 7 digits within any 21 characters, so more honest bios are refused
than under the old run rule: `2015-2020`, or several years and counts close together, such as `2015, 2018 and 2021`. The
provider rewrites them (`from 2015 to 2020`), and the message already says to remove numbers that look like a phone.

**Property checks (pgTAP, seeded):** a 10 digit number in groups of 4,3,3 or 3,3,2,2 or 4,3,2,2 with 1 to 5 characters
between groups is always flagged, and so is 1 to 2 characters between every digit. 1 to 3 characters between every digit can
span 25 characters, past the window, so it is not always caught; the owner was told.

**Known miss, accepted:** an email spelled in Turkish or Arabic words, such as `ali nokta example`. Admin reads every bio at review.

Bare domain endings: `com`, `net`, `org`, `info`, `io`, `co`, `me`, `app`, `tr`, `sa`.

## On the local stack

- [x] A new provider lands on step 1. Save with an empty form: each field says what is wrong, nothing is saved → AC-1, AC-2 · *proof: pgTAP 07 (each refusal), e2e*
- [x] Choose company: legal name and tax number appear and are required. 10 digits in Arabic Indic digits with spaces is · *proof: pgTAP 07 (Arabic Indic digits with a dash and spaces stored as 10 digits; 11 refused)*
      stored as 10 Western digits; 11 digits is refused → AC-2
- [x] The bio count matches the database on a string with an emoji → AC-1 · *proof: browser 2026-11-10: 78 in the form and `char_length(btrim(bio))` 78, with an emoji; `tests/provider-options.test.ts`*
- [x] Every row of the corpus, through a direct `save_provider_profile` call → AC-3 · *proof: pgTAP 07, both tables of the corpus, plus the accepted false positive and miss*
- [x] Save a clean bio: the checked chip shows, and goes when the text changes. Reload: the chip is back → AC-3 · *proof: browser 2026-11-11 (`tr`, 390): no chip while typing, chip after save, gone on an edit, back on revert and on reload*
- [x] Upload a photo from a phone sized JPEG with a rotation tag. The object in `provider-photos` is upright, JPEG, 1024 px at · *proof: 2026-11-11, a 4032x3024 test JPEG with orientation 6 and a GPS block: the stored object is JPEG, 768x1024, upright (marker band on top), no EXIF*
      most, with no EXIF → AC-4
- [x] Step 2: cards disabled until the tick is on. One `terms_acceptances` row with `provider-docs-draft-1`. Reload: still ticked. · *proof: e2e (inputs disabled until the tick), pgTAP 07 (one row, retry adds none)*
      A new version in `platform_settings`: asked again → AC-5, AC-6
- [x] Upload each document. Each row's object id, size and type match `storage.objects` → AC-7 · *proof: pgTAP 07; browser 2026-11-10, rows checked in the database*
- [x] Rename a text file to `.pdf` and upload: refused in the browser, no network call to Storage → AC-7 · *proof: browser 2026-11-10 (alert, zero Storage requests); e2e*
- [x] Register the same object twice: one row, no second audit row → AC-7 · *proof: pgTAP 07*
- [x] Replace a document: one row still, new path and `object_id`, `pending`, the old object gone, a `document.registered` row → AC-8 · *proof: pgTAP 07 (previous path and sweep returned, audit row); e2e*
- [x] Reject the ID, replace only the front: the back goes to `pending` → AC-8 · *proof: pgTAP 07 (twin rule)*
- [x] Approved with the ID's `valid_until` in the past: replace the front. The back becomes `rejected` with `document_expired`, one · *proof: pgTAP 07 (expiry block)*
      `document.reviewed` row, `reviewed_by` null; `/provider` and its card name it. Replace the front again: the back stays `rejected`.
      Approve stays closed. Replace the back: `pending`, and Approve opens after the verdicts → AC-8, AC-10, AC-18
- [x] Submit with one document missing: `file_incomplete`, and the card names it. Complete it and submit: `pending`, one audit row. · *proof: pgTAP 07 (missing, objectsMissing, one audit row)*
      Submit twice: no second row. Remove the object behind a row: `file_missing` → AC-9
- [x] `/provider` in each standing, by setting status in the local database: draft, pending, rejected, suspended, expired, approved. · *proof: browser 2026-11-11 (`tr`, 390): each page and chip label and token as the mapping; row deleted: `ErrorState` on all three pages, no chip*
      Delete the row: `ErrorState`, not draft. The header chip matches the mapping → AC-10
- [x] `/provider/profile` and step 2 in each standing behave as the table in Feature design says → AC-1, AC-5, AC-11 · *proof: browser 2026-11-11, all six standings. First run found `p7` saying "approved, you can apply" in `document_expired` (it read `file.status`); fixed the same day: it follows the standing, has its own `statusExpired` line, and drops the ID verified chip. Rechecked in `tr`*
- [x] Approved: replace a document: the dialog first, then `pending`, `document_replaced`. Change the bio: stays approved → AC-12 · *proof: e2e (dialog, then pending)*
- [x] Approved: change the tax number: the dialog first, then `pending`, `company_changed`, `submitted_at` reset, one · *proof: pgTAP 07 (direct call, same spelling no change, audit rows)*
      `provider.company_changed` row with old and new, one `provider.back_to_review` row. Cancel the dialog: nothing changes. Save the same
      value in another spelling (Arabic Indic digits, spaces): no change, no dialog. A direct `save_provider_profile` call skipping the dialog:
      the same result → AC-12
- [x] First save of the company fields: no `provider.company_changed` row → AC-12, AC-23 · *proof: pgTAP 07*
- [x] Approved: save `/account` with the name unchanged: no dialog, no status change. Change the name: the dialog, then `pending`, · *proof: browser and database 2026-11-11 (`tr`)*
      `name_changed`, `submitted_at` reset, the approved name in `provider.back_to_review`. Cancel the dialog: nothing changes → AC-12
- [x] Suspended: a rename shows the translated message, and no event reaches Sentry → AC-12 · *proof: pgTAP 07 (`provider_suspended` from the trigger); the action maps it*
- [x] As admin: the rail from `lg`, three tabs on a phone, the right count → AC-13 · *proof: browser 2026-11-11 (`tr`, `ar`, `en`): rail at 1280 (right side in `ar`), three tabs at 390, badge 4 = 4 `pending` rows*
- [x] Tabs, both sorts, page 2, an empty tab. `?tab=x&page=-1`: falls back, no error. A `draft` provider is in no tab → AC-14 · *proof: `tests/provider-options.test.ts` (fallbacks); e2e (approved tab, newest)*
- [x] Open a file: the phone shows its last four digits only. Page source and flight data hold no full phone → AC-15 · *proof: 2026-11-11, every HTML and flight response of a load, a reload and a client navigation searched*
- [x] After a rename, the file shows the approved name against the current one. Approved as A, replace a document, rename to B while · *proof: browser 2026-11-11 (`tr`), all three cases*
      `pending`: the file still shows A against B. Two renames: the name of the last approval, not the one in between → AC-15
- [x] No request for any file before Show. Show: one `document.viewed` row. Open the link after 60 seconds: refused → AC-16 · *proof: 2026-11-11: no Storage request on load, one row per Show, the link answers 400 `InvalidJWT` after expiry*
- [ ] A PDF opens in a new tab in Safari → AC-16 · *blocked 2026-11-11: no Safari on this machine*
- [x] Match before Show: `view_required`. Match on the ID with no date refused, with a past date and a date 16 years ahead refused. · *proof: pgTAP 07 (every case)*
      One click marks both sides. A date on the selfie refused. Reject with no chip refused. The chips differ by type → AC-17
- [x] Replace the file in another session, then Show and mark it: `stale_document`. Reuse the old path with new bytes and register: · *proof: pgTAP 07 (old path reused with new bytes)*
      still `stale_document` → AC-16, AC-17
- [x] Approve closed until every required document is matched, photo included. A rejected required document opens Reject. A file note · *proof: pgTAP 07 (two admins, one audit row); e2e*
      opens Reject with every document matched. Two tabs, both approve: one audit row → AC-18
- [x] Load the file, rename in another session, click Approve: `stale_profile`. A pending certificate does not block → AC-18 · *proof: pgTAP 07 (`stale_profile`; pending certificate does not block)*
- [x] Suspend with no reason refused. Suspended: upload, save and submit refused. Lift: back to approved, reason cleared → AC-19 · *proof: pgTAP 07; e2e (suspend and lift journey)*
- [x] Set a required document's `valid_until` to yesterday: `document_expired`, `provider_can_apply` false → AC-20 · *proof: pgTAP 07*
- [x] Delete the `criminal_record_required` row: the record is required → AC-20 · *proof: pgTAP 07*
- [x] pgTAP: a customer and an admin get `forbidden` from each provider function, and `provider_may_store` is false for both, even with a · *proof: pgTAP 07*
      `terms_acceptances` row → AC-21, AC-22
- [x] pgTAP: 20 orphans older than 24 hours do not block an upload; 20 fresh orphans do → AC-22 · *proof: pgTAP 07*
- [x] pgTAP: `07`, `08` and every older file pass; `npm run verify` is green → AC-21, AC-22, AC-26 · *proof: 2026-11-10: 416/416 on a fresh reset; `npm run verify` green (746 unit)*
- [x] Each audit action of AC-23 appears once for its action → AC-23 · *proof: pgTAP 07*
- [x] Captured PostHog and Sentry payloads for the journey: no name, phone, bio, tax number, signed link or object name → AC-24 · *proof: 2026-11-11, every `/api/e` and `/api/a` body of a full provider journey (company, refused bio, refused file) and an admin Show and reject, decoded and searched: none. Browser payloads only; server SDK events were not captured*
- [x] No CSP violation in stable Chrome on step 1, step 2 and the review page → AC-25 · *proof: e2e main journey asserts none (Playwright Chromium, three locales)*
- [x] 360, 390, 430, 1280 px, `tr` first, then `ar`, then `en`, with no overflow on Turkish strings → AC-27 · *proof: visual pass 2026-11-11 in all three locales. It found a 9 px sideways scroll on the admin file page at 360 in `ar` and `en` (a one word name did not wrap); fixed with `break-words` on the name, rechecked at the four widths in all three locales. The e2e check now compares `scrollWidth` with `clientWidth` (it used `innerWidth`, which counts the scrollbar and hid it); the onboarding spec passes in `ar`, `en` and `tr` with it*
- [x] `npm run test:e2e` with the database → AC-28 · *proof: 2026-11-10: 94 passed, 8 skipped (the existing single locale skips)*

## Real Storage responses, for the code map

Record status and error for each, from real calls: file over the limit, wrong declared type, no policy, object already there,
`remove()` on an object the policy hides.

Recorded 2026-11-10 on the local stack (`context/library-docs.md` holds the detail). HTTP is 400 for every refusal; the body:

- [x] File over the limit → `statusCode: "413"`, `EntityTooLarge`
- [x] Wrong declared type → `statusCode: "415"`, `InvalidMimeType`
- [x] No policy (no consent, another folder) → `statusCode: "403"`, `AccessDenied`, "new row violates row-level security policy"
- [x] Object already there (upsert off) → `statusCode: "409"`, `KeyAlreadyExists`
- [x] `remove()` on an object the policy hides → 200 with `[]` (no error); on an own orphan → 200 with the object
- [x] Signing an object the caller cannot select → `statusCode: "404"`, `NoSuchKey`
- [x] A PDF Blob with an empty type → refused as `invalid_mime_type` until `uploadProviderFile` rewrapped the body with its type (fixed)

## Real calls (a preview on the shared cloud project, after the migration push)

- [x] Cloud accepted the buckets and the policies on `storage.objects`; advisors clean → AC-22 · *proof: 2026-11-10 after the owner's push, read only: migration listed, both buckets private, four policies; the security advisors list only the intended definer RPCs (the same class as `complete_onboarding`)*
- [x] The AC-26 guard query against the cloud: no public bucket, no policy without a bucket, none granted to `anon` or `public` → AC-26 · *proof: 2026-11-10, all three guards empty on the cloud*
- [x] After the push of `20261114090000` (2026-11-15, read only): 8 migrations in the cloud; no public bucket; every `storage.objects` policy opens with its bucket list; none granted to `anon` or `public`; no policy reads `app_metadata`; both bucket triggers (`provider_files_guard` on insert, `provider_files_guard_update` on update) present and enabled; the new bodies of `has_contact_info`, `contact_normalise`, `provider_store_allowed` and `register_provider_document` live. Security advisors: only the intended definer RPCs, as on 2026-11-10 → AC-22, AC-26
- [ ] A real camera photo from iPhone Safari uploads as JPEG and shows for admin, with `camera=()` in place. Note any problem with
      the selfie capture → AC-5, AC-29
- [ ] The same from Android Chrome, and a PDF from Android → AC-7, AC-29
- [ ] A real PDF, as e-Devlet issues it, passes the byte check and opens in a new tab → AC-7, AC-29
- [ ] A file over 10 MB and a renamed `.exe` are refused with their messages → AC-29
- [ ] With a real provider token and the public key only, each refused → AC-22, AC-29:
      - read another provider's object, directly and by signing a link
      - overwrite their own object
      - delete their own current file
      - upload a document with no consent row
      - upload into another provider's folder
      - `POST /rest/v1/rpc/decide_provider`
      - `PATCH /rest/v1/providers` to set `status`
- [ ] With a real admin token and no view row: signing a link to an object is refused → AC-22, AC-29
- [ ] With a real admin token and a fresh view row for a replaced file: reading a new object at the reused path is refused → AC-22, AC-29
- [ ] With a real customer token and a real admin token, each refused: `accept_provider_docs_consent`, `register_provider_document`, an
      upload to each bucket → AC-21, AC-22, AC-29
- [ ] No CSP violation on the preview in stable Chrome, on the review page with an image shown → AC-25
