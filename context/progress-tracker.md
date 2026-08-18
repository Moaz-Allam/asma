# Progress Tracker

> **The living state of the project.** Read this at the start of every session; update it at the end of every task.
> This is how context survives between sessions. If it isn't written here, the next session doesn't know it.

**Last updated:** 2026-08-18
**Current phase:** Phase 1 — Foundation (feature 01 done)
**Overall status:** 🟡 Phase 1 in progress — feature 01 built

---

## 1. Session start checklist

- [ ] Read `project-overview.md` (model + non-negotiables)
- [ ] Read this file: current phase, open blockers, recent decisions
- [ ] Check §4 Blockers — is anything waiting on the human?
- [ ] Pick the next unchecked task in `build-plan.md` for the current phase
- [ ] Re-read the doc relevant to that task (`architecture.md` / `code-standards.md` / `ui-rules.md`)

## 2. Session end checklist

- [ ] Phase progress table updated
- [ ] Any decision made → §5 Decision Log
- [ ] Anything needing the human → §4 Blockers
- [ ] Design gap → §7 Design Questions
- [ ] PSP fact confirmed → §6
- [ ] §8 Handoff Notes written for the next session
- [ ] `Last updated` date changed

---

## 3. Phase progress

Legend: 🔴 not started · 🟡 in progress · 🟢 done · ⛔ blocked

| Phase | Status | Gate passed? | Notes |
| --- | --- | --- | --- |
| 0 — Foundations | 🟢 | ☑ | Feature 01 built and verified 2026-08-18 |
| 1 — Identity and roles | 🟡 | ☐ | 01 done. Next: 45 → 02 → 50 → 03 → 04 |
| 2 — Catalog and pricing | 🔴 | ☐ | |
| 3 — Requests and applications | 🔴 | ☐ | |
| 4 — Money core | 🔴 | ☐ | **Do not start Phase 5 until all 3 gate tests pass** |
| 5 — Unlock, escrow, release | 🔴 | ☐ | |
| 6 — Completion, ratings, admin | 🔴 | ☐ | |
| 7 — Hardening and launch | 🔴 | ☐ | |

### Current phase detail

**Phase 0 — Foundations**

| Task | Status | Notes |
| --- | --- | --- |
| Next.js + TS + Tailwind, strict | 🟢 | Next 16.3.1 · React 19.2.8 · TW 4.3.3, pinned exact |
| shadcn/ui init (primitives only) | ⏸ | Deferred — init writes a brand palette, blocked on B4. See spec §Most likely failure mode |
| Three locales, derived direction | 🟢 | ar/tr/en; verified in prerendered HTML |
| Supabase wired, typed clients | 🟡 | `lib/db/{client,server,admin}.ts` ✅. Project created + `supabase init` done. **`.env.local` still has 2 placeholders**: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_DB_POOL_URL |
| Env schema + `.env.example` | 🟢 | Zod, fail-fast via instrumentation.ts; rejects APP_REGION (D14) |
| Deny-by-default RLS in migration template | 🟢 | supabase/migrations/*.sql.example |
| Zod setup | 🟢 | lib/validation/index.ts |
| Test runner + first RLS test | 🟢 | vitest 27 tests; pgTAP "RLS enabled everywhere" |
| CI: typecheck, lint, test | 🟢 | 6 jobs. **Ran and passed on the first push** (run 32118566578) |
| Repo + CI | 🟢 | `github.com/Moaz-Allam/asma`. CI ran and passed. **No code-owner gate (D18, solo)** |
| Automated dependency PRs | 🟢 | `.github/dependabot.yml`; eslint held at 9.x deliberately |
| 45 Multi-region foundation | 🟢 | `regions` + `platform_settings` with RLS, 14 pgTAP assertions, seed matching `lib/region` (tested), CI region-column gate proven on a bad fixture |

---

## 4. Blockers — waiting on the human

> Anything here stops the related work. Do **not** guess and proceed.

| # | Blocker | Blocks | Raised | Status |
| --- | --- | --- | --- | --- |
| B1 | ~~Target market: Turkey or Saudi Arabia (or both)?~~ | — | at handover | ✅ **RESOLVED 2026-08-17: BOTH**, in **one deployment** separated by a `region` column (D14) — TR (TRY, iyzico) and KSA (SAR, PayTabs). Three locales in each. An account belongs to exactly one region. See `i18n.md` |
| B2 | **Legal sign-off on money custody model.** Confirm the platform never holds funds and no licence is required | Phase 7 release gate | at handover | ⏳ open |
| B3 | **PSP account + sandbox credentials** | Phase 4 | at handover | ⏳ open |
| B4 | **shadcn theme, brand colours, fonts, templates** | Styling (structure can proceed) | at handover | ⏳ open |
| B5 | **Pricing formula specifics** — for each category: the question list, types, options, base price, and modifier values | Phase 2 (07a–07c) | at handover | ⏳ open |
| B7 | **Public quality claim wording** — must be backed by a computed acceptance rate or a verifiable criterion. Do not ship "top 1%" unsubstantiated | 34 | v4 | ⏳ open |
| B8 | **Legacy provider job counts + past customer list** for the launch migration | 35 | v4 | ⏳ open |
| B6 | **Category list for launch** — which categories, and each one's questions | Phase 2 (07a) | at handover | ⏳ open |
| B10 | **Legally authoritative language for T&C and provider agreements.** Three locales ship, but one text must govern in a dispute. Also decides whether translations carry a "for convenience only" notice | T&C copy; provider signup | 2026-08-17 | ⏳ open |
| B9 | **Professional confirmation of the AGENT position (D12).** We set the price server-side and control matching — both are classic *principal* indicators, even though we never hold funds. A tax advisor must confirm the agent treatment in **both** regions (ZATCA / e-Fatura) before launch. Being wrong means VAT owed on the full job price, not just our fees | Phase 7 release gate; chart of accounts (feature 14) | 2026-08-17 | ⏳ open |

> ⚠️ **Never implement wallet top-up / stored balance.** Blocked by design, not just by B2 — see `project-overview.md` §6.

---

## 5. Decision log

Every non-obvious choice. Future sessions rely on this to avoid re-litigating.

| # | Date | Decision | Reason | Reversible? |
| --- | --- | --- | --- | --- |
| D1 | at handover | PSP behind an adapter interface; no SDK in feature code | Market undecided (B1); keeps both options open | Yes |
| D2 | at handover | Wallet is a **read-only earnings mirror**; unlock fee charged per transaction | Stored balance risks e-money/money-transmitter classification | Behind flag `FEATURE_STORED_BALANCE_WALLET` (OFF) |
| D3 | at handover | Auto-release after hold period (default 72h) | Prevents an inactive customer stranding provider funds | Configurable |
| D4 | at handover | Rating never gates payment release | Prevents rating coercion and trapped funds | No — design rule |
| D5 | at handover | No number masking | Model deliberately reveals contact post-unlock; leakage handled economically | Yes |
| D6 | at handover | Money stored as integer minor units | Float rounding errors are unacceptable in a ledger | No |
| ~~D7~~ | 2026-08-17 | ~~Both regions ship as two independent deployments~~ | ⚠️ **SUPERSEDED same day by D14** — one deployment, `region` column. Both regions still ship; only the deployment topology changed | — |
| D8 | 2026-08-17 | **Three locales — `ar` (RTL), `tr` (LTR), `en` (LTR) — in every deployment.** Direction derived from locale at runtime | Core segment includes Arabic speakers in Turkey; region and locale are independent axes | No — replaces the Arabic-only assumption |
| D9 | 2026-08-17 | Providers may be **individuals or companies, with no profile difference** | One provider account shape; entity type matters only for PSP sub-merchant KYC and invoicing, not for our schema or UI | Yes |
| D10 | 2026-08-17 | Admins are trusted operators but **never a code-execution boundary** (confirmed) | Pricing formulas stay structured rows; no `eval` of admin input, ever | No — security rule |
| D11 | 2026-08-17 | Accepted all proposed resolutions in `open-questions.md` G1–G16 | Each closes a silent-failure or unpriced-risk path found in the doc audit | Individually revisable |
| D19 | 2026-08-18 | **`localePrefix: 'always'` — every locale is prefixed (`/ar`, `/tr`, `/en`); there is no unprefixed route.** Supersedes D13's `as-needed` | `as-needed` gives exactly one locale the unprefixed URL, which cannot express a per-region default (`tr` for TR, `ar` for KSA) — and region is unknown until login, so nothing can derive it when the URL is served. `/` becomes a negotiation endpoint | Yes, but expensive once SEO exists |
| D18 | 2026-08-18 | **No CODEOWNERS / code-owner merge gate — removed.** High-risk paths are protected by `/review`, green CI, and an explicit callout in the summary instead | One-engineer project: the author and the reviewer are the same person, so the gate was theatre. A control everyone believes in but which does nothing is the `middleware.ts` failure class — better removed than left to rot | Yes — restore `.github/CODEOWNERS` + branch protection the day a second engineer joins |
| D17 | 2026-08-17 | **The satisfaction guarantee / re-do policy is DROPPED.** Trust rests on escrow + vetting + ratings; disputes handle disagreement | A guarantee of the outcome is a principal's obligation and contradicts D12. Keeping it risked VAT on the full job price. `project-overview.md` §34 rewritten | Yes — revisit if B9 returns "principal", since the constraint would be gone |
| D16 | 2026-08-17 | **Strict phone/region validation, no override at launch.** `+90` → TR, `+966` → KSA | Phone numbers are country-scoped in practice, so they carry the region naturally under phone-based OTP where one number maps to one identity | Yes — an admin override can be added once the blocked-user volume is known |
| D15 | 2026-08-17 | **Admins are global** — an admin sees and acts across both regions. No `admin_region` scoping | Matches launch reality: one operator replacing a WhatsApp group. Simplest RLS shape | ⚠️ Yes, but **expensive** — restricting a regional ops hire later means rewriting every admin policy against live data |
| D14 | 2026-08-17 | **Single deployment for both regions, separated by a `region` column** — not two deployments. Chosen for operational simplicity. **An account belongs to exactly one region**; a person operating in both markets creates a second account | One codebase, one migration run, one place to look. Single-region accounts keep one currency per account and per posting group, so the money model stays simple. **Supersedes D7** | ❌ Very hard after Phase 3 — it changes the shape of nearly every table |
| D13 | 2026-08-17 | **Seed defaults set for every open numeric/policy value** — grace periods, re-selection cap, price ceiling, application rate limit, PSP-fee absorption, locale defaults and URL strategy (see the table below) | Unblocks Phases 2–5 without waiting on non-critical decisions; every value is admin-editable in `platform_settings`, so a wrong default is a settings change, not a migration | Yes — all runtime-configurable |
| D12 | 2026-08-17 | **We are an AGENT / intermediary, not the principal.** The provider sells the service to the customer; we sell intermediation (commission) and lead access (unlock fee) to the provider | Determines VAT liability, invoice obligations, and the shape of the chart of accounts | ⚠️ **Business decision, NOT yet legally verified — see B9** |

### Defaults in use until decided (from `project-overview.md` §9)

All of these live in `platform_settings` and are admin-editable at runtime; the values below are the
seed defaults and the constants in `lib/utils.ts` are the fallbacks.

| Setting | Default | Confirmed |
| --- | --- | --- |
| Unlock fee basis | Flat, admin-configurable | ☐ |
| Hold period (auto-release) | 72 hours | ☐ |
| Payment window (SELECTED → OPEN) | 24 hours | ☐ |
| Unlock window (FUNDED → OPEN) | 24 hours | ☐ |
| Max applications/request | 10 | ☐ |
| Unlock fee refund on post-unlock cancellation | **Only when not provider-attributable** (G4) | ✅ D11 |
| Fee charge method | (A) card **at unlock**, via outbox (G9/C9) | ✅ D11 |
| **Start grace period** (G1) | 24h after `scheduled_start_at` | ✅ D13 |
| **Completion grace period** (G1) | 24h after `scheduled_end_at` | ✅ D13 |
| **Max re-selections before auto-refund** (G2) | 3 | ✅ D13 |
| **Max price multiple of base** (G11) | 20× — computed price above this fails loudly | ✅ D13 |
| **Applications per provider per hour** (G10) | 20 | ✅ D13 |
| **PSP fee absorbed on refund by** (G3) | Platform | ✅ D13 |
| Default locale — TR deployment | `tr` | ✅ D13 |
| Default locale — KSA deployment | `ar` | ✅ D13 |
| `en` customer-facing? | Yes, both regions | ✅ D13 |
| URL locale strategy | `localePrefix: 'always'` — every locale prefixed | ✅ **D19** (supersedes D13) |
| Legally authoritative T&C language | ⛔ **No default — needs legal (B10)** | ☐ |

---

## 6. PSP facts to confirm

Fill in before Phase 5. Source: the PSP's docs or support — **not** assumption.

| # | Question | Answer | Confirmed |
| --- | --- | --- | --- |
| 1 | Max hold duration (must exceed 72h) | | ☐ |
| 2 | Can individual (non-company) providers be sub-merchants? | | ☐ |
| 3 | Settlement delay after release | | ☐ |
| 4 | Webhook signature scheme + retry policy | | ☐ |
| 5 | Event id available for dedupe? | | ☐ |
| 6 | Partial refund supported while held? | | ☐ |
| 7 | Required user agreements to surface at signup | | ☐ |
| 8 | (KSA) ZATCA e-invoicing responsibility | | ☐ |
| 9 | Phone/SMS OTP available in this market? | | ☐ |

---

## 7. Design questions

Raised while building; answered by the human. Mirror in `ui-tokens.md` §10.

| # | Question | Raised | Status |
| --- | --- | --- | --- |
| Q1 | Brand palette | at handover | ⏳ |
| Q2 | Arabic-capable font | at handover | ⏳ |
| Q3 | Logo/favicon | at handover | ⏳ |
| Q4 | Dark mode in v1? | at handover | ⏳ |

---

## 8. Handoff notes

> Written at the end of each session for the next one. Be concrete: what you did, what you were mid-way through, what to do next, and anything surprising.

**Session 3 — 2026-08-18 (feature 01 CLOSED)**

```
DID        Feature 01 is done, reviewed, committed (5590445) and pushed to
           github.com/Moaz-Allam/asma. specs/01-project-setup/plan.md → Status: reviewed.
           Verified the human setup: repo is its own git root, remote set, CI ran GREEN
           on the first push, supabase init done.
           CODEOWNERS REMOVED (D18) — solo project, so the gate was theatre.
IN FLIGHT  Nothing. Working tree clean.
NEXT       Feature 45 — multi-region foundation. `/architect 45`. It MUST land before
           feature 03: it adds `region` to nearly every table, and retrofitting that
           after Phase 3 means rewriting every RLS policy. Plan already drafted and
           confirmed at specs/45-51-accepted-fixes/plan.md.
SURPRISES  1. ESLint 10 CRASHES eslint-config-next — its bundled eslint-plugin-react
              calls context.getFilename(), removed in v10. Pinned to 9.39.5 and held
              there by .github/dependabot.yml. Latest is not the same as compatible.
           2. `npx shadcn init` writes a full brand palette into globals.css as a side
              effect. Deferred the init (B4) and added guard rule brand-value-in-globals.
           3. architecture.md §11/§16 said lib/supabase-*.ts while §6 and build-plan.md
              said lib/db/ — a doc-vs-doc contradiction the code had already resolved.
           4. code-standards §17 said "Utility files: camelCase" while §2 said
              kebab-case, and its own example was kebab. Kebab wins.
           5. .env.example listed 22 vars lib/env.ts does not validate, contradicting
              §12's "all env vars validated at startup". Two tiers now explicit.
           6. `server-only` cannot import in a plain test runner — stubbed in vitest
              only; Next's build-time guarantee is untouched.
           7. Eager parseEnv() at module scope made lib/env untestable. Now getEnv() +
              instrumentation.ts, which is genuinely fail-fast at boot.
DO NOT     - Run `npx shadcn init` until B4 lands.
           - Upgrade ESLint past 9.x (dependabot ignores it; that ignore is deliberate).
           - Create app/layout.tsx — app/[locale]/layout.tsx renders <html>.
           - Add APP_REGION or APP_CURRENCY — lib/env.ts rejects them by design (D14).
           - Assume .env.local is real: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_DB_POOL_URL
             are still placeholders, so nothing can actually reach Supabase yet.
           - Guess past any blocker in §4. Moaz is working through them and will feed
             each one in.
```

**Session 2 — 2026-08-18 (review pass)**

```
DID        Verified the human setup steps. Ran /review twice on feature 01 and fixed
           everything it found. Doc-vs-code consistency swept 4 times.
FOUND+FIXED (code)  1. lib/db/client.ts used `!` non-null assertions on env — replaced
                       with Zod validation (code-standards §1 forbids `!` on boundaries).
                    2. LocaleSwitcher had two `as never` casts — I had copied next-intl's
                       `pathnames` variant; our routing has none, so the plain call is
                       fully typed. Added lib/i18n/navigation.ts (createNavigation).
                    3. No error.tsx / not-found.tsx — ui-rules §4 requires them.
                    4. lib/env.ts mixed z.url() and .string().url(); postgresql:// is not
                       a web URL, so the check was wrong as well as inconsistent.
FOUND+FIXED (docs)  5. architecture.md §11 tree said `lib/supabase-*.ts` (flat) while §6
                       and build-plan say `lib/db/` — the code follows lib/db/. Fixed in
                       §11 and §16, and propagated across 4 docs.
                    6. code-standards §17 said "Utility files: camelCase — contactInfo.ts,
                       supabase-server.ts" — contradicted §2 (kebab-case) AND itself.
                       Kebab-case wins.
                    7. §11 tree was 24 files out of date; now complete, with ✅ markers
                       separating built from planned.
                    8. .env.example listed 22 vars that lib/env.ts does not validate —
                       contradicting §12. Made the two tiers explicit rather than
                       pretending to validate features that do not exist.
                    9. Missing .github/dependabot.yml (build-plan 01 required it).
                   10. SETUP.md had gone stale on every step the human completed.
STATE      guard 39/39 · tsc 0 · eslint 0/0 · 27 tests · next build green · ar=rtl tr/en=ltr
COMMITTED  All review-pass fixes committed and pushed.
NEXT       Branch protection (human), then feature 45.
```

**Session 1 — 2026-08-18**

```
DID        Feature 01 built and verified. Next.js 16 skeleton boots; /ar renders RTL,
           /tr and /en render LTR — confirmed in the prerendered HTML, not assumed.
           27 unit tests, guard suite 39/39, tsc clean, eslint 0/0, next build green.
           pgTAP "RLS enabled everywhere" wired BEFORE the first table exists.
IN FLIGHT  Nothing. Feature 01 is complete.
NEXT       Feature 45 (multi-region foundation). It MUST land before 03, because it
           adds a `region` column to nearly every table and retrofitting it after
           Phase 3 means rewriting every RLS policy.
SURPRISES  1. ESLint 10 breaks eslint-config-next's bundled react plugin. Pinned to 9.39.5.
           2. `npx shadcn init` writes a full generated brand palette into globals.css.
              Deferred the init and added guard rule `brand-value-in-globals` to block it.
           3. `server-only` cannot be imported in a plain test runner — stubbed in
              vitest config only. The real build-time guarantee is untouched.
           4. Eager `parseEnv()` at module scope made lib/env untestable and would fail
              on any import without env. Moved to `getEnv()` + instrumentation.ts, which
              is genuinely fail-fast at server boot rather than at first use.
           5. Next 16 removed the `eslint` key from NextConfig along with `next lint`.
DO NOT     - Run `npx shadcn init` until B4 lands; it will invent a brand palette.
           - Upgrade ESLint past 9.x (see Versions).
           - Create app/layout.tsx — [locale]/layout.tsx renders <html>.
           - Add APP_REGION or APP_CURRENCY; lib/env rejects them by design (D14).
```

**Session 0 — handover**

- Nothing built yet. Docs prepared: overview, architecture, build plan, standards, libraries, UI rules/tokens/registry.
- **Start at:** `build-plan.md` Phase 0, first unchecked task.
- **Watch out for:** B1 (market) affects PSP work in Phases 4–5. It does **not** block Phases 0–3, because auth is built as a swappable OTP-channel adapter (phone default) and the PSP sits behind an interface. Proceed with foundations.
- **Do not:** implement wallet top-up, weaken RLS, or compute price/money client-side.

---

## 9. Versions

Pin once installed; keeps future sessions consistent.

| Package | Version | Pinned |
| --- | --- | --- |
| next | 16.3.1 | ☑ |
| react / react-dom | 19.2.8 | ☑ |
| typescript | 5.9.3 | ☑ |
| tailwindcss + @tailwindcss/postcss | 4.3.3 | ☑ |
| next-intl | 4.13.7 | ☑ |
| zod | 4.4.3 | ☑ |
| @supabase/supabase-js | 2.112.3 | ☑ |
| @supabase/ssr | 0.12.4 | ☑ |
| eslint | **9.39.5** | ☑ |
| typescript-eslint | 8.67.0 | ☑ |
| vitest | 4.1.10 | ☑ |
| shadcn/ui (CLI) | — | ☐ deferred, blocked on B4 |
| PSP SDK | — | ☐ blocked on B3 |

> ⚠️ **ESLint is pinned to 9.x deliberately.** ESLint 10 is released, but
> `eslint-config-next@16` bundles `eslint-plugin-react`, which calls
> `context.getFilename()` — removed in ESLint 10. Linting crashes outright.
> Do not "update" this until the Next config ships an ESLint-10-compatible react
> plugin. Latest is not the same as compatible.

---

## 10. Test health

Update after each phase gate.

| Suite | Status | Last run | Notes |
| --- | --- | --- | --- |
| Typecheck / lint | 🟢 | 2026-08-18 | tsc clean, eslint 0 errors 0 warnings |
| Unit | 🟢 | 2026-08-18 | **30 passed** — i18n, region, money, env, Turkish casing, and REGION_CONFIG-vs-migration drift |
| **RLS policy tests** | 🟢 | 2026-08-18 | pgTAP: schema-wide "RLS enabled everywhere" + 14 assertions on `regions`/`platform_settings`, incl. the negative cases (no write policy on reference data; unknown region rejected). **Not yet run against a live DB** — needs `.env.local` filled |
| Guard suite (`npm run guardrails`) | 🟢 | 2026-08-18 | 39/39, incl. false-positive cases |
| Build (`npx next build`) | 🟢 | 2026-08-18 | 3 locales SSG; `ar=rtl`, `tr/en=ltr` verified in the emitted HTML |
| CI (GitHub Actions) | 🟢 | 2026-08-18 | Ran green on push. **Not** in `npm run verify` — run `next build` + `supabase test db` yourself |
| Concurrency (money) | 🔴 | | Required before Phase 5 |
| Idempotency | 🔴 | | Required before Phase 5 |
| Invariant (`held = released + refunded + remaining`) | 🔴 | | Required before Phase 5 |
| Integration (full flow) | 🔴 | | |

---

## 11. Current Status

**Phase:** Phase 1 — Foundation

> ℹ️ **On phase numbering.** §3's "Phase 0 — Foundations" and this "Phase 1 — Foundation" are the
> **same phase** described twice — §3 as a checklist, §12 as numbered features 01–04. The numbered
> features in §12 are authoritative because they map 1:1 to `build-plan.md`. Treat §3's Phase 0 row
> as the gate summary for features 01–04, not as separate work.

> 🔴 **READ [`architecture-review.md`](architecture-review.md) FIRST** (converted from
> `docs/ARCHITECTURE-REVIEW.docx`; the `.docx` is the human-authored original). It documents six
> pre-money-flow blockers P0-1…P0-6, including one outright error in the earlier docs: the money
> write path called the PSP inline, which is not transactionally possible. **Use the outbox pattern
> (feature 38).** Also: the file is `proxy.ts`, not `middleware.ts` — a leftover `middleware.ts` is
> silently ignored on Next 16 and route protection becomes dead code.
>
> Known conflicts across all context docs are catalogued in
> [`contradictions.md`](contradictions.md). Read it before trusting any single section.

> ⚠️ **Read the v3 CORRECTIONS sections** in `project-overview.md` (§21–25), `architecture.md` (§20–22), and `build-plan.md` before starting. The payment order was corrected: **customer pays, then provider unlocks.**
**Last completed:** 45 Multi-region foundation
**Next:** 02 Auth + Roles (then 50 → 03 → 04)

---

## 12. Feature Progress

Numbers map 1:1 to `build-plan.md`.

### Phase 1 — Foundation
- [x] 01 Project Setup + Tokens ✅ 2026-08-18
- [x] 45 Multi-region foundation ✅ 2026-08-18 — `regions` + `platform_settings`, RLS + pgTAP, and the CI check that makes a region-less table impossible
- [ ] 02 Auth + Roles
- [ ] 03 Database Schema + RLS Baseline
- [ ] 04 App Shell + Navigation

### Phase 2 — Catalog and Pricing
- [ ] 05 Admin Catalog — Full UI
- [ ] 06 Catalog CRUD Logic
- [ ] 07 Pricing Rules + Engine
- [ ] 07a Admin Question Builder
- [ ] 07b Pricing Formula Builder
- [ ] 07c Dynamic Question Renderer + Server Pricing
- [ ] 08 Customer Browse + Price Preview

### Phase 3 — Requests and Applications
- [ ] 09 Post Request — Full UI + Logic
- [ ] 10 Provider Feed — Short Details Only
- [ ] 11 Apply + Contact Scanner
- [ ] 12 Applicant List + Choose Provider
- [ ] 13 Request Status + Realtime
- [ ] 40 RLS Performance Hardening 🔴

### Phase 4 — Money Core
- [ ] 14 Money Primitives + Ledger
- [ ] 38 Transactional Outbox + Relay 🔴
- [ ] 39 Ledger Integrity Enforcement 🔴
- [ ] 15 PSP Adapter
- [ ] 16 Webhook Receiver
- [ ] 17 Invariant + Reconciliation Jobs

### Phase 5 — Unlock, Escrow, Release
- [ ] 18 Unlock Fee + Reveal
- [ ] 19 Unlock Expiry Job
- [ ] 20 Customer Payment + Escrow Hold
- [ ] 21 Completion + Confirm + Auto-Release
- [ ] 22 Disputes + Admin Resolution
- [ ] 23 Earnings + Payouts

### Phase 6 — Completion and Admin
- [ ] 29 In-App Notification Centre
- [ ] 30 Provider Profile + Verification
- [ ] 31 Request Scheduling
- [ ] 24 Ratings
- [ ] 25 Notifications
- [ ] 26 Admin Dashboard + Reports + Leakage

### Phase 6b — Trust and Quality
- [ ] 32 Rating System
- [ ] 33 Provider Quality Metrics
- [ ] 34 Vetting Funnel
- [ ] 35 Reputation Migration (launch only)
- [ ] 36 Structured Application Answers
- [ ] 37 Quality Floor + Cold Start

### Phase 6c — Operability
- [ ] 41 Observability
- [ ] 42 Feature Flags + Kill Switches
- [ ] 43 Admin Operational Tooling

### Phase 7 — Hardening
- [ ] 44 Incident Runbooks + DR
- [ ] 27 Security + Load Testing
- [ ] 28 Launch Prep

**47 features total** (28 + 07a/07b/07c + 29/30/31 + 32–37 + 38–44).

---

## 13. Decisions Made During Build

_Add decisions here as they are made during implementation. Pre-existing decisions are in §5._

---

## 14. Notes

_Add notes here as the build progresses — workarounds, patterns, anything that differs from the context files._

> If something in this file contradicts a context file, the context file wins **unless** the note records an explicit human decision. In that case, update the context file too so they stop disagreeing.
