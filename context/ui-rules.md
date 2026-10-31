# UI Rules

> Binding rules for anything visual. Pairs with `ui-tokens.md` (values) and `ui-registry.md` (inventory).

**Status: ✅ design received 2026-10-25** (D48 to D51). The owner's Claude Design handoff is the visual
source of truth: `docs/design/screens/` (what each screen looks like), `docs/design/source/` (the exact
markup), and `docs/design/README.md` (which screen is which page). Build each screen from its reference.
**Where a reference and these rules disagree, these rules win** on accessibility, logical properties, PII,
money and the four states; for anything else visual, the design wins and this file follows it.

---

## 1. The component hierarchy

Resolve every UI need in this order. Only move down a step when the step above genuinely doesn't fit.

1. **An existing component in `ui-registry.md`** → reuse it.
2. **A shadcn/ui primitive** → add it via the CLI, style it with our tokens, register it.
3. **A composition of the above** → build in `components/features/`, register it.
4. **A custom component** → only if 1–3 fail. Justify it in `ui-registry.md`.

> ⛔ **Never** introduce a second component library, a CSS framework, or a UI kit. One system.
> ⛔ **Never** copy a random component from the internet into the codebase, and never import from
> `docs/design/source/` (it is a reference, not code).

---

## 2. shadcn/ui rules

- Components live in `components/ui/` and are **ours**, but treat them as a shared library: edit
  deliberately, never for a one-off screen.
- Add **one component at a time**, when a screen actually needs it. No bulk installs.
- **Restyle to the design through tokens**: pill buttons, 2px borders, the radius scale. Never hardcode
  colours or sizes inside a primitive.
- If a primitive needs a project-wide variant, add it as a **variant**, not a fork.
- **Register every component you add** in `ui-registry.md`, same commit.
- Do not fight Radix behaviour underneath (focus traps, keyboard handling): it is the accessibility layer.

**Before marking any shadcn component done, verify it in RTL.** Menus, selects, popovers, sheets,
toasts, and tooltips are the usual offenders.

---

## 3. Three locales, two directions (non-negotiable)

The product ships **`ar` (RTL), `tr` (LTR), `en` (LTR)** across **two regions (TR, KSA)**. Full
specification: [`i18n.md`](i18n.md). **v1 is Turkish first (D57):** the launch is Turkey, `tr` is the
primary language, KSA comes later. **The design is drawn in Arabic only**; Turkish and English are the
same layouts, mirrored by logical properties, with the same fonts (Turkish letters verified). So the
first check of every screen is the mirrored, longer `tr` version, not the drawn `ar` one.

**Direction is derived from the locale at runtime. Never hardcode either direction.**

- `<html lang={locale} dir={dirFor(locale)}>`; `dirFor` is the single place direction is decided.
- **Every screen must be verified in both directions** (`ar` and one Latin locale), not only RTL.
- **Use logical Tailwind properties only:**
  | ❌ Never | ✅ Always |
  | --- | --- |
  | `ml-4` / `mr-4` | `ms-4` / `me-4` |
  | `pl-4` / `pr-4` | `ps-4` / `pe-4` |
  | `left-0` / `right-0` | `start-0` / `end-0` |
  | `text-left` / `text-right` | `text-start` / `text-end` |
  | `border-l` / `border-r` | `border-s` / `border-e` |
- In the design, "right" means **start**: the wordmark, page titles, the admin rail and the first step
  of every stepper sit at the start edge. Read every reference that way.
- **Directional icons mirror** (chevrons, the «›» stepper separator, the ← back arrow). Non-directional
  ones (check, bell, search, star) do not.
- **Numbers, currency, dates, phone numbers, IBANs and reference numbers stay LTR** inside RTL text:
  wrap them in a `dir="ltr"` span (`MoneyDisplay` and friends do this).
- **Digits are Western (`0-9`) in every locale, as designed.** Format `ar` with `ar-u-nu-latn`.
- **No hardcoded user-facing strings in components.** Every string comes from the message catalogue or a
  localised database column (`i18n.md` §5).
- **Copy workflow (D58):** the Arabic wording in the design is the source for `messages/ar.json`
  (simple Modern Standard Arabic). English is drafted from the meaning of the design into
  `messages/en.json`; a translator turns the English into Turkish for `messages/tr.json` (owner step
  S21). Until a Turkish string arrives, the key stays marked as awaiting translation, never filled
  with machine output.
- Mixed Arabic and Latin text (the name **Aldebyani** inside Arabic copy) needs isolation (`dir="auto"`
  or `<bdi>`).
- **Never case-fold an identifier with a Turkish locale** (`i18n.md` §6).
- Layouts must survive Turkish string lengths, which run longer than Arabic: check the chips, the
  stepper and the buttons in `tr`.

**Test:** every screen checked in `tr` first, then `ar` (and `en`), before its task is marked done (the
built-in browser, and `npm run test:e2e` at 390px).

---

## 4. Every screen needs four states

| State | Requirement |
| --- | --- |
| **Loading** | Skeleton matching the real layout (not a spinner in the middle of the page) |
| **Empty** | Explains what will appear here and the next action |
| **Error** | Plain-language cause + a retry action. **Never** a stack trace, SQL, or a PSP payload |
| **Success** | The actual content |

The design's error and empty screens (`s17`, `p17`, `a4`) set the pattern: **say what happened, what
stayed safe ("no amount was charged", "your choice holds until the window ends"), and the next step**,
with one or two pill buttons. A big number or word leads (`404`, `0`, `00:00`).

Money and status screens additionally need a **stale/refreshing** indication after a mutation.

---

## 5. Forms

- **Server-side validation is the truth.** Client validation is convenience only
  (`code-standards.md` §6).
- Every input has a **visible label**. Placeholder is not a label. The design's group labels are 13px
  Cairo 600 `text-text-secondary`, above the control.
- **Single choices are pill chips, not selects** (property type, rooms, bathrooms, home state, time
  slots): a row of `rounded-full` buttons, 50px tall, selected `bg-accent text-accent-foreground`,
  unselected `bg-surface-secondary text-text-primary`. They are a radio group to assistive technology
  (`role="radiogroup"`, arrow keys).
- Dates are chips too (weekday above the day number); add-ons are wide toggle rows with their price.
- Phone sign-in (D55): one phone field (country code fixed by the row's region: `+90` in v1), then a
  code entry of **six** digit boxes (Supabase Auth codes are 6 to 10 digits; the design's four boxes
  are wrong), with a resend countdown.
- Errors appear **next to the field**, in plain language from the catalogue, saying how to fix it.
- Disable the submit button while submitting **and** guard the action server-side (idempotency).
- Destructive or money actions (choose provider, pay the commission, pay the provider fee, confirm
  completion, cancel) require an **explicit confirmation step** stating the consequence and the amount.

---

## 6. Displaying money and status

- Money is **formatted from server-provided minor units**. Never compute or round money in a component.
- Always show the **currency**, and set every amount and `₺` in `font-display` (Cairo has no `₺`).
- **The price card** (request form, review, offers, payment): an eyebrow label («السعر الثابت»), the
  amount at 72px, the currency sign smaller beside it, a one-line explanation, then a white inner card
  with the breakdown rows, then the main action. Panel `bg-accent-light rounded-panel`.
- Show **what the user actually gets or pays**: for customers, the job price, the commission to pay
  now and the cash due after the service; for providers, the fee to pay now and the cash to collect.
  Never only a gross figure.
- **Commission copy (D88):** the commission is part of the job price, paid online after choosing; the
  rest is cash to the provider after the service. A screen that says money is held or released is out
  of date until the design is re-exported (S24).
- Amounts are formatted for the locale: `tr` `₺3.200`, `en` `₺3,200`, `ar` with Western digits
  (`i18n.md` §7). The mockups' `₺3,200` is not a fixed format.
- **The agreement reminder** (D92): a short line with a link to the agreement statement above every
  payment button. Copy never says the platform holds money, or that it will collect the cash for anyone.
- Status is rendered from the canonical state machine (`project-overview.md` §4) through the one status
  chip (`ui-tokens.md` §4). Never invent labels.
- Deadlines (payment, pay and confirm windows) show an **absolute time plus a relative hint**, from server
  time. A running window can show the big countdown card of the design (`19:24:08`, Alexandria 900).

---

## 7. PII and disclosure (a UI rule with security consequences)

- Provider-facing views of an open request show **short details only**: service, size, district, date.
  The design follows this (`p10`, `p8`): no name, no street, no phone before unlock.
- Before selection the customer sees a provider as **first name + family initial** («أحمد س.») with the
  initial avatar; the full name appears only once the provider is revealed.
- **Never build a UI that would leak PII if RLS were removed.**
- The reveal of contact details is a distinct, deliberate UI moment, once both fees are confirmed
  (`p11` → `p12`).
- Application messages warn, **before submission**, that contact information is not allowed; the design
  shows the live scan result («تم الفحص — لا بيانات تواصل»).

---

## 8. Accessibility

- Semantic HTML first; ARIA only to fill genuine gaps.
- Everything interactive is **keyboard reachable** with a visible focus ring: 2px `ring-ring` (navy) plus
  the design's soft halo. Never remove focus outlines.
- Contrast at least WCAG AA: 4.5:1 for body text, 3:1 for large text and for control boundaries. The
  measured table is `ui-tokens.md` §11: `text-muted` is for large or non-essential text only, `alert`
  is never text, field borders use ink 500 (4.34:1, D59) instead of the design's faint `#DFE7F3`.
- Colour is never the **only** signal; the status chips are all blue, so their labels carry the meaning.
- Images and icon-only buttons (bell, search) need accessible names.
- Touch targets ≥ 44px (the design's chips are 50px, star buttons 44px).
- Respect `prefers-reduced-motion`.

---

## 9. Responsive

- **Phone first.** Most users arrive from a WhatsApp link on a phone; the design gives every core screen a
  390px version (`s18`, `p18`, `a5`).
- Test at 360, 390, 430 and 1280px.
- Desktop pages are drawn at 1280px, the admin console at 1440px.
- Tables have a phone plan: stacked cards (the design's phone screens show it). Never a squashed table.

---

## 10. Structure and performance

- Components render; they don't decide business rules (`code-standards.md` §3).
- Keep `'use client'` at the leaves.
- No layout shift on load: reserve space for images and async content.
- No `localStorage` / `sessionStorage` for auth or money state.

---

## 11. Design fidelity

- **Copy layout, hierarchy, spacing and component shapes from the reference screen.** Measure in
  `docs/design/source/` when a picture is not exact enough; values come from `ui-tokens.md`.
- **Never copy an image from the design.** Its photos and avatars are borrowed (tracker Q12). Until owned
  or licensed images exist, use the design's own placeholder (diagonal stripes, `bg-surface-secondary`)
  or a tinted panel with a line icon; avatars are initials on `bg-accent-light`.
- **Never copy a number from a mockup** (prices, commission, provider fee): real values come from
  `platform_settings` and the pricing engine.
- Never copy the mock browser bar or the annotations around the frames.
- Region specific details follow the row's region, never the mockup. The design's mock region is
  Saudi Arabia (Riyadh districts, «مدى», 05x phones, «السعودية · ₺»); v1 builds Turkey (D57): Turkish
  districts, `+90` phones, the iyzico card form.
- **There are no disputes (D92).** The design's dispute screens become a problem report after the
  re-export (S24).
- The design's «كرّر الطلب» on `s9` **is** in v1 (D56, position 04).
- The full exclusions list is in `docs/design/README.md`.

---

## 12. Fonts

Load three families with `next/font/google` in the root layout and expose them as variables:

```typescript
import { Alexandria, Cairo, Archivo_Black } from "next/font/google";
const display = Alexandria({ subsets: ["arabic", "latin", "latin-ext"], weight: ["700", "800", "900"], variable: "--font-alexandria" });
const sans = Cairo({ subsets: ["arabic", "latin", "latin-ext"], weight: ["400", "500", "600", "700", "800"], variable: "--font-cairo" });
const wordmark = Archivo_Black({ subsets: ["latin", "latin-ext"], weight: "400", variable: "--font-archivo-black" });
```

- `@theme inline` maps them to `font-sans` (Cairo, the default), `font-display`, `font-wordmark`
  (`ui-tokens.md` §13). Apply the three variable classes to `<html>`.
- Headings and every number or amount use `font-display`; everything else `font-sans`; the wordmark only
  `font-wordmark`.
- **Never use a system font as the primary font.**

---

## 13. Layout

- **Customer and provider pages** (desktop): a white page, content up to the 1280 frame with the page
  padding of `ui-tokens.md` §6. A header row, then the page title (h1 44px) with its one-line
  explanation, then the content.
- **The two-column pattern** (request form, offers, payment, confirmation, job, unlock): the main column
  (about 60%) at the start, a summary column (the price card and request card) at the end, `gap-3.5`.
  On phones the columns stack, the summary first when it holds the main action.
- **The admin console**: a navy rail at the start (the wordmark, then the views with count badges), a
  top bar (search, region switch, admin avatar), then the content. Rail items are 14px Cairo 700: white
  on the rail, navy on a light pill when active.
- **Phones**: the header (wordmark, bell, avatar), the content, and a fixed bottom tab bar with three
  items (customer: requests, new request, account).
- Gap between page sections: 22–30px (`gap-5.5` to `gap-7.5`).

---

## 14. Header and navigation

- **Desktop header**: the wordmark ("Aldebyani", Archivo Black 22px) at the start; nav links in Cairo
  15px 600 `text-text-primary`; at the end, the bell (a 40px circle `bg-surface-secondary` with a count
  badge) and the account avatar (initial on `bg-accent-light`). Signed out: sign in and "register as a
  provider" as secondary pills, «انشر طلبك» as the primary pill.
- **Flow headers** (request form, payment): the wordmark, then a stepper (the current step a navy pill
  13px Cairo 600 `py-2 px-4`, the others plain `text-text-secondary` separated by «›»), then a cancel or
  back link at the end.
- The active nav item is shown with `aria-current` and weight; no underline.
- The provider header also shows the account state chip («معتمد», «قيد المراجعة»).

---

## 15. Cards and panels

Every content section lives in a card. The design uses four kinds, chosen by role, never by taste:

| Kind | Classes | Use |
| --- | --- | --- |
| Tinted card | `bg-surface-secondary rounded-card p-6` | The default: lists, request cards, offer cards, notices |
| Emphasis panel | `bg-accent-light rounded-panel py-8 px-7.5` | The price card, summary cards, balances |
| Inverse panel | `bg-surface-inverse text-text-inverse rounded-panel` | Heroes, the dispute call to action, the admin rail |
| White card | `bg-surface border-2 border-border rounded-card` | Cards on a tinted area, collapsed applicants, notification rows |

- No shadows on cards (`ui-tokens.md` §8); separation is tint and border.
- No gradients on cards. The diagonal stripes are an image placeholder, not a card style.
- A white inner card inside a panel (the breakdown rows) is `bg-surface rounded-row`.

---

## 16. Typography hierarchy

Full scale in `ui-tokens.md` §5. On every page:

- **Page title**: h1, 44px Alexandria 900, tracking -0.04em, with a 13–15px `text-text-secondary`
  explanation under it.
- **Section heading**: 28px Alexandria 900. **Card title**: 22px Alexandria 800.
- **Body**: 15px Cairo 500, line height 1.7. **Secondary**: 13px Cairo 500 `text-text-secondary`.
- **Eyebrow**: 12px Cairo 700, tracking +0.06em, above values and inside panels.
- Never more than one weight in a single text run.

---

## 17. Chips and badges

All pill-shaped (`rounded-full`), Cairo.

| Kind | Spec |
| --- | --- |
| Status chip | 12px 700, `py-1.5 px-3`, colours from `ui-tokens.md` §4 only. **One component, reused** |
| Info chip | Same size, `bg-surface-secondary` («تنظيف عادي», «سعر ثابت») |
| Verified chip | «موثّق», `bg-accent-light` |
| Choice chip | 14px 700, 50px tall, `py-3 px-5`, selectable (§5) |
| Count badge | An 18px circle with 12px 700 digits, on the bell, the rail items and tabs |
| Star button | A 44px circle `bg-accent-muted` with ★; selected `bg-accent text-accent-foreground` |

---

## 18. Buttons

**Every button is a pill** (`rounded-full`), Cairo 700. Sizes:

| Size | Text | Padding | Use |
| --- | --- | --- | --- |
| sm | 13px | `py-2.5 px-4.5` | Row actions, table actions |
| md | 13–14px | `py-3 px-5.5` | Secondary actions, header pills |
| lg | 15px | `py-4 px-6.5` | Card actions («اختر أحمد») |
| block | 16–17px | `py-4.5` or `py-5`, full width | The main action of a panel («راجع وانشر الطلب», «ادفع ₺3,200») |

| Variant | Classes | Use |
| --- | --- | --- |
| Primary | `bg-accent text-accent-foreground` | One per view: the main action |
| Secondary | `bg-surface-secondary text-text-primary` | Second actions («الملف الكامل», «تعديل الطلب») |
| White | `bg-surface text-text-primary` | Actions on a tinted or navy panel («افتح نزاعًا», «احسب سعر طلبك مجانًا») |
| Destructive | `bg-surface text-error` | Cancel, reject, "I can't do this job"; never a red fill |
| Link | `text-link` | Inline navigation |

Money actions (pay the commission, pay the provider fee, confirm completion) always open a **confirmation dialog
stating the exact amount** before executing.

---

## 19. Form inputs

```
height:        61px (compact 52px)
padding:       py-3.5 px-4.5 (compact py-2.75 px-3.5)
font:          15px Cairo 500, text-text-primary (compact 14px)
border:        border-2 border-input (ink 500, D59), rounded-field (compact rounded-field-sm)
background:    bg-surface
placeholder:   text-text-secondary
focus:         border-accent + ring (navy 2px) + halo
error:         border-error, the message under the field in text-error
search:        rounded-full, 50px tall, the search icon at the end
```

- Every input has a **visible label** above it; placeholder is never a label.
- Submit disabled while pending **and** guarded server-side by idempotency.

---

## 20. Lists and tables

Requests, applications, transactions and admin queues are lists.

- **Cards for people-facing lists** (feed rows, offers, my requests): white cards with a 2px border,
  title (Alexandria 800), meta line (13px `text-text-secondary`), status chip, price at the end, actions
  as pills.
- **Tables for the admin**: the header row `bg-surface-secondary`, 12px Cairo 700 `text-text-secondary`,
  `py-3 px-5.5`; rows white, separated by 2px `border-light`; the status chip column; row actions as
  sm pills.
- No alternating row colours. Hover: `bg-surface-secondary`.
- **Phones:** tables collapse to stacked cards. Never a squashed table.

---

## 21. Money and deadline display

- Money always via the shared `MoneyDisplay`: `font-display`, tabular figures, LTR-isolated, currency
  always shown.
- Provider-facing amounts always show the **net** (after commission), never only gross.
- Deadlines show absolute time + relative hint, from **server time**.
- Countdown colour: default `text-text-secondary`, under 6 hours `text-text-primary` with the
  countdown card, expired `text-error` (the design has no amber; urgency is size and wording).

---

## 22. Empty states

Every section that can be empty has one, following `s17` / `p17` / `a4`:

- A big lead (`0`, a short word) in Alexandria 900, a one-line title, one sentence on what to do.
- One or two pill buttons for the next action.

Required on: provider feed, my applications, my requests, applicant list, transaction history, dispute
queue, notifications.

---

## 23. Icons and imagery

- **Text first.** The design uses two icons (the bell, search), simple geometric marks for categories,
  ★ for ratings and an arrow for navigation. Do not add decorative icons.
- Use lucide (shadcn's set) at stroke 2 in `text-text-primary` where an icon is needed; the arrow and
  chevrons mirror (§3).
- **No photography until owned or licensed images exist** (Q12): placeholders as in §11.
- Avatars are the person's initial (Alexandria 700) on `bg-accent-light`, a circle.

---

## 24. Tailwind v4 note

Tokens are defined with `@theme inline` in `globals.css` (`ui-tokens.md` §13); no `tailwind.config.ts`.
Every whole-pixel spacing value has a quarter-step class (`p-6.5`), so arbitrary values are never needed.

---

## 25. Do Nots

- Never use Tailwind's built-in colour classes or the `--ramp-*` steps; semantic tokens only
- Never define colours in `tailwind.config.ts`
- Never use physical direction utilities (`ml-`, `pr-`, `left-`, `text-left`); logical only
- Never render a customer's name, phone, or street address in a provider-facing pre-unlock view
- Never query a column in a provider-facing view that RLS is meant to gate
- Never compute, round, or convert money in a component; never set an amount in Cairo
- Never gate the rating UI on payment, or payment on rating
- Never build a top-up or add-funds UI (`project-overview.md` §6)
- Never show a raw error, stack trace, SQL, or PSP payload to a user
- Never add shadows or gradients to cards
- Never use a red fill for a button; destructive is red text on white
- Never use more than one font weight in a single text run
- Never stack more than 2 levels of border radius inside each other
- Never use `position: fixed` except for the phone bottom bar and overlays
- Never remove focus outlines
- Never copy a photo, avatar or number from the design references
