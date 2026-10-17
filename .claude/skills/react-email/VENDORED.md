# Vendored: react-email

| | |
| --- | --- |
| Source | `resend/resend-skills`, path `skills/react-email/` |
| Pinned commit | `247779a` (2026-10-16) |
| License | MIT (copy in `LICENSE`) |
| Reviewed | 2026-10-17, line by line, before vendoring |
| Used for | Email templates in three locales (`ar` RTL, `tr`, `en`), components, email-safe styling |

## Kept

`SKILL.md`, `references/I18N.md`, `references/COMPONENTS.md`, `references/STYLING.md`.

## Left out

`references/SENDING.md` (SDK based, and it runs `npx react-email@latest resend setup`, which stores an
API key), `references/EDITOR.md` (embeddable visual editor, out of scope), `references/PATTERNS.md`
(examples built on hex colours and raw palette classes). Links to them will not resolve; expected.

## Project overrides (these win over the skill)

- **Not installed yet.** The `react-email` package is added only when the notifications position's spec
  chooses it, pinned exactly (never `@latest`), recorded in `AGENTS.md`. Never run
  `npx create-email@latest` or any scaffold.
- **Never ask for hex colours.** Colours, fonts, and the logo come from `context/ui-tokens.md`
  (blocker B4). The write guard blocks hex values and raw palette classes in `.tsx`; how email styling
  maps to our tokens is decided in the notifications spec, not improvised.
- **Direction from locale:** `<Html lang={locale} dir={dirFor(locale)}>`, using `lib/i18n/direction.ts`.
  Copy comes from `messages/{ar,tr,en}.json`, never hardcoded.
- Always send a plain text alternative. Render user written text escaped.
