# Review, feat/03-catalog-pricing, 2026-11-15

**Reviewed by**: sonnet (author assumed on opus, as the project loop says; I could not confirm it in this run)
**Scope**: 56 files, branch `feat/03-catalog-pricing` at `a37d8d7` against master `5f6f283` (PR #27). I read the committed head. The worktree now also holds uncommitted edits to the migration, pgTAP file 10, the tracker and the spec. I did not review those edits.
**Verdict**: Changes requested

**Skipped on request, already known**: size cap on `p_answers` and `p_addon_ids`; INSERT guard on `pricing_formulas` and `pricing_modifiers`; `questions_guard` and a key or type change; DELETE of the two pricing keys in `platform_settings`; `100.0` raising a raw 22P02; the tamper meta test regex, the definer grant allowlist and the rule 8 scan breadth.

## Summary

The engine holds up. I probed rounding, answer validation and the formula checks directly on the local database and found no wrong price and no raised error on bad JSON. The money parser is strict and works on strings only. The catalogues, the RTL classes and the single doors are clean. The weak spots are in the app layer: the new client code repeats the position 02 network failure class in three places, and both pages swallow read errors without a report. Eight Minor items follow. None of them changes a price.

## Critical

None.

## Major

### Major, a dropped connection loses what was typed or hangs the test panel, `components/features/admin/catalog/use-action.ts:35`

**Problem**: `startTransition(async () => { const result = await call(); ... })` has no try and catch. The same shape appears in `components/features/admin/pricing/PricingEditor.tsx:123` (`startPublish(async () => { const result = await publishFormula(...)`) and in the preview timer at `PricingEditor.tsx:95` (`setTimeout(async () => { const result = await previewFormula(request); ...`). A Server Action call that rejects (offline, a reset, "server action not found" after a deploy) behaves like this:
- In the two transitions React rethrows the rejection during render, so it reaches the nearest error boundary. The sheet unmounts and the typed question (three locales, options, validation) or the whole formula draft is gone. Every sheet, switch and arrow on `/admin/catalog` goes through `useCatalogAction` (`CatalogBoard.tsx:70`, `:72`, `CatalogSheets.tsx:103`, `:142`, `:219`, `:280`, `QuestionBuilder.tsx:87`).
- In the preview timer it is an unhandled rejection. `answered` is never set, so `preview` stays `loading` for ever (`PricingEditor.tsx:115-119`). There is no error state for this case.

Position 02 already solved it: `components/features/admin/ProviderFileReview.tsx:97-106` (`safely`, try and catch, then `setError('network')`).

**Why it matters**: this is the class that recurred in 02, it loses admin input that is slow to retype, and the preview panel looks alive while it is dead.

**Suggested fix**: I recommend one try and catch in `run` (keep the sheet open, show a `network` message from `CatalogErrors`), one in `publish` (show `publishFailed` or a `network` notice), and one in the preview timer that sets `{ kind: 'message', code: 'failed' }` behind the existing `id === latest.current` check. Add a unit test that makes the action promise reject, so the class is covered by a test and not only by memory.

### Major, both admin pages swallow every read failure with no report, `app/[locale]/(admin)/admin/catalog/page.tsx:139` and `app/[locale]/(admin)/admin/pricing/page.tsx:88`

**Problem**: `})().catch(() => null)` turns any error from the page queries into the friendly `ErrorState` and drops it. Nothing reaches the log or Sentry. `components/features/admin/AdminShell.tsx:25-28` shows the house rule ("reported, never silent", `reportServerError('adminShell', error)`).

**Why it matters**: the first real use of these pages is the cloud push (S29) and the real calls of AC-26. If a grant, an RLS policy or a type is off there, you see a calm error card and have nothing to debug with. It also hides plain programming errors, for example `formatMinor` throwing on a value that is not a safe integer. User harm is low, diagnosability loss is high, and the fix is two lines.

**Suggested fix**: I recommend `.catch((error) => { reportServerError('adminCatalog', error); return null; })` and the same for pricing. `adminRegion()` returning null is a normal empty answer and can stay as it is.

## Minor

### Minor, a zone multiplier of 10 or more is an unmapped error, `lib/catalog/writes.ts:19`

**Problem**: `catalogCode` maps 23505, 23514, 23503, 22P02 and 42501 only. I reproduced on the local database that a zone `multiplier` of 10 fails with SQLSTATE 22003 `numeric field overflow` (the column is `numeric(3,2)`), not with a check violation. `saveZone` passes `parseFactor('15', 2)` straight through, so typing 15 for 1.5 is a realistic slip.
**Why it matters**: `mapped()` rethrows, so the admin sees "action failed" and Sentry gets a report for a plain typo.
**Suggested fix**: add `'22003': 'validation_failed'` to `SQLSTATE`, and a row for it in `tests/catalog-actions.test.ts:154`.

### Minor, invisible direction marks count as an answer, `supabase/migrations/20261115100000_catalog_pricing.sql:42` and `:522`

**Problem**: the blank pattern in `catalog_text_ok` and `catalog_trim` covers whitespace, NBSP, U+2000 to U+200D, U+2028, U+2029, U+202F, U+205F, U+2060, U+3000 and U+FEFF. It misses U+200E and U+200F (LRM, RLM), U+061C (ALM), U+00AD, U+180E, U+034F, U+2061 to U+2064, U+202A to U+202E and U+2066 to U+2069. I checked each on the local database: `catalog_trim` of those characters is not empty, and a required `text` question answered with only U+200F returns `[]` from `pricing_answer_errors`.
**Why it matters**: AC-7 says "zero width characters count as no answer". LRM, RLM and ALM have zero width and arrive from Arabic keyboards and paste. A required answer or a category name can be one invisible mark.
**Suggested fix**: extend both patterns (they are written out twice on purpose) with those code points, and add a pgTAP case that loops over the list so the two copies cannot drift.

### Minor, integer fields reject Arabic Indic digits while money fields accept them, `components/features/admin/catalog/QuestionBuilder.tsx:31`

**Problem**: `whole()` here, `Number.parseInt` in `CatalogSheets.tsx:149`, `wholeOrText` in `PricingRulesEditor.tsx:27` and the number control in `FormulaPreview.tsx:222` only read `0 to 9`. An admin typing `٣` in `ar` gets a generic `validation_failed`, or "invalid answers" in the panel, with no hint. `lib/money/parse.ts` folds those digits (AC-22), and `lib/catalog/compare.ts:9` already has a client safe `fold`.
**Suggested fix**: reuse `fold` for every integer field, or say "digits 0 to 9" in the field note. I recommend folding.

### Minor, "Before rounding" prints raw minor units next to major units, `components/features/admin/pricing/FormulaPreview.tsx:166`

**Problem**: the line shows `breakdown.unrounded` as the database text, for example `350000.0000`, while the total and every other line go through `MoneyDisplay` (₺3,500.00). The catalogue label has no unit in any locale.
**Why it matters**: an admin reads it as 100 times the total.
**Suggested fix**: format it by string steps (insert the mark two places from the end), or label it as kuruş. No browser arithmetic is needed.

### Minor, `maxLength` written as `200.0` poisons every quote of the category, `supabase/migrations/20261115100000_catalog_pricing.sql:637`

Same class as the known `100.0` item, but in a different function, so I note it in case the in place fix is limited to `amount`. `question_shape_ok('text', null, '{"maxLength": 200.0}', 'TR')` is true, then `(... ->> 'maxLength')::integer` raises `invalid input syntax for type integer: "200.0"`. The loop in `pricing_answer_errors` visits every active question, so one such row refuses every quote in that category. The app UI never sends it, only a direct admin call does. I recommend casting through `numeric` there, or requiring `^[0-9]+$` in the shape check.

### Minor, tests miss the branchy parts, several files

- `lib/catalog/compare.ts` (the "1.30 equals 1.3" rule and the Eastern digit fold), `lib/catalog/localized.ts`, `lib/catalog/queries.ts` `twoDecimals`, and `moveRow` in `lib/catalog/writes.ts:108` have no test. `tests/catalog-actions.test.ts:30-39` mocks `moveRow` away.
- `lib/catalog/options.ts:29` `MATCH_TABLE` is a second copy of the SQL match table (`pricing_formula_errors`, migration `:1075-1084`). Nothing ties the two together, so a change on one side offers illegal choices or hides legal ones until e2e happens to notice.
- `supabase/tests/10_pricing_engine.test.sql:136-160`: the 300 seeded formulas only use `always` lines (FIXED and MULTIPLIER) and empty answers. `PER_UNIT`, `equals`, `in`, `range` and multi select never run in the loop, and those are the branchy parts. The "same inputs give the same output" case (`:131-134`, and `r <> r2` in the loop) compares two calls of one pure expression with the same arguments, so it cannot fail.
- `tests/catalog-actions.test.ts:59` ("only an admin may call them") checks that `requireRole('admin')` was called, not that a non admin is refused.
- No test makes a Server Action promise reject (see the first Major).

### Minor, small state and navigation hygiene on the pricing page

- `components/features/admin/pricing/ServicePicker.tsx:28` plus `pricing/page.tsx:115` (`key={view.service.id}`): picking another service silently drops a dirty draft. The key is right (it stops one service's draft leaking into another), but a warning when `dirty` would match the "never lose typed input" intent.
- `PricingEditor.tsx:181`: `baseError` is cleared only on the next publish, so the red message stays while the admin fixes the field. `:73-77`: after a `stale_formula` reload the old card errors and notice stay on the new version.

### Minor, decision citation and a comment are stale

- `docs/specs/0007-catalog-pricing-engine/index.md:408` cites D99 for "Rail rows for pages not built yet". D99 is the sign up shape. The rule is D117 (`AdminRail` with built pages only).
- `QuestionBuilder.tsx:30` says the text is sent "as typed so the server refuses it", but `whole()` returns `NaN`.
- Unverified: the migration comment at `:275` cites D116 for the `(select public.is_admin())` subselect. I could not find that rule in D116's tracker row, so please check the number.

## Nits

- `FormulaPreview.tsx:19`: the `waiting` kind of `PreviewState` is never produced.
- `FormulaPreview.tsx:109-118`: zone chips do not mark an off zone, addon switches do (`:98`). AC-13 lets the panel use off zones, so the admin cannot tell a real quote would refuse.
- `QuestionOptionsEditor.tsx:39-42`: the key is `option-${index}`, so focus jumps when a middle option is removed.
- `CatalogSheets.tsx:62` and `LocalizedField.tsx:56`: the form has no `noValidate`, so the browser's own "required" bubble appears in the browser language, not the page locale.
- `CatalogSheets.tsx:149`: `parseInt('3.5')` becomes 3 without a word, against "never guessed".
- `PricingEditor.tsx:83-95` (likely, not run in a browser): a service with no required priced question has `complete` true on first open, so the panel fires a preview with an empty base and shows "invalid formula" before the admin typed anything.
- `docs/reviews` note: the tracker line "Committed locally, not pushed" will be stale once PR #27 is open. The dev session is already editing the tracker, so I did not file it.

## Strengths

- Rounding is exact and correct. I ran exact halves (1050 to 1100, 100050 to 100100, 1000.5 units at unit 1 to 1001), unit 100000 at both sides of the half, a zone of 0.50 at the floor, the ceiling exactly met (2000000), 50 multipliers of 10 (refused), and a negative subtotal (refused). The quotient correction after `numeric` division handles the scale limit.
- Answer validation returns codes and never raises for the shapes I tried: null, NBSP plus zero width, `[]`, wrong JSON types, `1e400`, repeated multi select values, bad dates, a non object `p_answers`, SQL null. Both shape helpers and `pricing_formula_errors` return false or a code for malformed JSON.
- Multi select matching applies once (verify.md figure 121000 reproduced).
- `lib/money/parse.ts` is strict, string only, and round trips under fast-check. `-0` becomes `0`.
- Catalogue work is clean: 208 new Turkish keys all carry `[tr] `, ar and en have the same keys, placeholders match in all three, every dynamic key the code builds exists, `npm run lint:rtl` passes, and `LocalizedField` sets `lang` and `dir` per field.
- `PricingEditor` is keyed by service, and the `latest` ref plus the `answered.for === request` identity check give a correct late answer guard.
- `ZeroRows` turns a silent RLS filter into `forbidden`. The match table and limits in the UI follow the spec.

## Test coverage

Covered: the pricing door (`tests/pricing.test.ts`: alert only on `pricing_settings_invalid`, log only on `price_out_of_range`, shape refusal, unknown error rethrown), the money parser (table plus properties), the action layer (zero rows, code mapping, money parsed on the server, edit never sends key or type). pgTAP 09, 10 and 11 carry the engine, RLS and race proof; I read 10's loop and the shape of 11 (`dblink` with `pg_sleep(0.3)` as the wait, which holds because the first session stays open).
Not covered: see the "tests miss the branchy parts" item above.

## What I did not check

- I did not run `npm run verify`, `db:test`, `test:e2e`, a browser at 360, 390, 430 or 1280 px, or axe.
- I read `CatalogBoard.tsx` by grep only (sheet keys, action errors), `catalog/page.tsx` in part, and not `types.ts`, `RowControls.tsx`, `loading.tsx`, `database.types.ts` or `supabase/config.toml`. I read pgTAP 09 and 11 by grep only and 10 for the loop and a few cases. I skimmed the e2e spec by grep.
- I did not reproduce the publish and guard race, and did not run `quote_price` with fixtures to confirm the check order. I read the code against AC-9 and it matches.
- The migration was read from the worktree while it was clean (the line anchors I cite match the committed head). Later uncommitted edits to it and to pgTAP 10 are not reviewed.
- Security attacks were left to the other reviewer, and the six skipped items were skipped.
- Nothing was run against the cloud.

For a second opinion from another provider on this money touching change, you can switch models with `/model` and rerun `/check review`.
