# Review, feat/20-service-agreement (merged, f7bcb4e), 2026-11-23

**Reviewed by**: Sonnet 5.5 (author on another model)
**Scope**: 112 files (`git diff 5940778 f7bcb4e`), branch vs master, already merged
**Verdict**: Changes requested (one Major, a deploy-time gap the spec is silent on; everything else is Minor or Nit)

## Summary
Position 20 adds the three agreement tables with guards and RLS, the acceptance inside the three payer functions, the
frozen agreement row and outbox job in `provider_fee_settled`, a deterministic pdfkit render in the relay, an append only
bucket, mail attachments, notices, the two cards and admin pages. The SQL, relay and storage door follow the spec closely,
the guards are tight, and the pgTAP (138 + 12 assertions), renderer, relay and driver tests cover nearly every AC. The
headline issue is that jobs already at `COMMISSION_PAID` when the migration lands can never be paid by their provider.
The D226 deviations are sound and I accept them.

## Major
### 🟠 In flight `COMMISSION_PAID` picks are stuck at deploy, `supabase/migrations/20261204090000_service_agreement.sql:598-606`
**Problem**: `pay_provider_fee` refuses `agreement_required` unless the customer already has an acceptance for that
application. A pick whose customer paid the commission before this release has none, so its provider can never pay: the
job page then shows the text "Tick the box..." with no box (`app/[locale]/(provider)/provider/applications/page.tsx`, the
`row.agreement_version` null branch). The spec only covers "jobs unlocked before the release" (neutral) and the
`agreement_missing` alert; it is silent on picks in `COMMISSION_PAID` or with a paid commission waiting for the fee.
**Why it matters**: any such job times out, the customer's commission is refunded or carried, and the provider is blocked
for a reason the UI cannot explain. Money and unlock path (priority 1).
**Suggested fix**: stop and ask the owner (it touches the unlock path). Options: a deploy checklist item that the push
waits until no request is in `COMMISSION_PAID` (and the old build is gone), or a defined legacy path (no agreement, no
tick, the existing alert). Either way, give the null `agreement_version` branch an honest message and a test.

## Minor
### 🟡 Try again can dead end after a template change, `lib/requests/checkout-page.ts:37`, `components/features/payments/CheckoutWaiter.tsx:136`
**Problem**: the waiter sends the version the payer already accepted. For the customer `pay_commission` demands the
region's active version, so after a new template goes active the retry is refused `agreement_required`, and the waiter
page has no checkbox to fix it (the message says to tick a box).
**Why it matters**: a payer on the card page cannot recover without leaving the page. Rare, only after a template change.
**Suggested fix**: on `agreement_required` from Try again, send the payer back to the request or job page (where the
current checkbox shows), or make that error's text on the waiter say so.

### 🟡 No index on `service_agreements.storage_path`, `supabase/migrations/20261204090000_service_agreement.sql:1459`
**Problem**: `agreement_read_allowed` looks the agreement up by `storage_path` on every storage read policy check; the
column has no index (only the unique constraints).
**Why it matters**: a sequential scan per signed link and per policy evaluation as agreements accumulate (kept forever, D223).
**Suggested fix**: a partial index on `storage_path where storage_path is not null` in a follow up migration.

### 🟡 Double alert for a render that gave up, `lib/relay/drain.ts:93`, `lib/relay/heartbeat.ts:38`
**Problem**: the last explicit failure alerts through `agreementGaveUp`; `outbox_health` then also lists that failed row and
the heartbeat calls `agreementGaveUp` again, which re-sets `failed_at` and raises `agreement_render_failed` a second time.
**Why it matters**: noise only (same record id joins one issue), but the spec says the heartbeat covers a lease that ran
out, not the same row twice.
**Suggested fix**: in `fail_agreement_render` return `already_failed` when `failed_at` is set and alert only on the first.

### 🟡 `decodeURIComponent` can throw, `app/[locale]/(account)/agreement/[version]/page.tsx:22`
**Problem**: a malformed percent sequence in the URL throws `URIError`, a 500 instead of a 404.
**Suggested fix**: wrap in try/catch and `notFound()`, or skip the decode (the version format has no escapable characters).

### 🟡 Provider feed page swallows an agreement read error, `app/[locale]/(provider)/provider/feed/[id]/page.tsx:37`
**Problem**: `loadMyAgreement(id).catch(() => null)` hides a real failure; the My jobs page reports the same failure through
`reportServerError`. Also the new imports sit above the `next/*` imports.
**Suggested fix**: report as the applications page does; reorder imports.

### 🟡 Admin page hardcodes region time zones, `app/[locale]/(admin)/admin/agreements/page.tsx:21`
**Problem**: a `ZONE` map duplicates `regions.timezone`; KSA or a new region silently falls back to UTC.
**Suggested fix**: have `admin_agreements` return the region's timezone per row (as `provider_jobs` does).

### 🟡 Docs not finished, `AGENTS.md`, `docs/specs/0011-choose-to-launch/0011-20-service-agreement.md`
**Problem**: AGENTS gained the pdfkit stack row, but the single doors table has no `lib/agreements` or
`lib/admin-agreements` row and `lib/storage` does not mention the agreements bucket and `agreements.ts` (spec Follow-up);
the spec's Follow-up boxes stay unchecked and its text (AC-4 "already tells", AC-5 `v_alerts`, the mail budget) still
disagrees with D226.
**Suggested fix**: `/sync` the door rows; `/architect` folds D226 into the spec.

### 🟡 Coverage gaps, `e2e/service-agreement.spec.ts`, `supabase/tests/42_service_agreement.test.sql`
**Problem**: no test for the carried re-pick tick in the choose dialog (`OfferList`), none for the card on a cancelled job
(the spec says it still works), none for Try again after a version change, none for the null `agreement_version` branch.
**Suggested fix**: add the dialog case to the e2e (or a component test), and one pgTAP assertion that `my_agreement`
answers after an admin cancel.

## Nits
- ⚪ `lib/observability/log.ts:55-60`, the agreement id rides in the `request_id` field; a dedicated field name would read honestly.
- ⚪ `actions/agreements.ts:24`, `openAgreementAction` takes `number` from the client only for the file name; the server could read it.
- ⚪ `components/features/payments/PayButton.tsx:94`, `aria-disabled` is redundant next to `disabled`.
- ⚪ `components/features/agreements/AgreementCheckbox.tsx:46`, `target="_blank"` links could carry `rel="noopener"` explicitly.
- ⚪ `supabase/migrations/20261204090000_service_agreement.sql:1367`, an unknown `p_after` cursor silently returns page 1.

## Strengths
- Acceptance and refusal live inside the payer functions in the specified order (X-5), so no payment can exist without
  its acceptance whatever client calls PostgREST; the old overloads are dropped and the grants written again.
- The guards are for every role, the bucket guard refuses update and delete and admits an insert only for an unrendered
  agreement path, and `agreement_text_valid` makes template fields a closed list at the database (rule 8).
- The render is byte stable (fixed dates and producer, ligatures off), uploads with `upsert: false` and accepts "exists"
  only on equal SHA256, and the service role never enters `lib/storage`.
- Money is stored as integers and formatted once through `formatMinorFixed`; the admin view is audited before the link.
- D226 deviations are recorded with reasons; the heartbeat `agreement_gaps` alert keeps `apply_fee_paid` replay stable.

## Test coverage
Strong: pgTAP 42 and 43 cover RLS, grants, guards, each refusal, the provider bound to the customer's version, the reveal
row and number, the gap case, visibility, admin audit, render again and the bucket; vitest covers the renderer (glyphs,
wrapping, determinism), the relay handler, mail attachments and both drivers; the e2e walks tick, pay, reveal, render,
mail and download in three locales. Untested: the items listed under Coverage gaps above.

## Resolutions (2026-11-23, `feat/20-review-fixes`, D227)

| Finding | Resolution |
| --- | --- |
| Major: in flight `COMMISSION_PAID` picks without an acceptance | None existed: the cloud had no `SELECTED` or `COMMISSION_PAID` request when the migration landed (checked 2026-11-23). The provider page now says the agreement is unavailable instead of asking for a tick it cannot show |
| Try again dead ends after a template change | Fixed (with S20-4): once the customer accepted for a pick, pay and Try again take exactly that version; the request page offers it |
| No index on `storage_path` | Fixed: partial index `service_agreements_storage_path_idx` |
| Double alert for a render that gave up | Fixed: `fail_agreement_render` answers `already_failed` after the first, and the relay alerts only on `failed` |
| `decodeURIComponent` can throw | Fixed: try/catch and `notFound()` |
| Feed page swallows a read error | Fixed: reported through `reportServerError` |
| Admin page hardcodes time zones | Fixed: `admin_agreements` returns each row's `timezone` |
| Docs not finished | AGENTS.md door rows and status, build plan and tracker updated; D226 and D227 wait for `/architect` to fold into the spec |
| Coverage gaps | The carried re-pick tick is covered in `e2e/expiry-cancel.spec.ts`; pgTAP 42 adds the cancelled job past the window, the suspended provider, the failing reveal, the template rotation and the queued re-render |
| Nits | `rel` added, `aria-disabled` removed; the log id field and the client sent number are left as they are |
