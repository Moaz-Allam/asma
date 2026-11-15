# 0007. Catalog and pricing engine (position 03)

**Date**: 2026-11-02
**Status**: Accepted (confirmed by the owner 2026-11-02, after a cross check on a second model). Amended 2026-11-15 from the reviews of
PR #27 (D136, D137): five internal functions added to the inventory, the size caps, the insert guard and the settings guard

## Summary

Admin builds the whole catalog as data: categories, services, addons, zones, questions and one price formula per
service, with no code change. The price is computed inside Postgres from the customer's answers, because a hostile
browser can call the database directly and position 04 has no other safe way to write a price. Nothing is seeded: the
owner enters real data (S17) through two new admin pages, and the customer form arrives with 04. The engine stops at the
job price; the commission and the provider fee land in 07.

## Requirements

**User stories**:
- As admin, I want to add categories, services, addons, zones and questions in three languages with no code change, so
  that a new service needs no developer.
- As admin, I want to build a formula from structured rows and try sample answers before I publish, so that a typo never
  reaches a customer.
- As the owner, I want every catalog and formula change recorded, and a published formula never changed, so that old
  requests keep the price they were sold at.
- As a customer (from 04), I want one fixed price from my answers, computed where nobody can tamper with it.

**Prerequisites** (not acceptance criteria):
- **02 merged** (spec 0006). This position reuses `is_admin()`, `has_contact_info()`, `AdminShell`, `AdminRail`,
  `FormField`, `ChoiceChips`, `ToggleChips`, `StatusChip`, `ConfirmDialog`, `ErrorState` and the textarea. Branch
  `feat/03-catalog-pricing` starts from that `master`.
- **Design source.** The live Claude Design project through the `claude_design` MCP, registered at local scope and proved
  on 2026-11-02: `app-05` and `app-06` in `Nazzafly Admin.dc.html`, `s4` in `Nazzafly Web Mockups.dc.html` for the shape of
  the data. Both files were byte identical to `docs/design/source/` that day. Figures in the design are illustration only.
- **S17 blocks content, not the build** (B5, B6). Tests use fixtures and nothing is invented. S17 gains estimated hours per
  service.
- **S21.** New strings go to the translator as `[tr]` keys.

**Acceptance criteria** (the contract):

*Catalog data.*

- **AC-1**: The seven tables of Feature design exist. Every row belongs to one region, and a child row cannot name a parent
  of another region (composite foreign keys). Turning a row off is the only way to retire it: no API role can delete. The
  migration seeds no catalog row. It adds the setting `price_rounding_minor` (`100` in both regions).
- **AC-2**: Text that admin writes is localised JSON, `{ "ar": …, "tr": …, "en": … }`. The region's default locale is
  required (TR `tr`, KSA `ar`), the others are optional. `catalog_text_ok` refuses unknown keys, non strings, and a blank or
  over long value. `localized()` in `lib/catalog/` picks the page's locale, then the region's default, on the server, so a
  Client Component gets one string. The admin lists show which locales a row is missing.
- **AC-3**: Question shape, checked by `question_shape_ok` as the type table says. `key` matches `^[a-z][a-z0-9_]{0,39}$` and
  is unique in its category, retired keys included. `key`, `type`, `category_id` and `service_id` never change, because no
  API role holds an update grant on them. `text`, `textarea`, `date` and `time` can never have `affects_pricing`. A question
  with a null `service_id` is asked for every service of the category; one with a `service_id` is asked for that service
  only. A key means one thing in a category, so nothing overrides anything.
- **AC-4**: A question an active formula reads cannot be turned off, lose `affects_pricing`, stop being `required` (a
  `multi_select` may be optional), or lose an option a modifier matches. `questions_guard` refuses with `question_in_use`, and
  the page says to publish a version without it first.

*The engine.*

- **AC-5**: The order never changes: (1) subtotal is the base price, (2) each modifier in `apply_order`, (3) add the chosen
  addons, (4) multiply by the zone multiplier, (5) round once, `round(subtotal / unit) * unit`, half up, where `unit` is
  `price_rounding_minor`. All arithmetic is exact `numeric`, with no rounding before step 5.
- **AC-6**: Match and effect follow the match table. An unanswered question fires nothing, which can only be an optional
  `multi_select`, because a formula refuses any other optional question (AC-12). `PER_UNIT` adds `amount × answer`. On a multi
  select, `equals` means that option is among the chosen ones, and `in` means any of them, applied once.
- **AC-7**: Answers are checked in the database before any pricing, against the service's active questions. Each failure is
  `{ key, code }`, all returned at once sorted by key, with no price: `answer_unknown`, `answer_required`, `answer_invalid`
  (wrong JSON type, a repeated or unknown option, a bad date or time), `answer_out_of_range` (outside min or max, off step, over
  the length), `contact_info_in_answer` (`has_contact_info` on `text` and `textarea`). JSON null, `[]` and a string of nothing
  but whitespace, NBSP and zero width characters included, count as no answer. A `p_answers` that is not an object returns
  `{ key: null, code: 'answer_invalid' }`.
- **AC-8**: The rounded price must be at least one `unit` and at most `base_price × max_price_multiple` (D13, G11), or the quote
  refuses with `price_out_of_range`. A missing or malformed `price_rounding_minor` or `max_price_multiple` refuses with
  `pricing_settings_invalid`, never a default. Check constraints on `platform_settings` hold both keys: `price_rounding_minor`
  an integer from 1 to 100000, `max_price_multiple` a number above 0 and up to 1000. `quotePrice` raises an alert on
  `pricing_settings_invalid` and only logs `price_out_of_range`, because a customer's own answers can reach that one. Either
  way the caller gets a plain "this service cannot be priced right now".
- **AC-9**: `quote_price` is the only way a signed in non admin reaches the engine. The region comes from the caller's
  `profiles.region`. Checks run in this order: `forbidden` with no profile; `service_unavailable` unless the service and its
  category are active, in that region, with an active formula; `zone_unavailable` unless the zone is active in that region, a
  null zone included; `addon_unavailable` unless each addon is active, on that service, and named once, a null list meaning
  none; `pricing_settings_invalid`; then the answers. It returns the output shape below, whose breakdown holds fired lines only,
  so a customer sees what applied to their answers and never the rules that did not. It writes nothing, and the same inputs on
  the same formula version give the same output.
- **AC-10**: Tamper test (rule 1). No function a customer or provider can run takes a price. A pgTAP meta test fails if any
  function executable by `authenticated` or `anon` has an argument named for money (`price`, `amount`, `total`, `fee`,
  `commission`, `base`), except `publish_pricing_formula` and `preview_pricing_formula`, which refuse non admins with
  `forbidden`. A real customer token calling `quote_price` with an extra `p_price` is refused.
- **AC-11**: Rule 8. A formula is rows. No column holds an expression, and a pgTAP test fails if the source of any pricing
  function contains `execute`.

*Publishing.*

- **AC-12**: `publish_pricing_formula` takes the service, the expected version (0 for the first), the base price and the
  ordered modifiers. The region comes from the service row. In one transaction it locks the service row with `for no key
  update`, refuses `service_unavailable` only when the service does not exist (an off service or category can publish, so a
  question can be retired while it is off), refuses `stale_formula` on a version mismatch, takes `for share` on each question
  the modifiers read, and runs `pricing_formula_errors`. On any error it returns them and writes nothing. A draft equal to the
  active formula, comparing numbers rather than text, returns `no_changes` and writes nothing. Otherwise it inserts the next
  version and its modifiers, moves `active` to it, and writes `pricing.formula_published`. No API role writes either table, and
  `pricing_history_guard` refuses any update or delete on them but `active` true to false, even from the SQL editor.
- **AC-13**: `preview_pricing_formula` takes the same draft plus a zone, addons and sample answers, and runs
  `pricing_formula_errors`, then `pricing_compute`, as a real quote does, so a preview and a quote of the same inputs give the
  same number, proved by a test. It writes nothing and raises no alert. The region comes from the service row. `p_preview`
  changes exactly four things: inactive zones and addons are allowed, only priced questions are checked, the breakdown holds every
  line with `fired` true or false, and a null zone multiplies by 1.

*Access.*

- **AC-14**: RLS (rule 7), each with a negative pgTAP test. An admin reads all seven tables, and inserts and updates the five
  catalog tables on named columns only. A customer, a provider and anon read and write nothing directly: a read returns no rows,
  an update changes none, and an insert is refused. 04 opens its own read path. No API role deletes. No API role, `service_role`
  included, writes `pricing_formulas` or `pricing_modifiers`. Every policy and function decides admin through `public.is_admin()`.
- **AC-15**: `audit_log` records, with who, when, old, new and region, in the same transaction: `catalog.created` and
  `catalog.updated`, through one trigger on the five catalog tables, so a change from the SQL editor is recorded too, with the
  table name as `entity_type`, `id::text` as `entity_id`, and `to_jsonb` of the old and new row. An update that changes nothing
  writes nothing. `pricing.formula_published` has `entity_type` `pricing_formula`, the new id, and `{ version, base_price }` as
  old (null on the first) and new.

*Admin pages.*

- **AC-16**: `AdminRail` gains Catalog and Pricing from a new `ADMIN_RAIL` list in `lib/navigation/menus.ts`. The bottom bar
  stays at three tabs, so below `lg` the page `/admin` shows a link row to each. Both pages use `guardPage` for `admin`, and
  every action uses `guardedAction` with `['admin']`.
- **AC-17**: `/{locale}/admin/catalog` (`app-05`): the category list (name, counts of services and questions, switch, New
  category) beside a panel with tabs Questions, Services, Addons and Zones. `?category=` and `?tab=` are validated and fall
  back silently to the first category and Questions. Every list has up and down arrows, a switch, an add action, an edit
  action and an empty state. Add and edit open a `Sheet`. Below `lg` the category list stacks above the panel. A deactivated
  question shows that old answers are kept.
- **AC-18**: Questions tab. A row shows label, key (mono, `dir="ltr"`), type, a summary of its validation, scope (all
  services, or the service's name), a price chip and a switch. `QuestionBuilder` asks key, type and scope on create only, and
  shows them read only after; `LocalizedField` for label and help text; required; affects price, only for types that can; min,
  max and step for `number`; maximum length for text; `QuestionOptionsEditor` for select types, where a value is typed once
  and an option can be removed unless it is in use.
- **AC-19**: Services tab: name, note, hours, and a state chip: `off` if the service or its category is off, else `no formula`
  with a link to `/admin/pricing?service=`, else `live`. Addons tab: grouped by service, name and price. Zones tab:
  every zone of the region, whichever category is open, with a multiplier field from 0.50 to 2.00 and the line that it
  applies after modifiers and addons, before rounding.
- **AC-20**: `/{locale}/admin/pricing` (`app-06`): a service picker (`?service=`, validated, falling back to the first
  service), title and version chip, a base price field, and `PricingRulesEditor` with one card per modifier: order number,
  question label and key, condition, effect chips, amount or factor, up and down, remove. Add modifier offers only questions
  this service can read, then only the match types and effects the match table allows. The line "then addons, zone
  multiplier, one rounding" stays read only. Publish reads "Publish version N" when the draft differs from the published
  formula, comparing numbers, so `1.3` equals `1.30`, and "Published, no changes" when it does not. Errors from
  `pricing_formula_errors` show on their card, and `stale_formula` reloads the page with a message. The page says old requests
  keep their price.
- **AC-21**: `FormulaPreview` beside the editor: a control per priced question, addon switches, zone chips. It starts with no
  answers and no zone, and shows no total until every required priced question is answered. With no zone the multiplier is 1, and
  a note says so. A change calls `previewFormula` after 400 ms, and a late answer never replaces a newer one. It shows the total in
  `MoneyDisplay` and every line of the breakdown, fired or not, all from the server.
- **AC-22**: Money input (rule 4). `lib/money/parse.ts` works on text, on the server, with string steps, never a float.
  `parseMinor` turns major units into integer minor units: one decimal mark, up to two decimals, limit 100000000 minor units, no
  grouping. `formatMinor` is its inverse, to fill a field. `parseFactor` returns a canonical string for a factor (up to 4 decimals) or a
  zone multiplier (up to 2), which travels as a string to `numeric` and is read back with `::text`. All three take `.`, `,` or U+066B as
  the decimal mark and fold U+0660 to U+0669 and U+06F0 to U+06F9. The browser does no money arithmetic.
- **AC-23**: UI: every value comes from the design source and `ui-tokens.md`. Every new string lives in all three catalogues,
  Turkish as `[tr] `, stored codes map to catalogue keys, and admin text shows escaped. Client Components get small new
  namespaces in `CLIENT_NAMESPACES`. Loading, empty and error states exist for each page; controls work by keyboard and have
  labels; targets are at least 44 px; state is never colour alone. Screens pass at 360, 390, 430 and 1280 px, `tr` first. New
  components get `ui-registry.md` rows. Bodies keep to the list of differences below.

*Signals and proof.*

- **AC-24**: `AlertReason` gains `pricing_settings_invalid`, with the service id as `recordId` and the region, proved by a unit
  test on a mocked refusal. `LogEvent` gains `price_out_of_range`. There is no new analytics event.
- **AC-25**: e2e at 390 px with axe in `ar`, `tr`, `en`, on the real local database: admin follows the links on `/admin`, adds a
  category, a number question, a select question, a service, an addon and a zone, publishes a formula, sees the expected price in the test panel, changes a
  modifier, sees version 2, and is refused turning off a question in use. A separate journey sends a customer and a provider
  to `/admin/catalog` and `/admin/pricing`. Each project has its own admin and its own names, and no test counts a whole list.
- **AC-26**: Real calls, recorded in `verify.md`, on a preview against the cloud project: a real customer token is refused on
  each table and each admin function, and `quote_price` returns the worked figure for a fixture service a real admin published.

## Decision

**Chosen option**: the engine is a set of Postgres functions, and `lib/pricing/` is the app's server only door to them.

A customer's price is computed by `quote_price`, and 04's `create_request` calls it in its own transaction, so no client
ever sends a price and no service role enters a request path. Admin writes the five simple catalog
tables directly under RLS, with one audit trigger, and publishes formulas through one function, so published versions never
change. Reasoning and options: see [rationale.md](rationale.md).

**Implementation skills**: `supabase` (`supabase/agent-skills`, `.agents/skills/supabase/`) ·
`supabase-postgres-best-practices` (`supabase/agent-skills`, `.agents/skills/supabase-postgres-best-practices/`) ·
`shadcn` (`shadcn-ui/ui`, `.claude/skills/shadcn/`) · `tailwind-design-system` (`.claude/skills/tailwind-design-system/`).

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

**Data model** (owner confirmed 2026-11-02). One migration, `catalog_pricing`. `lib/db/database.types.ts` follows through
`npm run db:types`. CI greps migrations, so the phrase `create table` stays out of its comments, and `region` starts its own
line in each table.

Every table has `id uuid` PK, `region text not null` FK `regions(code)`, `created_at timestamptz not null`. The five catalog
tables also have `display_order int not null default 0` and `active boolean not null default false`, so nothing reaches a
customer until admin turns it on.

| Table | Column | Type | Rules |
| --- | --- | --- | --- |
| `service_categories` | `name` | jsonb not null | `catalog_text_ok`, 120 |
| `services` | `category_id` | uuid not null | FK `(category_id, region)` to `service_categories(id, region)` |
| | `name`, `note` | jsonb, `note` null | `catalog_text_ok`, 120 |
| | `hours_min`, `hours_max` | smallint not null | `1 <= hours_min <= hours_max <= 24` |
| `addons` | `service_id` | uuid not null | FK `(service_id, region)` to `services(id, region)` |
| | `name` | jsonb not null | `catalog_text_ok`, 120 |
| | `price` | bigint not null | 1 to 100000000, minor units |
| `zones` | `name` | jsonb not null | `catalog_text_ok`, 120 |
| | `multiplier` | numeric(3,2) not null | 0.50 to 2.00. Default 1 |
| `questions` | `category_id` | uuid not null | FK `(category_id, region)` to `service_categories(id, region)` |
| | `service_id` | uuid null | FK `(service_id, category_id)` to `services(id, category_id)`. Null means every service |
| | `key` | text collate "C" not null | Unique with `category_id` |
| | `label`, `help_text` | jsonb, `help_text` null | `catalog_text_ok`, 120 and 300 |
| | `type` | text not null | One of the eight below |
| | `required`, `affects_pricing` | boolean not null | Default false |
| | `options`, `validation` | jsonb null | `question_shape_ok` |
| `pricing_formulas` | `service_id` | uuid not null | FK `(service_id, region)` to `services(id, region)` |
| | `version` | int not null | From 1. Unique with `service_id` |
| | `base_price` | bigint not null | 1 to 100000000, minor units |
| | `active` | boolean not null | Partial unique index on `service_id` where `active` |
| | `created_by` | uuid null | No FK, history outlives users |
| `pricing_modifiers` | `formula_id` | uuid not null | FK `(formula_id, region)` to `pricing_formulas(id, region)` |
| | `apply_order` | int not null | From 1. Unique with `formula_id` |
| | `question_key` | text collate "C" null | Null only with `always` |
| | `match_type` | text not null | `equals`, `in`, `range`, `is_true`, `always` |
| | `match_value` | jsonb null | As the match table says |
| | `effect_type` | text not null | `FIXED`, `PER_UNIT`, `MULTIPLIER` |
| | `amount` | bigint null | Set unless `MULTIPLIER` |
| | `factor` | numeric(6,4) null | Set only for `MULTIPLIER` |

Unique `(id, region)` on `service_categories`, `services` and `pricing_formulas`, and `(id, category_id)` on `services`, carry
the composite keys. Every foreign key has a covering index, and `region` has one on each table. All references are on delete
restrict.

**Question types**:

| `type` | Stored answer | `validation` | `options` | Can price |
| --- | --- | --- | --- | --- |
| `number` | JSON integer | Required: `{ "min", "max", "step" }`, `0 <= min <= max <= 10000`, `step >= 1`. On step means `(answer - min) % step = 0` | None | Yes |
| `single_select` | Option value | None | 1 to 30 rows | Yes |
| `multi_select` | Array of option values | None | 1 to 30 rows | Yes |
| `boolean` | JSON boolean | None | None | Yes |
| `text` | String | `{ "maxLength" }`, 1 to 500, default 200 | None | No |
| `textarea` | String | `{ "maxLength" }`, 1 to 2000, default 500 | None | No |
| `date` | `YYYY-MM-DD`, a real date | None | None | No |
| `time` | `HH:MM`, 24 hours | None | None | No |

An option is `{ "value": "villa", "label": { … } }`. `value` matches `^[a-z0-9_]{1,40}$`, is unique in the question, and is what
an answer stores (`i18n.md` §5). Lengths count code points after trim, and the `maxLength` defaults live in `pricing_answer_errors`.

A check passes on null, so `catalog_text_ok` and `question_shape_ok` return `coalesce(…, false)`, a nullable column reads
`col is null or helper(…)`, and each branch has its own pgTAP case.

**Match table**:

| Question type | `match_type` | `match_value` | Effects |
| --- | --- | --- | --- |
| `number` | `always` | null | `FIXED`, `PER_UNIT`, `MULTIPLIER` |
| `number` | `equals` | integer | `FIXED`, `PER_UNIT`, `MULTIPLIER` |
| `number` | `range` | `{ "min", "max" }`, inclusive | `FIXED`, `PER_UNIT`, `MULTIPLIER` |
| `single_select` | `equals` | option value | `FIXED`, `MULTIPLIER` |
| `single_select` | `in` | array of option values | `FIXED`, `MULTIPLIER` |
| `multi_select` | `equals`, `in` | as above | `FIXED` |
| `boolean` | `is_true` | null | `FIXED`, `MULTIPLIER` |
| none (`question_key` null) | `always` | null | `FIXED`, `MULTIPLIER` |

Limits: `FIXED` from -100000000 to 100000000, never 0, negative for a discount (`s4` draws one). `PER_UNIT` from 1 to 100000000.
`MULTIPLIER` from 0.1 to 10, at most 4 decimals, below 1 for a discount. At most 50 modifiers. `pricing_formula_errors` returns
`{ index, code }` for each, `index` being `apply_order`, or null for the base price or the whole formula:

- `modifier_malformed`: a wrong JSON type, a missing or extra value, `range` with min above max, an empty or repeated `in`, or a number
  that is not equal to itself at its scale. It tests `jsonb_typeof` before any cast and compares each value with its rounded form,
  because `bigint` and `numeric(6,4)` would otherwise round silently and a preview could differ from a published version.
- `base_price_out_of_range`, `too_many_modifiers`, `amount_out_of_range`, `factor_out_of_range`.
- `question_not_priced`: unknown, off, not `affects_pricing`, or outside this service's questions.
- `question_not_required`: every priced question must be `required`, except a `multi_select`, or a customer could skip a surcharge.
- `match_not_allowed`, `effect_not_allowed`, `option_unknown`.

**Formula in JSON** (publish and preview). Array order is `apply_order`, and a factor is a string:

```json
[{ "question_key": "rooms", "match_type": "always", "match_value": null, "effect_type": "PER_UNIT", "amount": 40000, "factor": null },
 { "question_key": "property_type", "match_type": "equals", "match_value": "villa", "effect_type": "MULTIPLIER", "amount": null, "factor": "1.30" }]
```

**Output shape** of `quote_price` and `preview_pricing_formula`. 04 stores `breakdown`, the formula id and the version as its
`pricing_snapshot`, so names stay readable after a rename:

```json
{ "status": "ok", "price": 350000, "currency": "TRY", "formula_id": "…", "formula_version": 4,
  "breakdown": {
    "base": 120000,
    "modifiers": [{ "question_key": "rooms", "match_type": "always", "match_value": null, "effect_type": "PER_UNIT",
                    "amount": 40000, "factor": null, "units": 3, "fired": true }],
    "addons": [{ "id": "…", "name": { "tr": "…" }, "price": 40000 }],
    "zone": { "id": "…", "name": { "tr": "…" }, "multiplier": "1.00" },
    "unrounded": "350000.00", "rounding_minor": 100 } }
```

`{ "status": "invalid", "errors": [{ "key": "rooms", "code": "answer_out_of_range" }] }` is the answer failure. `quote_price` returns
fired lines only. A preview returns every line, may also return `{ "status": "invalid_formula", "errors": [{ "index": 2, "code":
"option_unknown" }] }`, and has null ids and version when ok.

**Database functions** (each revokes `PUBLIC`, pins `search_path`, passes `supabase/tests/02`). Internal ones run only inside a
definer function, as `has_contact_info` does:

| Function | Kind | Executable by | Job |
| --- | --- | --- | --- |
| `catalog_text_ok(p_value, p_region, p_max)` | invoker, immutable | `authenticated` | AC-2. A check runs as the caller, so the caller needs the grant. Reads nothing. A test proves its locale map equals `regions.default_locale` |
| `question_shape_ok(p_type, p_options, p_validation, p_region)` | invoker, immutable | `authenticated` | AC-3. Same reason |
| `catalog_audit()` | definer, trigger | none | AC-15. After insert or update on the five tables. Compares old and new in its body, because a `when` clause naming `old` is refused on an insert trigger |
| `questions_guard()` | invoker, volatile, trigger | none | AC-4. Row level, before update on `questions`, so its body sees a formula committed while it waited |
| `pricing_history_guard()` | invoker, trigger | none | AC-12. Before update or delete on `pricing_formulas` and `pricing_modifiers` |
| `pricing_answer_errors(p_questions, p_answers, p_priced_only)` | invoker, stable | none | AC-7 |
| `pricing_evaluate(p_base, p_modifiers, p_answers, p_addons_total, p_multiplier, p_rounding, p_max_multiple)` | invoker, immutable | none | AC-5, AC-6, AC-8. Pure, so tests call it directly |
| `pricing_compute(p_region, p_service_id, p_base, p_modifiers, p_zone_id, p_addon_ids, p_answers, p_preview)` | invoker, stable | none | AC-7, AC-9, AC-13. Loads questions, zone, addons, settings, then the two above |
| `quote_price(p_service_id, p_zone_id, p_addon_ids, p_answers)` | definer, stable | `authenticated` | AC-9. The active formula through `pricing_compute`. 04's definer `create_request` calls this too, because `auth.uid()` holds inside it |
| `pricing_formula_errors(p_service_id, p_base, p_modifiers)` | invoker, stable | none | AC-12. Stable, so it takes no lock: Postgres refuses `for share` in a stable function, and the locks sit in `publish_pricing_formula` |
| `preview_pricing_formula(p_service_id, p_base, p_modifiers, p_zone_id, p_addon_ids, p_answers)` | definer, stable | `authenticated`, admin inside | AC-13 |
| `publish_pricing_formula(p_service_id, p_expected_version, p_base, p_modifiers)` | definer | `authenticated`, admin inside | AC-12. Returns `{ status, formula_id, version }`, `{ status: 'invalid_formula', errors }` or `{ status: 'no_changes' }` |
| `catalog_trim(p_text)` | invoker, immutable | none | AC-7. Trims whitespace, NBSP, zero width and direction marks from both ends |
| `pricing_answer_blank(p_answer)` | invoker, immutable | none | AC-7. JSON null, missing, `[]` or a blank string is no answer |
| `pricing_number_at_scale(p_value, p_scale)` | invoker, immutable | none | AC-12. A JSON number equal to itself at a scale, tested before any cast |
| `pricing_canonical(p_modifiers)` | invoker, immutable | none | AC-12. A draft or stored formula as JSON that compares numbers by value, for `no_changes` |
| `pricing_settings_guard()` | invoker, trigger | none | AC-8, D136. Before update or delete on `platform_settings`: the two pricing keys are never deleted or renamed |

Grants (D77): `select` on the seven tables to `authenticated`, `service_role`. To `authenticated`, on the five catalog tables, on named
columns: `insert` on every column but `id` and `created_at`; `update` on every column but those, `region`, each parent id, and `key` and
`type`. Nothing else, and no `delete`.

Because of those column grants an action never upserts: it inserts or it updates, always with `.select('id')`. RLS filters an update
silently, and a token's role can lag behind `is_admin()` after a demotion, so zero rows back means `forbidden`.

**State transitions**: a formula version is `active` or history. Publish moves `active` to the new version in one transaction, and
nothing moves it back. A catalog row is on or off, by admin, in both directions.

**Routes**:

| Path | Group | Who | Notes |
| --- | --- | --- | --- |
| `/{locale}/admin/catalog` | `(admin)` | admin | `?category=`, `?tab=`, each validated |
| `/{locale}/admin/pricing` | `(admin)` | admin | `?service=`, validated |

**API surface**. `lib/pricing/` is the door: `quotePrice`, `previewFormula`, `publishFormula` wrap the three functions, parse the
result with Zod and map codes. `lib/catalog/` holds admin queries, `localized()`, the Zod schemas and the option lists.
`lib/money/parse.ts` holds `parseMinor`, `formatMinor` and `parseFactor`. Browser code imports no Zod (D106). A function's refusal maps
through a code set, as `actions/onboarding.ts` does. On a direct write, Postgres code `23505` maps to `key_taken`, `23514` to
`validation_failed` and `42501` to `forbidden`. A mapped code reaches no Sentry report.

| Name | Kind | Key inputs | Key outputs | Auth | Key errors |
| --- | --- | --- | --- | --- | --- |
| `saveCategory` in `actions/admin-catalog.ts` | Server Action | `id?`, `name` | `id` | `['admin']` | `validation_failed`, `forbidden` |
| `saveService` | Server Action | `id?`, `categoryId`, `name`, `note`, `hoursMin`, `hoursMax` | `id` | `['admin']` | `validation_failed`, `forbidden` |
| `saveAddon` | Server Action | `id?`, `serviceId`, `name`, `price` | `id` | `['admin']` | `validation_failed`, `forbidden` |
| `saveZone` | Server Action | `id?`, `name`, `multiplier` | `id` | `['admin']` | `validation_failed`, `forbidden` |
| `saveQuestion` | Server Action | `id?`, `categoryId`, `serviceId?`, `key`, `type`, `label`, `helpText`, `required`, `affectsPricing`, `options`, `validation` | `id` | `['admin']` | `validation_failed`, `forbidden`, `key_taken`, `question_in_use` |
| `setCatalogActive` | Server Action | `table` (allow list), `id`, `active` | ok | `['admin']` | `forbidden`, `question_in_use` |
| `moveCatalogRow` | Server Action | `table` (allow list), `id`, `direction` | ok | `['admin']` | `validation_failed`, `forbidden` |
| `previewFormula` in `actions/admin-pricing.ts` | Server Action | `serviceId`, `basePrice`, `modifiers`, `zoneId?`, `addonIds`, `answers` | output shape | `['admin']` | `price_out_of_range`, `pricing_settings_invalid`, `service_unavailable` |
| `publishFormula` | Server Action | `serviceId`, `expectedVersion`, `basePrice`, `modifiers` | `version` or errors | `['admin']` | `stale_formula`, `no_changes`, `service_unavailable` |
| `quote_price` | RPC, through `quotePrice` from 04 | `p_service_id`, `p_zone_id`, `p_addon_ids`, `p_answers` | output shape | signed in, with a profile | `forbidden`, `service_unavailable`, `zone_unavailable`, `addon_unavailable`, `price_out_of_range`, `pricing_settings_invalid` |

**Value sourcing**:

| Action | Value | Source |
| --- | --- | --- |
| Admin pages | Which region | `getPublicRegions()`, the first active code. No switch while one region is live (D117), and no hardcoded region |
| Admin pages | Currency | `currencyFor(region)` |
| Category, zone create | Region | The same read, on the server, never from the client |
| Service, addon, question create | Region | The parent row, read in the action. The composite key refuses a mismatch |
| New row | `display_order` | The highest in its scope plus one, read in the action |
| Row move | New order | The scope read in `display_order`, `id` order, the row moved, then 1 to n written to the rows that changed |
| Lists | Text in one locale | `localized(value, getLocale(), regions.default_locale)` |
| Category row | Counts | `services` and `questions` of the category, on and off |
| Services tab | State chip | `services.active`, `service_categories.active`, an active `pricing_formulas` row |
| Pricing page | Questions on offer | Active, `affects_pricing`, same category, `service_id` null or this service |
| Pricing page | First service | Category `display_order`, then service `display_order`, then `id` |
| Pricing page | Version shown, expected version | The active formula's `version`, or 0, in the render |
| Publish, preview | Region | `services.region`, inside the function |
| Publish | New version | Highest `version` of the service plus one, inside the function |
| Publish | `created_by` | `auth.uid()`, inside the function |
| Money field | Minor units | `parseMinor` in the action |
| Quote | Region | `profiles.region` of `auth.uid()`, inside the function |
| Quote | Formula | The row with `active` for that service |
| Quote | Zone multiplier, addon prices | `zones.multiplier`, `addons.price`, read in the function |
| Quote | Rounding unit | `platform_settings (region, 'price_rounding_minor')`, a JSON integer of at least 1 |
| Quote | Ceiling | `base_price × platform_settings (region, 'max_price_multiple')`, a JSON number above 0 |
| Quote | Currency | `regions.currency` |
| Alert | `recordId`, region | The service id passed in, and the region from the caller's session |
| Preview | Formula | The draft in the page, checked by `pricing_formula_errors` |

**Key invariants**:
- The client sends answers, never a price (rule 1). No function a customer can run takes an amount.
- Exactly one rounding step, at the end (rule 4). No float anywhere between the form and the stored row.
- A published formula and its modifiers never change, but for `active` going true to false, and each service has at most one active formula.
- An active formula reads only active, priced, required questions of its own service, a `multi_select` being the one that may be optional.
- Every quoted price is a whole multiple of `unit`, between one `unit` and the ceiling.
- A child row's region is its parent's. Nothing here is ever deleted.
- The engine stops at the job price. No commission, fee or cash due is computed here (D88, D95, position 07).
- Text answers never change a price (§20).

**Security model**: no personal data lives in these tables. A text answer only passes through the engine's checks, and 04 stores it. The
threat model is a signed in user with a real token calling `/rest/v1` directly, so writes stop at grants and RLS, and customers reach
pricing only through a function with no money argument. Formula rows stay private: a customer sees the lines that fired for their own
answers, never the rules that did not. Admins are global (D15), trusted but recorded, and an admin token cannot change a published formula or a question's key by any
path. `publish_pricing_formula` and `preview_pricing_formula` check `is_admin()` first. No service role in a request path.

**Differences from the design, on purpose**:

| Screen | Left out or changed | Why |
| --- | --- | --- |
| `app-05` | Region switch and console search. Addons grouped by service, and questions carry a scope. No addon key column. `start_date` is not a question | D117. `s4` and `architecture.md` put addons on a service and ask general and service questions. An id is enough. A request's dates are columns (§23) |
| `app-06` | A service picker, and the title names the service. Typed fields replace the − and + steppers. Add and remove modifier join. Keys show as small secondary text | A formula is per service (`s4`, `architecture.md`). Real prices are not multiples of a step. The design has no way to add one. `docs/design/README.md` |
| Both | Rail rows for pages not built yet | D117 |

**Failure handling**:
- Two admins publish: the second gets `stale_formula`, and the page reloads with the new version.
- A question is switched off while a publish reads it: the `for share` lock makes one wait, so the guard or the formula check sees the truth.
- Some answers pass the ceiling on a published formula: that quote refuses and logs, and other answers still price. The test panel shows it first.
- A setting row is missing: every quote in that region refuses and alerts, and no default is guessed.
- A service, zone or addon goes off while a customer fills the form: `service_unavailable`, `zone_unavailable` or `addon_unavailable`.
- A price changes between the customer's quote and submit: 04 compares and asks (see Follow-up).
- A preview answer arrives late: the panel keeps the newest.
- A row move fails halfway: two rows can share an order, the tie breaks on `id`, and the next move renumbers the scope. It costs only display order.
- The active region read fails: both pages show `ErrorState` and offer nothing to write.
- Two admins edit one catalog row: the last write wins, and `audit_log` holds both. Only formulas carry a version.

**Configuration required**: no new variable, secret or dependency. One new `platform_settings` key, `price_rounding_minor`, edited by SQL
until the settings page lands in 16. The migration push is an owner step.

**Critical test scenarios**:
- Happy path: the AC-25 journey in three locales, verifies **AC-16** to **AC-21**.
- Worked figures: every row of the table in `verify.md`, including the design's own ₺3,500, verifies **AC-5**, **AC-6**.
- One rounding: a base of 1040 with three multipliers of 1.10 gives 1400, where rounding each step gives 1300, verifies **AC-5**.
- Seeded loop: 300 random formulas through `pricing_evaluate` with a fixed `setseed`, each result a multiple of `unit`, between the floor and
  the ceiling or refused, and the same twice, verifies **AC-5**, **AC-8**. fast-check cannot reach SQL, so this stands in for it.
- Tamper: the meta test, and a customer token writing each table, reading a formula and calling both admin functions, verifies **AC-10**, **AC-14**.
- Race: two sessions publish with `dblink`, one wins; a publish races a question switch off, verifies **AC-4**, **AC-12**.
- Permission: an admin token updating `questions.key`, `pricing_formulas.base_price` or deleting any row is refused, and so is the same change as
  `postgres`, through `pricing_history_guard`, verifies **AC-3**, **AC-12**, **AC-14**.
- Permission: a demoted admin with a live token updates a row and gets `forbidden`, not a silent success, verifies **AC-14**.
- Null safety: each branch of both check helpers, `{ "min": 1 }` with no max among them, refused, verifies **AC-2**, **AC-3**.
- Exposure: `quote_price` on answers that leave a modifier unfired returns no line for it, verifies **AC-9**.
- Skipping: a formula on an optional `boolean` is refused, and making a priced question optional is refused, verifies **AC-4**, **AC-12**.
- Same number: a preview and the quote after publishing it give equal output, verifies **AC-13**.
- `lib/money/parse.ts`: fast-check round trip of `parseMinor` and `formatMinor`, and the table in `verify.md`, verifies **AC-22**.

## Build plan

Tracer bullet, tests first on every access rule and every computed amount. One pull request, `feat/03-catalog-pricing`. The thin thread is
tasks 1 to 3: one fixture service priced by `quote_price`. The pages thicken it. **High risk paths, said out loud:** `supabase/migrations/`,
`lib/pricing/`, `lib/money/`.

1. Tests first, then the migration: tables, RLS, grants, the two check helpers, the three triggers, the setting, the two checks on `platform_settings`;
   pgTAP `09_catalog`; `npm run db:types`; satisfies **AC-1** to **AC-4**, **AC-8**, **AC-14**, **AC-15**.
2. Tests first, then the engine: `pricing_answer_errors`, `pricing_evaluate`, `pricing_compute`, `quote_price`; pgTAP `10_pricing_engine` (worked figures,
   seeded loop, tamper, the `execute` check); satisfies **AC-5** to **AC-11**.
3. Tests first, then `pricing_formula_errors`, `publish_pricing_formula`, `preview_pricing_formula`, with the race; satisfies **AC-12**, **AC-13**.
4. `lib/money/parse.ts`, `lib/pricing/`, `lib/catalog/`, the alert reason and the log event, with unit tests; satisfies **AC-8**, **AC-22**, **AC-24**.
5. Read `app-05` and `app-06` through `claude_design`. `ADMIN_RAIL`, the links on `/admin`, `LocalizedField`; satisfies **AC-2**, **AC-16**, **AC-23**.
6. `/admin/catalog`: categories, Services, Addons, Zones, then Questions with `QuestionBuilder` and `QuestionOptionsEditor`, and the actions;
   satisfies **AC-3**, **AC-4**, **AC-17** to **AC-19**.
7. `/admin/pricing`: `PricingRulesEditor`, `FormulaPreview`, the two actions; satisfies **AC-20**, **AC-21**.
8. Catalogues, `[tr]` count, the screen pass; satisfies **AC-23**.
9. e2e journeys and axe; satisfies **AC-25**.
10. Owner: dry run, then push the migration. Then the real calls of `verify.md`, `/check verify`, `slice-reviewer`, `security-reviewer`, `/check review`
    on another model, merge; satisfies **AC-26**.

Docs in the same change: `project-overview.md` §5 rule 1 (the engine sits in Postgres, `lib/pricing/` is its door) and §20 (the four cuts);
`architecture.md` §4 and §19, with a position section recording what this spec overrides, runtime Zod in §19.6 among them; `code-standards.md` §25;
`ui-registry.md`; `build-plan.md` row 03; the tracker's decision log and owner steps.

## Consequences

**Positive**:
- 04 gets a price inside its own transaction, and a direct API call can never hand one in.
- Exact `numeric` arithmetic, so no float path exists to guard.
- A new category or service needs no code. KSA later is a data change.
- No new dependency, secret, job or service role use.
- Customers read nothing directly, so 04 and 05 open only what they need.

**Negative / tradeoffs**:
- The interpreter is PL/pgSQL: harder to read than TypeScript and proved by pgTAP, with a seeded loop in place of fast-check.
- About a day and a half against the pace of one a day (R2), on top of 02, which is itself over its day.
- No real price exists until S17, so 04 builds on fixtures.
- Every quote is one more database call per form change in 04, with no limit but S23.
- Date driven pricing needs a new match type later. A weekend surcharge cannot be expressed.
- A ceiling failure surfaces per answer, after publish, unless the panel was used first, and it only logs in 03.
- To retire a question, admin publishes a version without it first.
- A priced question cannot be optional, except a `multi_select`.
- Catalog rows have no version, so two admins editing one row overwrite each other.
- A service cannot change category. Admin makes a new one and turns the old one off.

**Neutral**:
- The audit trigger also records a move, as two updates.
- The landing page keeps its samples, and `npm run launch:gate` keeps failing until S17 lands.

## Follow-up

- [ ] Before G1 (D135): the real calls of AC-26 and of the real call section of `verify.md`, on a preview against the cloud project, once
      real sign in works. 03 merged on local CI with these open, on the owner's waiver for the merge only.
- [ ] Position 04: rate limit quotes per user (owner accepted the formula mapping risk, 2026-11-15, R9). Each fired line shows its
      `match_value`, `amount` and `factor`, so many quotes can map a formula; the price surface is the formula, so no field is hidden.
- [ ] Position 04: the customer read path (bookable services, the question set, zones, addons, all without formula rows); `create_request` calls
      `quote_price` in its transaction and stores the snapshots; compare with the price the customer saw and refuse `price_changed`; raise an alert
      on `price_out_of_range` at submit, because the SQL path passes no door; `scheduled_end_at` from `hours_max`; `questions_snapshot`. The zone changes
      the price and the customer picks it, so tie it to the address or accept that anyone can pick the cheapest.
- [ ] Position 05: zones and services for `p4`.
- [ ] Position 07: commission and provider fee from the stored price; when the rate is frozen; rounding the commission so the cash due stays whole
      lira; rewrite the write guard rule `commission-netted` (D96), whose exemption named `lib/pricing`.
- [ ] Position 16: region switch, which must land before KSA goes live, because `KSA` sorts before `TR` and both pages would move to it unasked;
      `price_rounding_minor` on the settings page.
- [ ] When S17 lands: replace `lib/landing/samples.ts` with catalog data (spec 0005 follow up) and set `SAMPLE_DATA` false. This needs a signed out read.
- [ ] Owner: S17 gains hours per service.
- [ ] `/sync`: the `claude_design` row in the MCP table of `AGENTS.md`.
