# 01 Project Setup + Tokens

Status: **confirmed**
Date: 2026-08-18 · confirmed 2026-08-18

```
FEATURE   01 Project Setup + Tokens
INTENT    A developer can run the app, switch between ar/tr/en, and watch direction
          flip — and CI refuses any commit that breaks a rule from CLAUDE.md.
ACTORS    developer + CI only. No customer, provider, admin, relay, cron, or webhook.
TRIGGER   `npm run dev` / a push to the repo.
OUTCOME   A booting Next.js 16 skeleton with three locales, runtime-derived direction,
          fail-fast env validation, pgTAP wired before the first table exists, and six
          green CI jobs.
NOT DOING Any brand value. Any table. Any auth. Any money. Any clickable product flow.
```

## Ground truth

- **Phase 0 / Phase 1**, first code in the repo. Nothing built.
- **Blockers:** **B4** (theme, font, logo, dark mode) and **B3** (Supabase project + credentials)
  both constrain scope — see *Out of scope*. Neither blocks structure.
- **Decisions consumed:** D8 (three locales), D13 (locale defaults, `as-needed` URLs), D14 (one
  deployment, `region` column), D16 (phone/region rule — designed here, enforced in 02).
- **Doc conflict found and fixed while planning:** `build-plan.md` Phase 0 still said *"RTL + Arabic
  locale as the default direction"* — pre-D8 wording that contradicts runtime-derived direction.
  Corrected. Precedence: a recorded decision (D8) beats build-plan wording.

## Rules engaged

| Rule | How this respects it |
| --- | --- |
| **10** — locales, direction, tokens | `[locale]` segment; `dirFor()` is the single place direction is decided; `@theme` carries token **names** with placeholder values; no hardcoded strings |
| **11** — `proxy.ts` never `middleware.ts` | `proxy.ts` at root exporting `proxy`; guard hook **and** CI both block the old name |
| **7** — RLS + negative test | pgTAP and the schema-wide "RLS enabled everywhere" test land **before** the first table, so feature 03 cannot ship a naked one |
| **4** — integer minor units | `Money` type stub only. No arithmetic |
| **D14** — region is a row value | `lib/env.ts` **rejects** `APP_REGION`/`APP_CURRENCY`; `lib/region` throws if asked to read region from env |

## Design questions

**Data.** No tables — feature 03 owns those. What ships is the *migration template* enforcing the
mandatory order (enable RLS → policies → constraints → indexes on policy columns and FKs), plus a
collation note: `lower()` is collation-dependent and a Turkish collation maps `I`→`ı`, silently
breaking case-insensitive email uniqueness. **RLS policy: n/a. Negative case: n/a** — the pgTAP
schema-wide test is the standing negative case for every table that arrives later.

**State.** n/a — no request lifecycle exists yet.

**Money.** n/a — nothing moves. No ledger legs, no idempotency key, no outbox event.

**PII.** n/a — no user data of any kind. `proxy.ts` sees only a locale segment and a path.

**Concurrency.** n/a at runtime. One build-time concern: `messages/*.json` edited by several people
diverges silently, which the catalogue-completeness CI job catches.

**Trust.** Two client-supplied inputs, both validated server-side:
- the `[locale]` URL segment → `hasLocale(routing.locales, locale)` → `notFound()` on anything else;
- environment variables → a Zod schema parsed once at startup, failing fast.
`lib/validation/` is created with the shared Zod setup so later boundaries have somewhere to live.

**Failure.** Missing env var → the app refuses to boot with a message naming the variable. Unknown
locale → 404, not a silent fallback. Missing message key → **build fails**, because rendering a raw
key to a customer is worse than failing loudly.

**Verification.** See *Tests*. Everything is mechanically checkable; none of it is "looks right".

## Most likely failure mode

**`npx shadcn init` will write a complete brand palette into `globals.css`, and nothing currently
stops it.** The CLI generates concrete `oklch`/`hsl` values for `background`, `foreground`,
`primary`, `border` and the rest. That is a direct violation of rule 10 and of B4 — and it happens
*automatically*, as a side effect of a command I would otherwise run without thinking. Worse, the
guard hook does not catch it: `hardcoded-hex` only inspects `.tsx`/`.jsx`, and
`raw-tailwind-palette` looks for utility classes, not raw colour values in a `@theme` block. I would
end up having invented a brand palette by accident, in the one file the human explicitly reserved.

**Design that makes it impossible rather than unlikely:** immediately after `shadcn init`, replace
every generated colour value with the placeholder token names from `ui-tokens.md` §12, and **add a
guard rule** rejecting concrete colour values (`#`, `rgb(`, `hsl(`, `oklch(`) inside `app/globals.css`
unless the line carries an explicit `/* placeholder */` marker. Then the failure is caught at write
time, by the same mechanism as every other rule, rather than by someone noticing the app looks
suspiciously designed.

Secondary risk: version skew across Next 16 · React 19 · Tailwind v4 · next-intl. Mitigated by
querying Context7 per library before writing config, never training memory (`library-docs.md`
authority chain).

## Migration

None. Ships instead:
- `supabase/migrations/00000000000000_template.sql.example` — the mandatory order, commented.
- pgTAP extension enabled; `supabase/tests/rls_enabled_everywhere.test.sql` asserting every table in
  `public` has `rowsecurity = true`. Passes trivially today; becomes the backstop from feature 03 on.
- `supabase/config.toml` committed. **Transaction-mode pooler (6543) with prepared statements
  disabled** documented in `.env.example` and asserted by the env schema's URL shape check.

## Server

| Path | Purpose | Guard |
| --- | --- | --- |
| `proxy.ts` | Locale negotiation + redirect | **Routing/UX only, never auth.** Smoke test asserts a protected path redirects |
| `lib/env.ts` | Zod-validated env, parsed once, fail fast | Rejects `APP_REGION`/`APP_CURRENCY` with a message pointing at D14 |
| `lib/i18n/routing.ts` | `defineRouting({locales:['ar','tr','en'], localePrefix:'as-needed'})` | — |
| `lib/i18n/request.ts` | `getRequestConfig` — locale + messages per request | — |
| `lib/i18n/direction.ts` | `RTL_LOCALES`, `dirFor(locale)` | The **only** place direction is decided |
| `lib/region/index.ts` | `getRegion(row)` | Throws if asked to resolve region from env |
| `lib/db/{client,server,admin}.ts` | Typed Supabase helpers (Phase 0 checklist) | `admin` is `import 'server-only'` and documented webhooks/cron-only |
| `lib/validation/index.ts` | Shared Zod setup | — |
| `lib/money/money.ts` | `Money` type, integer minor units | `import 'server-only'`. Type only, no arithmetic |
| `app/[locale]/layout.tsx` | `<html lang dir>`, `hasLocale`→`notFound`, `setRequestLocale` | — |

## Outbox events

**None.** No external effects.

## UI

Structure and semantics only.

| Component | Note |
| --- | --- |
| `app/[locale]/layout.tsx` | Root of every user-facing route. Register in `ui-registry.md` §4 |
| `LocaleSwitcher` | ar / tr / en, writes the cookie. Register in `ui-registry.md` §2 |
| shadcn/ui | **Init only, zero components.** Added one at a time when a screen needs one (`ui-rules.md` §2) |
| `app/globals.css` | `@theme` with the full token **name** set, values as placeholders |

**The app will look unstyled until B4, and that is correct** — `ui-rules.md` §11 says build structure
now and forbids inventing brand values. Token names are stable, so the theme lands as a values-only
change with no component edited.

## Tests

| Test | Proves |
| --- | --- |
| `dirFor('ar')==='rtl'`, `dirFor('tr')==='ltr'`, `dirFor('en')==='ltr'` | Direction derived, not hardcoded |
| Unknown locale → 404 | `hasLocale` guard holds |
| `/requests` unauthenticated → redirect | proxy smoke test; catches silent regression to `middleware.ts` |
| Env schema rejects a missing var **and** rejects `APP_REGION` | Fail-fast, and D14 cannot regress |
| Message catalogues: every key in all three | Already wired in CI |
| `supabase test db` green incl. "RLS enabled everywhere" | pgTAP works before any table |
| `node .claude/evals/guard.test.mjs` — 39/39 | Guardrails intact, including the new globals.css rule |
| Turkish round-trip `I`/`ı`/`İ`/`i` through identifier comparison | `i18n.md` §6, G27 |
| `globals.css` contains no concrete colour value | The failure mode above, mechanically |

## Definition of Done

- [ ] Types check; lint clean; no `any`
- [ ] Six CI jobs green (guardrails, typecheck, lint, test, catalogues, pgTAP)
- [ ] `proxy.ts` exists; **no `middleware.ts` anywhere**
- [ ] Renders in `ar` **and** `tr`; direction flips, layout survives both
- [ ] No hardcoded string, colour, font, or direction anywhere
- [ ] Dependencies pinned exactly; lockfile committed; automated dependency PRs enabled
- [ ] `progress-tracker.md` and `ui-registry.md` updated

## Decisions

| Decision | Reason | Reversible |
| --- | --- | --- |
| No root `app/layout.tsx` | `[locale]/layout.tsx` renders `<html>`; next-intl documents removing pass-through root layouts as conflicting. Verified against docs, not memory | Yes — add if a root `app/page.tsx` ever appears |
| `localePrefix: 'as-needed'` | D13 | Yes |
| Token names now, values later | `ui-tokens.md` §12 | — |
| pgTAP before any table | The RLS test must pre-date the first table or the first naked table ships unnoticed | No |
| **New guard rule: no concrete colour in `globals.css`** | Closes the shadcn-init hole above at write time | Yes, but removing it re-opens the hole |

## Open questions

**None blocking.** Two noted against their blockers:

1. **Font (B4).** `--font-sans` declared, unset. `ui-rules.md` §12 forbids both a system-font primary
   and picking one, so text renders in browser fallback until B4. Requirement recorded: one family
   covering Arabic **and** Latin Extended (`ı İ ş ğ ç ö ü`).
2. **Supabase linking (B3).** CLI + `config.toml` committed; `supabase link` needs a real project ref.
   Local `supabase start` works without it, so pgTAP runs in CI regardless.

## Out of scope

- **Any brand value** — colours, font, logo, favicon, dark mode. Blocked on B4; inventing them is forbidden.
- **Any table, policy, or seed data** — feature 03.
- **Auth, roles, OTP** — feature 02.
- **`regions` table and region columns** — feature 45, which lands before 03.
- **shadcn components** — init only.
- **Linking a live Supabase project** — blocked on B3.
