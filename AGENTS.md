# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your
training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed
deprecation notices.

# AGENTS.md — Aldebyani

v3, 2026-10-17, rewritten as the entrypoint when the project adopted `docs/engineering-approach.md`.

**Aldebyani** (slogan: **Aldebyani Home Care**; repo codename `asma`; D40) is a home services marketplace: a customer posts a request, providers apply free, the customer
picks one and **pays the commission online**, then the **chosen provider pays a fee online**, and only
then does each see the other's contact details. The work happens, and the customer pays the provider
**in cash, in person**, after the service. Revenue is the commission plus the provider fee. **We never
hold or move job money**: the gateway only takes those two fees (D87). Three locales (`ar` RTL, `tr`, `en`), two
regions (TR, KSA) in one deployment, separated by a `region` column.

Launch **2026-11-20, Turkey only** (standard iyzico checkout, D93; date D94). KSA stays in the schema, switched off until a
Saudi PSP is chosen. Priority (owner confirmed, D42): **correct money and private data > the core
journey working end to end in all three locales > design polish > extra features.**

Product brief: `docs/brief/` (not imported yet, owner step S12). Until then the product sections of
`context/project-overview.md` stand in for it.

## Status

- 2026-08-18 · **00 scaffold** ✅ (specs 0001, 0003): Next 16, three locales, `proxy.ts`, env schema,
  Supabase clients, `regions` + `platform_settings` with RLS and pgTAP. CI green. Cloud projects exist
  since 2026-10-18 (Vercel `aldebyani`; Supabase org `aldebyani`, project `lrejqpcgsugjiijuakoq`,
  eu-central-1).
- 2026-10-17 · **Playbook bootstrap** done: docs layout, harness, review agents, quality tooling.
  Verified locally (verify, build, e2e 6/6). Build plan v3 confirmed (D41). Merged (PR #17).
- 2026-10-25 · **Design handoff imported** (PR #18; S13, B4 closed, D48–D61): `docs/design/` (source,
  53 screens, tools), the UI context rewritten from it, the write guard hardened. Tokens and fonts land
  in `app/globals.css` with the first UI position.
- 2026-10-28 · **Replanned** (D65): launch 2026-11-28, same scope; EU data regions (D62). Next:
  `/architect` 00b, G0 by 2026-10-30.
- 2026-10-29 · **00b built and reviewed** (spec 0004, D74–D86), PR #20: Sentry and PostHog doors, own
  telemetry relays, nonce CSP, `/api/health`, flags, alerts; migrations in the cloud.
- 2026-10-30 · **Money model changed to cash, no escrow** (D87 to D95). Launch moves up to 2026-11-20
  (D94). Older text about escrow, hold, release, payouts, sub-merchants or disputes is history; where a
  context doc still says so, `project-overview.md` and the decision log win.
- 2026-10-31 · **00b merged, G0 closed** (`b0d54d7`): clean clone and CI green, all three relays proved
  on production with real browsers.
- 2026-10-31 · **01 part 1 merged** (PR #22, `09a7501`). Its real calls (AC-26) and reviews are still owed.
- 2026-11-13 · **01 part 2 merged** (PR #25, `3c8ca33`): landing page, SEO, full account. Its migration is in the cloud.
- 2026-11-15 · **02 merged** (spec 0006, PR #26, `5f6f283`): provider onboarding, admin review, suspend. Three migrations, all in
  the cloud. Merged on local CI, which replaced GitHub CI (down). **AC-29 real calls are a hard gate before G1** (D133).
- 2026-11-15 · **03 merged** (spec 0007, PR #27, `734517b`): catalog and pricing engine in Postgres, the
  admin pages `/admin/catalog` and `/admin/pricing`, `lib/pricing`, `lib/catalog`, `lib/money/parse.ts`. Security, slice and
  `/check review` fixes folded in (D136, D137, R9). Its migration `20261115100000_catalog_pricing` is in the cloud (S29). Merged on local CI (D135); **AC-26 real calls are a hard gate before G1** (D135).
- 2026-11-16 · **04 merged** (spec 0008, PR #28, `1118a5b`): post a request. The form is built from a service's active
  questions, Postgres computes the price, commission and cash due, the street line sits in its own PII table, and
  `lib/requests/` is the customer's door. Its migration `20261116090000_post_request` is in the cloud (S30). Two Opus
  security passes and a Sonnet cross review (D143 to D145); merged on local CI, because GitHub Actions fails at startup.
  **AC-27 real calls are a hard gate before G1.** Its SQL review findings go into 05's first migration (R10).
- 2026-11-18 · **05 merged** (spec 0009, PR #30, `6a7e666`): provider setup, feed, apply, My applications; `lib/provider-feed/`.
  Carries 04's R10 fixes. Migration `20261117090000_provider_feed_apply` in the cloud (S31). Local gate (D158). **AC-25 real calls owed.**
- 2026-11-18 · **06 merged** (spec 0010, PR #32, `5812073`): offers, choose, payment deadline, timeline; closes R11. Spec 0010
  supersedes the umbrella child 0011-06 (D168). Migration `20261118090000_choose_provider` in the cloud (S35). Local gate
  (D168). **AC-21 real calls owed.**
- 2026-11-18 · **07 merged** (spec 0011-07, PR #35, `980eb5b`, D169, D170): the money core in Postgres, database only. Fee
  settings, one fee formula, the commission floor, the fee frozen on the pick, seven money tables, the append only balanced
  ledger, the relay's functions; pgTAP 18 and 19. Migration in the cloud (S36). Carry overs R13; owner answers D171, D172.
- 2026-11-17 · **08 merged** (spec 0011-08, PR #38, `05cd9e1`, D173, D174): `lib/psp` (`off` default, `fake`, an iyzico
  slot that refuses until S1), `lib/relay`, `/api/relay` and the PSP routes, pg_cron and pg_net schedules, `payments_enabled`
  off in both regions, a database fence on fake payments. Migration in the cloud (S38). Local gate (Actions startup
  failure, waived). Owed: S32, S33 and the deployment check (A-1); `/architect` records D174 in the spec; 08b after S1.
- 2026-11-17 · **09 merged** (spec 0011-09, PR #40, `820eed9`, D175 to D177): the customer pays the commission on the
  hosted card page; only the relay's verified result moves the request to `COMMISSION_PAID`. Pay, return and receipt
  pages; a commission of 0 settles with no fee row (D171). Migration in the cloud (S39). Local gate (D177). Carry
  overs R14. **AC-16 (the S37 window) owed.**
- 2026-11-18 · **10 merged** (spec 0011-10, PR #42, `886cdcf`, D178, D179): the provider fee and the reveal both ways. Its
  migration pushed through the Supabase connector (S40, D184). **AC-17 (the S37 window) owed.**
- 2026-11-19 · **11 merged** (spec 0011-11, PR #43, `eaed326`, D180, D182, D185): work and close. The full local e2e found a
  My jobs crash, fixed before the merge. Migration pushed through the connector (S41, D184). Merges run on the local gate
  (D183).
- 2026-11-19 · **12 merged** (spec 0011-12, PR #44, `29c4fec`, D181, D186 to D190): expiry, cancellation, fee refunds,
  the admin request page. First merge on GitHub's checks only (D187); its migration pushed with the CLI (S42).
  Carry overs R17.
- 2026-11-19 · **13 merged** (spec 0011-13, PR #45, `fab75be`, D191, D192): transactional email. Mail hangs on the audit row each
  move writes; the relay's `email` task sends it in its own lane through `lib/email` (off, fake, resend). Migration
  `20261125090000_transactional_email` in the cloud with mail off (S43 turns it on). Security review ship (R18 carry
  overs). Local typecheck, lint and unit tests now run before each push.
- 2026-11-19 · **14 merged** (spec 0011-14, PR #48, `376d333`, D193, D194): report a problem. Either side reports after the
  reveal, with up to three photos in the private `report-photos` bucket; admin's queue handles each report (no action, warn,
  suspend, back to work, close the job), and an open report pauses the auto close. Migration `20261126090000_report_problem`
  pushed with the CLI right before the merge. Storage v1.96 writes an upload's final row as service role, so the photo guard
  checks that write against its owner. Carry overs R19.
- 2026-11-20 · **15 merged** (spec 0011-15, PR #51, `4677c70`, D195, D196): provider jobs and fees history, read only.
  One definer function `provider_history(p_month)` behind `provider_reader()`, `loadHistory` in `lib/provider-feed/`, the
  page `/provider/history` in `PROVIDER_NAV`, a banned word test on `History.*`. Migration
  `20261127090000_provider_history` pushed with the CLI right before the merge. Carry overs R20. Next: 16, spec amended
  first, in a fresh session.
- 2026-11-20 · **16 merged** (spec 0011-16, PR #54, `ca12727`, D197, D198): admin operations. The request list, the admin
  cancel with an attribution on its audit row, one deadline extension per pick or request, the flag queue with the hand
  clear, the street line on click (audited), revenue from the ledger by day or month with a CSV route
  (`/api/admin/revenue`). Migration `20261128090000_admin_operations` pushed with the CLI right before the merge; it also
  fixes 12's `admin_request_detail` (`selected` was null with no pick). Carry overs R21. Next: 21.
- 2026-11-21 · **01b merged** (spec 0012, PR #57, D199 to D202): phone and password sign in. A code only creates an account
  or resets a password; daily sign in is phone and password from the browser to Auth. `password_guard` keeps a password
  only on a proven phone of an onboarded account, `phone_fixed` freezes the sign in phone, `/continue` sends a role with
  no password to `/account/password`, the account page changes it, a first password and a change mail a notice. One
  shared e2e sign in module (`e2e/auth.ts`). Migration `20261129090000_phone_password` pushed with the CLI after S44
  (read back). GitHub's checks ran with the repo public for the run, then private again (D202). **AC-13 real calls
  owed** (the cloud Phone provider is off: S20, S22). Carry overs R22. Next: 21.
- 2026-11-22 · **17 merged** (spec 0011-17, PR #58, `9d8230d`, D205 to D208): optional ratings that gate nothing. The
  customer of a `COMPLETED` job rates four scores once within 14 days; the score is computed when read (shrinkage, recency,
  New below 5), shown on the offer card and the provider's profile; admin hides with a reason (final, audited). Two
  append only tables, a consistency trigger, two mails. Migration `20261130090000_ratings` pushed with the CLI right before
  the merge. Also fixes 16's revenue default range (D208). Merged on GitHub's checks with the repo public for the run, then
  private again (D202 route). Carry overs R23, two of them owner decisions before G1. Next: 18.
- 2026-11-22 · **18 merged** (spec 0011-18, PR #60, `412ad4c`, D209 to D212): the in app notification centre and live
  status. Notices ride 13's recipient map (`audit_notices`, one map for mail and notices), each channel with its own trigger;
  ids only, rendered when read; the bell in every signed in header and `/notifications`; an empty ping per notice on the
  private Realtime topic `notices:<uid>` (policy `aldebyani_notices_read_own`), `lib/notifications/live.ts` the lint
  enforced Realtime door. Migration `20261201090000_notification_centre` pushed with the CLI right before the merge and read
  back. Merged on GitHub's checks with the repo public for the run, then private again (D202 route, owner's choice). S45
  owed (Realtime public access off). Carry overs R24. Next: 19.
- 2026-11-22 · **19a merged** (spec 0011-19a, PR #62, `eaecc4d`, D213 to D216): trust and quality. Jobs done, completion and on
  time on the offer card and the provider's profile, computed when read; probation for the first 5 jobs (2 live jobs, the last 2
  of 10 applicant slots reserved); an hourly watchlist admin warns, suspends or clears; `/admin/quality` (watchlist, probation,
  funnel) and a Quality section on the provider page; a document expiry reminder. `lib/admin-quality/` is admin's door.
  Migration `20261202090000_trust_quality` pushed with the CLI right before the merge and read back. Merged on GitHub's checks
  with the repo public for the run, then private again (D202 route, owner's choice). Carry overs R25 (S-2 an owner decision).
  Next: 19b.
- 2026-11-22 · **19b merged** (spec 0011-19b, PR #65, `5470f42`, D213, D219, D220): structured application answers. Admin writes up
  to five questions per category for providers (text, a choice, yes or no) in `/admin/catalog`, in `application_questions` (its
  own table, never priced); a category with active questions takes answers instead of the message, checked against the set read
  once under the request row lock and stored with a snapshot; every text answer, and all of them joined, pass the contact
  scanner at apply and on the card. `apply_to_request` takes four arguments. Migration `20261203090000_application_answers`
  pushed with the CLI right before the merge and read back. Merged on GitHub's checks with the repo public for the run, then
  private again (D202 route, owner's choice). Carry overs R26. Next: the Next.js security upgrade, then 20.

## Stack (pinned exactly)

`.npmrc` sets `save-exact=true`. **Never add a dependency without pinning its exact version and
recording it here.** Install scripts run only for packages listed per version in `package.json`
`allowScripts` (D45); a version bump needs the script reviewed again before `npm install-scripts approve`.
Approved after review: `@parcel/watcher` 2.6.0, `@swc/core` 1.15.47, `unrs-resolver` 1.12.2 (D45);
`@sentry/cli` 2.58.6 (a no op when its platform binary package is installed, else a checksum verified
download from Sentry's CDN) and `core-js` 3.51.0 (a donation banner, through `posthog-js`), owner
2026-10-28.

| Layer | Package · version | Why this version |
| --- | --- | --- |
| Runtime | Node 24 LTS (`.nvmrc`), npm 11 | Matches local and CI |
| App | `next` 16.4.6 · `react` / `react-dom` 19.2.8 · `typescript` 5.9.3 | TS 7 failed CI (dependabot PR). `next` 16.4.3 (2026-10-28, D66): 16.3.1 had critical unauthenticated remote code execution advisories. `next` 16.4.6 (2026-11-22, D216, D221): 16.0.0 to 16.4.4 carry seven moderate advisories (cache disclosure and poisoning, an SVG bypass, an Edge cookie leak); the build refused to run on 16.4.3 |
| i18n | `next-intl` 4.13.7 | |
| Data | `@supabase/supabase-js` 2.112.3 · `@supabase/ssr` 0.12.4 · `server-only` 0.0.1 | |
| Errors, traces, logs | `@sentry/nextjs` 10.75.2 (brings `@sentry/cli` 2.58.6) | Spec 0004 AC-20: the lowest version with Turbopack source map upload and Sentry Logs with `beforeSendLog`, raised to the first one clear of the critical tunnel advisory GHSA-mchm-gjx6-7h55 (every 10.x below 10.75.2). Released 2026-09-22. Owner choice 2026-10-28. Imported only in `lib/observability/` |
| Analytics | `posthog-js` 1.418.11 | Spec 0004 AC-20: the lowest version with every option we set plus the fixes for a relative `api_host` proxy (scripts added several times) and the cookieless id leak. Released 2026-08-24. Owner choice 2026-10-28. Imported only in `lib/analytics/` |
| Validation | `zod` 4.6.7 | Below 4.6.6, oversized constrained collections can exhaust memory (advisory, D66) |
| Styling | `tailwindcss` + `@tailwindcss/postcss` 4.3.3 | B4 resolved 2026-10-25 (D48). Tokens in `app/globals.css`, fonts in `lib/fonts.ts` |
| UI primitives | `radix-ui` 1.8.1 · `input-otp` 1.5.0 · `class-variance-authority` 0.7.1 · `clsx` 2.1.1 · `tailwind-merge` 3.7.0 · `lucide-react` 1.59.0 · shadcn CLI 4.21.5 (through `npx`, never installed) | Spec 0005 AC-18, D105. Never `shadcn init`: it writes its own palette. `components.json` is by hand; read what `add` writes. None has an install script |
| Lint | `eslint` 9.39.5 · `eslint-config-next` 16.4.6 · `typescript-eslint` 8.67.0 | ESLint 10 crashes eslint-config-next's react plugin; held at 9 (dependabot ignores ≥10) |
| Format, pre commit | `prettier` 3.9.9 · `husky` 9.1.7 · `lint-staged` 17.6.0 | Owner pinned |
| Unit tests | `vitest` 5.0.5 · `fast-check` 4.10.2 | Owner pinned vitest (5.0.5 for an advisory in `@vitest/mocker`, D66); fast-check for money property tests |
| End to end | `@playwright/test` 1.63.0 · `@axe-core/playwright` 4.13.0 · override `playwright-core` 1.63.0 | Owner pinned Playwright; axe 4.14.0 was 2 days old; the override stops axe's open peer range pulling a second `playwright-core` |
| Database tests | `supabase` CLI 2.114.0 (pgTAP via `supabase test db`) | |
| Types | `@types/node` 26.2.0 · `@types/react` 19.2.18 · `@types/react-dom` 19.2.4 | |

**Services** (accounts are owner steps; no SDK is installed until its position's spec says so):
Supabase (org `aldebyani`, eu-central-1; Free until launch, then Pro, D63) · standard iyzico checkout (TR) ·
Resend Pro (REST over `fetch`) · Sentry free (EU) · PostHog free (EU Cloud) · Cloudflare (DNS, Turnstile) · Vercel Hobby while building, Pro
from gate G3 (Hobby forbids commercial use) · an uptime monitor (Q3) · GitHub Actions.

## Commands

| Command | Does |
| --- | --- |
| `npm run dev` | Dev server on port 3000. Agents start it through `.claude/launch.json` (`asma-dev`) |
| `npm run build` / `npm start` | Production build / serve it. Locally, set `APP_LOCAL_ONLY=1` first: any production build or server off Vercel otherwise counts as a deployment and refuses to run without its Sentry and PostHog keys (`lib/deployment.ts`, spec 0004). Never set it on Vercel |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint, including the single door rules |
| `npm run lint:rtl` | Fails on physical direction classes (`ml-`, `text-left`, …) with replacements |
| `npm run format` / `npm run format:check` | Prettier write / check (Markdown excluded) |
| `npm test` | Vitest: unit, lint rule, and harness tests |
| `npm run test:e2e` | Playwright through `scripts/e2e.mjs`: resets the local database, 390px, `ar` + `tr` + `en`. `node scripts/e2e.mjs --reuse-build --serve` serves that build on the local stack (`asma-local`); `--indexable` builds and serves with the indexing switch on (`asma-indexable`). Needs local Storage: a stack started before 02 must be restarted (`npx supabase stop`), which also loads new test numbers. `E2E_PORT` moves the server off 3100. Runs the fake PSP (`PSP_DRIVER=fake`, its own `RELAY_SECRET`); the local seed turns payments on for `TR` and opens the fake fence |
| `npm run launch:gate` | Run at G3, not in CI: fails while a `[tr]` or `[draft]` marker remains (D100) |
| `npm run guardrails` | Regression suite for the write guard |
| `npm run db:test` | pgTAP (`supabase test db`). Needs Docker locally; always runs in CI |
| `npm run db:types` | Generate `lib/db/database.types.ts` from the local database |
| `npm run verify` | guardrails → typecheck → lint → lint:rtl → format:check → test |

Do not invent commands that don't exist.

## Where to read what

Read order: this file → `context/project-overview.md` (§1, §5, §6, §8) →
`context/progress-tracker.md` → the current position's spec in `docs/specs/` → **only** the one context
doc the task needs. **Do not read every doc.** `context/` is about 6,000 lines.

| Task | Read |
| --- | --- |
| Every session, first | `context/progress-tracker.md`: state, blockers, decision log, open questions (Q), owner steps (S) |
| Building a position | Its spec: `docs/specs/NNNN-*.md` or `NNNN-*/index.md` (`rationale.md` only when deciding) |
| Business rule, flow, "is this in scope?" | `context/project-overview.md` |
| Schema, RLS, outbox, pricing pipeline, invariants | `context/architecture.md` |
| Writing code: templates, money, errors, tests | `context/code-standards.md` |
| Build order, gates, cut list, schedule | `context/build-plan.md` |
| Requirement seeds for a position's spec | `context/feature-notes-v2.md` (old feature map at the end of the build plan) |
| Library API or gotcha, PSP facts, pgTAP | vendored skill → `context/library-docs.md` → context7 → official docs |
| Anything visual | `context/ui-rules.md` → `ui-tokens.md` → `ui-registry.md`; references in `docs/design/` |
| Locales, direction, Turkish casing | `context/i18n.md` |
| Known doc conflicts, the v5 corrections | `context/contradictions.md`, `context/architecture-review.md` |
| Why a past gap was resolved a certain way | `context/open-questions.md` (archive; live questions are Q rows in the tracker) |
| The methodology | `docs/engineering-approach.md` |

**Precedence** when documents disagree (highest first): (1) rules that never bend,
`project-overview.md` §5, and custody §6; (2) the decision log in `progress-tracker.md`; (3) the spec
being built, for its own feature; (4) the brief (`docs/brief/`; until imported, the product sections of
`project-overview.md`); (5) `architecture.md`; (6) `code-standards.md`, `ui-tokens.md`, `ui-rules.md`;
(7) `build-plan.md` task wording; (8) `docs/engineering-approach.md`. A `v5` section overrides an
earlier `v3`/`v4` section in the same file. Not settled by this order: **stop and ask.**

## Rules that never bend

Canonical text: `context/project-overview.md` §5 (it wins if this summary differs).

1. Price, commission, and fees are computed on the server. The client sends answers, never a price.
2. Contact details are visible only when both fees are `paid` for that `(request, provider)`: the
   customer's commission and the chosen provider's fee (`COMMISSION_PAID` is not enough). No provider
   ever reads another provider's data. RLS, never React.
3. No external call in a request path: DB transaction → `outbox_events` → relay → PSP. The relay is the
   only mutating caller of `lib/psp`. Money state changes only on verified PSP facts, never a redirect.
4. Money is integer minor units. No float, no client side money arithmetic, one rounding step.
5. `ledger_entries` and `ratings` are append only (`UPDATE`/`DELETE` revoked). Corrections are new postings.
6. Every money operation is idempotent, atomic, and balanced. Deterministic keys from domain ids, a
   replay returns the stored response, a fee is charged at most once and refunded at most once.
7. RLS enabled + policy + negative test in the same migration and commit as the table.
8. Never execute an admin authored string (`eval`, `new Function`). Formulas are structured rows.
9. The platform never holds or moves job money. The job price is cash from customer to provider, outside
   the platform; the gateway takes only the two fees. No top up, no stored balance;
   `FEATURE_STORED_BALANCE_WALLET` OFF.
10. Three locales, two regions, by construction: direction from the locale, logical properties,
    semantic tokens, no hardcoded strings, region from the owning row, no Turkish case folding of ids.
11. `proxy.ts`, never `middleware.ts`. `requireRole()` runs inside every Server Action and Route Handler.

**Lifecycle:** `OPEN → SELECTED → COMMISSION_PAID → UNLOCKED → IN_PROGRESS → AWAITING_CONFIRMATION →
COMPLETED`. `COMMISSION_PAID → OPEN` when the chosen provider misses the pay window: the commission stays
paid and the customer re-picks without paying again (max 3 failed picks, then a refund). A customer who
cancels before the reveal gets the commission back. After the reveal no fee is refunded automatically;
admin may refund by hand with a recorded reason. The cash is never part of any of this.

**Scope rule:** anything not in the brief is asked about before it is built, and logged as an override.

## How we build

- **Tracer bullets, strict order** (Build approach: Tracer Bullet). Each position is one capability end
  to end: migration → RLS + database functions → data layer → logic → action or route → UI in
  `ar`/`tr`/`en`, phone width (390px) first. Every layer tested. Spec first. **Tests first on risky
  paths** (`context/code-standards.md` §10).
- **Each position adds only its own write path** (policies and grants in its own migration). Schema
  changes only through migration files; the owner asks before any cloud push, with a dry run first.
- **The loop per position:** `/architect` → cross check on a different model → owner accepts → branch →
  `/develop` → `/test` → local checks (`npm run verify`, `db:test`, `test:e2e`) → `/check verify`
  (failure → `/debug`) → PR → CI green (3 jobs) → `/check review` on a different model, plus the
  `slice-reviewer` agent, plus `security-reviewer` when money, auth, PII, or storage is touched → fix →
  owner applies migrations to the cloud → merge → `/sync` → tracker updated.
- **Stop and ask** when: something is not in the brief; a rule would bend; documents disagree past the
  precedence order; a decision has no spec; a value has no named source; money, auth, or personal data
  is touched where the spec is silent; taking job money or a top up is implied; contact details would
  show before both have paid, or across providers; an RLS policy would be weakened; a money operation cannot be idempotent
  or atomic; the PSP lacks an assumed capability; legal, tax, KYC, or e-invoicing is implicated; the
  same problem survives one corrective attempt (stop patching, run `/debug` from the reproduction).
- **High risk paths, say so out loud:** `lib/money/**`, `lib/psp/**`, `lib/pricing/**`,
  `supabase/migrations/**`, `supabase/functions/**`, `.claude/**`, any idempotency key derivation.
  Solo project (D18): no code owner gate. What protects them is the reviewer agents, `/check review`,
  green CI, and an explicit callout in your summary. Restore CODEOWNERS if a second engineer joins.
- **End of session:** update `context/progress-tracker.md` (state, decisions, blockers, questions);
  fold permanent decisions into the right doc; `/sync` after merges; delete any line here that stopped
  being true.
- **Context hygiene:** long task notes go in `NOTES.md` (gitignored). Hold paths and identifiers, not
  file dumps. After a spec is accepted, build in a fresh session; the spec is on disk.

## Single doors (lint enforced, `eslint.config.mjs`)

Each risky system has one module that may import its SDK or read its key; everything else calls that
door's functions. The rules also catch `import()`, `require()`, a destructured key, and a computed or
spread `process.env` (D86). Every rule and exemption has a proof in `tests/lint/eslint-rules.test.ts`
(architecture.md §42). A file under `lib/` named `*relay*` (or under a `relay/` folder) gets the outbox relay's
rights (PSP, service role), so no other module may be named that way; since 08 no route file gets them (spec 0011-08
AC-3). Tests may import `lib/psp` (its contract suite).

| System | Door | Notes |
| --- | --- | --- |
| Supabase | `lib/db/` | The service role client (`lib/db/admin.ts`) for webhooks, jobs and the relay only; `createAnonClient()` for machine endpoints; the `Db` type for callers |
| Auth | `lib/auth/` | Only it calls `supabase.auth`, with one exemption, `lib/db/proxy.ts`, for the session refresh. `getSession()` is banned everywhere. Pages call `guardPage`, Server Actions `guardedAction` |
| Storage | `lib/storage/` | Only it calls `supabase.storage` (spec 0006 AC-26). `client.ts` checks first bytes, downscales and uploads; `server.ts` signs links and removes, always as the signed in user. Bucket names, limits and the 60 second link live in `buckets.ts` |
| PSP | `lib/psp/` | Only the outbox relay calls it (rule 3). Drivers `off` (default), `fake`, `iyzico` (a refusing slot until 08b, S1), picked by `PSP_DRIVER`; every call 15 s. `IYZICO_*` read only here (spec 0011-08) |
| Relay | `lib/relay/` | The only caller of `lib/psp` and of the relay's service role functions (spec 0011-08): `drain`, `handlers` (initialize, verify, refund), `callback`, `webhook`, `reconcile`, `heartbeat`, `fake-checkout`, `task` (the `/api/relay` door, `RELAY_SECRET` read only here). Routes only parse and call it |
| Card page URL | `lib/payments/` | `isAllowedCheckoutUrl(url, hosts)` and `checkout-hosts.ts`: the one URL check, no `lib/psp` import, so 09's redirect calls it too (AC-21, R-5) |
| Pricing | `lib/pricing/` | Admin's server only door to the engine in Postgres: `previewFormula`, `publishFormula` wrap `preview_pricing_formula`, `publish_pricing_formula` (spec 0007, D121). No function takes a price (rule 1). No lint rule yet; the SQL side is guarded by the tamper meta test in `supabase/tests/10_pricing_engine.test.sql`. Since 04, `quote_price` has no `authenticated` grant (spec 0008 AC-28) |
| Requests | `lib/requests/` | The customer's server only door (spec 0008): `loadRequestCatalog`, `quoteRequest`, `createRequest`, `cancelRequest`, `listMyRequests`, `getMyRequest`, `prefillFrom`, `loadOffers`, `chooseProvider`, `cancelPreview`, `payCommission`, `checkoutStatus`, `loadReceipt`, `rateProvider`, `loadRating` wrap `request_catalog`, `quote_request`, `create_request`, `cancel_request`, `request_offers`, `choose_provider`, `pay_commission`, `my_checkout`, `my_receipt`, `rate_provider`, `request_rating` and the RLS reads. Customers read offers only through `request_offers` (spec 0010); a payer reads an attempt or a receipt only through `my_checkout` and `my_receipt` (spec 0011-09). Pay takes a request id, never an amount. The split and the stored figures are computed in Postgres; `create_request`'s two expected figures are compared, never stored (D140) |
| Provider feed | `lib/provider-feed/` | The provider's server only door (spec 0009; since 19b `apply_to_request` takes the answers and the form's `questions_version`, all four arguments always sent, and `provider_request` returns the active `questions`): `loadSetup`, `saveSetup`, `loadFeed`, `loadRequest`, `applyToRequest`, `listApplications`, `loadHomeCounts`, `withdrawApplication`, `providerCancelJob`, `jobCancelPreview`, `loadHistory`, `loadMyRating` wrap `provider_setup`, `save_provider_setup`, `provider_feed`, `provider_request`, `apply_to_request`, `provider_applications`, `provider_home_counts`, `provider_history` (spec 0011-15: own unlocked jobs of one month, fees and refunds, totals summed in Postgres, no contact field), `my_provider_rating` (spec 0011-17: the caller's own score summary only, never a single rating). Strict schemas refuse a key the functions must never send. `apply_to_request` is the only write to `applications` (D148) |
| Admin requests | `lib/admin-requests/` | Admin's server only door to requests (spec 0011-12, 0011-16): `loadAdminRequest`, `refundFee`, `markRefundDone`, `listRequests`, `cancelRequest`, `extendDeadline`, `showAddress`, `listFlags`, `clearFlag` wrap `admin_request_detail`, `admin_refund_fee`, `admin_mark_refund_done`, `admin_requests`, `admin_cancel_request`, `admin_extend_deadline`, `admin_request_address`, `admin_flags`, `admin_clear_flag`, each checking `is_admin()` again. No amount is ever sent; reasons and notes go only to `audit_log`; the street line goes only to the client component that asked. No lint rule yet |
| Admin revenue | `lib/admin-revenue/` | Admin's server only door to revenue (spec 0011-16): `loadRevenue` wraps `admin_revenue` (ledger sums per region, currency and day or month, checked `is_admin()` again); `revenueCsv` and `revenueFileName` build the CSV that `/api/admin/revenue` serves, amounts through `formatMinorFixed` (integer arithmetic). No amount is ever computed here. No lint rule yet |
| Admin ratings | `lib/admin-ratings/` | Admin's server only door to ratings (spec 0011-17): `loadProviderRatings`, `hideRating` wrap `admin_provider_ratings` (the summary and every rating of a provider, 20 a page, with its request id; no customer id) and `admin_hide_rating` (a reason from the list and a note, once; a hide is final), each checking `is_admin()` again. No path changes a score. The shared shapes and the formatter live in `lib/ratings/summary.ts` (no `server-only`). No lint rule yet |
| Admin quality | `lib/admin-quality/` | Admin's server only door to trust and quality (spec 0011-19a): `loadQualityFlags`, `handleQualityFlag`, `loadProbation`, `endProbation`, `loadFunnel`, `loadProviderQuality` wrap `admin_quality_flags`, `admin_handle_quality_flag`, `admin_probation`, `admin_end_probation`, `admin_quality_funnel`, `admin_provider_quality`, each checking `is_admin()` again. No figure is sent or computed here; notes go only to the flag, the waiver and `audit_log`. The shared shapes and wording live in `lib/quality/summary.ts` (no `server-only`); the provider's own figures come through `loadMyQuality` in `lib/provider-feed/`. No lint rule yet |
| Reports | `lib/reports/` | Either side's server only door (spec 0011-14): `openReport`, `addReportPhoto`, `myReport`, `myWarning`, `acknowledgeWarning` wrap `open_report`, `add_report_photo`, `my_report`, `my_warning`, `acknowledge_warning`. Photos upload through `lib/storage` (`uploadReportPhoto`, re-encoded JPEG, no EXIF) and are registered only by `add_report_photo`, which reads what Storage recorded. No lint rule yet |
| Admin reports | `lib/admin-reports/` | Admin's server only door (spec 0011-14): `loadReports`, `openReportsCount`, `loadReport`, `handleReport`, `reportPhotoLink` wrap `admin_reports`, `admin_reports_open_count`, `admin_report_detail`, `handle_report`, `log_report_photo_view`, each checking `is_admin()` again. A photo link is signed only after its view is audited. No lint rule yet |
| Notifications | `lib/notifications/` | The notification centre's doors (spec 0011-18): `centre.ts` (server only) `loadNotices`, `noticeCount`, `openNotice`, `markAllRead`, `renderNotices` wrap `my_notices`, `my_notice_count`, `open_notice`, `mark_all_notices_read`, each reading `auth.uid()`; rows hold ids only and are rendered in the reader's locale from `NoticeKinds`; links come from `noticeHref` (`kinds.ts`) on the server, never the client. `live.ts` (client) is the **Realtime door** (lint): the only module that may use `.realtime`, `.channel(` or `.removeChannel(`; it joins the private topic `notices:<own id>`, authorized by the RLS policy `aldebyani_notices_read_own` on `realtime.messages`, and a ping carries nothing. `topics.ts` and `preferences.ts` keep 01's email switches |
| Email | `lib/email/` | Only `lib/relay` imports it (lint and a source test, spec 0011-13 AC-1). `emailDriver()`, `createEmailDriver()` (drivers `off` default, `fake` writes `EMAIL_FAKE_FILE`, `resend` over `fetch`, 15 s, the outbox key as Idempotency-Key), `renderEmail` (twenty templates, strings in `Email.*`). `EMAIL_*` read only here, `lib/env.ts` and `lib/deployment.ts`; the literal `api.resend.com` only here. The relay reads mail through `email_context` and ends it through `finish_email` |
| Sentry | `lib/observability/` | `next.config.ts` may import only `withSentryConfig` from `@sentry/nextjs/config`. Server: `initServer`, `captureRequestError`, `log`, `raiseAlert`; browser: `initClient`, `reportClientError`, `routerTransitionStart`; routes: `createEnvelopeForwarder` (`/api/e`), `createCspReportForwarder` (`/api/csp`) in `forward.ts` (D83). One scrubber (`scrub.ts`) for every signal, CSP reports included |
| PostHog | `lib/analytics/` | `initAnalytics`, `track`, `trackPageview`; events typed in `events.ts`, filtered again in `filter.ts`; route: `createPostHogForwarder` (`/api/a/*`) in `forward.ts`, its body parser in `capture-body.ts` (no `server-only`, so e2e runs real SDK bytes through it) (D83) |
| Telemetry keys | the two doors, `lib/env.ts`, `lib/deployment.ts`, `next.config.ts` | `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_POSTHOG_KEY`; `SENTRY_AUTH_TOKEN` in `next.config.ts` only. Others ask `sentryDsn()` or `posthogKey()` |
| Public machine endpoints | `app/api/health`, `app/api/e`, `app/api/a/[...path]`, `app/api/csp`, `app/api/relay` (secret header), `app/api/psp/callback`, `app/api/psp/webhook` (PSP signature) | No session, so no `requireRole()` (D71, D83, spec 0011-08 AC-17); position 01's action guard meta test exempts exactly these by name. Dev only: `app/api/psp/fake-checkout` and `/[locale]/dev/fake-checkout/<token>`, a 404 unless `PSP_DRIVER=fake` off production |

## Tooling gap scan (ask before adding)

At bootstrap, at the start of each position, when a new service is chosen, when a review finds
something a machine could catch, when a mistake or copy paste repeats, and before each gate:
scan for missing skills, hooks, context docs, MCP connectors, rules that never bend, agents,
guards (lint, database, meta tests, CI), guidelines, UI tokens or registry entries, tests,
alerts, and owner steps. Propose each as a multiple choice question with one recommended option,
what, where, why now, cost, and risk. Add nothing until the owner says yes for that item.
Never run third party installers or enable connector writes. Record accepted items in the
right inventory and the decision log; record declines with the reason.

## Claude Code tooling (`.claude/`)

| Piece | What it does |
| --- | --- |
| `settings.json` deny | `Read`/`Edit`/`Write` on every secret env file pattern (root and nested), `*.pem`, `*.key`. `.env.example` stays readable: variable names only, never values |
| `settings.json` ask | `git push`, `gh repo`, `vercel` deploy and env, `supabase db push` and `db reset`, edits to hooks, settings, migrations, `lib/money`, `lib/psp`, `lib/pricing`, and every connector write tool |
| `hooks/session-context.mjs` | SessionStart: injects the tracker's status, open blockers, next position. Project authored, local files only, no network |
| `hooks/guard.mjs` | PreToolUse `Write\|Edit\|MultiEdit`: 20 content rules (money, RLS, secrets, tokens, RTL). Suite: `npm run guardrails` |
| `hooks/guard-bash.mjs` | PreToolUse `Bash\|PowerShell`: exit 2 blocks secret file access, broad deletes, force push, history rewrites, data wipes, linked resets, prod deploys. Test: `tests/harness/guard-bash.test.ts` |
| `hooks/format-on-write.mjs` | PostToolUse `Edit\|Write`: Prettier on code files, best effort, never blocks |
| `agents/slice-reviewer.md`, `agents/security-reviewer.md` | Read only, fixed output format, run before merge (security: at gates and on money, auth, PII, storage) |
| `launch.json` | `asma-dev`: `npm run dev` on port 3000 (cloud Supabase, from `.env.local`). `asma-local`: the last e2e build on port 3100, on the local stack. `asma-indexable`: a build with the indexing switch on, for Lighthouse |

The bash guard scans the whole command, so a commit message mentioning a blocked phrase is blocked:
write long messages to a file and use `git commit -F <file>`. Never weaken a guard to make your own
change pass; if a rule is wrong, stop and say so.

## Model / effort posture

| Work | Model and effort |
| --- | --- |
| Schema, RLS, money, PSP, concurrency, auth, security review | Strongest model, high effort |
| UI slices from tokens and rules, CRUD on an existing pattern | Default effort |
| Copy tweaks, renames, formatting, doc updates | Fast model |
| Spec cross checks, `/check review`, gate reviews | A different model from the author (author Opus → reviewer Sonnet), fresh context |
| Read only code scouting | Cheapest model; returns a map, never file dumps |

## Agent skills

Workflow skills, vendored in `.claude/skills/` from `jsmastery-pro/skills` (identical to the user level
copies; `skills-lock.json` is that CLI's lock file). **Project overrides win over the skill text:**

- `/architect` (`.claude/skills/architect/`): specs go in `docs/specs/NNNN-title.md`, or
  `NNNN-title/index.md` + `rationale.md` for heavy ones. Always offer the cross check; recommend it on
  every spec touching money, auth, PII, or access. The owner accepts; `Accepted` is dated.
- `/develop` (`.claude/skills/develop/`): there is **no `docs/scope/`**. `context/build-plan.md` owns the
  order and status: wherever the skill says "scope row", read and update that position's row there.
  New components get a row in `context/ui-registry.md` in the same change.
- `/test` (`.claude/skills/test/`): preferences in `test-preferences.json`; honor the tests first list.
- `/check` (`.claude/skills/check/`): `verify` drives the real app through `.claude/launch.json` and the
  built in browser at 360, 390, 430 and 1280px in `ar`, `tr`, `en`; `review` writes
  `docs/reviews/<date>-<branch>.md` on a different model.
- `/debug` (`.claude/skills/debug/`): reproduce first; hand the regression test to `/test`.
- `/sync` (`.claude/skills/sync/`): updates the Status lines here and the build plan status; never
  rewrites decision log entries.
- `/document` (`.claude/skills/document/`): PR bodies end with the Claude Code line. No changelog before
  launch.
- `/scope` (`.claude/skills/scope/`): **not used**; `context/build-plan.md` owns the build order.
- `/audit` (`.claude/skills/audit/`): **never in bootstrap mode** (this file exists); gap fill only when
  the owner asks.

Vendor skills (reviewed line by line, pinned; each folder has a `VENDORED.md` with kept, left out, and
overrides):

- `supabase`, `supabase-postgres-best-practices` (`.agents/skills/`, linked into `.claude/skills/`):
  `supabase/agent-skills` @ `c9be0e9`, MIT, re-pinned 2026-10-17. Override: never iterate with
  `execute_sql` then `db pull`; schema changes are migration files only; ignore "create .mcp.json".
  `context/architecture.md` wins over the best practices file where they differ.
- `resend` (`.claude/skills/resend/`): `resend/resend-skills` @ `247779a`, MIT. REST facts only; no SDK.
- `react-email` (`.claude/skills/react-email/`): same repo and pin, MIT. Templates and i18n; package not
  installed until the notifications spec.
- `turnstile-spin/references/nextjs-app.md`: `cloudflare/skills` @ `86505e4`, Apache-2.0. One reference
  file, no `SKILL.md`; the widget wizard is left out.
- `tailwind-design-system` (`.claude/skills/tailwind-design-system/`): installed 2026-08-17, source not
  recorded (Q8). `context/ui-tokens.md` wins.
- `posthog-nextjs-app-router` (`.claude/skills/posthog-nextjs-app-router/`, frontmatter name
  `integration-nextjs-app-router`): `PostHog/skills` @ `1914a60`, path
  `skills/posthog/integration/skills/nextjs-app-router/`, MIT, vendored 2026-10-28 (D73). Kept `SKILL.md`,
  `references/next-js.md`, `references/EXAMPLE.md`; the wizard workflow and `identify-users.md` are left
  out. Spec 0004 wins: no wizard, no identification, cookieless, every option explicit, `lib/analytics/`
  is the only importer.
- Sentry skills (`sentry:sentry-instrument`, `sentry:sentry-get-started`, `sentry:sentry-setup-releases`,
  `sentry:sentry-create-alert`): Sentry's official Claude plugin (`claude-plugins-official/sentry`), user
  level, not vendored, updates itself (D73). Checked 2026-10-28 at plugin version 1.4.0. Spec 0004 wins
  wherever it differs: no wizard, no edge config, no `dataCollection` object (it flips unset categories to
  permissive), `sendDefaultPii` off, `lib/observability/` is the only importer.
- `shadcn` (`.claude/skills/shadcn/`): `shadcn-ui/ui` @ `24a1642`, MIT, vendored 2026-10-31 (D103). Not byte for
  byte: the live `npx shadcn@latest` injection and the allowed tools are removed, and the CLI is pinned.
  `ui-tokens.md` and `ui-rules.md` win; base is Radix.
- `optimise-seo` (`.claude/skills/optimise-seo/`, frontmatter name `seo`): `mblode/agent-skills` @ `2294de5`, path
  `skills/seo/`, MIT, vendored 2026-10-31 (D103). For part 2 of 01. Spec 0005 wins.
- `twilio-verify-send-otp` (`.claude/skills/twilio-verify-send-otp/`): `twilio/ai` @ `803790a`, MIT, public beta,
  vendored 2026-10-31 (D103). Facts only: Supabase Auth calls Twilio, so no SDK and no credential here.
- caveman (user level plugin): chat only. Never applied to code, commits, or docs.

**Declined:**
- 2026-10-17 · `review`, `recover`, `remember`, `imprint` (older project skills): retired by the owner;
  replaced by `/check review` + reviewer agents, `/debug`, the tracker + `/sync`, and registry rows
  written during `/develop`.
- 2026-10-17 · `getsentry/skills`: engineering workflow skills, not SDK setup; the SDK skill repo
  `getsentry/sentry-agent-skills` has no license.
- 2026-10-17 · `microsoft/playwright-cli`: runs its own browser binaries; the built in browser and
  `@playwright/test` cover it.

## MCP servers

| Server | Use here | Gate |
| --- | --- | --- |
| `context7` (`.mcp.json`) | Current library docs | Read only |
| `supabase` (`.mcp.json`, `--read-only`) | Schema, advisors | Kept alongside the connector (D64). The committed file keeps the `${…}` placeholders; the owner's local copy holds the ref (`lrejqpcgsugjiijuakoq`) and an access token. **Never stage or commit `.mcp.json` changes** |
| `playwright` (`.mcp.json`) | Browser driving | Connected (2026-10-28). The built in browser is the default |
| Supabase (account connector) | Schema, advisors, logs for project `lrejqpcgsugjiijuakoq` | Signed in to org `aldebyani` only (2026-10-28). Write tools ask gated in `settings.json`, used only when the owner asks. Schema through migration files, never ad hoc SQL |
| Vercel (account connector) | Deploy status, build and runtime logs | Project, env, domain, deploy, and purchase tools ask gated; production comes from merges only. Since 2026-10-28 it answers 403 on the team scope `moaz-allam-4163s-projects` even after approved team access links; the Vercel CLI (`npx vercel@65.5.0 … --scope moaz-allam-4163s-projects`, logged in to the owner) is the working path, ask gated like the connector |
| Sentry (account connector) | Errors in org and project `aldebyani` (EU, `de.sentry.io`) | `update_issue` ask gated; org `jawla-i1` and every other org are off limits |
| PostHog (account connector) | Analytics for project `aldebyani` (id 323846, EU Cloud) | Signed in to org `Aldebyani` only (2026-10-28). Read only use; writes (such as project settings) only when the owner asks, as on 2026-10-28 for the D68 settings |
| `sim` (local scope, `https://mcp.sim.ai/mcp`) | Read only critics on other vendors' models, on trial (D119, `docs/agents/sim-critics.md`) | `mcp__sim__call_write_operation` ask gated. Hosted in the US: code and specs only, **never customer data, a secret or a production value**. Never in `.mcp.json` |

**Cloud accounts (rechecked 2026-10-28, R1):** the Vercel project `aldebyani` and the Supabase org
`aldebyani` exist, and so do the Sentry org and project `aldebyani` and the PostHog EU project `aldebyani`. The Supabase CLI
is linked to `lrejqpcgsugjiijuakoq`; when a push answers 403 on its login role, log in again with the
`aldebyani` account and relink. The old ref `syrhavojjpabwwcaezee` is retired.

Before any write: list the projects and confirm the target with the owner. Connectors attached to the
account for other work (shop, forms, docs, automations and contacts, visualize, scheduled tasks) are
**off limits** for this project.

## Git

```
integration: on
branch prefix: feat/
commit: per-milestone
```

- One position = one branch = one PR, named after the position (`feat/01-sign-in`). Base: `master`,
  which is protected: `checks`, `database`, `e2e` must pass and the branch must be up to date (D46).
- Conventional Commits. Commit or push only when the owner asks; a per milestone commit is an offer,
  never automatic. Never force push. Never commit `.env*` except `.env.example`.
- Long messages: write to a file, `git commit -F <file>`.

## Utilities

`python .claude/tools/docx-to-md.py <file.docx>`: converts the owner's Word or Excel originals to
Markdown, for importing the brief into `docs/brief/`. Convert on demand, never in bulk.
