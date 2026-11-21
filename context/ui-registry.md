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
| Switch | `components/ui/switch.tsx` | ✅ the thumb is written to move the other way in RTL | ✅ checked on `/ar/account` (01b) | `NotificationTable`. Inside a form Radix adds a hidden input, `absolute` and moved `translateX(-100%)`: give the box around the switches `relative` (with its `overflow-hidden`), or in RTL the page scrolls sideways (found by 01b's e2e) |
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
| `AgreementLine` | The agreement reminder above every payment button: one short line and a link to the terms (D92); draft wording until S16 (`components/shared/AgreementLine.tsx`) | — | s7, p11 (S24) | ✅ built (09) | ✅ |
| `MoneyDisplay` | Money from server minor units + currency. **Never computes.** LTR-isolated, tabular figures | **`font-display`** always (Cairo has no `₺`); sizes: inline, row, XL 72px / L 66px with a smaller currency sign | s4, s7, p8, p9 | ✅ done (`components/shared/MoneyDisplay.tsx`, `lib/format/money.ts`) | ✅ |
| `StatusChip` | Request and provider status from the canonical state machines. One definition, reused (was `StatusBadge`) | Pill 12px Cairo 700 `py-1.5 px-3`, colours from `ui-tokens.md` §4 only («ملغى» on `success-light`, «مرفوض» on `error-light`, D59) | s10, s15, p6, app-02, app-03 | ✅ built (02, §9) | — |
| `Chip` | Static info chip and the verified chip | Pill 12px 700, `bg-surface-secondary` or `bg-accent-light` («موثّق») | s6, p10 | 📋 planned | — |
| `ChoiceChips` | Single choice as a row of pills (property type, rooms, slots) | Radio group; 50px pills, 14px 700, `py-3 px-5`; selected `bg-accent text-accent-foreground`, else `bg-surface-secondary` | s4, s18, p4, app-06 | ✅ built (02, §9) | — |
| `Stepper` | Flow progress in the header | Current step navy pill 13px 600 `py-2 px-4`; others `text-text-secondary`, «›» separators (mirror) | s4, s5, s7 | ✅ built (02, §9) | — |
| `PageHeader` | Page title + explanation + optional actions | h1 44px Alexandria 900 (-0.04em) + 13–15px `text-text-secondary` | every page | ✅ done (`components/shared/PageHeader.tsx`, no actions slot yet) | ✅ |
| `Panel` | The four card kinds of `ui-rules.md` §15 | tinted · emphasis · inverse · white, by `variant` | everywhere | 📋 planned | — |
| `EmptyState` | Big lead + title + next action | Lead in Alexandria 900, one sentence, one or two pills | s17, p17, a4 | ✅ done | ✅ |
| `ErrorState` | Plain-language error + retry; says what stayed safe | Same shape as `EmptyState` | s17, p17, a4 | ✅ built (02, §9) | — |
| `LoadingSkeleton` | Layout-matching skeleton | Tinted blocks in the card shapes | — | 📋 planned | — |
| `ConfirmDialog` | Destructive or money action; states consequence + amount | White dialog `rounded-panel shadow-overlay`, the amount in `MoneyDisplay`, block pills | s9 (dispute), p8, p9 | ✅ built (02, §9) | — |
| `DeadlineDisplay` | Absolute time + relative hint, from server time | Inline text; the countdown card for live windows | s9, p11 | 📋 planned | — |
| `CountdownCard` | A running window in big digits | `19:24:08` Alexandria 900 ~72px in an emphasis panel, the deadline under it | p11 | 📋 planned | — |
| `FormField` | Label + control + inline error | Label 13px Cairo 600 `text-text-secondary` above; field per `ui-rules.md` §19 | s4, p2 | ✅ built (02, §9) | — |
| `LocalizedField` | One text in three languages (spec 0007 AC-2) | A `FormField` per locale, each in its own direction, the region's default first and marked required; saved as localised JSON, shown escaped | app-05 | ✅ built (03) | ✅ |
| `InitialAvatar` | A person without a photo | Circle, initial in Alexandria 700, `bg-accent-light` (40px nav, 56px cards) | s6, s7, s9 | ✅ done, 40px; first grapheme through `lib/account/initial.ts` | ✅ |
| `RatingStars` | Choose 1–5 per dimension | Five 44px circles `bg-accent-muted` with ★, selected `bg-accent` | s9, s16 | 📋 planned | — |
| `PhoneField` / `CodeField` | Phone sign-in and the one-time code (D55) | Phone field with the region prefix (`+90` in v1); code as **six** digit boxes (the design draws four), resend countdown | s2, p1 | ✅ done (`components/features/auth/`); `BotCheck` and `LoginForm` beside them, `Function` free | ✅ |
| `PasswordField` | A password with a show and hide button (spec 0012 AC-1, AC-5; `components/features/auth/PasswordField.tsx`) | `Input` with `pe-13`, `dir="auto"`, never trimmed; the eye is a 44px `absolute end-1 top-1/2 -translate-y-1/2 rounded-full text-text-secondary` button with `aria-pressed` and `aria-controls`; optional hint `text-meta font-normal text-text-secondary` | — (s2 field) | ✅ built (01b) | ✅ |
| `PasswordLoginForm` | `/login`'s default mode, phone and password (spec 0012 AC-1 to AC-3; `components/features/auth/PasswordLoginForm.tsx`) | `LoginForm`'s layout: title `font-display text-title-s`, `PhoneField` (`autocomplete="username"`), `PasswordField`, the error box `rounded-row bg-error-light px-4 py-3`, block button, links `text-body-s font-semibold text-link underline underline-offset-4` ("Forgot", "New here") | s2 | ✅ built (01b) | ✅ |
| `ToggleRow` | Add-on with price, notification channel (`components/shared/ToggleRow.tsx`) | Wide `rounded-field` row, a real checkbox, label at start, price or switch at end; checked is `accent-light` plus a filled tick, never colour alone | s4, s12 | ✅ built (04) | ✅ |

---

## 3. Feature components

Domain components. Path: `components/features/<domain>/`.

### Requests

| Component | Purpose | Design ref | Status | RTL | Notes |
| --- | --- | --- | --- | --- | --- |
| `PriceCard` | Eyebrow, the big price, the fired lines, the split (online after choosing a provider, in cash to the provider after the service, D87), main action (`components/shared/PriceCard.tsx`) | s4, s5, s6, s7 | ✅ built (04) | ✅ | Replaces `PriceSummary`; display only, server figures; a per unit line shows amount × count, never multiplied |
| `RequestCard` | Customer's view of own request (summary column) | s6, s9, s15 | 📋 planned | — | Full detail |
| `RequestRow` | One request in "my requests": status chip, service, start, district, price, posted date; the whole card links to the detail (`components/features/requests/RequestRow.tsx`) | s10 | ✅ built (04) | ✅ | "Expired" is OPEN with a past start, a reading, not a state |
| `RequestForm` | Customer: `/requests/new`, both steps, the 400 ms quote loop, publish with the expected figures (`components/features/requests/RequestForm.tsx`) | s4, s5 | ✅ built (04) | ✅ | A late quote never replaces a newer one; the client key is made once per form |
| `RequestActions` | Customer: cancel while OPEN (a `ConfirmDialog` with reason chips) and repeat (`components/features/requests/RequestActions.tsx`) | s14 row 1, s9 repeat | ✅ built (04) | ✅ | |
| `RequestShortCard` | **Provider's pre-unlock view** (feed row) | p10, p6 | ↪ replaced by `FeedCard` (05) | — | ⚠️ **PII free: service, size, district, date only. Must not query restricted fields** |
| `FeedCard` | Provider: one request in the feed: service, district and start, job price, "n of m offers", "You applied" chip, "Details and apply"; full requests greyed with no button (`components/features/provider-feed/FeedCard.tsx`) | p10 | ✅ built (05) | ✅ | Display only; strings from `provider_feed`, which never returns the customer, address, notes or a typed answer |
| `ShortDetailsList` | Provider: the short details of one request as term and value rows, structured answers included (`components/features/provider-feed/ShortDetailsList.tsx`) | p8 | ✅ built (05) | ✅ | Rows built from `provider_request` only |
| `ProviderSetupForm` | Provider `p4` at `/provider/setup`: services by category, districts, work days and hours, a summary card; inactive picks greyed and dropped on save; read only when suspended (`components/features/provider-feed/ProviderSetupForm.tsx`) | p4 | ✅ built (05) | ✅ | No "from" price and no tools tick (D152); a save never sends the file to review (D151) |
| `StandingNotice` | Provider: 02's standing page in place of the feed when not approved (`components/features/provider-feed/StandingNotice.tsx`) | p6, p17 | ✅ built (05) | ✅ | Reuses `AccountStateBanner` |
| `RequestTimeline` | Status progression with times: the steps that happened and the next one greyed, from stored columns only (`components/features/requests/RequestTimeline.tsx`) | s15, s18 | ✅ built (06) | ✅ | 09 to 11 add their steps from their own columns |
| `NextStepPanel` | Customer after the choose: the commission online, the cash to the provider after the service, the stored deadline; the pay button slot for 09 (`components/features/requests/NextStepPanel.tsx`) | s6 (correction), s7 | ✅ built (06) | ✅ | Display only, stored minor units |
| `CancelRequestPanel` | Outcome by state at cancellation | s14 | 📋 planned | — | Matches `project-overview.md` cancellation table rows 1–12 |
| `RepeatRequestAction` | Re-post a past request with the same answers | s9 | 📋 planned | — | D56, position 04 (scope override); the price is recomputed on the server |

### Applications

| Component | Purpose | Design ref | Status | RTL | Notes |
| --- | --- | --- | --- | --- | --- |
| `ApplicationForm` | Provider applies with a message; free, no price field; a confirm restates the deal; a replay shows the stored status (`components/features/provider-feed/ApplicationForm.tsx`) | p8 | ✅ built (05) | ✅ | ⚠️ Warns contact info is rejected **before** submit; no live scan, no structured answers (D152, D153); a refusal keeps the message |
| `ApplicationRow` | Provider: one application in "My applications": status chip, service, district and start, job price, applied date (`components/features/provider-feed/ApplicationRow.tsx`) | p13 (list) | ✅ built (05) | ✅ | Withdraw is position 12 |
| `OfferList` | Customer compares the offers on an OPEN request and chooses one behind a `ConfirmDialog` that restates the deal (`components/features/requests/OfferList.tsx`) | s6, s18 | ✅ built (06) | ✅ | Read only when the request expired; the exact deadline shows only after the choose |
| `OfferCard` | One offer: letter avatar, first name and family initial («أحمد س.»), Verified and New chips, on the platform since, the message or "Message hidden" (`components/features/requests/OfferCard.tsx`) | s6 | ✅ built (06) | ✅ | No photo, full name or contact detail before both have paid (D159); ratings, job counts and reviews come in 17 and 19 |
| `ProviderProfileView` | Customer-facing profile with derived metrics | s8, p7 | 📋 planned | — | Legacy counts split from platform counts |

### Money

| Component | Purpose | Design ref | Status | RTL | Notes |
| --- | --- | --- | --- | --- | --- |
| `PaymentPanel` | Customer pays the commission: the split and the agreement reminder | s7 (re-export, S24) | ✅ built (09) as `NextStepPanel` + `AgreementLine` + `PayButton` | ✅ | Redirect ≠ proof of payment; v1 is the iyzico card page only (D57, D93). Design pass owed after S24 |
| `PayButton` | Pay: takes a `PayTarget` (commission by request id, provider fee by application id, 10) and sends that id only (rule 1); a new attempt goes to the pay page, a young one is reused, a commission of 0 settles and reloads; refusals show their catalogue string (`components/features/payments/PayButton.tsx`) | s7 (S24) | ✅ built (09) | ✅ | 10 reuses it for the provider fee |
| `CheckoutWaiter` | Pay page and return page: polls the payer's own attempt (`open` 1 s for 15 s, `return` 2 s for 2 min, then Refresh); shows only what the relay verified; the card URL replaces the history entry (`components/features/payments/CheckoutWaiter.tsx`) | s7 (S24) | ✅ built (09) | ✅ | Spec 0011-09 AC-11, AC-12; never shows paid from a redirect |
| Receipt page | `/[locale]/receipts/[feeId]`: our fee id as the number, kind, amount, status, paid time, service, date, "not a tax invoice" (`app/[locale]/(customer)/receipts/[feeId]/page.tsx`) | s7 (S24) | ✅ built (09) | ✅ | No PSP payment id (D175, R13); payer only, else 404 |
| `ProviderFeePanel` | Chosen provider pays the provider fee; shows the cash to collect | p11 (re-export, S24) | ✅ built (10) as the Chosen tab card on My jobs (`app/[locale]/(provider)/provider/applications/page.tsx`) with `AgreementLine` and `PayButton` | ✅ | Idempotent in Postgres (`pay_provider_fee`); no confirm dialog, the amount is on the button. Design pass owed after S24 |
| `JobActionButton` | Started, Done, Confirm and "Job done": opens `ConfirmDialog`, sends the request id only, refreshes; a refusal shows its string (`components/features/jobs/JobActionButton.tsx`) | s7, p11 (S24) | ✅ built (11) | ✅ | Postgres decides the start day and the state; no money moves (D91) |
| `WithdrawButton` | Withdraw on My jobs (Applied, Chosen) before the reveal: `ConfirmDialog` whose body follows the application status (§36 rows 3, 6), sends the application id only (`components/features/jobs/WithdrawButton.tsx`) | p10 (S24) | ✅ built (12) | ✅ | Postgres refuses after the reveal and during a young fee attempt |
| `CancelJobButton` | The unlocked provider cancels the job (§36 row 9): `ConfirmDialog` listing what `cancel_preview` says (customer told, fee kept, counts against), sends the request id only (`components/features/jobs/CancelJobButton.tsx`) | p11 (S24) | ✅ built (12) | ✅ | No fee comes back by itself after the reveal |
| `AdminReasonAction` | Admin refund by hand (AC-8) or a refused refund recorded as done by hand (AC-9), or a deadline flag cleared by hand (16, R-7): `ConfirmDialog` with a 10 to 500 character reason or note, counted as Postgres counts it (`components/features/admin/requests/AdminReasonAction.tsx`) | a2 | ✅ built (12, 16) | ✅ | No amount is ever sent; the reason goes only to `audit_log` |
| `AdminRequestActions` | Admin's operations on one request (spec 0011-16): `AdminCancelAction` (attribution chips, the paid fees with a link to refund each, a reason), `AdminExtendAction` (the one deadline the state allows, 1 to 48 hours, a reason), `AdminAddressButton` (a reason, then the street line held only in the component) (`components/features/admin/requests/AdminRequestActions.tsx`) | a2 | ✅ built (16) | ✅ | No amount is ever sent; the line is never rendered by the server page (R-8) |
| Admin request list, flag queue, revenue | `/admin/requests` (GET filter form, cards, pager), `/admin/flags` (open flags oldest first, Clear), `/admin/revenue` (range and grain form, one card per region, currency and period, late payments apart, Download CSV) | a2 | ✅ built (16) | ✅ | No name, phone, address or note on the list (R-2); amounts summed in Postgres |
| `ReportForm` | The one report form for both sides: reason chips, the text with its count, up to three photos; the report first, then each photo uploaded and registered, a failed photo retried while the report is open (`components/features/reports/ReportForm.tsx`) | p11 (S24) | ✅ built (14) | ✅ | Postgres decides party, window and limits (R-1 to R-4); photos re-encoded as JPEG, EXIF dropped |
| `ReportScreen` | The report page of either side: back link, header, the form, or why no report can be filed now (`components/features/reports/ReportScreen.tsx`) | p11 | ✅ built (14) | ✅ | 404 for a request the caller is not a party to |
| `ReportStatus` | The caller's own report in one line (open or reviewed, never the outcome) and "Report a problem" while one can be filed (`components/features/reports/ReportStatus.tsx`) | s7, p11 | ✅ built (14) | ✅ | The other side never sees a report exists (AC-7) |
| `WarningBanner` / `UserWarning` | Admin's warning as a fixed sentence per reason code, on every page of the customer's and the provider's area, until "I understand" (`components/features/reports/WarningBanner.tsx`, `UserWarning.tsx`) | s7, p11 | ✅ built (14) | ✅ | Never admin's words (R-9) |
| `HandleReportForm` | Admin handles a report once: outcome chips, a warning reason, a note, an optional refund of one of the request's paid fees named with payer and amount, a confirm dialog (`components/features/admin/reports/HandleReportForm.tsx`) | a2 | ✅ built (14) | ✅ | No amount is ever sent; the note stays on the report (R-12) |
| `ReportPhotoButton` | One report photo behind Show: the view is audited, then a 60 second signed link drawn as a plain image (`components/features/admin/reports/ReportPhotoButton.tsx`) | a2 | ✅ built (14) | ✅ | X-3: Storage admits admin only with a fresh view row |
| `ContactCard` | The other side's contacts after both fees: name, phone, WhatsApp (`wa.me`), email with "unconfirmed", and for the provider the street line, notes, zone and start; Call, WhatsApp, Email buttons; inside `data-pii` (`components/shared/ContactCard.tsx`, `ContactsSeen.tsx` sends `contacts_unlocked`) | s7, p11 (S24) | ✅ built (10) | ✅ | Renders only what `request_contacts` returns (rule 2); phone and email LTR isolated |
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
| `DocumentUpload` | ID, selfie, criminal record; three states | p3 | ✅ built (02, §9) | — | Private bucket; signed URLs |
| `ZoneSelector` | Districts (choice chips) | p4 | 📋 planned | — | |
| `AvailabilityEditor` | Schedule | p4 | 📋 planned | — | |
| `AccountStateBanner` | Under review, rejected, suspended, document expired | p5, p14 | ✅ built (02, §9) | — | |

### Notifications

| Component | Purpose | Design ref | Status | RTL | Notes |
| --- | --- | --- | --- | --- | --- |
| `BellMenu` | Bell with count badge and dropdown | s13, p15 | 📋 planned | — | `shadow-overlay`; each item opens its request |
| `NotificationList` | Full page, grouped by day | s13, p15 | 📋 planned | — | Unread dot `bg-alert` |
| `EmailNudge` | A quiet note asking for a confirmed email, linking to `/account`; never a block (`components/shared/EmailNudge.tsx`) | — (no design ref; `rounded-row bg-accent-light`, a white pill) | ✅ built (13) | ✅ | Spec 0011-13 AC-4: My requests and the choose dialog while mail is on; the feed and the apply page while the apply gate is on. Strings from the caller |
| `EmailLinkButton` | "Send link again": a `type="button"` that calls `requestEmailConfirmation` and shows the sent line or the refusal (`components/features/account/EmailLinkButton.tsx`) | s12 | ✅ built (13) | ✅ | Inside the account form it never submits the form; shown only while mail is on |
| `ConfirmEmailForm` | The confirm page's one button (a POST through `confirmEmail`), the done line, or one refusal (`invalid_link`, `link_expired`, `link_used`) with "Send link again" (`components/features/account/ConfirmEmailForm.tsx`) | — (s12 styles) | ✅ built (13) | ✅ | Opening the link changes nothing, so a mail scanner confirms no address (AC-7) |

### Account password (01b)

| Component | Purpose | Design ref | Status | RTL | Notes |
| --- | --- | --- | --- | --- | --- |
| `SetPasswordForm` | The password step at `/account/password`: a first or a reset password, two `PasswordField`s, the rules line, problems and Auth errors in one `rounded-row bg-error-light` box, `othersLeft` as `bg-warning-light` (`components/features/account/SetPasswordForm.tsx`) | — (s12 styles) | ✅ built (01b) | ✅ | The submit waits for `useHydrated`, so a tap before hydration is never a native GET with the password in the URL. The event is sent with `leaving` (a full load follows) |
| `PasswordSection` | The account page's Password card: a reminder (`rounded-card bg-warning-light px-6 py-5`, a white pill link) while no password is set, else "last changed" and the change form (`rounded-card border-2 border-border bg-surface px-6 py-5`) (`components/features/account/PasswordSection.tsx`) | s12 | ✅ built (01b) | ✅ | Heading `font-sans text-label font-semibold`, as `SignOutCard` |
| `ChangePasswordForm` | Current, new and repeat `PasswordField`s, "Forgot it?" link, one `BotCheck`, a `secondary` button; success as `rounded-row bg-success-light` (`components/features/account/ChangePasswordForm.tsx`) | s12 | ✅ built (01b) | ✅ | The phone comes from the server page, never typed; `router.refresh()` redraws "last changed" |

### Admin

| Component | Purpose | Design ref | Status | RTL | Notes |
| --- | --- | --- | --- | --- | --- |
| `AdminRail` | Navy rail with views and count badges | app-01 … app-09 | ✅ built (02, §9) | — | White items, active on a light pill. Items from `ADMIN_RAIL` (03; 16 adds Requests, Flags and Revenue, badges for files, flags and reports); below `lg` the page `/admin` links to the pages the bottom bar has no tab for |
| `AdminTable` | Tables of the console | app-02, app-03, app-04 | 📋 planned | — | Header row `bg-surface-secondary`; stacked cards on phones |
| `ActionQueue` | "Needs action" list on the dashboard | app-01, a5 | 📋 planned | — | |
| `StatCard` | Counts and held amounts | app-01, app-08 | 📋 planned | — | Amounts via `MoneyDisplay` |
| `PricingRulesEditor` | Pricing formula rows, one card per modifier: order, question label and key, condition, effect chips, amount or factor, up, down, remove | app-06 | ✅ built (03) | ✅ | ⚠️ Structured rows only, never a text expression. Offers only the match types and effects of `MATCH_TABLE`. Typed fields replace the design's steppers; amounts are text, parsed on the server |
| `QuestionBuilder` | Add or edit one question in a `Sheet`: key, type, scope (create only), label, help, required, affects price, number range, text length, options | app-05 | ✅ built (03) | ✅ | ⚠️ Key, type and scope read only after create. Affects price only for number, selects and yes or no |
| `QuestionOptionsEditor` | Options for select questions | app-05 | ✅ built (03) | ✅ | Value typed once (mono, `dir="ltr"`), label in three locales through `LocalizedField`; at most 30 |
| `FormulaPreview` | Test panel: a control per priced question, addon switches, zone chips, the total and every line, fired or not | app-06 | ✅ built (03) | ✅ | Price always from the server. No total until every required priced question is answered; asks 400 ms after a change; a late answer never replaces a newer one |
| `CatalogBoard` | `/admin/catalog`: categories beside a panel with Questions, Services, Addons and Zones tabs | app-05 | ✅ built (03) | ✅ | Category and tab in the URL; stacks below `lg`; every list has up, down, a switch, add, edit and an empty state |
| `RowControls` | Up, down, on and off, edit, for one catalog row | app-05 | ✅ built (03) | ✅ | 44px targets, each named for its row |
| `PricingEditor` | `/admin/pricing`: base price, `PricingRulesEditor` and publish, beside `FormulaPreview` | app-06 | ✅ built (03) | ✅ | Publish version N only when the draft differs, compared as numbers in text; `stale_formula` reloads |
| `ServicePicker` | The service whose formula is open, grouped by category | app-06 | ✅ built (03) | ✅ | Changes `?service=` |
| `CatalogSheet` | The add and edit `Sheet` of the catalog: title, fields, the refusal, one Save | app-05 | ✅ built (03) | ✅ | `noValidate`: every message comes from the catalogue in the page locale, never the browser bubble |
| `CategorySheet` | Add or edit a category name in three languages | app-05 | ✅ built (03) | ✅ | Region read on the server |
| `ServiceSheet` | Add or edit a service: name, note, hours 1 to 24 | app-05 | ✅ built (03) | ✅ | Hours fold Eastern digits; `3.5` is refused, never 3 |
| `AddonSheet` | Add or edit an addon: service (create only), name, price | app-05 | ✅ built (03) | ✅ | Price is text, parsed into minor units on the server |
| `ZoneSheet` | Add or edit a zone: name, multiplier 0.50 to 2.00 | app-05 | ✅ built (03) | ✅ | Multiplier is text, canonical on the server; a typo like 15 is a refusal |
| `DynamicQuestionForm` | Customer: renders questions by type (`components/features/requests/DynamicQuestionForm.tsx`) | s4 | ✅ built (04) | ✅ | Number as chips up to 8 values, else a field; hints in plain TypeScript, the database checks (D106, D125) |
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
| `FlowHeader` | `components/layout/FlowHeader.tsx` | `Stepper` at the start, cancel or back at the end (the wordmark stays in `AppShell`) | s4, s5, s7 | ✅ built (04) |
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
| `AdminLayout` | `app/[locale]/(admin)/layout.tsx` | `AdminShell`: `AdminRail` from `lg`, the normal header and `BottomTabBar` below it. No search and no region switch yet (spec 0006 AC-13) | app-01, app-03 | ✅ built (02) |

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

## 9. Built in position 02 (spec 0006, 2026-11-10)

RTL: every piece uses logical properties only (`lint:rtl` clean), and the visual pass in `ar`, `tr` and `en` at
360, 390, 430 and 1280 px ran in `/check verify` on 2026-11-11, so each row says ✅. Frames read from the live Claude Design project (`p2`,
`p3`, `p5`, `p7`, `p14`; `app-03`, `a1`, `a2`, `a4` from the admin export, which matches live).

### StatusChip
**Path:** components/shared/StatusChip.tsx · **Used by:** provider header, queue rows, document cards · **Design ref:** p5, app-03 · **RTL checked:** ✅ 2026-11-11
```
Pill:     inline-flex shrink-0 items-center rounded-full px-3 py-1.5 text-chip whitespace-nowrap
waiting:  bg-warning-light text-warning-foreground   (pending, approved: D59)
negative: bg-error-light text-error-foreground       (rejected, suspended, document_expired)
neutral:  bg-surface-secondary text-text-primary     (draft, not started)
info:     bg-accent-light text-text-primary          (review reason, matching)
```
The label always names the state. `STANDING_TONE` in `components/features/provider/StandingChip.tsx` is the one standing mapping.

### ChoiceChips · ToggleChips
**Path:** components/shared/ChoiceChips.tsx, ToggleChips.tsx · **Used by:** step 1 (entity type, languages) · **Design ref:** p2 · **RTL checked:** ✅ 2026-11-11
```
Pill:     inline-flex min-h-11 cursor-pointer items-center rounded-full px-5 py-3 text-btn-sm
Selected: bg-accent text-accent-foreground   (ToggleChips adds a Check icon, so never colour alone)
Else:     bg-surface-secondary text-text-primary
Focus:    has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring
```
Real radio and checkbox inputs, `sr-only`, inside a `fieldset` with a `legend`.

### Stepper
**Path:** components/shared/Stepper.tsx · **Used by:** steps 1 and 2 · **Design ref:** p2, p3 · **RTL checked:** ✅ 2026-11-11
```
Step:     inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 py-2 (text-body-s font-semibold)
current:  bg-accent text-accent-foreground (aria-current="step") · done: bg-surface-secondary + Check · next: text-text-secondary
Separator: › with rtl:-scale-x-100
```

### ConfirmDialog
**Path:** components/shared/ConfirmDialog.tsx · **Used by:** replace on an approved file, company change, rename, suspend, lift · **Design ref:** a2 · **RTL checked:** ✅ 2026-11-11
```
Overlay: fixed inset-0 z-40 bg-surface-inverse/40
Content: fixed inset-x-4 top-1/2 z-50 mx-auto flex max-w-md -translate-y-1/2 flex-col gap-4 rounded-panel bg-surface p-6.5 shadow-overlay
Title:   font-display text-title-s text-text-primary · Body: text-body-s text-text-secondary
Buttons: Button lg (flex-1) + Button lg secondary
```
Radix Dialog from `radix-ui`; `children` holds a field (the suspension reason).

### ErrorState · PageSkeleton · FormField · Textarea
**Paths:** components/shared/ErrorState.tsx, PageSkeleton.tsx, FormField.tsx, components/ui/textarea.tsx · **RTL checked:** ✅ 2026-11-11
```
ErrorState:  role=alert, EmptyState's shape on bg-error-light (rounded-card px-6.5 py-12 text-center)
PageSkeleton: role=status, animate-pulse blocks bg-surface-secondary (rounded-row, rounded-panel)
FormField:   Label above, control, note text-meta text-text-secondary, error text-meta text-error with id `${id}-error`
Textarea:    Input's classes with min-h-24 py-4
```

### Provider onboarding (feature)
**Paths:** components/features/provider/{OnboardingFrame,ProfileForm,DocumentsStep,FileProgress,StandingChip,AccountStateBanner,ProviderProfileView}.tsx, use-provider-upload.ts · **Used by:** /provider, /provider/profile, /provider/profile/documents · **Design ref:** p2, p3, p5, p7, p14 · **RTL checked:** ✅ 2026-11-11
```
Frame grid:   grid items-start gap-3.5 lg:grid-cols-[1.5fr_1fr]; aside lg:sticky lg:top-4
Gate line:    rounded-block bg-accent-light p-5 + chip rounded-full bg-accent px-4.5 py-2 text-chip text-accent-foreground
Progress:     rounded-panel bg-surface-secondary p-6.5; bar h-3 rounded-full bg-track, fill bg-accent; role=progressbar
Doc card:     rounded-block p-5 lg:p-6.5 border-2 (border-border; uploaded border-accent-light bg-surface-secondary; missing at submit border-error)
Photo:        size-26 rounded-full overflow-hidden bg-surface-secondary, plain <img>
Status panel: rounded-panel bg-accent-light p-6.5 lg:p-9, title font-display text-title
```
File inputs are `sr-only` with `tabIndex=-1` and an `aria-label`; a pill button opens them, so the keyboard reaches one control per file. Images show through a plain `<img>` (never `next/image`: its optimizer would fetch a signed link).

### Admin console (feature)
**Paths:** components/features/admin/{AdminShell,AdminRail,ProviderQueue,ProviderFileReview}.tsx · **Used by:** /admin, /admin/providers, /admin/providers/[id] · **Design ref:** app-03, a1, a2, a4 · **RTL checked:** ✅ 2026-11-11
```
Rail:        hidden w-64 shrink-0 flex-col gap-8 bg-surface-inverse px-5 py-7 text-text-inverse lg:flex
Rail item:   flex min-h-11 items-center gap-3 rounded-row px-4 py-3 text-nav; active bg-accent-light font-extrabold text-text-primary
Count badge: min-w-7 rounded-full bg-surface px-2 py-0.5 text-chip text-text-primary
Queue tabs:  inline-flex min-h-11 rounded-full px-5 py-3 text-btn-sm (active bg-accent text-accent-foreground)
Queue row:   flex items-center gap-3.5 rounded-block border-2 p-4.5 (current border-accent)
File:        rounded-panel border-2 border-border p-5.5 lg:p-7; facts dl grid sm:grid-cols-2
```
Below `lg` the header and `BottomTabBar` (dashboard, providers, account) replace the rail, and the queue is hidden on the file page.
