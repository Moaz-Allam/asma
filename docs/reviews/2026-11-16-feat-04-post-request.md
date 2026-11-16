# Review: `feat/04-post-request` (position 04, spec 0008), 2026-11-16

Cross model review, read only, fresh context, at head `80055a4`: `/check review` on Sonnet with the slice
checklist (unused exports, registry rows, the spec's function list against the migration, an AC to test link,
docs status). Author: Opus. The security passes A and B are in
`2026-11-16-feat-04-post-request-security.md`. Fixes are decision D143; findings that need SQL are not fixed in
04, because `20261116090000_post_request` is in the cloud (S30): they go to 05's first migration (R10).

**Verdict:** no Critical; one Major (fixed).

## `/check review` (Sonnet)

| # | Severity | Where | Finding | Resolution |
| --- | --- | --- | --- | --- |
| C1 | Major | `RequestForm.tsx` quote effect | Typing in a text question asked for a quote after every pause, spending the 60 an hour on answers that never change a price | **Fixed**: text, textarea, date and time answers leave the quote key; they travel with each quote from a ref, and their blank state still moves `missing` |
| C2 | Minor | the three request routes | No `loading.tsx` (AC-24) | **Fixed** for `/requests` and `/requests/new` (`PageSkeleton`, new string `Requests.states.loading`; the list moved into a `(list)` route group so its boundary does not wrap the detail). **Not** for `/requests/[id]`: a loading boundary streams the page, and `notFound()` then answers 200 instead of 404 (AC-14, caught by e2e); the detail keeps its real 404 |
| C3 | Minor | `listMyRequests` | Tabs filter against the app server clock, not the database's `now()` | **Accepted** (D143): the server is the app server, never the browser; the drift is seconds at a start that is an hour or more away |
| C4 | Minor | `publish()` on `schedule_invalid` | The day and hour chips did not reload | **Fixed**: clears the day and hour and calls `router.refresh()` |
| C5 | Minor | `lib/pricing/schemas.ts` | `QuoteResult` dead | **Fixed**: removed |
| C6 | Minor | `lib/requests` | Dead re-exports and exports | **Fixed**: the unused re-exports dropped, `answerStillValid` made local |
| C7 | Minor | `AGENTS.md` single doors | The Pricing row still named `quotePrice`; no `lib/requests` row | **Fixed** |
| C8 | Minor | `context/ui-registry.md` | A stale planned `RequestForm` row beside the built one | **Fixed**: removed |
| C9 | Minor | `supabase/tests/10` | Its in file grant makes its function list differ from production | **No change**: `supabase/tests/12` asserts the production list without `quote_price` |
| C10 | Minor | `RequestActions.tsx` | A stale error stayed after a later success | **Fixed**: cleared on open and on success |
| C11 | Minor | tests | No render test for `DynamicQuestionForm` (AC-21), no fake timer test for the stale quote guard (AC-6) | **Deferred**: no component test library is installed (adding one is a dependency decision); both are covered by the e2e journey and the browser pass in `verify.md`. Catalogue parity is a CI grep step and `tests/i18n.test.ts` |
| C12 | Minor | `verify.md` | The 25 row page 2 check was not driven on real rows | **Deferred**: the keyset filter is unit tested; the box stays open |
| C13 | Nit | `lib/requests/view.ts` | `lib` imported a type from `components` | **Fixed**: `PriceLine` lives in `lib/requests/view.ts` |
| C14 | Nit | list page, view | `NUMBER_LOCALE` declared twice; the fallback locale from the user's region | **Fixed** the duplicate; the fallback stays the user's region (customers read only their own region's rows) |
| C15 | Nit | `PriceCard`, rows | `×` and ` · ` glyphs | **No change**: not words; the `×` sits in a `dir="ltr"` span |
| C16 | Nit | spec text vs migration | The time zone guard checks `pg_timezone_names`; indexes are `(service_id, region)` and `(zone_id, region)` | **Accepted** (D143): AC-1's first sentence is the rule; the composite indexes cover the composite keys |

## Second cross pass (coordinator, Sonnet), file lost, rows kept from the message

| # | Severity | Where | Finding | Resolution |
| --- | --- | --- | --- | --- |
| F1 | Major | `RequestForm.tsx` (quote timer, publish), `RequestActions.tsx` (cancel) | No try and catch around the three client Server Action calls (03's D137 settle pattern) | **Fixed**: each call settles to `{ success: false, error: 'action_failed' }` on a throw, so the page shows the catalogue string |
| F2 | Major | the three request routes | No loading state (AC-24) | **Fixed** as C2: list and form; the detail keeps a real 404 instead (AC-14) |
| F3 | Major | `RequestActions.tsx` | Imported a value from `lib/requests/input.ts`, so Zod reached the browser (D106) | **Fixed**: the cancel reasons live in `lib/requests/constants.ts`, with no dependency; `input.ts` reexports them. No CSP report in the e2e runs (`telemetry.spec.ts`, `post-request.spec.ts`) |
| F6 | Minor | `create_request` | With `request_lead_days` 0, a start already past today's hour is accepted | **Deferred, R10** (SQL; 05's first migration) |

## Counts

`/check review`: 0 Critical, 1 Major (fixed), 11 Minor (7 fixed, 1 accepted, 1 no change, 2 deferred), 4 Nit (2 fixed,
1 no change, 1 accepted). Second cross pass, the four kept rows: 3 Major (fixed), 1 Minor (deferred, R10).
