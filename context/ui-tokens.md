# UI Tokens

> The **only** source of visual values. If a value isn't here, you may not use it.
>
> **Status: ✅ THEME RECEIVED 2026-10-25.** Every value below comes from the owner's Claude Design handoff
> (`docs/design/`, decisions D48 to D51): the palette as the case study names it, and the type, spacing,
> radius and borders measured from the screens themselves (`docs/design/tools/measure.mjs`). Token
> **names** stayed stable; the placeholder values are gone. Look at `docs/design/screens/` for the
> picture, `docs/design/source/` for the exact markup.

---

## 1. Rules

1. **No arbitrary values in Tailwind.** `p-[13px]`, `text-[#1a1a1a]`, `w-[437px]` are forbidden. Use the
   scale. Tailwind v4 already covers every whole pixel: spacing is a multiple of `--spacing` (4px) in
   quarter steps, so 26px is `p-6.5` and 14px is `gap-3.5` (verified against the installed Tailwind 4.3.3:
   quarter steps compile, `p-6.3` does not).
2. **No raw hex, rgb, or hsl in components.** Colours come from semantic tokens only.
3. **No inline styles** for anything a token covers.
4. **Semantic names, not literal ones.** `bg-surface-secondary`, never the ramp step. The ramps (§2) are
   plain CSS variables precisely so they generate **no** utility classes.
5. **Add a token here before using it.** A value the design uses that is missing here: add it with its
   source screen, or flag it. Never inline it.
6. shadcn primitives consume these tokens via CSS variables; **never hardcode inside a primitive**.
7. Spacing, radius and type use the scales below; no in-between values.

---

## 2. Palette (the design's ramps)

Named as the case study names them ("الأساسي", "النصوص والسطح", "الحالات"). Defined as `:root` variables
`--ramp-*` in `app/globals.css` (§13), consumed only through the semantic tokens of §3.

### Primary (blue)

| Step | Hex | What it paints in the design |
| --- | --- | --- |
| 900 | `#0F3A73` | Main text and headings, primary buttons, navy hero panels, the admin rail, selected chips |
| 700 | `#1E5FB3` | Links and hover |
| 300 | `#C3D0E4` | Rare: strong dividers, inactive progress |
| 250 | `#D0DBEB` | Toggle tracks (off), decoration |
| 200 | `#DBE7F6` | Emphasis panels (price and summary cards), avatar discs, count badges, the "verified" chip, active status chips |
| 150 | `#E4ECF7` | Card borders and dividers (2px) |
| 100 | `#EAF1FA` | Quiet fills: chips, star rating buttons, notice cards, waiting status chips |
| 50 | `#F2F6FC` | Tinted cards and rows, secondary buttons, closed status chips |

### Text (ink) and surface

| Step | Hex | Use |
| --- | --- | --- |
| ink 900 | `#22324F` | Dense data where navy is too loud (tables, long figures) |
| ink 800 | `#2C3C5E` | Secondary headings in data views |
| ink 700 | `#3D4D6C` | Body text on tinted panels |
| ink 600 | `#4B5B78` | Descriptions, labels, secondary text (the design's second most used colour) |
| ink 500 | `#6A7A97` | Muted text, **large or non-essential only** (4.34:1 on white, §11) |
| surface | `#FFFFFF` | Page, cards on tinted areas, fields |

### States

| Token | Hex | Use |
| --- | --- | --- |
| danger | `#C0262D` | Error text, destructive actions (text on white) |
| danger alert | `#E5484D` | Unread dots and alert marks. **Never text** (3.91:1) |
| danger 50 | `#FDE2E2` | Error panels, the rejected provider chip |
| shadow | `rgb(15 58 115 / 0.18)` | The design's one shadow colour (overlays only, §8) |

**There is no green and no amber.** By decision D49 the statuses stay on the blue ramp; meaning comes
from each chip's label, never from colour alone (§4).

**Off-palette values in the design's HTML** (drift, a few uses each) snap to the nearest step:
`#DFE7F3` (field borders, placeholder stripes) → 200, `#D5DFEE` and `#DBE4F1` → 250 and 150,
`#F2F7FD` → 50, `#EEF1F6` / `#EEF2F8` / `#EEF3FA` / `#EEF4FD` → 100.

---

## 3. Semantic colour tokens

Defined in `@theme inline` (§13), so each one becomes `bg-*`, `text-*`, `border-*`. These are the only
colour names a component may use.

| Token | Value | Use |
| --- | --- | --- |
| `background` | white | Page base |
| `surface` | white | Cards on tinted areas, fields, popovers, dialogs |
| `surface-secondary` | primary 50 | The default tinted card, list rows, secondary buttons |
| `surface-inverse` | primary 900 | Navy panels: the landing hero, the provider hero, the dispute call to action, the admin rail |
| `border` | primary 150 | Card borders, dividers (2px) |
| `border-light` | primary 50 | Dividers inside white cards |
| `input` | ink 500 | Field borders (2px). **D59:** ink 500 (4.34:1) instead of the design's `#DFE7F3` (1.25:1), so fields meet WCAG AA; cards keep their light borders |
| `ring` | primary 900 | Focus outline (2px). With `ring-halo` (primary 200, 5px) as the soft glow the design shows |
| `track` | primary 250 | Toggle track, off (`s12`) |
| `text-primary` | primary 900 | Headings and main text. **Navy is the text colour of this design** |
| `text-secondary` | ink 600 | Descriptions, labels, meta |
| `text-muted` | ink 500 | Large or non-essential text only |
| `text-strong` | ink 900 | Dense data (admin tables) |
| `text-inverse` | white | Text on `surface-inverse` and `accent` |
| `link` | primary 700 | Inline links, hover on navy text links |
| `accent` | primary 900 | Primary buttons, selected chips, active nav |
| `accent-foreground` | white | Text on `accent` |
| `accent-light` | primary 200 | Emphasis panels (price, summary), avatar discs, count badges |
| `accent-muted` | primary 100 | Quiet chips, star buttons, notice cards, hover on secondary |
| `info` / `info-light` / `info-foreground` | primary 900 / primary 100 / primary 900 | Neutral and waiting states |
| `pending` / `pending-light` / `pending-foreground` | primary 900 / primary 200 / primary 900 | Active states: chosen, paid, unlocked, in progress |
| `success` / `success-light` / `success-foreground` | primary 900 / primary 50 / primary 900 | Finished: completed (quiet, by design) |
| `warning` / `warning-light` / `warning-foreground` | primary 900 / primary 100 / primary 900 | Waiting on someone: awaiting confirmation, under review |
| `error` / `error-light` / `error-foreground` | danger / danger 50 / danger | Errors, disputes, destructive actions |
| `alert` | danger alert | Unread dots, alert marks (non-text) |

`success`, `warning`, `pending`, `info` keep separate names although several share values: the names
carry meaning for the code, and a later palette change touches values only.

---

## 4. Request status chips (D49: one blue ramp)

One badge component, reused everywhere (`ui-rules.md` §17). Labels come from the message catalogue; the
Arabic below is the design's wording. Chips are pills: 12px Cairo 700, `px-3 py-1.5`, text
`text-text-primary` unless stated.

| State | Design label (ar) | Background | Notes |
| --- | --- | --- | --- |
| `OPEN` | مفتوح | `bg-info-light` | Provider feed shows «مفتوح · N من 10 عروض» |
| `SELECTED` | بانتظار الدفع (customer) · اختارك العميل (provider) | `bg-pending-light` | |
| `COMMISSION_PAID` | بانتظار فتح البيانات | `bg-pending-light` | |
| `UNLOCKED` | فُتحت البيانات | `bg-pending-light` | |
| `IN_PROGRESS` | قيد التنفيذ | `bg-pending-light` | The design also shows an inverted variant (`bg-accent text-accent-muted`) for the current step in a stepper |
| `AWAITING_CONFIRMATION` | بانتظار تأكيدك (customer) · بانتظار تأكيد العميل (provider) | `bg-warning-light` | |
| `COMPLETED` | مكتمل | `bg-success-light` | |
| `CANCELLED` | ملغى | `bg-success-light` | **D59:** this spelling and colour (the design also had «ملغي» on primary 100) |
| Closed to new offers | مقفل | `bg-success-light` | Feed row at the applicant cap |

Provider verification chips (**D59**): «معتمد» (approved) and «قيد المراجعة» (under review) use
`bg-warning-light`, as designed; «مرفوض» (rejected) uses `bg-error-light`, so red always means a negative
outcome. The design drew all three alike.

---

## 5. Typography

### Families (D48)

| Token | Family | Use | Weights loaded |
| --- | --- | --- | --- |
| `font-display` | **Alexandria** | Headings, numbers, money, the big price, initials avatars | 700, 800, 900 |
| `font-sans` | **Cairo** | Body, labels, buttons, chips, fields (the default) | 400, 500, 600, 700, 800 |
| `font-wordmark` | **Archivo Black** | The navbar word "Aldebyani" only (D43) | 400 |
| `font-mono` | system monospace | Reference numbers and codes (request `#8412`, IBAN tails) | 400 |

All three load through `next/font/google` with subsets `arabic` (not Archivo Black), `latin`,
`latin-ext`. **Verified 2026-10-25** by rendering: Alexandria and Cairo draw every Turkish letter
(`ğ Ğ ı İ ş Ş ç Ç ö Ö ü Ü`). **Cairo has no `₺` glyph** (it falls back to a system font), Alexandria
does: **every amount and every currency sign is set in `font-display`**, including inside buttons and
breakdown rows whose words are Cairo (`MoneyDisplay` owns this). Both families support tabular figures
(`tnum`); money uses `tabular-nums`.

### Scale (measured from the screens)

Each role is a named Tailwind size (`--text-*` in §13, which carries the line height, tracking and
weight), so the design's sizes never need arbitrary values. Pair Alexandria roles with `font-display`.

| Role | Class | Size | Family · weight | Line height | Tracking | Where |
| --- | --- | --- | --- | --- | --- | --- |
| Display XL | `text-display` | 84px | Alexandria 900 | 1.24 | -0.055em | Case study and landing section display |
| Hero | `text-hero` | 76px | Alexandria 700 | 1.24 | -0.05em | Landing hero «خلّها علينا» (kashida stretched, as designed) |
| Price XL | `text-price-xl` | 72px | Alexandria 900 | 1 | -0.05em | The fixed price on the request form (s4), the countdown card |
| Price L | `text-price-l` | 66px | Alexandria 900 | 1 | -0.05em | Request value (p8) |
| Display L | `text-display-l` | 48px | Alexandria 900 | 1.24 | -0.045em | Display titles outside the landing page |
| Landing titles | `text-close` · `text-quick` · `text-band` · `text-heading` · `text-band-s` | 58 · 56 · 52 · 48 · 46px | Alexandria 900 | 1.24 | -0.045 · -0.05 · -0.045 · -0.04 · -0.045em | `s1`: closing, quick start, offers, prices with categories and FAQ, trust |
| Page title (h1) | `text-title` | 44px | Alexandria 900 | 1.24 | -0.04em | Every page title |
| Small title (h1) | `text-title-s` | 38px | Alexandria 900 | 1.24 | -0.02em | `s2` |
| Amounts | `text-amount` · `text-amount-s` · `text-tile` | 38 · 30 · 24px | Alexandria 900 | 1.15 · 1.05 · 1.15 | 0 | `s1` price cards, sample card, trust cards |
| Section (h2) | `text-section` | 28px | Alexandria 900 | 1.24 | -0.02em | Section headings |
| Step title | `text-step` | 25px | Alexandria 800 | 1.24 | -0.02em | `s1` how it works |
| Code digit | `text-digit` | 26px | Alexandria 900 | 1 | 0 | `s2` code boxes |
| Card title (h3) | `text-card` | 22px | Alexandria 800 | 1.24 | -0.02em | Card and panel titles |
| Subhead | `text-subhead` | 20px | Alexandria 800 | 1.24 | -0.02em | `s12` notices |
| Question | `text-question` | 18px | Cairo 700 | 1.5 | 0 | FAQ question |
| Sample | `text-sample` | 17px | Cairo 700 | 1.4 | 0 | Sample line in `s1` step cards |
| Small title | `text-group` | 15px | Alexandria 800 | 1.24 | -0.02em | List group titles, card labels |
| Body L | `text-body-l` | 16px | Cairo 500 | 1.65 | 0 | Hero and intro paragraphs |
| Lead | `text-lead` | 16px | Cairo 500 | 1.75 | 0 | Landing band paragraphs |
| Answer | `text-answer` | 15px | Cairo 400 | 1.9 | 0 | FAQ answer |
| Body | `text-body` | 15px | Cairo 500 | 1.7 | 0 | Default body, field text |
| Body S | `text-body-s` | 13px | Cairo 500 | 1.7 | 0 | Descriptions under titles, helper text, field labels (600) |
| Label | `text-label` | 14px | Cairo 700 | 1.3 | 0 | List rows, strong inline text, choice chips |
| Meta | `text-meta` | 12px | Cairo 500 | 1.5 | 0 | Timestamps, captions |
| Chip | `text-chip` | 12px | Cairo 700 | 1.3 | 0 | Status and info chips, count badges |
| Eyebrow | `text-eyebrow` | 12px | Cairo 700 | 1.3 | +0.06em | Small labels above values («السعر الثابت») |
| Button | `text-btn-sm` · `text-btn-nav` · `text-btn` · `text-btn-band` · `text-btn-lg` | 13 · 14 · 15 · 16 · 17px | Cairo 700 | 1.875 (Cairo's normal line height, which the design's pills use) | 0 | By button size (`ui-rules.md` §18; md 13–14px uses `text-btn-sm` or `text-label`) |
| Nav link | `text-nav` | 15px | Cairo 600 | 1.3 | 0 | Header links, phone tabs |
| Wordmark | `text-wordmark` | 22px (24px on the landing page: `text-wordmark-lg`; 18px on phones: `text-wordmark-sm`) | Archivo Black | 1.4 | -0.01em | Navbar |

Rules:

- Body text never below 13px; 12px only for chips, meta and eyebrows.
- Headings always Alexandria with negative tracking; body never.
- Arabic headings keep line height 1.24 (the design forces it for every `h1`–`h4`); body 1.65–1.7.
- **Digits are Western (`0-9`) in all three locales, as designed** (₺3,200, 4.8, 01 تفاصيل الطلب). In
  `ar`, format with the `ar-u-nu-latn` locale, because plain `ar` renders Arabic-Indic digits
  (`i18n.md` §7).

---

## 6. Spacing

Tailwind v4 `--spacing` stays 4px; the design's values map to quarter steps.

| Context | Design value | Classes |
| --- | --- | --- |
| Page padding, desktop | 26px top, 34px sides, 34px bottom | `pt-6.5 px-8.5 pb-8.5` |
| Page padding, phone | 20px sides | `px-5` |
| Default gap (cards, grids, columns) | 14px | `gap-3.5` |
| Tight gap (chip rows, inline groups) | 6, 8, 10px | `gap-1.5` · `gap-2` · `gap-2.5` |
| Group gap | 12, 16px | `gap-3` · `gap-4` |
| Section gap | 22, 24, 26, 30px | `gap-5.5` · `gap-6` · `gap-6.5` · `gap-7.5` |
| Card padding | 24px 26px · 28px 30px · 16px 20px | `py-6 px-6.5` · `py-7 px-7.5` · `py-4 px-5` |
| Chip padding | 6px 12px | `py-1.5 px-3` |
| Field padding | 14px 18px (compact 11px 14px) | `py-3.5 px-4.5` (`py-2.75 px-3.5`) |

`px-*` and `py-*` are logical in v4 (`padding-inline`, `padding-block`). Never `pl-*` / `pr-*`.

---

## 7. Radius

| Token | Value | Use |
| --- | --- | --- |
| `rounded-full` | pill / circle | Buttons, chips, avatars, toggles, search field (the design's 99px and 50%) |
| `rounded-panel` | 26px | Big panels: hero, price card, summary card, page shell |
| `rounded-block` | 24px | Strips inside panels |
| `rounded-card` | 22px | Offer cards, list cards, collapsed applicants |
| `rounded-tile` | 20px | Notification items, service tiles, mid cards |
| `rounded-row` | 18px | White rows inside navy or tinted panels (promise chips) |
| `rounded-field` | 16px | Fields, small cards |
| `rounded-field-sm` | 14px | Compact fields |
| `rounded-sm` | 12px | Small boxes, thumbnails |
| `rounded-xs` | 6px | Tiny marks |

Never nest more than two radius levels; an inner radius is the outer one minus the padding.

---

## 8. Borders and shadows

- **Borders are 2px** (`border-2`), colour `border-border`; fields `border-input`; selected states
  `border-accent`. The design uses 2px almost everywhere (255 of 262 borders measured).
- **The design is flat: no elevation shadows on cards.** Separation comes from tint steps and borders.
- One shadow token, taken from the design: `shadow-overlay` = `0 20px 50px` in the `shadow` palette
  colour, for dialogs, sheets, dropdowns and the bell menu only.
- Focus: `ring-2 ring-ring` plus the 5px `ring-halo` glow (primary 200), never removed.

---

## 9. Motion

| Token | Duration | Use |
| --- | --- | --- |
| `fast` | ~150ms | Hover, focus |
| `base` | ~200ms | Dropdowns, tooltips |
| `slow` | ~300ms | Dialogs, sheets |

Ease-out for entrances, ease-in for exits. **Always respect `prefers-reduced-motion`.** The design has
one motion of its own: the two columns of service tiles in `s1` loop in opposite directions over 26s
(`animate-tiles-up`, `animate-tiles-down`) and pause on hover.

---

## 10. Breakpoints, frames, z-index

- The design draws **390px** phones, **1280px** desktop pages and a **1440px** admin console. Build at
  390 first; the desktop layout starts at `lg` (1024) and reaches the 1280 frame at `xl`; content width
  is 1280 minus the 34px page padding on each side.
- Tailwind defaults otherwise: `sm 640` · `md 768` · `lg 1024` · `xl 1280` · `2xl 1536`.

| Layer | `z-` |
| --- | --- |
| Base content | `0` |
| Sticky header, phone bottom bar | `10` |
| Dropdown, popover | `20` |
| Overlay, backdrop | `30` |
| Dialog, sheet | `40` |
| Toast | `50` |

---

## 11. Contrast (WCAG 2.1, computed 2026-10-25)

| Pair | Ratio | Verdict |
| --- | --- | --- |
| primary 900 on white · on 50 · on 100 · on 200 · on 250 · on danger 50 | 11.21 · 10.34 · 9.86 · 8.95 · 8.02 · 9.16 | AA |
| white on primary 900 | 11.21 | AA |
| ink 900 · 800 · 700 · 600 on white | 12.83 · 10.97 · 8.48 · 6.85 | AA |
| ink 600 on 50 · on 200 | 6.31 · 5.47 | AA |
| ink 500 on white · on 50 | 4.34 · 4.00 | **Large text only** |
| primary 700 on white · on 50 | 6.28 · 5.79 | AA |
| danger on white · on danger 50 | 5.90 · 4.82 | AA |
| danger alert on white | 3.91 | **Non-text only** |
| Field border: ink 500 on white (D59) | 4.34 | AA for a control boundary (3:1). The design's `#DFE7F3` was 1.25 |
| Card border primary 150 on white | 1.19 | Decorative; cards are identified by content, fine |

---

## 12. Open design questions

| # | Question | Status |
| --- | --- | --- |
| 1 | Brand palette | ✅ **2026-10-25 (D48):** the design's ramps, §2 |
| 2 | Arabic capable font family | ✅ **2026-10-25 (D48):** Alexandria (display, numbers) + Cairo (body); Turkish letters verified; `₺` only in Alexandria |
| 3 | Logo and favicon assets | ✅ **2026-10-17 (D40, D43, D44):** `docs/design/logo.jpg`, favicons in `app/`, the navbar wordmark in Archivo Black, the name written exactly **Aldebyani** in every locale |
| 4 | Dark mode in scope for v1? | ✅ **2026-10-25 (D50): no.** Light only, as designed |
| 5 | Colours for `success` / `warning` / `pending` | ✅ **2026-10-25 (D49):** the design's blue ramp, §3 and §4 |
| 6 | Field borders were 1.25:1 against white (WCAG AA wants 3:1 for an input's boundary) | ✅ **2026-10-25 (D59):** `input` = ink 500 (4.34:1) |
| 7 | "Cancelled" appeared as «ملغى» on primary 50 and «ملغي» on primary 100 | ✅ **2026-10-25 (D59):** «ملغى» on `success-light` |
| 8 | Approved and rejected provider chips looked identical | ✅ **2026-10-25 (D59):** «مرفوض» on `error-light`; approved stays blue |
| 9 | The design's focus glow (5px primary 200) alone is 1.27:1 | ✅ Default (our rule §8 wins): 2px navy ring plus the glow |

---

## 13. Applying the tokens (`app/globals.css`)

Tailwind v4: tokens live in `app/globals.css`, never `tailwind.config.ts`. The ramps are `:root`
variables (no utilities); the semantic tokens and scales are `@theme inline`, which generates
`bg-surface`, `rounded-panel`, `font-display` and so on (verified: `@theme` names compile to those
classes in Tailwind 4.3.3).

```css
@import "tailwindcss";

:root {
  --ramp-primary-900: #0f3a73;
  --ramp-primary-700: #1e5fb3;
  --ramp-primary-300: #c3d0e4;
  --ramp-primary-250: #d0dbeb;
  --ramp-primary-200: #dbe7f6;
  --ramp-primary-150: #e4ecf7;
  --ramp-primary-100: #eaf1fa;
  --ramp-primary-50: #f2f6fc;
  --ramp-ink-900: #22324f;
  --ramp-ink-800: #2c3c5e;
  --ramp-ink-700: #3d4d6c;
  --ramp-ink-600: #4b5b78;
  --ramp-ink-500: #6a7a97;
  --ramp-white: #ffffff;
  --ramp-danger: #c0262d;
  --ramp-danger-alert: #e5484d;
  --ramp-danger-50: #fde2e2;
  --ramp-shadow: rgb(15 58 115 / 0.18);
}

@theme inline {
  --color-*: initial;                                  /* FIRST: drops Tailwind's own palette (D61) */

  --font-sans: var(--font-cairo), sans-serif;          /* next/font variables from the root layout */
  --font-display: var(--font-alexandria), sans-serif;
  --font-wordmark: var(--font-archivo-black), sans-serif;

  --color-background: var(--ramp-white);
  --color-surface: var(--ramp-white);
  --color-surface-secondary: var(--ramp-primary-50);
  --color-surface-inverse: var(--ramp-primary-900);
  --color-border: var(--ramp-primary-150);
  --color-border-light: var(--ramp-primary-50);
  --color-input: var(--ramp-ink-500);
  --color-ring: var(--ramp-primary-900);
  --color-ring-halo: var(--ramp-primary-200);
  --color-track: var(--ramp-primary-250);
  --color-text-primary: var(--ramp-primary-900);
  --color-text-secondary: var(--ramp-ink-600);
  --color-text-muted: var(--ramp-ink-500);
  --color-text-strong: var(--ramp-ink-900);
  --color-text-inverse: var(--ramp-white);
  --color-link: var(--ramp-primary-700);
  --color-accent: var(--ramp-primary-900);
  --color-accent-foreground: var(--ramp-white);
  --color-accent-light: var(--ramp-primary-200);
  --color-accent-muted: var(--ramp-primary-100);
  --color-info: var(--ramp-primary-900);
  --color-info-light: var(--ramp-primary-100);
  --color-info-foreground: var(--ramp-primary-900);
  --color-pending: var(--ramp-primary-900);
  --color-pending-light: var(--ramp-primary-200);
  --color-pending-foreground: var(--ramp-primary-900);
  --color-success: var(--ramp-primary-900);
  --color-success-light: var(--ramp-primary-50);
  --color-success-foreground: var(--ramp-primary-900);
  --color-warning: var(--ramp-primary-900);
  --color-warning-light: var(--ramp-primary-100);
  --color-warning-foreground: var(--ramp-primary-900);
  --color-error: var(--ramp-danger);
  --color-error-light: var(--ramp-danger-50);
  --color-error-foreground: var(--ramp-danger);
  --color-alert: var(--ramp-danger-alert);

  --text-display: 84px; --text-display--line-height: 1.24; --text-display--letter-spacing: -0.055em; --text-display--font-weight: 900;
  --text-hero: 76px; --text-hero--line-height: 1.24; --text-hero--letter-spacing: -0.05em; --text-hero--font-weight: 700;
  --text-price-xl: 72px; --text-price-xl--line-height: 1; --text-price-xl--letter-spacing: -0.05em; --text-price-xl--font-weight: 900;
  --text-price-l: 66px; --text-price-l--line-height: 1; --text-price-l--letter-spacing: -0.05em; --text-price-l--font-weight: 900;
  --text-display-l: 48px; --text-display-l--line-height: 1.24; --text-display-l--letter-spacing: -0.045em; --text-display-l--font-weight: 900;
  --text-title: 44px; --text-title--line-height: 1.24; --text-title--letter-spacing: -0.04em; --text-title--font-weight: 900;
  --text-section: 28px; --text-section--line-height: 1.24; --text-section--letter-spacing: -0.02em; --text-section--font-weight: 900;
  --text-card: 22px; --text-card--line-height: 1.24; --text-card--letter-spacing: -0.02em; --text-card--font-weight: 800;
  --text-group: 15px; --text-group--line-height: 1.24; --text-group--letter-spacing: -0.02em; --text-group--font-weight: 800;
  --text-body-l: 16px; --text-body-l--line-height: 1.65; --text-body-l--font-weight: 500;
  --text-body: 15px; --text-body--line-height: 1.7; --text-body--font-weight: 500;
  --text-body-s: 13px; --text-body-s--line-height: 1.7; --text-body-s--font-weight: 500;
  --text-label: 14px; --text-label--line-height: 1.3; --text-label--font-weight: 700;
  --text-meta: 12px; --text-meta--line-height: 1.5; --text-meta--font-weight: 500;
  --text-chip: 12px; --text-chip--line-height: 1.3; --text-chip--font-weight: 700;
  --text-eyebrow: 12px; --text-eyebrow--line-height: 1.3; --text-eyebrow--letter-spacing: 0.06em; --text-eyebrow--font-weight: 700;
  --text-btn-sm: 13px; --text-btn-sm--line-height: 1.875; --text-btn-sm--font-weight: 700;
  --text-btn: 15px; --text-btn--line-height: 1.875; --text-btn--font-weight: 700;
  --text-btn-lg: 17px; --text-btn-lg--line-height: 1.875; --text-btn-lg--font-weight: 700;
  /* The landing, sign in and account sizes of the table above are in app/globals.css. */
  --text-nav: 15px; --text-nav--line-height: 1.3; --text-nav--font-weight: 600;
  --text-wordmark: 22px; --text-wordmark--line-height: 1.4; --text-wordmark--letter-spacing: -0.01em;
  --text-wordmark-sm: 18px; --text-wordmark-sm--line-height: 1.4; --text-wordmark-sm--letter-spacing: -0.01em;

  --radius-panel: 26px; --radius-block: 24px; --radius-card: 22px; --radius-tile: 20px;
  --radius-row: 18px; --radius-field: 16px; --radius-field-sm: 14px; --radius-sm: 12px; --radius-xs: 6px;

  --shadow-overlay: 0 20px 50px var(--ramp-shadow);
}
```

`--color-*: initial` stays the **first** line of `@theme inline` (D61). It removes Tailwind's own
palette, so `bg-red-500`, `text-white` and `var(--color-blue-900)` produce nothing and only our tokens
exist. Placed after our tokens it deletes them too (both verified against Tailwind 4.3.3).
`bg-transparent`, `text-current` and `bg-inherit` are not palette colours and still work; Tailwind's
preflight defaults to `currentcolor`, so nothing in it depends on the palette.

Order of work when a position first applies them: load the fonts with `next/font/google` in the root
layout (variables `--font-cairo`, `--font-alexandria`, `--font-archivo-black`), paste the block, check
the built pages in `ar` and `tr`, then add shadcn (its init writes its own palette; map it to these names,
never keep its values).

> **The write guard** (`.claude/hooks/guard.mjs`, rule `brand-value-in-globals`, updated 2026-10-25,
> D60) allows colour values in `globals.css` **only in `--ramp-*` declarations**, checked line by line
> and declaration by declaration; every other token must reference a ramp, and colours inside comments
> are ignored. An Edit must carry the whole declaration (`--ramp-name: value;`): a bare value has no
> name to check. The old `/* placeholder */` escape was deleted when this block landed (position 01).

---

## 14. Invariants

- Never use hex values in components; always semantic tokens
- Never use raw Tailwind colour classes (`bg-blue-900`, `text-gray-600`) or the `--ramp-*` steps directly;
  once §13 lands, Tailwind's palette is switched off and those classes compile to nothing (D61)
- Never define colours in `tailwind.config.ts`; `@theme` in `globals.css` only
- Fonts are set once in the root layout; never a system font as primary
- Every amount and currency sign is in `font-display` (Cairo has no `₺`)
- Status chips always use §4; never a colour per screen
- Colour is never the only signal; always the label (and an icon where the design has one)
