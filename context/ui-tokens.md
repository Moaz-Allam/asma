# UI Tokens

> The **only** source of visual values. If a value isn't here, you may not use it.
>
> **Status: 🟡 AWAITING THEME.** The human will supply the shadcn theme, brand colours, and typography. Until then use the shadcn/Tailwind defaults below and **do not invent brand values**.

---

## 1. Rules (apply now, and after the theme lands)

1. **No arbitrary values in Tailwind.** `p-[13px]`, `text-[#1a1a1a]`, `w-[437px]` are forbidden. Use the scale.
2. **No raw hex, rgb, or hsl in components.** Colours come from semantic tokens only.
3. **No inline styles** for anything a token covers.
4. **Semantic names, not literal ones.** `bg-destructive`, never `bg-red-500`. When the theme changes, semantics survive; literals break.
5. **Add a token here before using it.** If you need a value that doesn't exist, add it to this file (or flag it) — don't inline it.
6. shadcn primitives consume these tokens via CSS variables; **do not hardcode inside a primitive**.
7. Spacing, radius, and typography use the defined scales — no in-between values.

---

## 2. Colour tokens (semantic)

shadcn's CSS-variable convention. Values are placeholders until the theme arrives — **names are stable, values are not.**

| Token | Use |
| --- | --- |
| `background` / `foreground` | Page base |
| `card` / `card-foreground` | Cards, panels |
| `popover` / `popover-foreground` | Menus, popovers |
| `primary` / `primary-foreground` | Primary actions |
| `secondary` / `secondary-foreground` | Secondary actions |
| `muted` / `muted-foreground` | De-emphasised text, placeholders |
| `accent` / `accent-foreground` | Hover/selected surfaces |
| `destructive` / `destructive-foreground` | Delete, cancel, dispute |
| `border` / `input` / `ring` | Borders, field borders, focus ring |

### Project-specific semantic tokens

Defined here because the domain needs them. Add to the theme when it arrives.

| Token | Use | Rule |
| --- | --- | --- |
| `success` / `success-foreground` | Released, completed, approved | Never the only signal — pair with text/icon |
| `warning` / `warning-foreground` | Awaiting action, deadline near | |
| `info` / `info-foreground` | Neutral status | |
| `pending` / `pending-foreground` | Held funds, awaiting confirmation | |

### Request-status colour map

One badge style per state, defined once, reused everywhere (see `ui-rules.md` §6).

| State | Token |
| --- | --- |
| `OPEN` | `info` |
| `SELECTED` | `warning` |
| `UNLOCKED` | `info` |
| `FUNDED` | `pending` |
| `IN_PROGRESS` | `info` |
| `AWAITING_CONFIRMATION` | `warning` |
| `RELEASED` | `success` |
| `DISPUTED` | `destructive` |
| `REFUNDED` | `muted` |
| `PARTIALLY_RELEASED` | `warning` |
| `CANCELLED` | `muted` |

---

## 3. Typography

**Status: 🟡 awaiting font choice.** Requirement: **one family covering Arabic *and* Latin Extended** — Turkish needs `ı İ ş ğ ç ö ü`, and many Arabic-capable fonts ship a weak or absent Latin Extended range. Verify glyph coverage in all three locales before committing; a missing `ğ` renders as tofu to every Turkish user. Do not pick one — flag it. See `i18n.md` §7.

| Token | Use |
| --- | --- |
| `text-xs` | Meta, timestamps |
| `text-sm` | Secondary text, labels |
| `text-base` | Body (default) |
| `text-lg` | Emphasised body |
| `text-xl` / `text-2xl` | Section headings |
| `text-3xl`+ | Page titles |

Rules:
- Body text never below `text-sm`.
- Weight: `normal`, `medium`, `semibold`, `bold` only.
- Arabic needs slightly more line-height than Latin — use the defined leading scale, don't hand-tune per component.
- **Numbers and currency: use tabular figures** so amounts align in tables and lists.

---

## 4. Spacing

Tailwind's 4px-based scale. Use `1, 2, 3, 4, 6, 8, 12, 16, 20, 24`. Nothing between.

| Context | Value |
| --- | --- |
| Inside a control | `2`–`3` |
| Between related elements | `2`–`4` |
| Between groups | `6`–`8` |
| Section separation | `12`–`16` |
| Page padding (mobile → desktop) | `4` → `8` |

**Always use logical spacing utilities** (`ms/me/ps/pe`) — see `ui-rules.md` §3.

---

## 5. Radius, borders, shadows

| Token | Use |
| --- | --- |
| `rounded-sm` / `rounded-md` | Inputs, small controls |
| `rounded-lg` | Cards, dialogs |
| `rounded-full` | Avatars, pills, badges |

- Borders: `border` token only; width `1px` default.
- Shadows: use the defined `shadow-sm` / `shadow-md` / `shadow-lg` steps for elevation (dropdown → dialog). Don't invent shadows.

---

## 6. Motion

| Token | Duration | Use |
| --- | --- | --- |
| `fast` | ~150ms | Hover, focus |
| `base` | ~200ms | Dropdowns, tooltips |
| `slow` | ~300ms | Dialogs, sheets |

Ease-out for entrances, ease-in for exits. **Always respect `prefers-reduced-motion`.**

---

## 7. Breakpoints

Tailwind defaults: `sm 640` · `md 768` · `lg 1024` · `xl 1280`. Mobile-first; design at ~360px upward.

---

## 8. Z-index

Use one scale; never invent a `z-[9999]`.

| Layer | Token |
| --- | --- |
| Base content | `0` |
| Sticky header | `10` |
| Dropdown / popover | `20` |
| Overlay / backdrop | `30` |
| Dialog / sheet | `40` |
| Toast | `50` |

---

## 9. When the theme arrives

1. Replace the placeholder **values** here; keep the **names**.
2. Update CSS variables in the global stylesheet — **not** in components.
3. Re-verify contrast (WCAG AA) and the RTL pass.
4. Note the change in `progress-tracker.md`.

If the supplied theme lacks a token this file defines (e.g. `success`, `pending`), **ask** rather than improvising a colour.

---

## 10. Open design questions

Add here as you hit them; the human answers.

| # | Question | Status |
| --- | --- | --- |
| 1 | Brand colour palette | ⏳ awaiting |
| 2 | Arabic-capable font family | ⏳ awaiting |
| 3 | Logo and favicon assets | ⏳ awaiting |
| 4 | Dark mode in scope for v1? | ⏳ awaiting |
| 5 | Colours for `success`/`warning`/`pending` in the brand palette | ⏳ awaiting |

---

## 11. Tailwind v4 — how tokens are defined

This project uses **Tailwind CSS v4**. All design tokens are defined with the `@theme` directive in `app/globals.css`. **No `tailwind.config.ts` for colours or tokens.**

Tailwind v4 generates utility classes automatically from every `@theme` variable:

- `--color-accent` → `bg-accent`, `text-accent`, `border-accent`
- `--color-surface` → `bg-surface`, `text-surface`, `border-surface`

```tsx
// Correct — generated utility classes
className="bg-surface text-text-primary border-border"

// Also correct — CSS variable directly
style={{ color: 'var(--color-text-primary)' }}

// Never — hardcoded hex
className="bg-[#F6F7FB] text-[#101828]"

// Never — raw Tailwind colour classes
className="bg-purple-500 text-gray-600"
```

---

## 12. globals.css — token definition skeleton

> **🟡 Values are placeholders until the human supplies the theme.** Token **names are stable** — build against them now. When the theme arrives, replace values here only; components must not change.

```css
@import "tailwindcss";

@theme {
  /* Font — must support Arabic. Awaiting choice */
  --font-sans: "TBD", sans-serif;

  /* Page and surface backgrounds */
  --color-background: TBD;
  --color-surface: TBD;
  --color-surface-secondary: TBD;

  /* Borders */
  --color-border: TBD;
  --color-border-light: TBD;

  /* Text */
  --color-text-primary: TBD;
  --color-text-secondary: TBD;
  --color-text-muted: TBD;

  /* Primary accent */
  --color-accent: TBD;
  --color-accent-light: TBD;
  --color-accent-muted: TBD;
  --color-accent-foreground: TBD;

  /* Success — released, completed, approved */
  --color-success: TBD;
  --color-success-light: TBD;
  --color-success-lightest: TBD;
  --color-success-foreground: TBD;

  /* Warning — awaiting action, deadline near */
  --color-warning: TBD;
  --color-warning-light: TBD;
  --color-warning-foreground: TBD;

  /* Pending — funds held, awaiting confirmation */
  --color-pending: TBD;
  --color-pending-light: TBD;
  --color-pending-foreground: TBD;

  /* Info — neutral status */
  --color-info: TBD;
  --color-info-light: TBD;
  --color-info-foreground: TBD;

  /* Error / destructive — disputes, cancel, refund */
  --color-error: TBD;
  --color-error-light: TBD;
  --color-error-foreground: TBD;

  /* Border radius */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --radius-full: 9999px;
}
```

---

## 13. Colour Usage Guide

### Page layout
| Element | Token |
| --- | --- |
| Page background | `bg-background` |
| Card / surface | `bg-surface` |
| Secondary surface | `bg-surface-secondary` |
| Default border | `border-border` |

### Typography
| Element | Token |
| --- | --- |
| Headings, primary text | `text-text-primary` |
| Secondary text, labels | `text-text-secondary` |
| Placeholder, muted, timestamps | `text-text-muted` |

### Accent
Used for: primary buttons, active nav item, focus rings, selected states.

| Element | Token |
| --- | --- |
| Button background | `bg-accent` |
| Button text | `text-accent-foreground` |
| Light badge background | `bg-accent-light` |
| Subtle background | `bg-accent-muted` |

### Request status badges
One definition, reused everywhere. Never invent a colour per screen.

| Status | Background | Text |
| --- | --- | --- |
| `OPEN` | `bg-info-light` | `text-info-foreground` |
| `SELECTED` | `bg-warning-light` | `text-warning-foreground` |
| `UNLOCKED` | `bg-info-light` | `text-info-foreground` |
| `FUNDED` | `bg-pending-light` | `text-pending-foreground` |
| `IN_PROGRESS` | `bg-info-light` | `text-info-foreground` |
| `AWAITING_CONFIRMATION` | `bg-warning-light` | `text-warning-foreground` |
| `RELEASED` | `bg-success-lightest` | `text-success-foreground` |
| `DISPUTED` | `bg-error-light` | `text-error-foreground` |
| `REFUNDED` | `bg-surface-secondary` | `text-text-secondary` |
| `PARTIALLY_RELEASED` | `bg-warning-light` | `text-warning-foreground` |
| `CANCELLED` | `bg-surface-secondary` | `text-text-secondary` |

### Money display
| Element | Token |
| --- | --- |
| Amount (default) | `text-text-primary` |
| Amount — earning / released | `text-success` |
| Amount — fee / deduction | `text-text-secondary` |
| Amount — held / pending | `text-pending` |
| Currency suffix | `text-text-muted` |

### Provider verification badges
| Status | Background | Text |
| --- | --- | --- |
| Approved | `bg-success-lightest` | `text-success-foreground` |
| Pending | `bg-warning-light` | `text-warning-foreground` |
| Rejected / suspended | `bg-error-light` | `text-error-foreground` |

---

## 14. Typography scale

| Element | Size | Weight | Line height | Colour token |
| --- | --- | --- | --- | --- |
| Logo text | 19px | 700 | 28px | `text-text-primary` |
| Stat number | 30px | 600 | 36px | `text-text-primary` |
| Page title | 24px | 600 | 32px | `text-text-primary` |
| Section heading | 16px | 600 | 24px | `text-text-primary` |
| Nav item (active) | 14px | 500 | 20px | `text-accent` |
| Nav item (inactive) | 14px | 500 | 20px | `text-text-secondary` |
| Body / primary content | 14px | 500 | 20px | `text-text-primary` |
| Card label | 14px | 500 | 20px | `text-text-secondary` |
| Money amount (prominent) | 20px | 600 | 28px | per money table |
| Badge text | 12px | 500 | 16px | per badge table |
| Timestamp / muted | 12px | 400 | 16px | `text-text-muted` |

**Arabic note:** Arabic glyphs need slightly more line-height than Latin at the same size. Use the line heights above rather than Tailwind defaults, and never hand-tune per component.

**Numbers:** use tabular figures for money and any column of numbers so amounts align.

---

## 15. Spacing

| Token | Value | Usage |
| --- | --- | --- |
| `gap-1` | 4px | Tight inline gaps |
| `gap-2` | 8px | Badge and tag gaps |
| `gap-3` | 12px | Form field gaps |
| `gap-4` | 16px | Section internal gaps |
| `gap-6` | 24px | Between sections |
| `gap-8` | 32px | Page section gaps |
| `p-4` | 16px | Card padding (compact) |
| `p-6` | 24px | Card padding (default) |
| `px-4 py-2` | 16px / 8px | Button padding |
| `px-2 py-0.5` | 8px / 2px | Badge padding |

**Always logical:** `ps-*` / `pe-*` / `ms-*` / `me-*`, never `pl-*` / `pr-*` / `ml-*` / `mr-*`.

---

## 16. Component tokens

### Cards
```
background: bg-surface
border: 1px solid var(--color-border)
border-radius: 16px (rounded-xl)
padding: 24px (p-6)
box-shadow: 0px 1px 3px rgba(0,0,0,0.1), 0px 1px 2px -1px rgba(0,0,0,0.1)
```

### Buttons
**Primary:** `bg-accent` · `text-accent-foreground` · `rounded-md` · `px-4 py-2` · `font-medium`
**Secondary:** `bg-surface` · `border border-border` · `text-text-primary` · `rounded-md` · `px-4 py-2`
**Destructive:** `bg-error` · `text-error-foreground` · `rounded-md` · `px-4 py-2`
**Ghost:** transparent · `text-text-secondary` · `hover:bg-surface-secondary` · `rounded-md`

### Input fields
```
background: bg-surface
border: border border-border
border-radius: rounded-md
padding: px-3 py-2
text: text-text-primary
placeholder: text-text-muted
focus: ring-1 ring-accent border-accent
```

### Badges
```
border-radius: rounded-full
padding: px-2 py-0.5
font-size: 12px
font-weight: 500
```

### Money display
```
font-variant-numeric: tabular-nums
direction: ltr (isolated inside RTL text)
currency: always shown, in text-text-muted
```

### Deadline countdown
```
default:        text-text-secondary
< 6 hours left: text-warning
expired:        text-error
```

---

## 17. Invariants

- Never use hex values directly in components — always tokens
- Never use raw Tailwind colour classes (`bg-purple-500`, `text-gray-600`)
- Never define colours in `tailwind.config.ts` — `@theme` in `globals.css` only
- Font is set once in the root layout — never a system-font fallback as primary
- All borders default to `border-border` — never `border-gray-*`
- Status badges always use the status table above — never a per-screen colour
- Money colours always come from the money table — never inline conditionals with raw colours
- Colour is never the only signal — always pair with text or an icon
