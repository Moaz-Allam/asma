# UI Registry

> **Living inventory of every UI component in the project.** Its job is to stop the agent rebuilding a component that already exists, under a different name, on a different screen.

**Rule: check this file before creating any component. Update it in the same commit that adds one.**
An unregistered component is an incomplete task (see `build-plan.md` Definition of Done).

---

## How to use

1. **Before building:** search this file for the need ("card", "status", "money"). Found → reuse. Nearly found → extend it with a variant rather than forking.
2. **After building:** add a row. Fill every column.
3. **Status values:** `✅ done` · `🚧 in progress` · `📋 planned` · `⚠️ needs RTL check`
4. **RTL column:** `✅` only after you have actually viewed it in RTL. Not "should be fine".

---

## 1. shadcn/ui primitives

Add via CLI, one at a time, only when a screen needs it. Do not bulk install.

| Component | Path | Status | RTL | Used by |
| --- | --- | --- | --- | --- |
| _(none yet)_ | `components/ui/` | — | — | — |

<!-- Example row once you add one:
| Button | components/ui/button.tsx | ✅ done | ✅ | everywhere |
-->

**Likely needed** (do **not** pre-install — add on demand): Button, Input, Label, Textarea, Select, Checkbox, RadioGroup, Form, Card, Badge, Dialog, AlertDialog, Sheet, DropdownMenu, Popover, Tooltip, Tabs, Table, Skeleton, Toast/Sonner, Avatar, Separator, Calendar/DatePicker, Pagination.

---

## 2. Shared components

Cross-feature building blocks. Path: `components/shared/`.

| Component | Purpose | Props (summary) | Status | RTL | Used by |
| --- | --- | --- | --- | --- | --- |
| `MoneyDisplay` | Render money from server minor units + currency. **Never computes.** LTR-isolated, tabular figures | `amount`, `currency`, `size?` | 📋 planned | — | everywhere money appears |
| `StatusBadge` | Request status badge from the canonical state machine. One definition, reused | `status: RequestStatus` | 📋 planned | — | all three apps |
| `EmptyState` | Standard empty state: explanation + next action | `title`, `description`, `action?` | 📋 planned | — | all lists |
| `ErrorState` | Plain-language error + retry. Never leaks internals | `message`, `onRetry?` | 📋 planned | — | all data views |
| `LoadingSkeleton` | Layout-matching skeleton | `variant` | 📋 planned | — | all data views |
| `ConfirmDialog` | Confirmation for destructive/money actions; states consequence + amount | `title`, `description`, `amount?`, `onConfirm` | 📋 planned | — | choose, unlock, pay, dispute, withdraw |
| `DeadlineDisplay` | Absolute time + relative hint, from server time | `deadline`, `label` | 📋 planned | — | unlock window, release date |
| `FormField` | Label + control + inline error (visible label always) | standard form props | 📋 planned | — | all forms |
| `PageHeader` | Title + optional actions | `title`, `actions?` | 📋 planned | — | all pages |

---

## 3. Feature components

Domain components. Path: `components/features/<domain>/`.

### Requests

| Component | Purpose | Status | RTL | Notes |
| --- | --- | --- | --- | --- |
| `RequestForm` | Post a request; shows **server-computed** price | 📋 planned | — | Never computes price client-side |
| `PriceSummary` | Price breakdown from server | 📋 planned | — | Display only |
| `RequestCard` | Customer's view of own request | 📋 planned | — | Full detail |
| `RequestShortCard` | **Provider's pre-unlock view** | 📋 planned | — | ⚠️ **PII-free. Must not query restricted fields** |
| `RequestTimeline` | Status progression | 📋 planned | — | From canonical state machine |

### Applications

| Component | Purpose | Status | RTL | Notes |
| --- | --- | --- | --- | --- |
| `ApplicationForm` | Provider applies with message | 📋 planned | — | ⚠️ Warns contact info is rejected **before** submit |
| `ApplicantList` | Customer compares applicants | 📋 planned | — | Rating, jobs completed, message |
| `ApplicantCard` | One applicant | 📋 planned | — | No provider contact pre-unlock |

### Money

| Component | Purpose | Status | RTL | Notes |
| --- | --- | --- | --- | --- |
| `UnlockFeePanel` | Chosen provider pays fixed fee | 📋 planned | — | ⚠️ Idempotent action; confirm dialog with amount |
| `PaymentPanel` | Customer pays; commission + held amount shown | 📋 planned | — | Redirect ≠ proof of payment |
| `EarningsSummary` | Pending / available / paid out | 📋 planned | — | ⚠️ **Read-only mirror. No top-up UI** |
| `LedgerList` | Provider transaction history | 📋 planned | — | Append-only, read-only |
| `PayoutRequestForm` | Withdraw available balance | 📋 planned | — | Confirm dialog |

### Completion and disputes

| Component | Purpose | Status | RTL | Notes |
| --- | --- | --- | --- | --- |
| `CompletionPanel` | Provider marks complete / customer confirms | 📋 planned | — | Shows auto-release deadline |
| `DisputeForm` | Raise dispute before deadline | 📋 planned | — | Only while within window |
| `RatingForm` | Optional rating after release | 📋 planned | — | ⚠️ **Must not gate payment** |

### Provider onboarding

| Component | Purpose | Status | RTL | Notes |
| --- | --- | --- | --- | --- |
| `ProviderRegistrationForm` | Sign-up details | 📋 planned | — | |
| `DocumentUpload` | Verification docs | 📋 planned | — | Private bucket; signed URLs |
| `ZoneSelector` | Work areas | 📋 planned | — | |
| `AvailabilityEditor` | Schedule | 📋 planned | — | |

### Admin

| Component | Purpose | Status | RTL | Notes |
| --- | --- | --- | --- | --- |
| `PricingRulesEditor` | Pricing formula inputs | 📋 planned | — | |
| `QuestionBuilder` | Admin: add/edit/reorder questions per category | 📋 planned | — | ⚠️ `key` immutable after create |
| `QuestionOptionsEditor` | Admin: options for select-type questions | 📋 planned | — | value + Arabic label rows |
| `FormulaBuilder` | Admin: base price + ordered modifiers | 📋 planned | — | ⚠️ Structured rows only — never a text expression |
| `FormulaPreview` | Admin: sample answers → live breakdown | 📋 planned | — | Price always from server |
| `DynamicQuestionForm` | Customer: renders questions by type | 📋 planned | — | ⚠️ Schema generated at runtime |
| `PriceBreakdown` | Customer: base, modifiers fired, addons, zone, total | 📋 planned | — | Display only, never computes |
| `PlatformSettingsForm` | Fees, commission, windows | 📋 planned | — | |
| `ProviderApprovalQueue` | Review + approve/reject | 📋 planned | — | Audit-logged |
| `DisputeQueue` | Resolve: release / partial / refund | 📋 planned | — | Audit-logged |
| `ReportsDashboard` | Requests, revenue, performance | 📋 planned | — | |

---

## 4. Layouts

| Layout | Path | Purpose | Status |
| --- | --- | --- | --- |
| `NotFound` | `app/[locale]/not-found.tsx` | Unknown locale or missing route; localised | ✅ done |
| `ErrorBoundary` | `app/[locale]/error.tsx` | Route error boundary; logs digest, never renders it | ✅ done |
| `RootLayout` | `app/[locale]/layout.tsx` | `lang={locale}` + `dir={dirFor(locale)}` — **derived, never hardcoded** — providers, `setRequestLocale` | ✅ done |
| `LocaleSwitcher` | `components/layout/LocaleSwitcher.tsx` | ar / tr / en; persists to cookie | ✅ done |
| `CustomerLayout` | `app/[locale]/(customer)/layout.tsx` | Customer nav | 📋 planned |
| `ProviderLayout` | `app/[locale]/(provider)/layout.tsx` | Provider nav + earnings summary | 📋 planned |
| `AdminLayout` | `app/[locale]/(admin)/layout.tsx` | Admin nav | 📋 planned |

---

## 5. Custom components (needs justification)

Anything that couldn't be built from shadcn primitives. Keep this table short — a long list means the hierarchy in `ui-rules.md` §1 is being skipped.

| Component | Why shadcn didn't fit | Approved by | Status |
| --- | --- | --- | --- |
| _(none)_ | | | |

---

## 6. Deprecated

Move rows here rather than deleting, so the agent doesn't resurrect them.

| Component | Replaced by | Date |
| --- | --- | --- |
| _(none)_ | | |

---

## 7. Entry format

After building any component, add it here with **the exact classes used**. The next session matches these classes rather than inventing new ones.

```
### ComponentName
**Path:** components/features/requests/ComponentName.tsx
**Used by:** /requests/[id], /provider/feed/[id]
**RTL checked:** ✅

Container:  bg-surface border border-border rounded-xl p-6
Title:      text-[16px] font-semibold text-text-primary leading-6
Body:       text-[14px] font-medium text-text-primary leading-5
Muted:      text-[12px] font-normal text-text-muted leading-4
Badge:      rounded-full px-2 py-0.5 text-[12px] font-medium
```

Rules:
- Record **actual classes**, not intentions
- If a component varies by state, list each variant's classes
- If you deviate from an existing pattern, say why in one line
- `RTL checked` is `✅` only after you have viewed it in RTL

---

## 8. Built components

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
`generateStaticParams` prerenders all three locales.

### LocaleSwitcher
**Path:** components/layout/LocaleSwitcher.tsx
**Used by:** app/[locale]/page.tsx (will move into the navbar at feature 04)
**RTL checked:** ✅

```
Container: flex items-center gap-2
Button:    rounded-md px-2 py-1 text-sm font-medium transition-colors
Active:    bg-accent-muted text-accent
Inactive:  text-text-secondary hover:bg-surface-secondary
```

Notes: language names come from `Intl.DisplayNames` at runtime, **never hardcoded** — a
literal Arabic or Turkish string in a component is copy that cannot be translated, and
the guard hook rejects it. Colour is not the only signal: `aria-current` carries the
active state too (`ui-rules.md` §8).

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
locale. Copy comes from `messages.Error.notFound` / `.backHome`.

### ErrorBoundary
**Path:** app/[locale]/error.tsx
**Used by:** route-level error boundary for everything under `[locale]`
**RTL checked:** ✅

```
Main:    mx-auto flex min-h-svh max-w-3xl flex-col items-start justify-center gap-4 p-4 sm:p-8
Heading: text-2xl font-semibold text-text-primary
Button:  rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground
```

Notes: ⚠️ **`ui-rules.md` §7 — never render the error.** The `digest` is logged in a `useEffect`;
the user sees plain-language copy from `messages.Error.generic` plus a retry that calls `reset()`.
No stack trace, no SQL, no PSP payload. Must stay a Client Component (`'use client'`).

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
comes from `messages/`. Placeholder content until B4 supplies the visual design.
