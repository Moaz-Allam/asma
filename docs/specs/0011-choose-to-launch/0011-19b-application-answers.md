# 0011-19b. Structured application answers (position 19, part b, P2)

Child of [0011](index.md). Follows the cross child contract there. **Changes the apply path (05, 06) and what the
customer reads on the offer card; free text from providers may hold personal data despite the scanner: a migration
(one table, two columns, functions), the catalog and provider feed doors, three surfaces.** Built after
[0011-19a](0011-19a-trust-quality.md) merges, on its own branch.

> **Accepted 2026-11-22 under the owner's standing rule "always do whats recommended" (D213)**, after a Sonnet cross
> check (fixes X-1 to X-8 and X-12 applied, see *Cross check*). Written against what 01 to 18 and 01b built and what
> 19a adds. Built now, before 21 (D203), gated and merged by D204. Every design choice below was the owner's pick in
> the `/architect` interview or, after that rule, the recommended option.
>
> What 19b reads as built: `applications.message` is `text not null`, 20 to 600 characters after `catalog_trim`
> (05), checked by `message_has_contact_info` in `apply_to_request` (refused `contact_info_in_message`, returned so the
> attempt counter commits, D153) and hidden again on the card by `offer_card` (`message_hidden`, 06). The latest
> `apply_to_request` is in `20261118090000_choose_provider.sql` as 19a replaces it (cap per caller,
> `probation_limit`); `provider_request` returns `cap`, `full` and the caller's own `application` `{ id, status,
> created_at }`; `applications_guard` (latest in `20261128090000_admin_operations.sql`) refuses any change to
> `message`. 03's catalog tables are written by admin directly under RLS with column grants and the `catalog_audit`
> trigger (D125), through `lib/catalog/writes.ts` (`insertRow`, `updateRow`) from `actions/admin-catalog.ts`; labels are
> localised `jsonb` checked by `catalog_text_ok(value, region, max)` and shown with `localized(value, locale,
> regionDefault)` (`lib/catalog/localized.ts`); a question's options and validation are checked by
> `question_shape_ok(type, options, validation, region)`; the builder UI is `QuestionBuilder` and
> `QuestionOptionsEditor` in `components/features/admin/catalog/`. Request questions (`questions`) belong to a category
> and can price; launch categories are still open (B6).

## Summary

Because customers cannot chat before choosing, the single free message on an application carries little signal.
Admin may now write up to five questions per category for providers (for example "How will you approach this job?",
"What is included in your price?", "Will you bring your own materials?"), answered as text, a choice, or yes or no.
When a category has active questions, the apply form asks them instead of the message, and the customer sees the
answers on the offer card. A category with no questions keeps today's message, so nothing changes until admin writes
some. Every text answer passes the same contact scanner as the message.

## Requirements

**User stories**:
- As a customer, I want each provider to answer the same questions, so that I can compare offers point by point.
- As a provider, I want clear questions instead of a blank box, so that I know what the customer needs to hear.
- As admin, I want to set the questions per category without a release, so that each trade gets the questions that
  matter for it.

**Prerequisites**: 19a merged. Branch `feat/19b-application-answers`.

**Acceptance criteria**:

- **AC-1, the questions table**: `application_questions` (see *Data model*) holds questions per category and region,
  types `textarea`, `single_select` and `boolean` only. Labels and help text are checked by `catalog_text_ok` (120 and
  300 code points), options and validation by `question_shape_ok`, and a `textarea`'s `maxLength` (validation) is 10 to
  600 (null means 600; below 10 no answer could pass, D219). A key is unique per category forever (retired keys included) and matches
  `^[a-z][a-z0-9_]{0,39}$`. RLS is on, with admin read, insert and update policies (the `questions` pattern); column
  grants let admin insert every editable column and update only `label`, `help_text`, `required`, `options`,
  `validation`, `display_order`, `active` (never `key`, `type`, `category_id`, `region`). `application_questions_guard`
  (before insert, update, delete, truncate, every role) refuses delete and truncate (`application_question_retire`:
  deactivate instead), any change to `key`, `type`, `category_id` or `region`, and a sixth active question in a category
  (`too_many_questions`); before it counts, it locks the category's `service_categories` row (`for update`), so two
  admins activating different questions at once cannot both pass (X-4). It is security definer, and a BEFORE trigger runs
  ahead of the RLS write check, so `application_questions_access` (security invoker, named to fire first) refuses an API
  caller who is not admin with 42501 before the guard can lock or count for them (D219). The `catalog_audit` trigger writes `catalog.created` and `catalog.updated` rows for it. New
  rows start inactive. No provider, customer or `anon` reads the table directly.

- **AC-2, admin builds them**: in `/[locale]/admin/catalog`, each category's sheet gets a second list, "Questions for
  providers", below 03's request questions: add, edit, reorder and switch active, reusing `QuestionBuilder` and
  `QuestionOptionsEditor` with the type list cut to the three types and no pricing controls. Writes go through
  `lib/catalog/writes.ts` from new actions in `actions/admin-catalog.ts` (`guardedAction(['admin'])`, stable codes:
  `too_many_questions`, `application_question_retire`, `validation_failed`, `forbidden`). The list says "Up to 5
  active. A category with none keeps the free message."

- **AC-3, the provider reads them**: `provider_request` is replaced in place and adds `questions`: the active
  `application_questions` of the request's service's category, in `display_order` then `key`, each `{ "key", "label",
  "help_text", "type", "required", "options", "max_length" }`; an empty array means the message form. It also adds
  `questions_version`: `application_questions_version(p_category_id uuid, p_region text) returns text` (internal, no
  grant) = `md5` of the `questions` array's text, or null with no active question, so any edit (a new optional
  question, a changed `required`, label, help text, options or limit, a deactivation) changes it (X-3). Its
  `application` block adds `application_answers` and `questions_snapshot` for the caller's own application (null for
  a message application); the name differs from the existing top level `answers`, which is the request's own answers
  (`provider_structured_answers`, 04), so the payload never holds two meanings under one key (X-8). Labels are rendered
  on the server in the reader's locale with `localized`.

- **AC-4, apply with answers**: `apply_to_request(p_request_id uuid, p_message text default null, p_answers jsonb
  default null, p_questions_version text default null)` replaces the two argument function (`drop function` of the old
  signature, then `create`, with the grants written again). Every argument after the first has a default, so a call
  naming any subset still resolves through PostgREST and the app can deploy after the migration (X-7); `applyToRequest`
  always sends all four explicitly, nulls included. Steps 1 to 10 (19a's body, the attempt counter at step 10
  included) are unchanged; **steps 11 to 13** (the message check, the scanner, the insert) are replaced (X-6). A stale
  form's refusal therefore costs an hourly attempt, as a refused message does today (D153), accepted. Every refusal
  is returned (not raised) as `{ "status": "refused", "code", "key"? }` so the counter commits:
  1. Load the active questions of the request's category once, in one `select`, and build from that one result the
     version (as AC-3), the validation and the snapshot, so they always agree (X-6).
  2. **No active questions**: `p_answers` and `p_questions_version` must be null (else `questions_changed`); the
     message path runs exactly as today (`message_invalid`, `contact_info_in_message`).
  3. **Active questions**: `p_answers` null, any non null `p_message` (an empty string included), or a
     `p_questions_version` different from the version just built returns `questions_changed`. `p_answers` must be a
     JSON object of at most 16384 bytes (else `answers_invalid`). A key that is not an active question returns
     `questions_changed`. Each active question, in order: a `required` one with no value (absent or null) returns
     `answers_invalid` with its `key`; a `textarea` value must be a string of at most 8192 bytes, then
     `catalog_trim`, then 10 to `max_length` code points (else `answers_invalid`), then `message_has_contact_info`
     false (else `contact_info_in_answer` with its `key`); a `single_select` value must be one of its option values; a
     `boolean` value must be a JSON boolean. Optional questions left empty (a text blank after the trim included) are
     stored absent. Then all text answers joined in snapshot order (`answers_joined_text`) pass `message_has_contact_info`
     too (else `contact_info_in_answer` with no `key`), so a number split across fields is caught as one (D219).
  4. Insert the application with `message` null, `answers` the cleaned object (trimmed text), and `questions_snapshot`
     the active questions as an array, in order, each `{ "key", "label", "type", "required" }` plus, for an answered
     `single_select`, `"choice": { "value", "label" }` (only the chosen option, never the whole list, X-5), so a later
     edit by admin never changes what a sent application meant. Size bound: five questions, each label at most 120
     code points in three locales (at most 4 bytes each) plus one option label the same, stay under 16 KiB, so the
     size checks of AC-5 can never fire on a valid apply.
  The replay of step 5 returns the stored application as today, whatever was sent.

- **AC-5, the columns**: `applications` gains `answers jsonb` and `questions_snapshot jsonb` (both nullable);
  `message` drops `not null` (its length check stays). `applications_one_content` requires exactly one shape:
  `message` set with both new columns null, or `message` null with `answers` a JSON object of at most 16384 bytes and
  `questions_snapshot` a JSON array of at most 32768 bytes (twice AC-4's bound, a margin, never reached by a valid
  apply). Every existing row is a message row, so the check holds at once.
  `applications_guard` is replaced (body copied, the two columns added to its refused changes), so no role changes an
  answer after the insert.

- **AC-6, the offer card**: `offer_card` is replaced in place (19a's body plus this) and adds `answers`: null for a
  message application, else an array in snapshot order, each `{ "key", "label", "type", "choice", "value", "hidden" }`
  for the answered questions only, where a `textarea` value that `message_has_contact_info` matches comes back as
  `value` null with `hidden` true (06's rule for the message); when the text answers joined match, every text answer of
  that card comes back hidden (D219). `message` stays null and `message_hidden` is written
  `coalesce(public.message_has_contact_info(message), false)`, because the scanner returns null for a null message and
  the offer schema needs a boolean (X-2). `request_offers` is replaced too (body copied from
  `20261118090000_choose_provider.sql`): in its branch for a chosen provider suspended after the choose (06 security
  review S2), it also sets `answers` to null beside the message, so a suspended provider's free text never reaches the
  customer (X-1). `OfferCard` shows, in place of the message, each answer as the question's label and the answer
  (a choice through its option label, yes or no in words, a hidden answer as "Hidden: it contained contact details"),
  labels in the reader's locale through `localized`. `lib/requests` `loadOffers` schema gains `answers`.

- **AC-7, the apply form**: `ApplicationForm` renders the questions when `questions` is not empty: a `textarea` with a
  live character count, a radio group for a `single_select`, a yes or no radio group for a `boolean`, each with its
  label, help text and a "Required" or "Optional" mark; else 05's message box as today. The form sends back the
  `questions_version` it was drawn from (a hidden value, never edited). Refusals: `questions_changed`
  refreshes the page and shows "The questions for this job changed. Check them and send again."; `answers_invalid` and
  `contact_info_in_answer` mark the field named by `key`. The provider's own application on the request page shows
  their answers read only (`application.application_answers` with its snapshot). The `application_submitted` analytics event is unchanged (no properties).

- **AC-8, three locales, phone first**: strings in `ar`, `tr`, `en` (provider and customer copy `[draft]` until S16),
  390px first, logical properties only, axe clean; the radio groups have a legend and work with the keyboard.

- **AC-9, tests**: pgTAP `40_application_answers.test.sql`: the table's checks and guard (six active refused, delete
  refused, key change refused for every role), RLS (provider, customer and `anon` read nothing), each apply refusal in
  AC-4 in order, the counter counting a refused attempt, the snapshot surviving an admin edit, the card hiding a
  scanned answer, the one content check, the guard refusing an answer change, the two argument call still resolving;
  a dblink race in `15_apply_races` style (admin deactivating a question while a provider applies: the apply either
  sees the old set and stores it, or returns `questions_changed`), and two admins activating the fifth and sixth
  question at once (one gets `too_many_questions`); a chosen provider suspended after the choose shows no answers;
  `message_hidden` is `false`, never null, on an answers card. Existing tests updated in the same change (X-12):
  `10_pricing_engine` (the allowlist entry `apply_to_request(uuid, text)` becomes `apply_to_request(uuid, text, jsonb,
  text)`), `14_provider_feed_apply` (the exact keys of `provider_request`, its top level `answers` kept), `16_choose_provider`
  (the exact keys of `offer_card` gain `answers`). Unit tests for the door schemas and the answer
  rendering; e2e `application-answers` at 390px in three locales (admin adds two questions, a provider answers them, the
  customer sees them on the card; a category with none keeps the message).

## Decision

**Chosen option**: a table of its own for application questions per category, three answer types, answers and a
snapshot stored on the application, the message kept only for categories with no questions.

**Implementation skills**: `supabase-postgres-best-practices` (`supabase/agent-skills`,
`.claude/skills/supabase-postgres-best-practices/`) · `shadcn` (`shadcn-ui/ui`, `.claude/skills/shadcn/`)

## Rationale

*Context.* The brief (§32) asks for admin configurable questions per category, on the request question engine, with
the contact scanner on every text answer. 03's `questions` table carries pricing: every pricing guard and the tamper
test reads it, so anything added there must be excluded from all of them, forever. Launch categories are not decided
(B6), so the change must not break applying in a category nobody has configured yet.

*A table of its own (owner's pick).* It shares 03's helpers (`catalog_text_ok`, `question_shape_ok`, the audit
trigger, the builder components) without sharing the table, so an application question can never reach the pricing
engine. Runner up: a `purpose` column on `questions`, one engine but a permanent exclusion in every pricing path.

*Three types (owner's pick).* Text, a choice and yes or no cover the brief's examples. A number could read as a
counter offer and a date or time as a new schedule, both against server side pricing (rule 1) and the request's own
schedule. Runner up: all of 03's types.

*The message kept where there are no questions (owner's pick).* Applying keeps working in every category on the day
19b ships; admin replaces the message category by category. Runner up: always replace, which would block applying in
any category without questions.

*Recommended calls made while writing.* (1) Five active questions at most, a constant in the guard, so a provider's
form and the customer's card stay short. Runner up: a setting. (2) Text answers of 10 to 600 code points, close to
the message's 20 to 600 but allowing a short precise answer. Runner up: the message's 20. (3) A snapshot on the
application, as 04 stores `questions_snapshot` on the request, so an edit never rewrites what a provider said.
Runner up: read the live question, which changes the meaning of old answers. (4) `questions_changed` for any mismatch
between what the form showed and what is active, so a provider never sends answers to questions they did not see.
(5) A third argument with a default rather than a new function name, so deploys stay ordered migration first.

## Feature design

**Data model sketch**:

| Table | Column | Type | Null | Notes |
| --- | --- | --- | --- | --- |
| `application_questions` | `id` | uuid | no | pk, `gen_random_uuid()` |
| | `category_id` | uuid | no | fk `(category_id, region)` to `service_categories(id, region)` on delete restrict |
| | `region` | text | no | fk `regions(code)` |
| | `key` | text collate "C" | no | unique `(category_id, key)`, format check |
| | `label` | jsonb | no | `catalog_text_ok(label, region, 120)` |
| | `help_text` | jsonb | yes | `catalog_text_ok(help_text, region, 300)` |
| | `type` | text | no | check in `textarea`, `single_select`, `boolean` |
| | `required` | boolean | no | default false |
| | `options` | jsonb | yes | `question_shape_ok` |
| | `validation` | jsonb | yes | `question_shape_ok`; `textarea` `maxLength` 10 to 600 |
| | `display_order` | integer | no | default 0 |
| | `active` | boolean | no | default false |
| | `created_at` | timestamptz | no | default `now()` |
| `applications` (changed) | `message` | text | **yes** (was no) | length check kept |
| | `answers` | jsonb | yes | object, `<= 16384` bytes |
| | `questions_snapshot` | jsonb | yes | array, `<= 32768` bytes (AC-5) |

Indexes: `application_questions (category_id, display_order, key) where active`, `(region)`. Check
`applications_one_content` (AC-5).

**State transitions**: a question: inactive ⇄ active (admin); never deleted. An application gains no state.

**API surface**:

| Function or action | Kind | Key inputs | Key outputs | Auth | Key errors |
| --- | --- | --- | --- | --- | --- |
| `application_questions` insert, update | table, RLS | the editable columns | the row | admin | `too_many_questions`, `application_question_retire`, check violations |
| `application_questions_version(p_category_id, p_region)` | internal | category, region | md5 text or null | none | |
| `provider_request(p_request_id)` | replaced | as 05 | adds `questions`, `questions_version`; `application.application_answers`, `questions_snapshot` | provider | as before |
| `apply_to_request(p_request_id, p_message, p_answers, p_questions_version)` | replaced, new signature, all but the first defaulted | request, message or answers and version | as 05 | provider | adds `questions_changed`, `answers_invalid`, `contact_info_in_answer` (with `key`) |
| `offer_card`, `request_offers` | replaced | as before | adds `answers`; suspended chosen provider's answers null | as before | |
| `saveApplicationQuestion`, `moveApplicationQuestion` | Server Actions | category, question fields | id | admin | stable codes of AC-2 |
| `applyToRequest` | Server Action, changed | request, message or answers | outcome | provider | the codes above |

**Value sourcing**:

| Action | Value produced / displayed | Source |
| --- | --- | --- |
| Apply form | the questions and their labels | `provider_request.questions` from `application_questions` of `services.category_id` |
| Apply form | the reader's locale and fallback | the route locale; the region's default locale (`regions.default_locale`) |
| Apply | which questions count | active rows read once at the time of the insert, under the request row lock |
| Apply | whether the form was current | `p_questions_version` (from `provider_request.questions_version`) against the version built from those rows |
| Apply | the stored meaning | `questions_snapshot` built from those rows (chosen option only) |
| Offer card | each answer's label and option label | `questions_snapshot` (`label`, `choice.label`), never the live table |
| Offer card | hidden or shown | `message_has_contact_info` on the stored text, at read time |
| Admin builder | the category's region | `service_categories.region` (as 03's `parentRegion`) |

**Key invariants**:
- An application holds either a message or answers with their snapshot, never both, never neither.
- Answers and their snapshot never change after the insert, for any role.
- An application question never reaches the pricing engine (separate table; the tamper test of 03 is unchanged).
- Every text answer passed the contact scanner at apply and is scanned again when read.
- At most five active questions per category.

**Security model**: admin writes questions under RLS with column grants (03's model, D125); providers read active
questions only through `provider_request` for a request they may see (05's checks); customers read answers only
through `request_offers` for their own request (06). Text answers are free text written by a provider and may hold
personal data despite the scanner: they are read by the request's customer and admin only, like the message (05). No
new endpoint, no secret.

**Configuration required**: none.

**Critical test scenarios**:
- Happy path: admin activates two questions on a category; a provider answers both; the customer sees both answers on
  the card in three locales, verifies **AC-2**, **AC-4**, **AC-6**.
- Failure case: admin deactivates a question while a provider has the form open; the send returns `questions_changed`
  and the page reloads the new set, verifies **AC-4**, **AC-7**.
- Failure case: a text answer with a phone number is refused with its key; one that slips past an older scanner is
  hidden on the card, verifies **AC-4**, **AC-6**.
- Auth: a provider or customer selecting `application_questions` reads nothing; a provider cannot change an answer,
  verifies **AC-1**, **AC-5**.

## Build plan

Tracer Bullet: one textarea question from the table to the card first, then the other types and the builder.

1. Migration `20261203090000_application_answers.sql`: `application_questions` with its checks, policies, grants,
   guard and audit trigger; the two columns, the one content check and `applications_guard`;
   `application_questions_version`; `provider_request`, `apply_to_request` (new signature), `offer_card` and
   `request_offers` replaced; tests 10, 14 and 16 updated; pgTAP 40 first (tests first: the apply path).
   satisfies **AC-1**, **AC-3**, **AC-4**, **AC-5**, **AC-6**, **AC-9**
2. `lib/provider-feed` schemas and `applyToRequest`, `ApplicationForm` for the three types and the refusals; the
   provider's own answers on the request page. satisfies **AC-3**, **AC-4**, **AC-7**, **AC-8**
3. `lib/requests` `loadOffers` schema and `OfferCard` answers. satisfies **AC-6**, **AC-8**
4. The builder list in `/admin/catalog` and its actions. satisfies **AC-2**, **AC-8**
5. e2e `application-answers`, unit tests, the local gate (D204), `/check verify`. satisfies **AC-8**, **AC-9**
6. Reviews (`slice-reviewer`, `security-reviewer` for the apply path and free text, `/check review` on another model),
   fixes, the owner pushes the migration after a dry run right before the merge (production parses the new shapes
   strictly), merge on the owner's word. satisfies every AC

## Consequences

**Positive**:
- Offers become comparable point by point, which is the only comparison a customer can make without chatting.
- Admin tunes the questions per trade without a release; nothing changes for a category until admin acts.
- Old applications keep their meaning through the snapshot.

**Negative / tradeoffs**:
- Two content shapes for an application (message or answers) live side by side; every reader must handle both.
- Admin must write questions in the region's default locale at least; untranslated labels fall back to it.
- Five questions and 600 characters each make a longer card than one message; the card must stay readable at 390px.
- The scanner can still miss contact details written creatively; the card's second scan and reports are the backstop.

**Neutral**:
- `apply_to_request` changes signature (a dropped and created function, grants written again, the function grants
  meta test updated).
- No new analytics event; `application_submitted` stays as it is.

## Follow-up

- [ ] B6: when launch categories are decided, admin writes their provider questions (seed the brief's three examples
  as a starting point if the owner wants them).
- [ ] S16: the form and card copy leave `[draft]`.
- [ ] `/sync`: `ui-registry.md` rows for the question fields on the apply form and the answers block on the card.

## Amendments after the build (2026-11-22, D219)

Recorded from the 19b reviews, record only, built and merged in PR #65 (`5470f42`): the textarea limit floor of 10
(AC-1), the access trigger ahead of the guard (AC-1), the joined text scan at apply and on the card (AC-4, AC-6), and the
data model's snapshot bound corrected to AC-5's 32768. Carry overs are in tracker R26.

## Cross check (Sonnet, 2026-11-22)

The pass over 19a and 19b is recorded in [0011-19a](0011-19a-trust-quality.md#cross-check-sonnet-2026-11-22). Its fixes
for 19b, each the recommended one (owner's standing rule, D213), are written into the text above: X-1 (`request_offers`
hides a suspended chosen provider's answers, Critical), X-2 (`message_hidden` coalesced to false), X-3 (a question set
version from `provider_request`, checked at apply), X-4 (the category row locked before counting active questions),
X-5 (the snapshot keeps only the chosen option; size bounds stated), X-6 (steps 11 to 13 replaced; one read of the
active set; a stale form costs an attempt), X-7 (every argument after the first defaulted; the action sends all four),
X-8 (`application_answers`, so it never collides with the request's `answers`); X-12 names tests 10, 14 and 16.
