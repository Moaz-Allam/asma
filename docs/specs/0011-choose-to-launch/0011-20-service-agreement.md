# 0011-20. Service agreement PDF (position 20, P1)

Child of [0011](index.md). Follows the cross child contract there. **Touches both payment paths (09, 10), the reveal
(10), the relay and its mail lane (08, 13), Storage, and personal data (both parties' names, phones and the job's street
line): a migration (three tables, a bucket, functions), `lib/agreements`, the relay, `lib/email`, `lib/storage`, five
surfaces.** Built after [0011-19b](0011-19b-application-answers.md) merged, on its own branch, before 21 (D218, D203).

> **Accepted 2026-11-23 by the owner (D222)**, after a Sonnet cross check (X-1 to X-15 applied, see *Cross check*).
> Written from the owner's picks in the `/architect 20` interview (each the recommended option) on top of
> D218 (the owner's brief, in chat). Replaces the cut invoicing adapter (D217). The Turkish text is a `[draft]` template
> until the owner's lawyer approves it (B10, S16); keeping every agreement forever against KVKK erasure is the owner's
> call, to be confirmed by the lawyer (Follow-up).

## Summary

Before each side pays its fee, it ticks a required box: "I accept the service agreement", with a link to the full text.
When both fees are paid (the reveal), the relay turns the accepted template and the job's frozen details into a Turkish
PDF *Hizmet Sözleşmesi*, stores it in a private bucket that nobody can delete from, and sends each side a mail with the PDF
attached and an in app notice. Each side can download it from its request or job page until they open it once or 7 days
pass; after that only their mail copy and admin hold it. Admin lists and opens every agreement, each view audited.

## Requirements

**User stories**:
- As a customer, I want a written agreement naming the provider, the job and the price, so that I have proof of what we
  agreed before I let someone into my home.
- As a provider, I want the same document with the customer's details and the cash I am owed, so that the terms are not
  disputed later.
- As admin, I want every agreement kept and searchable, so that I can answer a report or a legal claim with the exact text
  both sides accepted.

**Prerequisites**: 19b merged. Branch `feat/20-service-agreement`.

**Acceptance criteria**:

- **AC-1, templates**: `agreement_templates` holds versioned Turkish templates per region: `version` (text, unique per
  region, `^[a-z0-9._-]{1,40}$`), `body` (a JSON array of sections, each `{ "heading": text, "paragraphs": [text] }`,
  at most 40 sections and 64 KiB), `active` (at most one per region, a partial unique index). Paragraphs may name fields
  only as `{{name}}` from the fixed list in *Template fields*; the renderer substitutes those and nothing else (no
  expression, no code, rule 8). Rows come only from migrations: no API role writes the table. The first migration seeds
  TR version `draft-1` (every heading and paragraph starts `[draft] `), active. Anyone signed in reads the active
  template through `agreement_template(p_version text default null)`.

- **AC-2, the customer's acceptance**: the commission pay surface (`NextStepPanel` on the request page) shows a required
  checkbox (`AgreementCheckbox`: "I accept the service agreement", linking to `/[locale]/agreement/<version>`, and the
  terms at `/terms` in the same label) in place of 09's `AgreementLine`, above `PayButton`, which stays disabled until
  it is ticked. `pay_commission(uuid, text, text)` is dropped explicitly and created again as `pay_commission(p_request_id
  uuid, p_locale text, p_ip text, p_agreement_version text default null)`, grants written again (no old overload left,
  so PostgREST never sees two). Order (X-5): 09's steps 1 to 4 unchanged (caller, state, `already_paid` first, the
  deadline); then the agreement check: a null, or a version that is not the region's active one, returns the refusal
  `agreement_required`; then the acceptance insert (role `customer`, the request's selected application, the template
  id, `now()`, `on conflict (application_id, role) do nothing`, so a replay keeps the first acceptance); then 09's step 5
  onward (a commission of 0 settles at once, D171, with its acceptance already stored; `payments_disabled`; a reused
  attempt). Every caller passes the version: `lib/requests` `payCommission`, `actions/payments.ts`, the input schema,
  `PayButton`'s `PayTarget`, the regenerated `lib/db/database.types.ts`.

- **AC-3, the provider's acceptance**: the fee pay surface (My jobs, the `chosen` tab of `JOB_TABS`, label
  `ProviderFeed.jobs.tab.chosen`) shows the same checkbox, linking to the version the customer accepted for that pick,
  which `provider_jobs` (replaced) returns per row as `agreement_version` (null when no customer acceptance exists; the
  `JobRow` schema gains the key). `pay_provider_fee(uuid, text, text)` is dropped and created again with
  `p_agreement_version text default null`; after 10's steps 1 to 4 (`already_paid` first) the version must equal the
  customer's accepted version for this application (else `agreement_required`), then the provider's acceptance is
  inserted the same way (role `provider`), then 10's step 5 onward (a fee of 0 settles at once). The customer's version
  binds even when it is no longer the active template.

- **AC-4, the re-pick**: `choose_provider(uuid, uuid)` (latest body in `20261124090000_expiry_cancel_refunds.sql`) is
  dropped and created again with `p_agreement_version text default null`. When `carried_commission()` finds a paid
  commission carried from a failed pick (12's re-pick path), it requires the region's active version (else
  `agreement_required`, checked after the existing caller and state checks, before any write) and inserts the customer's
  acceptance for the new application (role `customer`). A first pick ignores the argument; the acceptance then comes
  with the payment (AC-2). The old pick's acceptance stays. `request_offers` already tells the page whether the
  commission carries; the choose confirm dialog shows the checkbox only then.

- **AC-5, queued at the reveal**: `provider_fee_settled` (replaced, 10's body plus this; the one place every pick moves
  to `UNLOCKED`, both after a verified payment and for a fee of 0, with the request row already locked) inserts, in the
  same transaction, `service_agreements` with `content` frozen from the rows as they are at the reveal (see *Template
  fields*: plain values, minor unit integers and UTC instants, never formatted text), the template both accepted, and
  `number` = `HS-<region>-<year of unlocked_at in the region's time zone>-<6 digit per region sequence>` (the sequence
  picked from a fixed region list, never dynamic SQL; a gap after a rollback is fine), then enqueues outbox
  `agreement.render` (a new kind in `outbox_events_kind_valid` and `enqueue_outbox`, key `agreement.render:<agreement
  id>:1`). `after_provider_fee_paid` is not touched. A pick without both acceptances (an old job, or a broken path) gets
  no row and returns `agreement_missing` among the alerts the existing settle path already reports (10's `v_alerts`);
  the reveal never waits on or fails for the agreement. A later cancel, admin refund or suspension leaves the agreement
  as it is (no void, no status column).

- **AC-6, rendered in the relay**: `claim_outbox` hands `agreement.render` to a new relay handler `renderAgreement`
  (`lib/relay/agreement.ts`): it reads `agreement_render_context(id)` (service role only: the frozen content, the
  template body, both acceptances), renders the PDF with `lib/agreements/render.ts` (pdfkit, Noto Sans regular and bold
  vendored under `lib/agreements/fonts/` with their Open Font License text, A4, page numbers and the number on each
  footer), formats money once through `lib/money` `formatMinorFixed` with `₺` and dates in the region's time zone, and
  sets the PDF's creation date to the reveal time and a fixed producer, so the same agreement always renders the same
  bytes. It uploads with `lib/storage` `uploadAgreement(db, path, bytes)` (the relay passes its own database handle; the
  storage door never imports the service role) to bucket `service-agreements` at `TR/<year>/<agreement id>-r<attempt
  key>.pdf` (`upsert: false`); an "already exists" answer counts as done only when the stored object's SHA256 equals the
  new one. It ends with `finish_agreement_render(id, path, sha256, byte_size)`, which fills the four file fields once and
  queues the two mails and two notices (AC-8). A replay finds the file fields set and does nothing. The render runs in no
  request path (rule 3). A PDF over 1 MiB is a render failure. `next.config.ts` `outputFileTracingIncludes` carries
  `lib/agreements/fonts/**` into the relay route's bundle.

- **AC-7, render failure**: a failed render or upload returns the outbox row to the queue with the relay's existing
  backoff (`claim_outbox`, 2 minute lease, 6 attempts). The last explicit failure calls `fail_agreement_render(id)`, which
  sets `failed_at` and raises the alert `agreement_render_failed` (ids only); the heartbeat task also alerts on any
  `agreement.render` outbox row ended `failed` (a lease that ran out) whose agreement has no file, so no failure is
  silent. Admin's agreement page shows it as failed with a **Render again** button (`admin_rerender_agreement(id)`,
  audited), which enqueues a new attempt under the next key (`:2`, `:3`, and a new object path). A re-render uses the
  same frozen `content`, so the document says the same.

- **AC-8, mail and notice**: `finish_agreement_render` queues one mail per side directly through 13's `queue_email`
  (replaced to accept the templates `agreement_ready_customer` and `agreement_ready_provider`; key
  `agreement:<agreement id>:<role>`, entity the agreement id, topic transactional) and one notice per side (kind
  `agreement_ready` added to `notifications_kind_valid`, 18's `NoticeKinds` and `noticeHref`, linking to the request
  page or the job). `email_context` (replaced from its latest body in `20261202090000_trust_quality.sql`) returns, for
  these two templates, the agreement id and number only (never a path), and the outcome `condition` when the agreement
  has no file. The relay's mail step (`lib/relay/email.ts`, `lib/email` stays relay only) then loads the PDF through
  `lib/storage` `downloadAgreement(db, agreementId)` (which reads the path itself from the row) and passes it to
  `renderEmail` and the driver as an attachment `Hizmet-Sozlesmesi-<number>.pdf`. `EMAIL_TEMPLATES`, the values schema,
  `SendContext` and the drivers' input gain the attachment: Resend sends `attachments` (base64), the fake driver records
  each attachment's name, byte size and SHA256 (never the bytes). A download failure ends the mail as `retry`; the mail
  lane's per row budget becomes 20 seconds for these two templates. `queue_email` already skips a recipient with no
  confirmed address; the notice still goes.

- **AC-9, each side's download card**: the customer's request page and the provider's job view (My jobs, Active tab, and
  the job's request page) show an **Agreement** card ("Your service agreement is ready", the number, a Download button)
  while `agreement_visible(id)` holds for the caller (every time from the database's `now()`): the agreement is
  rendered, the caller is its customer or its provider (one agreement per unlocked application, so a provider whose
  pick failed never has one), `rendered_at` is under 7 days ago, and that side's `*_opened_at` is null or under 10
  minutes ago. **Download** calls `openAgreementAction(id)`: `open_service_agreement(id)` stamps that side's
  `*_opened_at` if null and returns the storage path in the same call; the page then signs a 300 second link as the
  signed in user through `lib/storage` `signedLink`, allowed by the bucket's read policy (`agreement_read_allowed(name)`:
  the caller is a party and that side's `*_opened_at` is under 10 minutes old, or the caller is admin with a fresh
  `agreement.viewed` audit row, 14's pattern). Within those 10 minutes the card keeps a Download again button, then says
  "Opened. Your copy is in your email." and leaves. A cancelled or refunded job's card still works. No list of
  agreements exists in either portal.

- **AC-10, admin**: `/[locale]/admin/agreements` (in the admin rail) lists every agreement, newest first, 50 a page,
  searchable by number or request id, each row with number, request and its live status, both names (from `content`),
  `rendered_at` or failed, and opened marks; the admin request page links to its agreement. **View** calls `admin_agreement_link(id)`, which writes an
  `agreement.viewed` audit row first and only then the page signs a 60 second link (14's photo pattern). Admin can render
  again (AC-7) and nothing else: no edit, no delete.

- **AC-11, append only, for every role**: guard triggers (before update, delete and truncate, for every role, the
  owner included) make `agreement_acceptances` refuse update, delete and truncate; `service_agreements` refuse delete,
  truncate and any update except: the four file fields set from null to values together once; `failed_at` set or
  changed only while `rendered_at` is null; each `*_opened_at` from null once. `agreement_templates` refuses delete,
  truncate and any update but `active`. The relay and the definer functions write through these rules, never around
  them (no role is exempt). The bucket has no delete or update policy for any role, and the relay uploads with `upsert:
  false`. RLS on all three tables with policies and negative tests in the same migration (rule 7).

- **AC-12, the full text page**: `/[locale]/agreement/[version]` renders that template's sections (Turkish, with a short
  line in the reader's locale saying the Turkish text is the agreement), with `{{fields}}` shown as their Turkish labels,
  so each checkbox links to exactly the text it accepts. Indexing off (`noindex`).

- **AC-13, three locales, phone first**: every string around the PDF (checkbox, cards, admin page, mails, notice) in
  `ar`, `tr`, `en`, `[draft]` until S16; the PDF itself Turkish only. 390px first, logical properties, axe clean; the
  checkbox has a real label and its error is announced.

- **AC-14, tests**: pgTAP `42_service_agreement.test.sql` (the three tables' RLS, grants and guards; each pay refusal
  `agreement_required`; the provider bound to the customer's version; the re-pick acceptance; the row and outbox at the
  reveal with frozen content and the number; no row and an alert without both acceptances; `agreement_visible` for each
  side, a stranger, after opening, after 7 days; admin view audited before the link; no delete for any role, the bucket
  included) and `43_agreement_races.test.sql` (two relay workers rendering one agreement: one file, one finish; a pay
  replay racing itself: one acceptance). Tests 10 (the function allowlist with the new signatures), 20, 21, 22 and 16
  updated in the same change, and the scrubber test gains `agreement_content`. Unit tests for the renderer (Turkish glyphs embedded, every field substituted, no `{{`
  left, a 200 character street line and a 120 character name wrap) and the drivers' attachments. e2e `service-agreement` at 390px in three
  locales on the fake PSP: both tick and pay, the reveal renders, both cards download a PDF, the fake mail file shows
  both attachments, admin lists and views it; paying without the tick is impossible.

## Decision

**Chosen option**: agreements as frozen data plus a template version, rendered once in the relay with pdfkit into an
append only private bucket, delivered by mail attachment, a notice and a one time download card, kept for admin.

**Implementation skills**: `supabase-postgres-best-practices` (`supabase/agent-skills`,
`.claude/skills/supabase-postgres-best-practices/`) · `supabase` (same repo, `.claude/skills/supabase/`, Storage) ·
`resend` (`resend/resend-skills`, `.claude/skills/resend/`, attachments over REST) · `shadcn` (`shadcn-ui/ui`,
`.claude/skills/shadcn/`, the checkbox)

## Rationale

*Why frozen content.* The PDF is a contract record, so it must say exactly what was true when both had paid, even if a
name or address changes later or a render has to be repeated. `content` is written in the reveal's transaction from the
rows the reveal itself reads; the renderer reads only that and the accepted template.

*Why the relay.* PDF work and a Storage upload are slow external calls; rule 3 keeps them out of request paths, and the
relay already has retries, leases, alerts and a mail lane. The reveal stays as fast and as safe as 10 built it.

*Why acceptance inside the pay functions.* The database already decides each payment; recording the acceptance in the
same transaction (and refusing without it) means no payment can ever exist without its acceptance, whatever client
calls PostgREST. The provider is bound to the customer's version so one document has one text.

*Why pdfkit and a vendored Noto Sans.* pdfkit is maintained, pure JavaScript, embeds a TTF and wraps and paginates long
text itself; Noto Sans covers Turkish, Arabic and the lira sign under the Open Font License, and a committed file means
no network fetch at render time. Runners up: `@react-pdf/renderer` (heavier, slower cold starts), `pdf-lib` (no text
layout, no recent release).

*Owner picks* (the `/architect 20` interview, 2026-11-23): a `[draft]` template now, the lawyer's text later as a new
version by migration; accept again on a re-pick; Turkish only; a template version row; names, phones and the job
address; the platform named as intermediary; all four figures; the card until opened or 7 days; pdfkit; Noto Sans; a
region sequence number; the customer's version binds; retry then alert; an admin page plus a request link; a notice as
well as the mail; no agreements for jobs unlocked before the release.

*Recommended calls made while writing*: (1) the signed link for a party is 300 seconds (a phone download over a slow
line), admin's stays 60 (D-series pattern); (2) parties read through a narrow Storage read policy open for 10 minutes after they
open the agreement, so links are signed as the user and the service role stays in the relay (cross check X-2); (3) the number's year is the reveal's
year in the region's time zone; (4) the full text page shows field labels, never sample data; (5) `failed` is a reading
(`failed_at` set, `rendered_at` null), not a status column.

## Feature design

**Data model sketch**:

| Table | Column | Type | Null | Notes |
| --- | --- | --- | --- | --- |
| `agreement_templates` | `id` | uuid | no | pk |
| | `region` | text | no | fk `regions(code)` |
| | `version` | text collate "C" | no | unique `(region, version)`, format check |
| | `body` | jsonb | no | array of `{heading, paragraphs[]}`, shape and size checked |
| | `active` | boolean | no | default false; unique `(region) where active` |
| | `created_at` | timestamptz | no | default `now()` |
| `agreement_acceptances` | `id` | uuid | no | pk |
| | `region` | text | no | fk |
| | `request_id` | uuid | no | fk `requests(id, region)` |
| | `application_id` | uuid | no | fk `applications(id)`; must belong to `request_id` |
| | `user_id` | uuid | no | fk `profiles(id)` on delete restrict |
| | `role` | text | no | `customer` or `provider`; unique `(application_id, role)` |
| | `template_id` | uuid | no | fk `agreement_templates(id)` |
| | `accepted_at` | timestamptz | no | default `now()` |
| `service_agreements` | `id` | uuid | no | pk |
| | `region` | text | no | fk |
| | `request_id` | uuid | no | fk |
| | `application_id` | uuid | no | unique (one agreement per unlocked pick) |
| | `number` | text collate "C" | no | unique, `^HS-[A-Z]{2,3}-\d{4}-\d{6}$` |
| | `template_id` | uuid | no | fk |
| | `content` | jsonb | no | frozen fields, object, at most 16 KiB |
| | `storage_path` | text | yes | set once with the three below |
| | `sha256` | text | yes | 64 hex |
| | `byte_size` | integer | yes | 1 byte to 1 MiB |
| | `rendered_at` | timestamptz | yes | |
| | `failed_at` | timestamptz | yes | last render attempt failed |
| | `customer_opened_at`, `provider_opened_at` | timestamptz | yes | each set once |
| | `created_at` | timestamptz | no | the reveal |

Sequence `service_agreement_seq_<region>` (TR now; KSA when it opens). Bucket `service-agreements`: private, PDF only
(`application/pdf`), 1 MiB, one read policy (`agreement_read_allowed`, AC-9) and no insert, update or delete policy for
any API role (the relay uploads through `lib/storage` with its own handle).

**Template fields** (the only names a paragraph may hold; all frozen into `content` at the reveal): `agreement_number`,
`agreement_date` (the reveal's local date), `customer_name` (`profiles.full_name`), `customer_phone`,
`provider_name` (`providers.approved_name`), `provider_phone` (`profiles.phone` of the provider), `platform_name` (the
literal "Aldebyani" in the content builder), `service_name` and `category_name` (`requests.pricing_snapshot ->
service -> name`, `-> category_name`), `addon_names` (`pricing_snapshot -> breakdown -> addons[] -> name`), `district`
(`zones.name`), each localised text taken as `tr`, else `en`, else `ar`; `street_line` (`request_addresses.line`);
`scheduled_start`, `scheduled_end` (UTC instants, shown in `regions.timezone`); `job_price` (`fixed_price`),
`commission` (`commission_amount`), `provider_fee` (`applications.provider_fee_amount`), `cash_due` (minor unit
integers) and `currency`; `customer_accepted_at`, `provider_accepted_at` (UTC instants); `template_version`. The
renderer formats money and dates once. The text signature block lists each side as "<name>, elektronik olarak kabul etmiştir: <date and
time>".

**State transitions**: an agreement: queued (row, no file) → rendered (file fields set) ; queued → failed (`failed_at`)
→ queued again (admin render again) → rendered. Each side's card: visible → opened (or 7 days). Nothing returns from
rendered.

**API surface**:

| Function or action | Kind | Key inputs | Key outputs | Auth | Key errors |
| --- | --- | --- | --- | --- | --- |
| `agreement_template(p_version)` | definer, read | version or null (active) | `{version, sections}` | signed in | `not_found` |
| `pay_commission(p_request_id, p_locale, p_ip, p_agreement_version)` | replaced | + version | as 09 | customer | + `agreement_required` |
| `pay_provider_fee(p_application_id, p_locale, p_ip, p_agreement_version)` | replaced | + version | as 10 | provider | + `agreement_required` |
| `choose_provider(p_request_id, p_application_id, p_agreement_version)` | replaced | + version | as 06 | customer | + `agreement_required` (re-pick only) |
| `provider_fee_settled` | replaced, internal | as 10 | + agreement row, outbox | none | alert `agreement_missing` |
| `provider_jobs` | replaced | as 10 | + `agreement_version` per row | provider | as before |
| `queue_email`, `email_context` | replaced, internal | + the two templates | + agreement id and number | relay | `condition` |
| `agreement_render_context(p_id)`, `finish_agreement_render(...)`, `fail_agreement_render(p_id)` | internal | id, file fields | context, ok | service role (relay) | |
| `my_agreement(p_request_id)` | definer, read | request | `{id, number, rendered, opened}` or null | either party | |
| `open_service_agreement(p_id)` | definer | id | `{storage_path}` | the party, while visible | `not_found` |
| `admin_agreements(p_query, p_after)`, `admin_agreement_link(p_id)`, `admin_rerender_agreement(p_id)` | definer | query, cursor, id | rows, path, ok | admin (`is_admin()`) | `forbidden` |
| `payCommissionAction`, `payProviderFeeAction`, `chooseProviderAction` | Server Actions, changed | + `agreementVersion` | as before | as before | `agreement_required` |
| `openAgreementAction`, `adminAgreementLinkAction`, `rerenderAgreementAction` | Server Actions | id | signed URL, ok | party, admin | stable codes |

**Value sourcing**:

| Action | Value produced / displayed | Source |
| --- | --- | --- |
| Checkbox (customer, first pick and re-pick) | version and its link | the region's active `agreement_templates` row through `agreement_template(null)` |
| Checkbox (provider) | version and its link | `provider_jobs` row `agreement_version`: the customer's `agreement_acceptances.template_id` for that application |
| Checkbox on the re-pick | whether to show it | `request_offers`' carried commission flag (12) |
| Pay, choose | whether the version is acceptable | the active row (customer) or the customer's acceptance (provider), read in the function |
| Reveal | every template field | the rows the reveal locks: `requests`, the pick's `applications`, `profiles` (customer), `providers` (provider), `request_addresses`, `zones`, `services`, `service_categories`, the stored figures, both acceptances; frozen into `content` |
| Reveal | the number's year and date | `unlocked_at` in `regions.timezone` |
| Render | text | the accepted template's `body` with `content` substituted |
| Card | shown or not | `agreement_visible`: `rendered_at`, the caller's side, its `*_opened_at`, 7 days from `rendered_at` |
| Mail | attachment bytes | the bucket object at `storage_path`, read at send time |
| Admin list | names | `content` (the frozen names), never live rows |

**Key invariants**:
- No commission or provider fee is charged (no checkout row, no settle) without that side's acceptance in the same
  transaction; the provider's names the customer's template.
- At most one agreement per unlocked pick; its `content` and file never change once set; nothing is ever deleted.
- The PDF holds contact details only after both fees are paid (it is created at the reveal, rule 2), and only the two
  parties of that pick and admin can ever get a link.
- No template text is executed; only listed fields are substituted (rule 8).
- Money in the PDF is the stored minor units, formatted once (rule 4).

**Security model**: the three tables have RLS on with deny policies for API roles except: a party reads its own
acceptances (`user_id = auth.uid()`), admin reads all; every other read goes through the definer functions above, each
checking the caller. No API role inserts or updates any of the three tables directly. The bucket has one read policy,
`agreement_read_allowed(name)` (a party for 10 minutes after opening, admin after its audit row), and no insert, update
or delete policy for any API role; the relay uploads with its own service role handle passed into `lib/storage`, which
never imports the service role itself (the `lib/db/admin` lint fence holds). Links are signed as the signed in user. Mails carry the PDF as personal data to confirmed addresses only. The
scrubber treats `content`, `agreement_content` and `street_line` as personal keys (`street_line` already folds into
`_line`). Logs and alerts carry ids only.

**Configuration required**: none (the bucket, the template and the sequence come from the migration; pdfkit and the font
are pinned in the repo).

**Critical test scenarios**:
- Happy path: both tick and pay on the fake PSP, the reveal queues the agreement, the relay renders it, both get a mail
  with the PDF and a notice, both download once from their card, admin views it (audited), verifies **AC-2**, **AC-3**,
  **AC-5** to **AC-10**.
- Failure case: an upload error twice then success, and a permanent failure that alerts and is rendered again by admin
  with the same text, verifies **AC-6**, **AC-7**.
- Failure case: a stale version on the provider's pay (the template changed after the customer accepted) is refused,
  and the current page offers the customer's version, verifies **AC-3**.
- Auth: a stranger, the other provider of a re-picked request, and an expired card get no link; nobody deletes a file or
  a row, admin included, verifies **AC-9**, **AC-11**.

## Build plan

Tracer Bullet: one agreement from tick to downloaded PDF first (customer and provider acceptance, the row at the reveal,
the relay render, the provider's card), then the mail attachment and notice, the re-pick, admin, and the failure path.

1. Migration `20261204090000_service_agreement.sql`: the three tables with checks, RLS, policies, grants and guards; the
   sequence; the bucket and its read policy; the `draft-1` TR template; `agreement_template`; `pay_commission`,
   `pay_provider_fee` and `choose_provider` dropped and created with the new argument, `provider_fee_settled` and
   `provider_jobs` replaced (grants written again); the outbox kind; the render context, finish and fail functions;
   `my_agreement`, `open_service_agreement`, the admin functions; `queue_email`, `email_context` and the notices map
   replaced for the two templates and the notice kind; pgTAP 42 and 43 first, tests 10, 16, 20 to 22 updated. Satisfies **AC-1** to **AC-5**,
   **AC-11**, **AC-14**.
2. `lib/agreements/` (render, fields, font files and license, pdfkit pinned after reviewing its install scripts and
   recorded in `allowScripts` if any), `lib/storage` `uploadAgreement` and `downloadAgreement` taking a `Db`, the relay's
   `renderAgreement` and claim wiring, the heartbeat alert, `outputFileTracingIncludes` for the fonts. Satisfies **AC-6**, **AC-7**.
3. `AgreementCheckbox` in place of `AgreementLine` on both pay surfaces and the re-pick confirm; every caller of the
   three functions (doors, actions, inputs, `PayTarget`, regenerated types); `/agreement/[version]` for any version.
   Satisfies **AC-2** to **AC-4**, **AC-12**, **AC-13**.
4. The download card for both sides, `openAgreementAction`. Satisfies **AC-9**, **AC-13**.
5. `lib/email` attachments (types, Resend body, fake record), the two templates, the notice kind rendering. Satisfies
   **AC-8**.
6. `/admin/agreements`, the request page link, render again. Satisfies **AC-7**, **AC-10**.
7. e2e `service-agreement`, unit tests, the local gate, `/check verify`. Satisfies **AC-13**, **AC-14**.
8. Reviews (`slice-reviewer`, `security-reviewer` for PII, storage and payments, `/check review` on another model),
   fixes, the migration pushed after a dry run right before the merge (production parses the new keys strictly; the old
   build calling the pay functions without a version is refused, so the deploy follows the push at once).

## Consequences

**Positive**:
- Every unlocked job has a signed, numbered, unchangeable record of who agreed to what, at what price, with the cash
  outside the platform stated in writing.
- Payments cannot happen without acceptance, whatever client calls the database.
- The lawyer's text drops in as a new version without code changes.

**Negative / tradeoffs**:
- The two pay functions and `choose_provider` change signature again; old clients are refused until they redeploy.
- A PDF with names, phones and an address is personal data kept forever; this rests on a contract record basis the
  lawyer must confirm (KVKK), and the account deletion work (21) must exclude it.
- Two new pinned dependencies (pdfkit and its tree) and a vendored font in the bundle.
- The download card is easy to miss; the mail and the notice are the main copy.

**Neutral**:
- Jobs unlocked before the release have no agreement.
- KSA needs its own template and sequence before it opens.

## Cross check (Sonnet, 2026-11-23)

A read only pass found 15 gaps (3 Critical, 10 Major, 2 Minor) and verified 17 claims; each fix, the recommended one,
is written into the text above (owner's pick, "apply the recommended fixes"): X-1 the hook moved to
`provider_fee_settled` so a fee of 0 gets its agreement; X-2 the service role stays in the relay (storage functions take
a `Db`, parties read through a 10 minute policy); X-3 the attachment path through `queue_email`, `email_context`, the
relay's mail step and the drivers; X-4 the re-pick through `carried_commission()`; X-5 the check order after the deadline
and before the zero settle; X-6 every caller and the `AgreementLine` replacement; X-7 frozen plain values formatted once
in the renderer; X-8 the localised names and the platform literal; X-9 open and path in one call, a 10 minute window;
X-10 the guards' exact rules; X-11 byte stable renders, new paths per attempt, an alert for a silent lease end; X-12
`provider_jobs` returns the customer's version, any version page; X-13 no void after a cancel or refund; X-14 the 200
character street line; X-15 the notice map, the mail key, the alert path, the scrubber, the font license and tracing.

## Follow-up

- [ ] B10, S16: the lawyer's Turkish text as template version 2 (a migration), and the copy leaves `[draft]`.
- [ ] Owner's lawyer: confirm keeping agreements forever against KVKK erasure (a contract record for legal claims); 21's
  account deletion must keep them.
- [ ] `AGENTS.md` (`/sync`): pdfkit and its version in the stack table, `lib/agreements` as a door, the bucket in
  `lib/storage`.
- [ ] `ui-registry.md`: `AgreementCheckbox`, `AgreementCard`, the admin agreements list.
