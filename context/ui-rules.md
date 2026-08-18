# UI Rules

> Binding rules for anything visual. Pairs with `ui-tokens.md` (values) and `ui-registry.md` (inventory).

**Status:** the human will supply the **shadcn theme, component choices, and templates** later. Until then: use shadcn defaults, build with primitives, and **do not invent a visual language**. Structure now, styling later — that is the point of tokens.

---

## 1. The component hierarchy

Resolve every UI need in this order. Only move down a step when the step above genuinely doesn't fit.

1. **An existing component in `ui-registry.md`** → reuse it.
2. **A shadcn/ui primitive** → add it via the CLI, register it.
3. **A composition of the above** → build in `components/features/`, register it.
4. **A custom component** → only if 1–3 fail. Justify it in `ui-registry.md`.

> ⛔ **Never** introduce a second component library, a CSS framework, or a UI kit. One system.
> ⛔ **Never** copy a random component from the internet into the codebase.

---

## 2. shadcn/ui rules

- Components live in `components/ui/` and are **ours** — but treat them as a shared library: edit deliberately, never for a one-off screen.
- Add **one component at a time**, when a screen actually needs it. No bulk installs.
- **Do not hardcode colours or sizes** inside a primitive. Everything comes from tokens.
- If a primitive needs a project-wide variant, add it as a **variant**, not a fork.
- **Register every component you add** in `ui-registry.md`, same commit.
- Do not fight Radix behaviour underneath (focus traps, keyboard handling) — it is the accessibility layer.

**Before marking any shadcn component done, verify it in RTL.** Menus, selects, popovers, sheets, toasts, and tooltips are the usual offenders.

---

## 3. Three locales, two directions (non-negotiable)

> ⚠️ **Changed 2026-08-17.** This previously read "the primary language is Arabic, direction RTL".
> The product ships **`ar` (RTL), `tr` (LTR), `en` (LTR)** across **two regions (TR, KSA)**.
> Full specification: [`i18n.md`](i18n.md). This is not a later "i18n pass" — it is day one.

**Direction is derived from the locale at runtime. Never hardcode either direction.**

- `<html lang={locale} dir={dirFor(locale)}>` — `dirFor` is the single place direction is decided.
- **Every screen must be verified in both directions** (`ar` and one Latin locale), not only RTL.
  A screen correct in one direction is not done.
- The logical-property rule below is now load-bearing rather than stylistic: code written with
  logical properties flips for free; code written with physical ones must be rebuilt.
- **Use logical Tailwind properties only:**
  | ❌ Never | ✅ Always |
  | --- | --- |
  | `ml-4` / `mr-4` | `ms-4` / `me-4` |
  | `pl-4` / `pr-4` | `ps-4` / `pe-4` |
  | `left-0` / `right-0` | `start-0` / `end-0` |
  | `text-left` / `text-right` | `text-start` / `text-end` |
  | `border-l` / `border-r` | `border-s` / `border-e` |
- **Directional icons mirror** (chevrons, arrows, back/next). Non-directional (check, user, trash) do not.
- **Numbers, currency, dates, and phone numbers stay LTR** inside RTL text — wrap in a `dir="ltr"` span so they don't visually scramble.
- **No hardcoded user-facing strings in components.** Every string comes from the message catalogue or from a localised database column (`i18n.md` §5). This is enforceable — CI greps for it.
- Mixed Arabic/Latin text (e.g. a brand name) needs isolation — use `dir="auto"` or explicit isolation to avoid bidi mangling.
- **Never case-fold an identifier with a Turkish locale.** `"I".toLocaleLowerCase('tr')` is `"ı"`, not `"i"` — this breaks email matching and enum comparison. Display-only casing may be locale-aware; identifiers never are. See `i18n.md` §6.
- Layouts must survive Turkish string lengths, which run longer than Arabic for the same content.

**Test:** every screen checked in `ar` **and** `tr` before its task is marked done. Playwright MCP is configured for this — drive it once per locale.

---

## 4. Every screen needs four states

Never ship only the happy path. For any view that loads data:

| State | Requirement |
| --- | --- |
| **Loading** | Skeleton matching the real layout (not a spinner in the middle of the page) |
| **Empty** | Explains what will appear here and the next action |
| **Error** | Plain-language cause + a retry action. **Never** show a stack trace, SQL, or a PSP payload |
| **Success** | The actual content |

Money and status screens additionally need a **stale/refreshing** indication after a mutation.

---

## 5. Forms

- **Server-side validation is the truth.** Client validation is convenience only (see `code-standards.md` §6).
- Every input has a **visible label**. Placeholder is not a label.
- Errors appear **next to the field**, in plain Arabic, saying how to fix it — not "Invalid input".
- Disable the submit button while submitting **and** guard the action server-side against double submission (idempotency).
- Destructive or money actions (choose provider, pay unlock fee, confirm completion, dispute, withdraw) require an **explicit confirmation step** stating the consequence and the amount.

---

## 6. Displaying money and status

- Money is **formatted from server-provided minor units**. Never compute or round money in a component.
- Always show the **currency**. Never a bare number.
- Show **what the user actually gets/pays**: for providers, show the fee and the net; never only a gross figure.
- Status is rendered from the canonical state machine in `project-overview.md` §4 — do not invent labels. One badge style per state, defined once, reused.
- Deadlines (unlock window, release date) are shown as an **absolute time plus a relative hint**, computed from server time.

---

## 7. PII and disclosure — a UI rule with security consequences

- Provider-facing views of an open request show **short details only**. Even though RLS enforces this, the UI must not query or render restricted fields.
- **Never build a UI that would leak PII if RLS were removed.** If a component only works because a query returned a field it shouldn't have, that is a bug in both layers.
- The reveal of customer details is a distinct, deliberate UI moment — after the unlock fee is confirmed.
- Application message inputs must warn, **before submission**, that contact information is not allowed and will be rejected.

---

## 8. Accessibility

- Semantic HTML first; ARIA only to fill genuine gaps.
- Everything interactive is **keyboard reachable** with a visible focus ring. Never remove focus outlines.
- Contrast at least WCAG AA (4.5:1 body text).
- Colour is never the **only** signal — pair it with text or an icon (status badges especially).
- Images and icon-only buttons need accessible names.
- Respect `prefers-reduced-motion`.

---

## 9. Responsive

- **Mobile-first.** Most users arrive from a WhatsApp link on a phone.
- Test at ~360px, tablet, and desktop.
- Touch targets ≥ 44px.
- Tables must have a mobile plan (card layout or horizontal scroll with a sticky first column) — never a squashed table.

---

## 10. Structure and performance

- Components render; they don't decide business rules (`code-standards.md` §3).
- Keep `'use client'` at the leaves. A page should not become a Client Component because one button needs state.
- No layout shift on load — reserve space for images and async content.
- No `localStorage`/`sessionStorage` for auth or money state.

---

## 11. Placeholder policy (until the theme arrives)

While waiting for the human's theme/templates:

- ✅ Use shadcn defaults and neutral tokens.
- ✅ Build correct structure, semantics, states, and RTL.
- ❌ Do **not** pick brand colours, custom fonts, bespoke spacing, or illustrations.
- ❌ Do **not** hand-tune pixel values to "look nicer" — that work will be thrown away.
- 📝 Note any place where a design decision is genuinely needed in `progress-tracker.md` under *Design questions*.

---

## 12. Font

Import an **Arabic-capable** font via `next/font/google` in the root layout and expose it as `--font-sans`.

```typescript
import { <ArabicFont> } from "next/font/google";
const sans = <ArabicFont>({ subsets: ["arabic", "latin"], variable: "--font-sans" });
```

- `--font-sans` is declared in `@theme` in `globals.css`
- Apply the font variable class to `<html>` in the root layout
- **Never use a system font as the primary font**
- 🟡 Family awaiting the human's choice — see `ui-tokens.md` §10. Do not pick one

---

## 13. Layout

- Page max-width: 1440px, centered
- Main content padding: 32px on all sides (16px on mobile)
- Gap between page sections: 24px
- Header height: 64px, full width, `bg-surface`, padding 0 24px
- All pages use the top navbar only — no sidebar, no drawer
- Full-width layout on all pages

---

## 14. Navbar

Role-based items (see `project-overview.md` §12).

- Active item: `text-accent`, weight 500, 14px
- Inactive item: `text-text-secondary`, weight 500, 14px
- No underline — active state is colour change only
- Navbar always `bg-surface`, full viewport width
- **RTL:** logo on the right, nav items flow right-to-left

---

## 15. Cards

Every content section lives in a card.

```
background: bg-surface
border: 1px solid var(--color-border)
border-radius: 16px
padding: 24px
box-shadow: 0px 1px 3px rgba(0,0,0,0.1), 0px 1px 2px -1px rgba(0,0,0,0.1)
```

Never use coloured card backgrounds — always `bg-surface`. Colour goes **inside** cards via badges, bars, and text, never on the card surface.

---

## 16. Typography hierarchy

Three levels used consistently (full scale in `ui-tokens.md` §14):

**Section headings** — 16px / 600 / `text-text-primary` / 24px line height
**Body / primary content** — 14px / 500 / `text-text-primary` / 20px line height
**Secondary / muted** — 12px / 400 / `text-text-muted` / 16px line height

Stat numbers: 30px / 600 / `text-text-primary`.

---

## 17. Badges

All badges are pill-shaped (`rounded-full`) unless specified.

```
padding: 2px 8px
font-size: 12px
font-weight: 500
```

Status badges always use the status colour table in `ui-tokens.md` §13. **One badge component, reused** — never a bespoke badge per screen.

---

## 18. Buttons

**Primary** — `bg-accent`, `text-accent-foreground`, `rounded-md`, `px-4 py-2`, 14px/500
**Secondary** — `bg-surface`, `border border-border`, `text-text-primary`, `rounded-md`, `px-4 py-2`
**Destructive** — `bg-error`, `text-error-foreground` — used for cancel, dispute, reject only

Money actions (pay unlock fee, fund request, confirm completion, request payout) always open a **confirmation dialog stating the exact amount** before executing.

---

## 19. Form inputs

```
background: bg-surface
border: 1px solid var(--color-border)
border-radius: 8px
padding: 8px 12px
font-size: 14px
color: text-text-primary
placeholder: text-text-muted
focus: ring-1 ring-accent border-accent
```

- Every input has a **visible label** — placeholder is never a label
- Errors appear next to the field, in plain Arabic, saying how to fix it
- Submit disabled while pending **and** guarded server-side by idempotency

---

## 20. Lists and tables

Requests, applications, and transactions are lists.

- No alternating row colours — `bg-surface` rows separated by borders
- Row border: 1px solid `var(--color-border)`
- Column headers: 12px, weight 500, `text-text-secondary`
- Row text: 14px, `text-text-primary`
- Hover: `bg-surface-secondary`
- **Mobile:** collapse to stacked cards. Never a squashed table

---

## 21. Money and deadline display

- Money always via the shared `MoneyDisplay` component — tabular figures, LTR-isolated, currency always shown
- Provider-facing amounts always show the **net** (after fee/commission), never only gross
- Deadlines show absolute time + relative hint, computed from **server time**
- Countdown colour: default `text-text-secondary` → `text-warning` under 6 hours → `text-error` when expired

---

## 22. Empty states

Every section that can be empty must have one. Keep it minimal:

- Short descriptive text in `text-text-muted`
- Optional icon above
- CTA if there is a logical next action

Required on: provider feed, my applications, my requests, applicant list, transaction history, dispute queue.

---

## 23. Tailwind v4 note

This project uses **Tailwind v4**. Tokens are defined with `@theme` in `globals.css` — no `tailwind.config.ts` needed. Never define colours in a config file. Always use `@theme` for new tokens.

---

## 24. Do Nots

- Never use Tailwind's built-in colour classes (`bg-purple-500`, `text-gray-600`) — project tokens only
- Never define colours in `tailwind.config.ts` — `@theme` in `globals.css` only
- Never use physical direction utilities (`ml-`, `pr-`, `left-`, `text-left`) — logical only
- Never render a customer's name, phone, or street address in a provider-facing pre-unlock view
- Never query a column in a provider-facing view that RLS is meant to gate — if the UI works only because a field leaked, both layers are broken
- Never compute, round, or convert money in a component
- Never gate the rating UI on payment, or payment on rating
- Never build a top-up or add-funds UI — see `project-overview.md` §6
- Never show a raw error, stack trace, SQL, or PSP payload to a user
- Never add gradients to card backgrounds
- Never use more than one font weight in a single UI element
- Never stack more than 2 levels of border radius inside each other
- Never use `position: fixed` for layout — normal flow only
- Never remove focus outlines
