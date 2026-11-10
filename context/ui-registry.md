# UI Registry

> **Living inventory of every UI component in the project.** Its job is to stop the agent rebuilding a
> component that already exists, under a different name, on a different screen.

**Rule: check this file before creating any component. Update it in the same commit that adds one.**
An unregistered component is an incomplete task (see `build-plan.md` Definition of Done).

Since 2026-10-25 every planned component names its **design reference** (`docs/design/screens/<app>/<id>.jpg`,
ids from `docs/design/README.md`) and the **spec** measured from the design. Build to the reference,
with the tokens of `ui-tokens.md` and the rules of `ui-rules.md`.

---

## How to use

1. **Before building:** search this file for the need ("card", "status", "money"). Found → reuse. Nearly
   found → extend it with a variant rather than forking.
2. **After building:** move the row to §8 with the exact classes used, and set its status.
3. **Status values:** `✅ done` · `🚧 in progress` · `📋 planned` · `⚠️ needs RTL check` ·
   `⚠️ restyle to the design`
4. **RTL column:** `✅` only after you have actually viewed it in RTL. Not "should be fine".

---

## 1. shadcn/ui primitives

Add via CLI, one at a time, only when a screen needs it. Do not bulk install. Restyle each to the design
through tokens (pills, 2px borders, the radius scale) before registering it.

| Component | Path | Status | RTL | Used by |
| --- | --- | --- | --- | --- |
| Button | `components/ui/button.tsx` | ✅ variants primary, secondary, white, destructive, link; sizes sm, md, lg, block, text (`ui-rules.md` §18) | ✅ | everywhere |
| Input | `components/ui/input.tsx` | ✅ 61px field, `read-only` tint (§19) | ✅ | `PhoneField`, onboarding, account |
| Label | `components/ui/label.tsx` | ✅ | ✅ | forms |
| Checkbox | `components/ui/checkbox.tsx` | ✅ 24px | ✅ | onboarding |
| InputOTP | `components/ui/input-otp.tsx` | ✅ boxes shrink to fit 360px, always LTR | ✅ | `CodeField` |
| Switch | `components/ui/switch.tsx` | ✅ the thumb is written to move the other way in RTL | ⚠️ needs RTL check | `NotificationTable` |
| Accordion | `components/ui/accordion.tsx` | ✅ content stays mounted and CSS hides it, so answers are in the server HTML (AC-29) | ✅ | landing FAQ |
| Sheet | `components/ui/sheet.tsx` | ✅ sides `start`, `end`, `top`, `bottom`; `closeLabel` required | ⚠️ needs RTL check | `PublicMenu` |

Added at shadcn CLI 4.21.5 with a hand written `components.json`, because `init` writes its own palette. No
animation classes: the design adds no motion, and `tw-animate-css` is not installed.

**Likely needed** (add on demand): Textarea, RadioGroup (for choice chips), Form, Badge, Dialog,
AlertDialog, DropdownMenu, Popover, Tooltip, Tabs, Table, Skeleton, Sonner, Avatar, Separator, Pagination.

---

## 2. Shared components

Cross-feature building blocks. Path: `components/shared/`.

| Component | Purpose | Spec (from the design) | Design ref | Status | RTL |
| --- | --- | --- | --- | --- | --- |
| `MoneyDisplay` | Money from server minor units + currency. **Never computes.** LTR-isolated, tabular figures | **`font-display`** always (Cairo has no `₺`); sizes: inline, row, XL 72px / L 66px with a smaller currency sign | s4, s7, p8, p9 | ✅ done (`components/shared/MoneyDisplay.tsx`, `lib/format/money.ts`) | ✅ |
| `StatusChip` | Request and provider status from the canonical state machines. One definition, reused (was `StatusBadge`) | Pill 12px Cairo 700 `py-1.5 px-3`, colours from `ui-tokens.md` §4 only («ملغى» on `success-light`, «مرفوض» on `error-light`, D59) | s10, s15, p6, app-02, app-03 | 📋 planned | — |
| `Chip` | Static info chip and the verified chip | Pill 12px 700, `bg-surface-secondary` or `bg-accent-light` («موثّق») | s6, p10 | 📋 planned | — |
| `ChoiceChips` | Single choice as a row of pills (property type, rooms, slots) | Radio group; 50px pills, 14px 700, `py-3 px-5`; selected `bg-accent text-accent-foreground`, else `bg-surface-secondary` | s4, s18, p4, app-06 | 📋 planned | — |
| `Stepper` | Flow progress in the header | Current step navy pill 13px 600 `py-2 px-4`; others `text-text-secondary`, «›» separators (mirror) | s4, s5, s7 | 📋 planned | — |
| `PageHeader` | Page title + explanation + optional actions | h1 44px Alexandria 900 (-0.04em) + 13–15px `text-text-secondary` | every page | ✅ done (`components/shared/PageHeader.tsx`, no actions slot yet) | ✅ |
| `Panel` | The four card kinds of `ui-rules.md` §15 | tinted · emphasis · inverse · white, by `variant` | everywhere | 📋 planned | — |
| `EmptyState` | Big lead + title + next action | Lead in Alexandria 900, one sentence, one or two pills | s17, p17, a4 | ✅ done | ✅ |
| `ErrorState` | Plain-language error + retry; says what stayed safe | Same shape as `EmptyState` | s17, p17, a4 | 📋 planned | — |
| `LoadingSkeleton` | Layout-matching skeleton | Tinted blocks in the card shapes | — | 📋 planned | — |
| `ConfirmDialog` | Destructive or money action; states consequence + amount | White dialog `rounded-panel shadow-overlay`, the amount in `MoneyDisplay`, block pills | s9 (dispute), p8, p9 | 📋 planned | — |
| `DeadlineDisplay` | Absolute time + relative hint, from server time | Inline text; the countdown card for live windows | s9, p11 | 📋 planned | — |
| `CountdownCard` | A running window in big digits | `19:24:08` Alexandria 900 ~72px in an emphasis panel, the deadline under it | p11 | 📋 planned | — |
| `FormField` | Label + control + inline error | Label 13px Cairo 600 `text-text-secondary` above; field per `ui-rules.md` §19 | s4, p2 | 📋 planned | — |
| `InitialAvatar` | A person without a photo | Circle, initial in Alexandria 700, `bg-accent-light` (40px nav, 56px cards) | s6, s7, s9 | ✅ done, 40px; first grapheme through `lib/account/initial.ts` | ✅ |
| `RatingStars` | Choose 1–5 per dimension | Five 44px circles `bg-accent-muted` with ★, selected `bg-accent` | s9, s16 | 📋 planned | — |
| `PhoneField` / `CodeField` | Phone sign-in and the one-time code (D55) | Phone field with the region prefix (`+90` in v1); code as **six** digit boxes (the design draws four), resend countdown | s2, p1 | ✅ done (`components/features/auth/`); `BotCheck` and `LoginForm` beside them, `Function` free | ✅ |
| `ToggleRow` | Add-on with price, notification channel | Wide `rounded-field` row, label at start, price or switch at end | s4, s12 | 📋 planned | — |

---

## 3. Feature components

Domain components. Path: `components/features/<domain>/`.

### Requests

| Component | Purpose | Design ref | Status | RTL | Notes |
| --- | --- | --- | --- | --- | --- |
| `RequestForm` | Post a request; shows the **server-computed** price live | s4, s18 | 📋 planned | — | Never computes price client-side |
| `PriceCard` | Eyebrow, the big price, explanation, breakdown card, main action | s4, s5, s6, s7 | 📋 planned | — | Replaces `PriceSummary`; display only |
| `RequestCard` | Customer's view of own request (summary column) | s6, s9, s15 | 📋 planned | — | Full detail |
| `RequestRow` | One request in "my requests" with status and price | s10 | 📋 planned | — | |
| `RequestShortCard` | **Provider's pre-unlock view** (feed row) | p10, p6 | 📋 planned | — | ⚠️ **PII free: service, size, district, date only. Must not query restricted fields** |
| `RequestTimeline` | Status progression with times | s15, s18 | 📋 planned | — | From canonical state machine |
| `CancelRequestPanel` | Outcome by state at cancellation | s14 | 📋 planned | — | Matches `project-overview.md` cancellation table rows 1–12 |
| `RepeatRequestAction` | Re-post a past request with the same answers | s9 | 📋 planned | — | D56, position 04 (scope override); the price is recomputed on the server |

### Applications

| Component | Purpose | Design ref | Status | RTL | Notes |
| --- | --- | --- | --- | --- | --- |
| `ApplicationForm` | Provider applies with message and structured answers; free, no price field | p8 | 📋 planned | — | ⚠️ Warns contact info is rejected **before** submit; live scan chip |
| `OfferList` | Customer compares applicants (was `ApplicantList`) | s6, s18 | 📋 planned | — | |
| `OfferCard` | One applicant: initial, «أحمد س.», verified chip, stats chips, message, answers, reviews, choose | s6 | 📋 planned | — | Expanded and collapsed; no provider contact pre-unlock |
| `ProviderProfileView` | Customer-facing profile with derived metrics | s8, p7 | 📋 planned | — | Legacy counts split from platform counts |

### Money

| Component | Purpose | Design ref | Status | RTL | Notes |
| --- | --- | --- | --- | --- | --- |
| `PaymentPanel` | Customer pays the commission: the split and the agreement reminder | s7 (re-export, S24) | 📋 planned | — | Redirect ≠ proof of payment; v1 is the iyzico card page only (D57, D93) |
| `ProviderFeePanel` | Chosen provider pays the provider fee; shows the cash to collect | p11 (re-export, S24) | 📋 planned | — | ⚠️ Idempotent; confirm dialog with amount; `CountdownCard` |
| `FeeHistoryList` | Provider's jobs, fees paid and the cash each job was worth, with filters | p9 (re-export, S24) | 📋 planned | — | Read only. No balance, no withdrawal, no top up (D91) |
| `PayoutRequestForm` | Request a payout of the available balance via the PSP | p9 | 📋 planned | — | Confirm dialog with amount |

### Work, completion, reports, ratings

| Component | Purpose | Design ref | Status | RTL | Notes |
| --- | --- | --- | --- | --- | --- |
| `JobPanel` | Won job after unlock: customer details, start and finish | p12 | 📋 planned | — | PII only after the unlock |
| `CompletionPanel` | Provider marks complete / customer confirms | s9, p12 | 📋 planned | — | Shows the confirm deadline |
| `ReportForm` | Report a problem to admin | s9 (re-export, S24) | 📋 planned | — | After the reveal; promises nothing about the cash (D92) |
| `ReportCallout` | Inverse panel with the report button | s9 (re-export, S24) | 📋 planned | — | |
| `RatingForm` | Optional rating per dimension after completion | s9, s16 | 📋 planned | — | ⚠️ **Must not gate anything** |

### Provider onboarding

| Component | Purpose | Design ref | Status | RTL | Notes |
| --- | --- | --- | --- | --- | --- |
| `ProviderSignup` | Phone, then what the provider will pay and how it works | p1 | 📋 planned | — | Inverse hero panel «طلبات مسبقة الدفع!» |
| `ProviderRegistrationForm` | Profile, step 1 of 3 | p2 | 📋 planned | — | |
| `DocumentUpload` | ID, selfie, criminal record; three states | p3 | 📋 planned | — | Private bucket; signed URLs |
| `ZoneSelector` | Districts (choice chips) | p4 | 📋 planned | — | |
| `AvailabilityEditor` | Schedule | p4 | 📋 planned | — | |
| `AccountStateBanner` | Under review, rejected, suspended, document expired | p5, p14 | 📋 planned | — | |

### Notifications

| Component | Purpose | Design ref | Status | RTL | Notes |
| --- | --- | --- | --- | --- | --- |
| `BellMenu` | Bell with count badge and dropdown | s13, p15 | 📋 planned | — | `shadow-overlay`; each item opens its request |
| `NotificationList` | Full page, grouped by day | s13, p15 | 📋 planned | — | Unread dot `bg-alert` |

### Admin

| Component | Purpose | Design ref | Status | RTL | Notes |
| --- | --- | --- | --- | --- | --- |
| `AdminRail` | Navy rail with views and count badges | app-01 … app-09 | 📋 planned | — | White items, active on a light pill |
| `AdminTable` | Tables of the console | app-02, app-03, app-04 | 📋 planned | — | Header row `bg-surface-secondary`; stacked cards on phones |
| `ActionQueue` | "Needs action" list on the dashboard | app-01, a5 | 📋 planned | — | |
| `StatCard` | Counts and held amounts | app-01, app-08 | 📋 planned | — | Amounts via `MoneyDisplay` |
| `PricingRulesEditor` | Pricing formula rows with live preview | app-06 | 📋 planned | — | ⚠️ Structured rows only, never a text expression |
| `QuestionBuilder` | Add/edit/reorder questions per category | app-05 | 📋 planned | — | ⚠️ `key` immutable after create |
| `QuestionOptionsEditor` | Options for select-type questions | app-05 | 📋 planned | — | value + label in three locales |
| `FormulaPreview` | Sample answers → live breakdown | app-06 | 📋 planned | — | Price always from server |
| `DynamicQuestionForm` | Customer: renders questions by type | s4 | 📋 planned | — | ⚠️ Schema generated at runtime |
| `PlatformSettingsForm` | Fees, commission, windows | app-07 | 📋 planned | — | |
| `ProviderApprovalQueue` | Review + approve/reject | app-03, a1 | 📋 planned | — | Audit-logged |
| `ProviderFile` | Lifecycle, derived metrics, documents, actions | a1, a2 | 📋 planned | — | |
| `ReportQueue` | Problem reports: warn, suspend, refund a fee by hand | app-04, a5 (re-export, S24) | 📋 planned | — | Audit-logged (D92) |
| `AdminCancelRefund` | Attribution, outcome, ledger preview | a3 | 📋 planned | — | |
| `LeakageMonitor` | The leakage watchlist: providers with many unlocks and few completions | app-09 | 📋 planned | — | In the brief (`project-overview.md`, admin; feature note 26); no route in §12 yet |
| `ReportsDashboard` | Requests, revenue, performance | app-08 | 📋 planned | — | |

---

## 4. Layouts

| Layout | Path | Purpose | Design ref | Status |
| --- | --- | --- | --- | --- |
| `NotFound` | `app/[locale]/not-found.tsx` | Unknown locale or missing route; localised | s17 | ✅ done · ⚠️ restyle to the design |
| `ErrorBoundary` | `app/[locale]/error.tsx` | Route error boundary; reports an error without a digest to Sentry, never renders it | s17 | ✅ done · ⚠️ restyle to the design |
| `GlobalError` | `app/global-error.tsx` | Last resort for a crash outside the locale layout: own `<html>`, locale from the path (`localeOfPath`), `Error` copy from each catalogue | s17 | ✅ done · ⚠️ restyle to the design |
| `RootLayout` | `app/[locale]/layout.tsx` | `lang={locale}` + `dir={dirFor(locale)}`, **derived, never hardcoded**; providers; `setRequestLocale` | — | ✅ done (fonts per `ui-rules.md` §12 still to load) |
| `LocaleSwitcher` | `components/layout/LocaleSwitcher.tsx` | ar / tr / en as a pill group; persists to the cookie, and to `profiles.locale` with `signedIn` | s12 | ✅ done |
| `SiteHeader` | `components/layout/SiteHeader.tsx` | Wordmark, `NavLinks`, avatar; signed-out pills. No bell before 18 | s1, s3, s6 | ✅ done |
| `FlowHeader` | `components/layout/FlowHeader.tsx` | Wordmark, `Stepper`, cancel or back | s4, s5, s7 | 📋 planned |
| `BottomTabBar` | `components/layout/BottomTabBar.tsx` | Phone: three tabs, fixed, from `lib/navigation/menus.ts` | s18, p18 | ✅ done |
| `SiteFooter` | `components/layout/SiteFooter.tsx` | Copyright, legal links, join link, support link, language | s1 | ✅ done |
| `PublicMenu` | `components/layout/PublicMenu.tsx` | The two bar menu on every width, a `Sheet` from the top: anchors, both calls and the language, stacked | s1 | ✅ done |
| `LandingPhoto` | `components/features/landing/LandingPhoto.tsx` | One photo slot, a file in `public/landing/` under the design's name. Borrowed photos until owned ones exist (D109, Q12) | s1, s2 | ✅ done |
| `SectionHead` | `components/features/landing/SectionHead.tsx` | Landing section title with its outlined link | s1 | ✅ done |
| `CategoryRail` | `components/features/landing/CategoryRail.tsx` | The category row and its two arrows | s1 | ✅ done |
| `AppShell` | `components/layout/AppShell.tsx` | `SiteHeader`, content, `BottomTabBar` for every signed in group. Draws only: `guardPage` is the check | s3, s12 | ✅ done |
| `NavLinks` | `components/layout/NavLinks.tsx` | Desktop role menu with `aria-current` | s3 | ✅ done |
| `CustomerLayout` | `app/[locale]/(customer)/layout.tsx` | `AppShell`, `noindex` | s3 | ✅ done |
| `ProviderLayout` | `app/[locale]/(provider)/layout.tsx` | Provider header with the account state chip | p6 | 📋 planned |
| `AdminLayout` | `app/[locale]/(admin)/layout.tsx` | `AdminRail` + top bar (search, region switch) | app-01 | 📋 planned |

---

## 5. Custom components (needs justification)

Anything that couldn't be built from shadcn primitives. Keep this table short.

| Component | Why shadcn didn't fit | Approved by | Status |
| --- | --- | --- | --- |
| _(none)_ | | | |

---

## 6. Deprecated

Move rows here rather than deleting, so the agent doesn't resurrect them.

| Component | Replaced by | Date |
| --- | --- | --- |
| `StatusBadge` | `StatusChip` (same job; the design's pill chip) | 2026-10-25 |
| `PriceSummary` | `PriceCard` (the design's price card includes the summary) | 2026-10-25 |
| `ApplicantList` / `ApplicantCard` | `OfferList` / `OfferCard` (the design's offers) | 2026-10-25 |
| `FormulaBuilder` | `PricingRulesEditor` + `FormulaPreview` (one console view) | 2026-10-25 |
| `PriceBreakdown` | `PriceCard` breakdown rows | 2026-10-25 |

---

## 7. Entry format

After building any component, add it here with **the exact classes used**. The next session matches
these classes rather than inventing new ones.

```
### ComponentName
**Path:** components/features/requests/ComponentName.tsx
**Used by:** /requests/[id], /provider/feed/[id]
**Design ref:** docs/design/screens/customer/s6.jpg
**RTL checked:** ✅

Container:  bg-surface-secondary rounded-card p-6
Title:      font-display text-card text-text-primary
Body:       text-body-s text-text-secondary
Chip:       rounded-full px-3 py-1.5 text-chip bg-pending-light text-text-primary
```

Rules:
- Record **actual classes**, not intentions; no arbitrary values (`ui-tokens.md` §1)
- If a component varies by state, list each variant's classes
- If you deviate from the reference or an existing pattern, say why in one line
- `RTL checked` is `✅` only after you have viewed it in RTL

---

## 8. Built components

> Built before the design landed (position 00). They use the semantic token names, which are unchanged,
> so they keep working; **restyle each to the design when its position touches it** (pills, 2px borders,
> the radius scale, Alexandria titles).

### LocaleLayout
**Path:** app/[locale]/layout.tsx
**Used by:** every user-facing route
**RTL checked:** ✅ — verified in the prerendered HTML for all three locales:
`<html lang="ar" dir="rtl">` · `<html lang="tr" dir="ltr">` · `<html lang="en" dir="ltr">`

```
<html lang={locale} dir={dirFor(locale)}>   ← both DERIVED. Never hardcode either.
```

Notes: renders `<html>` itself — there is deliberately **no** `app/layout.tsx`, because
next-intl documents removing pass-through root layouts as conflicting with the localized
one. Guards in order: `hasLocale` → `notFound()`, then `setRequestLocale(locale)`.
`generateStaticParams` prerenders all three locales. The three fonts of `ui-rules.md` §12 load here.

### LocaleSwitcher
**Path:** components/layout/LocaleSwitcher.tsx
**Used by:** the landing page, `/login`, `/account` (with `signedIn`)
**RTL checked:** ✅

```
Container: flex w-fit items-center gap-1 rounded-full bg-surface-secondary p-1
Button:    rounded-full px-3.5 py-2 text-btn-sm transition-colors
Active:    bg-accent text-accent-foreground
Inactive:  text-text-primary hover:bg-accent-muted
```

Notes: language names come from `Intl.DisplayNames` at runtime, **never hardcoded** — a
literal Arabic or Turkish string in a component is copy that cannot be translated, and
the guard hook rejects it. Colour is not the only signal: `aria-current` carries the
active state too (`ui-rules.md` §8). Restyled to the design in position 01, as the pill group of s12 ().

### NotFound
**Path:** app/[locale]/not-found.tsx
**Used by:** reached by `notFound()` in the locale layout (unknown locale segment), and any missing route
**RTL checked:** ✅ — logical properties only, no physical direction

```
Main:    mx-auto flex min-h-svh max-w-3xl flex-col items-start justify-center gap-4 p-4 sm:p-8
Heading: text-2xl font-semibold text-text-primary
Link:    text-sm font-medium text-accent underline-offset-4 hover:underline
```

Notes: uses `Link` from `@/lib/i18n/navigation`, **never `next/link`** — the plain one drops the
locale. Copy comes from `messages.Error.notFound` / `.backHome`. ⚠️ Restyle to `s17` (big «404», two pills).

### ErrorBoundary
**Path:** app/[locale]/error.tsx
**Used by:** route-level error boundary for everything under `[locale]`
**RTL checked:** ✅

```
Main:    mx-auto flex min-h-svh max-w-3xl flex-col items-start justify-center gap-4 p-4 sm:p-8
Heading: text-2xl font-semibold text-text-primary
Button:  rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground
```

Notes: ⚠️ **`ui-rules.md` §7 — never render the error.** In a `useEffect` it calls
`reportClientError()` (spec 0004 AC-17), which reports only an error without a `digest` (the server
reported the rest); the user sees plain-language copy from `messages.Error.generic` plus a retry that
calls `retry()` (Next 16). No stack trace, no SQL, no PSP payload. Must stay a Client Component
(`'use client'`).

### GlobalError
**Path:** app/global-error.tsx
**Used by:** a crash that escapes `app/[locale]/layout.tsx`; it replaces the whole document
**RTL checked:** ✅ (`dir` from the locale, tested in `tests/global-error.test.ts`)

Notes: no next-intl provider exists here, so the locale is `localeOfPath(usePathname())`
(`lib/i18n/path-locale.ts`: the first segment when it is a supported locale, exact match, else the
default) and the copy is the `Error` part of each catalogue, imported statically. Same classes, same
reporting rule and same `retry()` as `ErrorBoundary`.

### Landing page
**Path:** app/[locale]/page.tsx
**RTL checked:** ✅

```
Main:      mx-auto flex min-h-svh max-w-3xl flex-col gap-6 p-4 sm:p-8
Header:    flex items-center justify-between gap-4 border-b border-border pb-4
Card:      rounded-xl border border-border bg-surface p-6
Heading:   text-2xl font-semibold text-text-primary
Body:      text-sm text-text-secondary
Muted:     text-sm text-text-muted
```

Notes: logical properties only — no `ml-`/`pr-`/`left-`/`text-left` anywhere, so the
layout flips with the locale for free. Every colour is a semantic token; every string
comes from `messages/`. Placeholder content; the real landing is design screen `s1` (no position yet).
