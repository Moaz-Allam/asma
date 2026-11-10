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
| Spelled, Turkish | `sıfır beş beş beş bir iki üç dört` |
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

**Known false positive, accepted:** `2015-2020` is 8 digits with a one character gap, so it is refused. The provider writes
`from 2015 to 2020`, and the message says to remove numbers that look like a phone.

**Known miss, accepted:** an email spelled in Turkish or Arabic words, such as `ali nokta example`. Admin reads every bio at review.

Bare domain endings: `com`, `net`, `org`, `info`, `io`, `co`, `me`, `app`, `tr`, `sa`.

## On the local stack

- [ ] A new provider lands on step 1. Save with an empty form: each field says what is wrong, nothing is saved → AC-1, AC-2
- [ ] Choose company: legal name and tax number appear and are required. 10 digits in Arabic Indic digits with spaces is
      stored as 10 Western digits; 11 digits is refused → AC-2
- [ ] The bio count matches the database on a string with an emoji → AC-1
- [ ] Every row of the corpus, through a direct `save_provider_profile` call → AC-3
- [ ] Save a clean bio: the checked chip shows, and goes when the text changes. Reload: the chip is back → AC-3
- [ ] Upload a photo from a phone sized JPEG with a rotation tag. The object in `provider-photos` is upright, JPEG, 1024 px at
      most, with no EXIF → AC-4
- [ ] Step 2: cards disabled until the tick is on. One `terms_acceptances` row with `provider-docs-draft-1`. Reload: still ticked.
      A new version in `platform_settings`: asked again → AC-5, AC-6
- [ ] Upload each document. Each row's object id, size and type match `storage.objects` → AC-7
- [ ] Rename a text file to `.pdf` and upload: refused in the browser, no network call to Storage → AC-7
- [ ] Register the same object twice: one row, no second audit row → AC-7
- [ ] Replace a document: one row still, new path and `object_id`, `pending`, the old object gone, a `document.registered` row → AC-8
- [ ] Reject the ID, replace only the front: the back goes to `pending` → AC-8
- [ ] Approved with the ID's `valid_until` in the past: replace the front. The back becomes `rejected` with `document_expired`, one
      `document.reviewed` row, `reviewed_by` null; `/provider` and its card name it. Replace the front again: the back stays `rejected`.
      Approve stays closed. Replace the back: `pending`, and Approve opens after the verdicts → AC-8, AC-10, AC-18
- [ ] Submit with one document missing: `file_incomplete`, and the card names it. Complete it and submit: `pending`, one audit row.
      Submit twice: no second row. Remove the object behind a row: `file_missing` → AC-9
- [ ] `/provider` in each standing, by setting status in the local database: draft, pending, rejected, suspended, expired, approved.
      Delete the row: `ErrorState`, not draft. The header chip matches the mapping → AC-10
- [ ] `/provider/profile` and step 2 in each standing behave as the table in Feature design says → AC-1, AC-5, AC-11
- [ ] Approved: replace a document: the dialog first, then `pending`, `document_replaced`. Change the bio: stays approved → AC-12
- [ ] Approved: change the tax number: the dialog first, then `pending`, `company_changed`, `submitted_at` reset, one
      `provider.company_changed` row with old and new, one `provider.back_to_review` row. Cancel the dialog: nothing changes. Save the same
      value in another spelling (Arabic Indic digits, spaces): no change, no dialog. A direct `save_provider_profile` call skipping the dialog:
      the same result → AC-12
- [ ] First save of the company fields: no `provider.company_changed` row → AC-12, AC-23
- [ ] Approved: save `/account` with the name unchanged: no dialog, no status change. Change the name: the dialog, then `pending`,
      `name_changed`, `submitted_at` reset, the approved name in `provider.back_to_review`. Cancel the dialog: nothing changes → AC-12
- [ ] Suspended: a rename shows the translated message, and no event reaches Sentry → AC-12
- [ ] As admin: the rail from `lg`, three tabs on a phone, the right count → AC-13
- [ ] Tabs, both sorts, page 2, an empty tab. `?tab=x&page=-1`: falls back, no error. A `draft` provider is in no tab → AC-14
- [ ] Open a file: the phone shows its last four digits only. Page source and flight data hold no full phone → AC-15
- [ ] After a rename, the file shows the approved name against the current one. Approved as A, replace a document, rename to B while
      `pending`: the file still shows A against B. Two renames: the name of the last approval, not the one in between → AC-15
- [ ] No request for any file before Show. Show: one `document.viewed` row. Open the link after 60 seconds: refused → AC-16
- [ ] A PDF opens in a new tab in Safari → AC-16
- [ ] Match before Show: `view_required`. Match on the ID with no date refused, with a past date and a date 16 years ahead refused.
      One click marks both sides. A date on the selfie refused. Reject with no chip refused. The chips differ by type → AC-17
- [ ] Replace the file in another session, then Show and mark it: `stale_document`. Reuse the old path with new bytes and register:
      still `stale_document` → AC-16, AC-17
- [ ] Approve closed until every required document is matched, photo included. A rejected required document opens Reject. A file note
      opens Reject with every document matched. Two tabs, both approve: one audit row → AC-18
- [ ] Load the file, rename in another session, click Approve: `stale_profile`. A pending certificate does not block → AC-18
- [ ] Suspend with no reason refused. Suspended: upload, save and submit refused. Lift: back to approved, reason cleared → AC-19
- [ ] Set a required document's `valid_until` to yesterday: `document_expired`, `provider_can_apply` false → AC-20
- [ ] Delete the `criminal_record_required` row: the record is required → AC-20
- [ ] pgTAP: a customer and an admin get `forbidden` from each provider function, and `provider_may_store` is false for both, even with a
      `terms_acceptances` row → AC-21, AC-22
- [ ] pgTAP: 20 orphans older than 24 hours do not block an upload; 20 fresh orphans do → AC-22
- [ ] pgTAP: `07`, `08` and every older file pass; `npm run verify` is green → AC-21, AC-22, AC-26
- [ ] Each audit action of AC-23 appears once for its action → AC-23
- [ ] Captured PostHog and Sentry payloads for the journey: no name, phone, bio, tax number, signed link or object name → AC-24
- [ ] No CSP violation in stable Chrome on step 1, step 2 and the review page → AC-25
- [ ] 360, 390, 430, 1280 px, `tr` first, then `ar`, then `en`, with no overflow on Turkish strings → AC-27
- [ ] `npm run test:e2e` with the database → AC-28

## Real Storage responses, for the code map

Record status and error for each, from real calls: file over the limit, wrong declared type, no policy, object already there,
`remove()` on an object the policy hides.

## Real calls (a preview on the shared cloud project, after the migration push)

- [ ] Cloud accepted the buckets and the policies on `storage.objects`; advisors clean → AC-22
- [ ] The AC-26 guard query against the cloud: no public bucket, no policy without a bucket, none granted to `anon` or `public` → AC-26
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
