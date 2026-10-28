# Progress Tracker

v3, 2026-10-17, restructured to the playbook's five parts (`docs/engineering-approach.md` §18). Read
at the start of every session, update at the end. If it is not written here, the next session does
not know it.

**Last updated:** 2026-10-28
**Phase:** Bootstrap done · design imported (PR #18) · position 00 ✅ · 00b in progress
**Status:** 🟡 Spec 0004 (00b) accepted 2026-10-28; launch 2026-11-28 (D65); cloud accounts partly connected (R1)
**Next:** `/develop` position 00b in a fresh session (spec 0004) → G0 by 2026-10-30

---

## 1. Current state

Dated bullets, newest at the bottom.

- **2026-08-17** · Docs prepared (overview, architecture, build plan, standards, UI docs). Market
  decided: both regions in one deployment (D14), three locales (D8). Gaps G1–G27 catalogued in
  `open-questions.md`; resolutions accepted (D11 and later decisions).
- **2026-08-18** · Position 00, part one (old feature 01): Next 16.3.1, three locales with derived
  direction, `proxy.ts`, Zod env schema with fail fast boot, Supabase clients, pgTAP "RLS enabled
  everywhere", CI (run 32118566578 green). CODEOWNERS removed (D18).
- **2026-08-18** · Position 00, part two (old feature 45): `regions` + `platform_settings` with RLS,
  16 pgTAP assertions, the CI check that rejects a domain table without `region` (run 32129285600).
- **2026-08-18** · D20: postings are tax shape neutral, so B9 gates only invoicing and refund fee
  absorption. B3 split by how each fact is obtainable; B11 raised as the priority business check.
- **2026-10-17** · **Playbook adopted** (bootstrap). Done: `AGENTS.md` entrypoint with `CLAUDE.md` as a
  one line pointer; `docs/` layout (brief, specs 0001–0003 moved in, reviews, design,
  `engineering-approach.md`); rules canonical in `project-overview.md` §5; build plan v3 (positions,
  gates G0–G3, cut list, schedule to 2026-11-07); this tracker restructured; `SETUP.md` folded into
  §5 owner steps; four old skills retired; resend, react-email, Turnstile reference vendored and
  the Supabase skills re-pinned; harness (deny and ask rules, bash guard, format hook, review agents,
  launch config); quality tooling (Prettier, husky, lint-staged, Vitest 5, Playwright in three
  locales, fast-check, axe, lint enforced doors, `lint:rtl`, meta pgTAP tests, gitleaks, three CI
  jobs). Test counts are in §8.
- **2026-10-17** · Found: the Supabase CLI login sees only project `alqafila` and the claude.ai
  Supabase connector only `Jawla`. Neither sees `syrhavojjpabwwcaezee` (R1, S6). Owner: the remote
  projects for Aldebyani are not created yet; connect the right accounts when they are (D40).
- **2026-10-17** · Brand recorded (D40): Aldebyani, slogan "Aldebyani Home Care"; `App.name` and the
  landing title updated in all three catalogues (Arabic spelling and slogan translation pending, Q11).
- **2026-10-17** · Bootstrap verified locally: `npm run verify` green (write guard 41/41, typecheck,
  lint with the single door rules, `lint:rtl`, Prettier, **127 unit tests in 10 files**: unit, money
  property tests, lint rule proofs, bash guard, `lint:rtl`); `next build` green; **e2e 6/6** (ar, tr, en
  at 390px with axe, through `scripts/e2e.mjs`, no database). Not run locally: pgTAP (needs Docker;
  includes the new function grant meta tests) and gitleaks; both run in CI. Nothing committed yet.
  `playwright-core` pinned to 1.63.0 with an npm override (axe had pulled 1.64.1). The dev server
  refuses to boot because `.env.local` holds a malformed `SUPABASE_DB_POOL_URL` (S19).
- **2026-10-17** · PR #17 CI green on all three jobs (first gitleaks and function grant meta test runs
  passed). `master` protection on (D46). Install scripts approved (D45). Favicons generated from the
  owner's logo (D44); e2e now 9/9, including icons linked and served in every locale.
- **2026-10-25** · **Design handoff imported** (S13, closes B4; D48–D57). `docs/design/`: the four
  design files and their scripts in `source/`, 53 screens rendered with stand-ins in `screens/` (no
  borrowed photo or real avatar enters the repo), capture tools in `tools/`, the screen → page →
  position map. `ui-tokens.md`, `ui-rules.md`, `ui-registry.md` rewritten from the design; fonts verified
  for Turkish (Cairo lacks `₺`, so money is set in Alexandria); contrast measured. Design vs docs
  conflicts recorded in `contradictions.md` C14–C28. Owner: v1 is Turkish first (D57); copy is English
  first, then translated to Turkish (D58); design questions settled (D59); write guard updated for the
  palette block and hardened after a security review (D60, guard suite 63/63); Tailwind's own palette is
  switched off when the tokens land (D61). Not yet applied to code: tokens and fonts land in
  `app/globals.css` with the first UI position.
- **2026-10-28** · PR #18 merged (`5127f78`, with the guard fix). Connection check: Vercel project
  `aldebyani` exists since 2026-10-18 (S3 ✅); Supabase org `aldebyani` has one project in
  eu-central-1 (Free plan, default name), and the CLI is linked to it but logged in to another account;
  Sentry org `aldebyani` is on the EU region, and its project `aldebyani` (Next.js) was created by the
  agent at the owner's request, with Sentry's onboarding run waiting on 00b; the PostHog connector is still signed
  in to another org (US); the project Supabase MCP waits for its env vars; the Docker engine is off; the
  dev server still fails at boot (S19). Owner: EU regions everywhere (D62); Supabase Free until launch
  (D63); both Supabase MCP paths kept (D64). **Replanned:** 11 days behind (00b was due 2026-10-18);
  launch moves to 2026-11-28 (D65), same scope and cut list. Found in the working tree: the PostHog
  setup wizard's changes (run 2026-10-27 outside the spec: `posthog-js`, OpenTelemetry log export,
  autocapture on, env names our guard rejects); set aside with `git stash` as
  "posthog-wizard-2026-10-27" for the 00b spec. `npm audit`: critical `next` advisories, so security
  bumps ship before 00b (D66).
- **2026-10-28** · PR #19 merged (D66, `64d2613`); production redeployed on Next 16.4.3, and Vercel's
  Sentry integration created a matching Sentry release. Sentry project `aldebyani` (EU) created by the
  agent at the owner's request; Sentry's onboarding run waits on the instrument step (00b). S19 fixed:
  the dev server boots. **Spec 0004 (position 00b) accepted** after a cross check on Sonnet (22 gaps,
  13 issues, all fixed): decisions D67 to D73. Still open for G0: S8 (PostHog EU), the Supabase CLI
  login (S6), the Vercel toolbar off on previews, env values in both Vercel scopes.
- **2026-10-28** · The owner ran the Sentry setup wizard. A local verification error reached Sentry
  (`ALDEBYANI-1`) and Sentry's onboarding run moved to its last two stages, but the event carried the
  owner's IP address and city: the wizard leaves `dataCollection` at its defaults, which spec 0004
  (AC-3) forbids. The owner turns on "prevent storing of IP addresses" and deletes the issue. The
  wizard's code (a second root layout with two `<html>` tags, demo crash routes, a hardcoded DSN, an
  edge config, 100% tracing) is set aside in the stash "sentry-wizard-2026-10-28"; its `.gitignore`
  line for `.env.sentry-build-plugin` stays. S8 done: org `Aldebyani`, project `aldebyani` (id
  323846) on PostHog EU Cloud, configured per D68 through the connector at the owner's request
  (autocapture, recordings, console logs, heatmaps, web vitals off; cookieless hashing on; IPs
  discarded). The PostHog connector now reaches only that org.
- **2026-10-28** · Supabase CLI logged in to the `aldebyani` account and linked; the owner pushed the
  position 00 migration to the cloud project after a dry run. Checked through the connector: migration
  `20260818135102_regions_and_settings` applied, `regions` (2 rows) and `platform_settings` (20 rows)
  with RLS on, security advisors clean. Vercel toolbar turned off on previews (D72). The Vercel
  connector returns 403 for the team scope until its team access is authorized.

---

## 2. Blockers and risks

> Anything open here stops the related work. Do **not** guess and proceed. The B rows stay open until
> the owner supplies the answer (owner's standing instruction).

| # | Blocker or risk | Blocks | Mitigation meanwhile | Status |
| --- | --- | --- | --- | --- |
| B1 | ~~Target market~~ | — | — | ✅ RESOLVED 2026-08-17: both regions, one deployment (D14). Narrowed 2026-10-17: Turkey launches first, KSA later (D22) |
| B11 | 🔴 **Can an individual be a sub-merchant?** A business model check: if individuals cannot onboard, the provider structure changes | 02 (sub-merchant data), 08–12 | Evidence: iyzico's marketplace docs list three sub-merchant types including `PERSONAL`. Not confirmed: run it in the sandbox (S1) | ⏳ open, priority |
| B3 | **PSP facts.** Sandbox answerable: sub-merchant types and fields, callback signature scheme and event id, partial refund while unapproved, approval API shape. Must ask: max hold duration, real per-card fee (§7) | 08–12 | Design to the worst case: `psp_max_hold_hours` in `platform_settings` plus an invariant alert | ⏳ open; sandbox path available (S1, S2) |
| B4 | ~~**Brand: theme, colours, fonts, logo, templates**, plus: Arabic capable font, dark mode in v1?~~ | — | — | ✅ RESOLVED 2026-10-25: the Claude Design handoff (D48); status colours D49; no dark mode in v1 D50 |
| B5 | **Pricing formula specifics** per category: questions, types, options, base price, modifiers | 03 content, G3 | The engine is generic; build it against test fixtures, never invented data | ⏳ open |
| B6 | **Launch categories** and each one's questions | 03 content, G3 | Same as B5; start with one worked category (home cleaning) | ⏳ open |
| B2 | **Legal sign off on the custody model**: the platform never holds funds and needs no licence | G3 | None; owner track S16 | ⏳ open |
| B9 | **Professional confirmation of the agent position (D12)** | 20 (invoicing), refund fee absorption, G3 | D20 keeps the ledger shape neutral, so the money core is not blocked | ⏳ open, narrowed 2026-08-18 |
| B10 | **Legally authoritative language** for T&C and provider agreements | T&C copy, provider signup, G3 | None; owner track S16 | ⏳ open |
| B7 | **Public quality claim wording**, backed by a computed rate or verifiable criterion | Public copy, 19 | Ship no claim until decided | ⏳ open |
| B8 | **Legacy provider job counts and past customer list** for the reputation migration | 19 (Q9) | Not in P0 | ⏳ open |
| R1 | **Cloud accounts partly connected** (rechecked 2026-10-28). Exist: Vercel project `aldebyani` (S3 ✅), Supabase org `aldebyani` with project `lrejqpcgsugjiijuakoq` (eu-central-1, linked; it replaces the old unverified ref `syrhavojjpabwwcaezee`), Sentry org and project `aldebyani` (EU). Missing: the Sentry auth token for source maps (S7); the PostHog EU project and the connector's sign in to it (S8); the Supabase CLI login to the `aldebyani` account (it still sees only `alqafila`); the project MCP's env vars (D64) | Any cloud push, G0 | Before any push, `npx supabase projects list` must show `lrejqpcgsugjiijuakoq` as linked. Each connector is used only for the `aldebyani` org or project; `Jawla`, `jawla-i1` and `alqafila` are other work and off limits | ⏳ open |
| R2 | **Deadline.** Replanned 2026-10-28 (D65): 16 P0 positions from 2026-10-29 to the 2026-11-28 launch, with 3 buffer days. The owner steps in `build-plan.md` (parallel tracks) are on the critical path, S1 and S16 most of all | Launch date | Cut list decided in advance (`build-plan.md`); replan honestly at each gate | ⏳ watching |
| R3 | **Free plan limits.** Vercel Hobby forbids commercial use; Sentry and PostHog free quotas | G3 | Test data only before G3; Vercel Pro at G3 (D25); recheck quotas at G3 | ⏳ planned |
| R4 | **Shared pre launch database.** Previews and production share the one Supabase project until G3 (D37) | G3 | Test data only; G3 wipes it, reapplies migrations, creates a staging project | ⏳ deliberate |

> ⚠️ **Never implement wallet top up or a stored balance.** Blocked by design (`project-overview.md`
> §6), not only by B2.

---

## 3. Decision log

Newest first. **By:** Owner (asked in chat), or Default (chosen by the agent, in force until the owner
overrides). A recorded owner decision beats a general rule (precedence level 2). Superseded rows stay,
struck through, with the replacement named.

| # | Date | Decision | By | Where |
| --- | --- | --- | --- | --- |
| D73 | 2026-10-28 | **Skills for 00b:** Sentry's skills come from Sentry's official Claude plugin (user level, updates itself; no vendored copies); PostHog's `nextjs-app-router` skill is vendored at `PostHog/skills@1914a60` with a `VENDORED.md`. Any skill advising a setup wizard is overridden by spec 0004 | Owner (asked in chat) | spec 0004 AC-19 |
| D72 | 2026-10-28 | **Vercel:** login protection stays on for previews, share links for anyone else; the Vercel toolbar is off on previews; the agent sets public env values through the connector, the owner sets secrets; values exist in both Preview and Production scopes; Vercel's Sentry integration is kept | Owner (asked in chat) | spec 0004 AC-16 |
| D71 | 2026-10-28 | **Deployment guard and health:** `isDeployment()` is true on Vercel always and for any production build unless `APP_LOCAL_ONLY=1`; the Sentry DSN and the PostHog key are both required on deployments, each from the task that adds its door; `GET /api/health` checks the app plus a database ping through `health_ping()` (granted to `anon`) | Owner (asked in chat) | spec 0004 AC-9, AC-10 |
| D70 | 2026-10-28 | **Money flags and KSA:** the five money flags are `platform_settings` rows per region (TR on, KSA off), read live on every call and failing closed; the env flag variables are removed; KSA's `regions.active` is false | Owner (asked in chat) | spec 0004 AC-14, AC-15 |
| D69 | 2026-10-28 | **Security headers and CSP:** a strict nonce Content Security Policy, enforced now and reporting to Sentry, so pages render per request; HSTS at one day until the final domain (S4) | Owner (asked in chat) | spec 0004 AC-12, AC-13 |
| D68 | 2026-10-28 | **Analytics:** PostHog EU in cookieless mode with no consent banner and no identification (legal to confirm under S16); one project with an `app_env` property; autocapture, session recording, surveys and remote flags off; 00b events `$pageview` and `locale_changed`; the server side client arrives with its first event (08 or 09) | Owner (asked in chat) | spec 0004 AC-6, AC-7 |
| D67 | 2026-10-28 | **Observability:** Sentry EU is the one backend for errors, traces (10% production, 100% preview), logs (Sentry Logs), replays (on error only, masked, nothing kept in browser storage) and alerts (rules on new and escalating alert issues; the summary email arrives with 13). Personal data is scrubbed from every signal | Owner (asked in chat) | spec 0004 AC-1 to AC-5, AC-11 |
| D66 | 2026-10-28 | **Security bumps before 00b**, in their own PR (`chore/security-bumps`): `next` and `eslint-config-next` 16.4.3 (16.3.1 has critical unauthenticated remote code execution advisories, among others), `zod` 4.6.7, `vitest` 5.0.5, and transitive fixes through `npm audit fix` without `--force`. Supersedes dependabot #16, #15 and #6 | Owner (asked in chat) | `package.json`, `AGENTS.md` stack table |
| D65 | 2026-10-28 | **Launch moves to 2026-11-28** (replan). 11 days behind the v3 schedule: 00b was due 2026-10-18, and the design import and owner tracks ran long. Same scope and cut list; the heavy positions (00b, 01, 03, 07, 08, 12, 21) get two days each; three buffer days; gates G0 10-30, G1 11-15, G2 11-20, G3 11-25. Holds only if the owner steps land by the dates in `build-plan.md`. Supersedes the date in D22 and the schedule in D41 | Owner (asked in chat) | `build-plan.md` schedule and parallel tracks, `project-overview.md` §1, `AGENTS.md` |
| D64 | 2026-10-28 | **Both Supabase MCP paths kept:** the claude.ai Supabase connector (now signed in to org `aldebyani` only; its write tools stay ask gated) and the project MCP in `.mcp.json` (`--read-only`). The committed `.mcp.json` keeps the `${SUPABASE_PROJECT_REF}` and `${SUPABASE_ACCESS_TOKEN}` placeholders; the owner's local copy holds the real values (owner, 2026-10-28) and is **never staged or committed** | Owner (asked in chat) | `AGENTS.md` MCP servers, S6 |
| D63 | 2026-10-28 | **Supabase stays on the Free plan until launch; Pro at launch** (position 21: backups and the tested restore need it). Free pauses a project after a week idle, so keep it in use while building | Owner (asked in chat) | S6, R3, `build-plan.md` |
| D62 | 2026-10-28 | **EU data regions everywhere:** Supabase `eu-central-1` (Frankfurt), Sentry EU (`de.sentry.io`), PostHog EU Cloud, Vercel functions pinned to `fra1` (00b). Nearest to Turkey and the simplest KVKK/GDPR position. Resolves Q5 and Q6 | Owner (asked in chat) | S6, S7, S8, the 00b spec |
| D61 | 2026-10-25 | **Tailwind's own palette is switched off** when the tokens land: `--color-*: initial` as the **first** line of `@theme inline`. Raw palette classes (`bg-red-500`, `text-white`) and `var(--color-blue-900)` then compile to nothing, so semantic tokens and D49 hold at build time, not only through the guard and review. Verified against Tailwind 4.3.3: placed after our tokens, the reset deletes them too | Owner (asked in chat) | `ui-tokens.md` §13, §14 |
| D60 | 2026-10-25 | **Write guard `brand-value-in-globals` updated:** colour values in `app/globals.css` only in `--ramp-*` declarations, checked line by line and declaration by declaration; every other token references a ramp; colours inside comments are prose. The pre-B4 escape is narrowed to one custom property holding a neutral `oklch(L 0 0)`, alone on its line, ending in `/* placeholder */`; it is deleted when the tokens land. Comment stripping fixed per language: `--` lines only in `.sql` (stripping them everywhere hid CSS custom properties and TS code), `//` only in JS/TS (in SQL it hid the code after it, such as an `UPDATE ledger_entries`). The guard no longer exits when stripping leaves the text empty (a `//;…` line skipped every rule). Security review 2026-10-25: safe to merge; the owner chose to fix its findings before merging. Guard suite 63/63, with Edit and MultiEdit cases; on all 279 tracked files the decisions match `master` | Owner (asked in chat) | `.claude/hooks/guard.mjs`, `.claude/evals/guard.test.mjs` |
| D59 | 2026-10-25 | **Design questions 6–8 settled:** field borders use ink 500 `#6A7A97` (4.34:1, WCAG AA) instead of the design's `#DFE7F3`; "cancelled" is «ملغى» on `success-light`; a rejected provider («مرفوض») is `error-light`, approved stays blue | Owner (asked in chat) | `ui-tokens.md` §3, §4, §12 |
| D58 | 2026-10-25 | **Copy workflow:** Arabic from the design (simple Modern Standard Arabic); English drafted from the design's meaning; a translator turns English into Turkish (S21). Untranslated Turkish keys stay marked, never machine filled | Owner (asked in chat) | `ui-rules.md` §3, `i18n.md` §7 |
| D57 | 2026-10-25 | **v1 is Turkish first**: primary language `tr`, Turkey region; KSA comes later (D22). The design is drawn in Arabic; it is the layout reference, mirrored for `tr` and `en`, and every screen is verified in `tr` first. The design's KSA mock details (Riyadh districts, «مدى», 05x phones, «السعودية · ₺», "Saudi only" settings) are dropped: Turkish data and the iyzico card form | Owner (asked in chat) | `ui-rules.md` §3, `docs/design/README.md`; closes Q14 |
| D56 | 2026-10-25 | **Repeat request is in v1** (the design's «كرّر الطلب» on `s9`): re-post with the same answers, position 04. Not in the brief, so recorded as a scope override | Owner (asked in chat) | `build-plan.md` 04, `ui-registry.md` |
| D55 | 2026-10-25 | **Sign-in is a phone SMS code at launch**, as designed (D16). The code is **6 digits**: Supabase Auth allows 6 to 10, so the design's 4 boxes become 6. Needs an SMS provider for Turkey (S20) | Owner (asked in chat) | `build-plan.md` 01; closes Q4 |
| D54 | 2026-10-25 | **Disputes at launch resolve as full release or full refund only.** The design's partial release (`s9` copy, `a5`) stays hidden until P1, as position 14 already says | Owner (asked in chat) | `build-plan.md` 14, `docs/design/README.md` |
| D53 | 2026-10-25 | **Commission is taken when the customer pays** (`project-overview.md`, unchanged). The screens that say «تُخصم … عند تحرير المبلغ» are copy errors: the UI says the provider receives the net amount at release | Owner (asked in chat) | `contradictions.md` C14 |
| D52 | 2026-10-25 | **Digits are Western (`0-9`) in all three locales**, as the design draws them; `ar` formats with `ar-u-nu-latn`. Grouping and the currency position follow the locale (`tr`: ₺3.200) | Default (from the owner's design) | `ui-tokens.md` §5, `i18n.md` §7 |
| D51 | 2026-10-25 | `docs/design/` holds the design source and 53 renders made with stand-ins. The design's borrowed photos and real users' avatars never enter the repo (Q12) | Owner (asked in chat) | `docs/design/README.md` |
| D50 | 2026-10-25 | **No dark mode in v1**: light only, as designed | Owner (asked in chat) | `ui-tokens.md` §12 |
| D49 | 2026-10-25 | **Status chips stay on the design's blue ramp** (no green or amber); dispute is the only red; meaning comes from the label | Owner (asked in chat) | `ui-tokens.md` §4 |
| D48 | 2026-10-25 | **The Claude Design handoff is the visual source of truth** (export of 2026-10-24, confirmed final; the 2026-10-25 re-export is byte identical). Palette, fonts (Alexandria for headings and money, Cairo for body, Archivo Black for the wordmark), radius, borders and components recorded; `ui-tokens.md`, `ui-rules.md`, `ui-registry.md` rewritten | Owner (asked in chat) | `context/ui-*.md`, `docs/design/`; closes B4 |
| D47 | 2026-10-17 | Repo settings: **Allow auto-merge** on, **Automatically delete head branches** on. PR #17 set to squash merge itself once the three required checks pass | Owner (asked in chat) | GitHub settings |
| D46 | 2026-10-17 | `master` protected: the `checks`, `database`, `e2e` jobs are required (bound to GitHub Actions), branches must be up to date before merging, force pushes and deletion blocked. Admins are not enforced, so the owner keeps an explicit bypass (S14) | Owner (asked in chat) | GitHub settings |
| D45 | 2026-10-17 | npm install scripts approved for `@parcel/watcher` 2.6.0, `@swc/core` 1.15.47, `unrs-resolver` 1.12.2 after review (each is a no op unless the native binary is missing). npm records them per version in `package.json` `allowScripts`, so any version bump needs a fresh review | Owner (asked in chat) | `package.json`, `AGENTS.md` |
| D44 | 2026-10-17 | **The name is written exactly "Aldebyani" in every locale**, `ar` included (no Arabic transliteration). The slogan stays as written, "Aldebyani Home Care", in all three locales unless the owner asks for a translation. Favicons generated from `docs/design/logo.jpg` | Owner | `messages/*.json`, `docs/design/README.md` |
| D43 | 2026-10-17 | **Navbar wordmark font: Archivo Black** (OFL), self hosted through `next/font/google` (no third party requests at runtime), the closest free match to the logo's heavy grotesque. Replaced by an SVG wordmark only if the owner supplies one. Built with the app shell in position 01 | Owner | ui-tokens §10 |
| D42 | 2026-10-17 | Priority line confirmed (D35): correct money and private data > core journey end to end in three locales > design polish > extra features | Owner | `AGENTS.md`, project-overview §1 |
| D41 | 2026-10-17 | **Build plan v3 confirmed as drafted**: 22 positions (16 P0), gates G0–G3, the cut list, ~~the target schedule to 2026-11-07~~ (schedule superseded by D65). Bootstrap ships as branch `chore/playbook-bootstrap` + PR | Owner | `build-plan.md` |
| D40 | 2026-10-17 | **Brand: the platform is "Aldebyani", slogan "Aldebyani Home Care".** The supplied round logo is the browser favicon; the navbar logo is the word "Aldebyani" only, in the font of the logo's wordmark (font to confirm, Q11). Repo codename stays `asma`. Remote projects (Supabase, Vercel, Sentry, PostHog) are not created yet; connect the right accounts when they are (R1, S6) | Owner | `AGENTS.md`, B4 |
| D39 | 2026-10-17 | Server Action and Route Handler errors return a **stable code** listed in the message catalogues, never display text. Fixes the §19 template, which returned a hardcoded Arabic string (rule 10) | Default | code-standards §19, §37 |
| D38 | 2026-10-17 | `SUPABASE_DB_POOL_URL` is optional until the first direct Postgres consumer exists (shape still validated when present), so the local stack and e2e boot without cloud values | Default | `lib/env.ts`, code-standards §22 |
| D37 | 2026-10-17 | Previews and production share the one Supabase Pro project until G3, test data only; G3 wipes it, reapplies migrations, creates a staging project | Default (playbook §17.4) | build-plan G3, R4 |
| D36 | 2026-10-17 | Specs moved to `docs/specs/` (0001 setup, 0002 review fixes 45–51, 0003 multi-region); `SETUP.md` folded into the owner checklist (§5) and removed; v2 feature notes archived verbatim in `feature-notes-v2.md` | Default | `docs/specs/`, §5 |
| D35 | 2026-10-17 | Priority line: correct money and private data > core journey end to end in three locales > design polish > extra features | Default (confirm: Q1) | `AGENTS.md` |
| D34 | 2026-10-17 | Precedence order: rules → decision log → the spec being built → brief → architecture → standards and UI docs → build plan wording → methodology | Default | `AGENTS.md`, project-overview §0 |
| D33 | 2026-10-17 | Rules that never bend: canonical text in project-overview §5, keeping the 1–11 numbering the guard and code already cite; the old §5 list folded into rules 2 and 6. No rule added or removed | Default | project-overview §5 |
| D32 | 2026-10-17 | Node 24 LTS everywhere (local was already 24.11.1; CI was 22) | Default | `.nvmrc`, `ci.yml`, `package.json` |
| D31 | 2026-10-17 | Quality stack pinned: Vitest 5.0.2, pgTAP (`supabase test db`), Playwright 1.63.0, ESLint 9.39.5, Prettier 3.9.9, husky 9.1.7, lint-staged 17.6.0 | Owner | `AGENTS.md` stack |
| D30 | 2026-10-17 | Services: Supabase Pro, Resend Pro, own domain (paid); Sentry, PostHog, Cloudflare, an uptime monitor (free tiers); Vercel per D25 | Owner | `AGENTS.md` |
| D29 | 2026-10-17 | Vendored after line by line review: resend + react-email @ `247779a`, Turnstile Next.js reference @ `86505e4`; Supabase skills re-pinned @ `c9be0e9` | Owner | `AGENTS.md` skills |
| D28 | 2026-10-17 | Connectors: every write tool ask gated; PostHog MCP added at G1. Declined: removing the two failing local MCP servers (kept) | Owner | `AGENTS.md` MCP, `settings.json` |
| D27 | 2026-10-17 | Added fast-check (money property tests, resolves G14), @axe-core/playwright, Cloudflare Turnstile, gitleaks in CI | Owner | `AGENTS.md` stack |
| D26 | 2026-10-17 | Retired project skills `review`, `recover`, `remember`, `imprint` | Owner | `AGENTS.md` declined list |
| D25 | 2026-10-17 | Hosting: Vercel Hobby while building (test data only), Pro from G3 (Hobby forbids commercial use) | Owner | build-plan G3 |
| D24 | 2026-10-17 | End to end tests at 390px in `ar`, `tr`, and `en` (all three, not only English and Arabic) | Owner | code-standards §10 |
| D23 | 2026-10-17 | Turkey's PSP is **iyzico Marketplace** (Pazaryeri): sub-merchants and the approval API; the owner already has the account | Owner | architecture §5 |
| D22 | 2026-10-17 | **Launch ~~2026-11-07~~ (date superseded by D65: 2026-11-28), Turkey only.** KSA stays in the schema, switched off, until a Saudi PSP is chosen (no evidence iyzico supports SAR or Saudi sub-merchants) | Owner | project-overview §1, architecture regions |
| D21 | 2026-10-17 | **Adopted the AI Assisted Build Playbook**: `AGENTS.md` entrypoint, `docs/` layout, specs with cross checks, the per position loop, gates G0–G3, tracer bullets. Supersedes build plan v2's phases, its "full UI with mock data first" principle, and "03: all tables first" (each position now adds its own tables) | Owner | `AGENTS.md`, build-plan v3 |
| D20 | 2026-08-18 | Ledger postings are tax shape neutral; tax classification lives in a reporting layer. B9 gates only invoicing and refund fee absorption. Netting would destroy derivability as well as hide a fee | Owner | architecture §29 |
| D19 | 2026-08-18 | `localePrefix: 'always'`: every locale prefixed (`/ar`, `/tr`, `/en`), no unprefixed route; `/` negotiates. Supersedes D13's `as-needed` (one unprefixed locale cannot express a per region default) | Owner | `i18n.md` |
| D18 | 2026-08-18 | No CODEOWNERS or code owner merge gate (solo project: author and reviewer are the same person). Restore it and branch protection when a second engineer joins | Owner | `AGENTS.md` |
| D17 | 2026-08-17 | The satisfaction guarantee is dropped. Trust rests on escrow, vetting, ratings, disputes. A guarantee of the outcome is a principal's obligation (D12). Revisit if B9 says principal | Owner | project-overview §34 |
| D16 | 2026-08-17 | Strict phone and region validation at launch: `+90` → TR, `+966` → KSA, no override | Owner | `lib/region` |
| D15 | 2026-08-17 | Admins are global (both regions); no `admin_region` scoping. Expensive to change later | Owner | architecture |
| D14 | 2026-08-17 | One deployment for both regions, separated by a `region` column. An account belongs to exactly one region. Supersedes D7 | Owner | architecture §4 |
| D13 | 2026-08-17 | Seed defaults for every open numeric or policy value (table below); all admin editable in `platform_settings` | Owner | below |
| D12 | 2026-08-17 | We are an **agent**, not the principal: the provider sells the service; we sell intermediation and lead access. Not yet legally verified (B9) | Owner | architecture §29 |
| D11 | 2026-08-17 | Accepted the proposed resolutions for G1–G16 in `open-questions.md` | Owner | `open-questions.md` |
| D10 | 2026-08-17 | Admins are trusted operators but never a code execution boundary | Owner | rule 8 |
| D9 | 2026-08-17 | Providers may be individuals or companies with no profile difference | Owner | project-overview §25 |
| D8 | 2026-08-17 | Three locales, `ar` (RTL), `tr`, `en`, direction derived at runtime | Owner | `i18n.md` |
| ~~D7~~ | 2026-08-17 | ~~Two independent deployments~~. Superseded the same day by D14 | Owner | — |
| D6 | handover | Money stored as integer minor units | Owner (brief) | rule 4 |
| D5 | handover | No number masking; leakage handled economically | Owner (brief) | project-overview §3 |
| D4 | handover | Rating never gates payment release | Owner (brief) | project-overview §3 |
| D3 | handover | Auto release after the hold period (default 72h) | Owner (brief) | `platform_settings` |
| D2 | handover | Wallet is a read only earnings mirror; unlock fee charged per transaction | Owner (brief) | project-overview §6 |
| D1 | handover | PSP behind an adapter interface; no SDK in feature code | Owner (brief) | architecture §5 |

### Defaults in use (`platform_settings` seeds, admin editable at runtime)

| Setting | Default | Confirmed |
| --- | --- | --- |
| Unlock fee basis | Flat, admin configurable | ☐ |
| Hold period (auto release) | 72 hours | ☐ |
| Payment window (`SELECTED → OPEN`) | 24 hours | ☐ |
| Unlock window (`FUNDED → OPEN`) | 24 hours | ☐ |
| Max applications per request | 10 | ☐ |
| Unlock fee refund after unlock | Only when not provider attributable (G4) | ✅ D11 |
| Fee charge method | Card at unlock, via the outbox | ✅ D11 |
| Start grace period | 24h after `scheduled_start_at` | ✅ D13 |
| Completion grace period | 24h after `scheduled_end_at` | ✅ D13 |
| Max re-selections before auto refund | 3 | ✅ D13 |
| Max price multiple of base | 20× | ✅ D13 |
| Applications per provider per hour | 20 | ✅ D13 |
| PSP fee absorbed on refund by | Platform | ✅ D13 |
| Default locale, TR / KSA | `tr` / `ar` | ✅ D13 |
| `en` customer facing | Yes, both regions | ✅ D13 |
| URL locale strategy | `localePrefix: 'always'` | ✅ D19 |
| Legally authoritative T&C language | No default (B10) | ☐ |

---

## 4. Open questions

Ordered by what they block soonest. Check before designing anything that touches one. A resolved
question moves to the decision log and is struck through here.

| # | Question | Blocks |
| --- | --- | --- |
| ~~Q2~~ | ~~Confirm the build order~~ → resolved by D41 | — |
| ~~Q11~~ | ~~Brand assets~~ → resolved by D43 (wordmark font) and D44 (logo file, favicons, exact name) | — |
| ~~Q1~~ | ~~Confirm the priority line~~ → resolved by D42 | — |
| ~~Q4~~ | ~~Sign in channel at launch~~ → resolved by D55: phone SMS code, 6 digits | — |
| ~~Q13~~ | ~~The redesign's provider wallet conflicts with rule 9~~ → withdrawn 2026-10-25: **not a conflict**. `project-overview.md` §6 and §12 define the wallet as a read only mirror of PSP balances with payout requests via the PSP, which is what `p9` draws. The flag was wrong | — |
| Q12 | **The redesign's photos and avatars are borrowed** (found 2026-10-24). 13 photos in the Claude Design export (`img/`) are crops of Airtasker and Taskrabbit marketing images, one of them AdobeStock licensed to Taskrabbit. The 3 `land-*` photos have no known source. The 5 avatars (`img/av-*.jpg`) are real Airtasker users' profile photos. Replace them with owned, licensed or generated images before any public use or any UI built from the design | Launch material; UI positions built from the design |
| ~~Q14~~ | ~~KSA leftovers in the TR redesign~~ → resolved by D57: v1 is Turkish first; build with Turkish data and the iyzico card form | — |
| ~~Q5~~ | ~~Sentry and PostHog data region~~ → resolved by D62: EU | — |
| ~~Q6~~ | ~~Region for the new Supabase project~~ → resolved by D62: `eu-central-1` (Frankfurt), Vercel functions in `fra1` | — |
| Q3 | **Uptime monitor:** Better Stack free (10 monitors, 3 min checks, status page) or UptimeRobot free (50 monitors, 5 min; its May 2026 terms reportedly allow commercial use, verify) | S10, G1 |
| Q10 | **Candidate rules** from the playbook's security pass: (12) user written content is always rendered escaped, including in emails; (13) a secret is read only inside its single door (now lint enforced). Promote into §5? | Nothing; strengthens review |
| Q9 | **Reputation migration** (old 35, needs B8) at launch or after? | Priority of position 19 |
| Q7 | **Saudi PSP** for the KSA launch (PayTabs or another with mada) | KSA go live only |
| Q8 | `tailwind-design-system` skill has no recorded source. Re-vendor from a known source at a pinned commit, or remove it? | Nothing |

Gap reasoning behind earlier decisions stays in `open-questions.md` (an archive now).

---

## 5. Owner setup checklist

The agent never creates accounts, accepts terms, adds payment methods, or reads or pastes secret keys.
Values go straight into Vercel env, GitHub secrets, or `.env.local`; say only variable **names** in
chat. Exact variable names for new services are added to `.env.example` by the position that uses
them.

| # | Owner action (exact steps) | Agent does after | Blocks | Status |
| --- | --- | --- | --- | --- |
| S1 | **iyzico sandbox.** Sign up at the iyzico sandbox merchant panel, copy the sandbox API key and secret into `.env.local` as `IYZICO_API_KEY` and `IYZICO_SECRET_KEY`. In the sandbox: create a `PERSONAL` sub-merchant (B11); run one marketplace payment; note the callback payload, its signature scheme, the event id, whether a partial refund works before approval, and how approval behaves | Records §7 facts; specs 08 | 08–12 | ☐ |
| S2 | **iyzico live terms** (in writing from iyzico): max time a payment can stay unapproved; real per-card fees (domestic, foreign, installments); settlement delay for new sub-merchants; agreements users must accept; whether `PERSONAL` sub-merchants work in production | Records §7; sets `psp_max_hold_hours` | G3 | ☐ |
| S3 | **Vercel.** vercel.com → Add New → Project → import `Moaz-Allam/asma`, name it `aldebyani` → framework Next.js, Node 24 → add env vars for Preview and Production (names from `.env.example`) → stay on Hobby until G3 | Preview checks, region pin (00b) | G0 | ✅ 2026-10-18 by the owner (found 2026-10-28). Env vars still to add: the Supabase ones now, Sentry and PostHog once the 00b spec names them |
| S4 | **Domain and DNS.** Buy the domain (Cloudflare Registrar sells at cost; it does not sell `.com.tr` or `.sa`) → DNS in Cloudflare → add it to Vercel with DNS only (grey cloud) records → tell me the name | Wires `appOrigin()`, Resend, Turnstile hostnames | S5, S9, G3 | ☐ |
| S5 | **Resend and Supabase SMTP.** Resend → Domains → add the sending domain → add its SPF, DKIM, DMARC records in Cloudflare → verify → create a sending only API key → Vercel env and `.env.local` as `EMAIL_API_KEY` → turn off open and click tracking. Supabase → Authentication → SMTP settings → Resend SMTP (`smtp.resend.com`, port 465, user `resend`, password: an API key) with a `no-reply@` sender. Supabase's built in email only reaches project team members | Email OTP (Q4), position 13 | 01, 13 | ☐ |
| S6 | **Create the Supabase project, then connect the right accounts (R1).** supabase.com → New project `aldebyani` in your own org, Free plan until launch then Pro (D63), region `eu-central-1` (D62) → `npx supabase login` with that account (unset any `SUPABASE_ACCESS_TOKEN` that points at another account) → `npx supabase link --project-ref <new ref>` → `npx supabase projects list` must show it as linked. For the MCP: a **scoped** personal access token limited to that project; set `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF` in your shell profile. Reconnect the claude.ai Supabase connector to that org. **Same rule for every service:** connect the account that owns the Aldebyani project (Vercel team S3, Sentry org S7, PostHog project S8) before anything uses it | Verifies each link read only; updates `AGENTS.md` and the tracker with the new refs | Any cloud push, previews (G0) | ⏳ partly done 2026-10-28: project created 2026-10-18 in org `aldebyani` (eu-central-1, Free until launch, D63; default name, renaming is optional) and linked (`lrejqpcgsugjiijuakoq`). CLI logged in to that account, `.env.local` updated (S19), the project MCP served from the owner's local `.mcp.json` (D64), the position 00 migration pushed (2026-10-28). Still to do: the Supabase values in Vercel (both scopes) |
| S7 | **Sentry.** sentry.io → organisation (EU region, D62) → project `aldebyani`, platform Next.js → keep the DSN ready → create an org auth token for source maps (Vercel env only) → tell me the org and project slugs | 00b wires it | 00b, G1 | ⏳ mostly done 2026-10-28: org `aldebyani` on the EU region (`de.sentry.io`); project `aldebyani` (Next.js) created by the agent at the owner's request, DSN on `ingest.de.sentry.io`. Still to do: the org auth token for source maps (Vercel env only; Vercel's Sentry integration may already have added it, 00b task 7 checks the names). Verified locally 2026-10-28 (`ALDEBYANI-1`) |
| S8 | **PostHog.** Sign up (EU Cloud, D62) → project `aldebyani` → keep the project API key and host ready → session replay: mask all inputs on; autocapture off for now → sign the claude.ai PostHog connector in with that EU account (one connector URL; PostHog routes by account) | 00b wires it | 00b | ✅ 2026-10-28: org `Aldebyani`, project `aldebyani` (id 323846) on EU Cloud, settings per D68; the connector is signed in to it. The project key goes into Vercel with 00b task 10 (as `NEXT_PUBLIC_POSTHOG_KEY`) |
| S9 | **Turnstile.** Cloudflare → Turnstile → Add widget → hostnames: your domain and `localhost` → Managed mode → keep the site key and secret ready | 01 wires it | 01 | ☐ |
| S10 | **Uptime monitor** (Q3): an HTTP monitor on `/api/health` of the production URL, every 5 minutes or faster, alerting your phone and email | Verifies at G1 | G1 | ☐ |
| S11 | **Docker Desktop** (optional): install and start it so `npm run db:test` and `npm run test:e2e` run locally. CI runs both regardless | — | Local runs only | ☐ |
| S12 | **Import the brief.** Put the original brief files (the `.docx` / `.xlsx` that used to be in `context/docs/`) into `docs/brief/`, or tell me where they are | Converts them with numbered sections | Precedence level 4 | ☐ |
| S13 | **Design handoff (B4).** Export the Claude Design screens, logo, colours, fonts into `docs/design/` and say which screen is which page | Records tokens with a contrast table; maps screens | UI layer from 01 | ✅ 2026-10-25 (D48) |
| S14 | **Branch protection.** GitHub → Settings → Branches → rule for `master`: require the `checks`, `database`, `e2e` jobs; block force pushes | — | Protects merges | ✅ 2026-10-17, done by the agent at the owner's request (D46) |
| S15 | **Close the stale dependabot PR** (TypeScript 5.9.3 → 7.0.2; CI rejected it) | — | — | ☐ |
| S16 | **Legal (B2, B9, B10).** Custody confirmation; agent position; authoritative language; T&C (the service contract is customer to provider; we are intermediary and payment facilitator), privacy notice (KVKK), provider agreement with a data processing clause. **Also (2026-10-25):** provider verification collects a criminal record certificate and a liveness selfie (`p3`), both special categories of personal data under KVKK; confirm the legal basis, explicit consent wording and retention | Builds the legal pages | G3 | ☐ |
| S17 | **Catalog data (B5, B6).** Launch categories; per category: questions (key, type, options, required, validation), labels in `ar`/`tr`/`en`, base price, modifiers, zones and multipliers; TR commission %, unlock fee, windows. Start with home cleaning | Seeds through admin UI, never invented | 03 content, G3 | ☐ |
| S19 | **Fix `.env.local`.** `npm run dev` stops at boot: its `SUPABASE_DB_POOL_URL` lacks `pgbouncer=true`. Delete that line (it is optional now, D38, and the old project is unverified), or correct it once the new project exists (S6). The agent cannot read or edit this file, by design | Re-runs the dev server preview | Local `npm run dev` | ✅ 2026-10-28: the dev server boots (the pool URL now points at the new project's transaction pooler) |
| S18 | **Claims and legacy data (B7, B8).** The public quality claim and how it is computed; legacy provider job counts and the past customer list | 19, public copy | 19 | ☐ |
| S21 | **Turkish translator (D58).** Choose who turns the English copy into Turkish (a native speaker or an agency), so each position's new strings can be translated before its screens ship; legal copy goes through S16 | Sends each position's `messages/en.json` additions for translation; marks untranslated keys | Turkish screens of every position | ☐ |
| S20 | **SMS provider for Turkey (D55).** Open an account with an SMS provider Supabase Auth supports (Twilio, Twilio Verify, MessageBird, Vonage, or Textlocal; a local Turkish provider would need Supabase's Send SMS hook instead), register the sender ID for Turkey, and keep the credentials ready for the Supabase project's Auth settings (never in chat) | Wires phone sign-in in position 01; 6 digit codes | 01 | ☐ |

---

## 6. Bootstrap checklist (playbook §21.1)

| Step | Status |
| --- | --- |
| 1 Brief imported to `docs/brief/` with numbered sections | ☐ S12 |
| 2 `AGENTS.md` and one line `CLAUDE.md` | ✅ 2026-10-17 |
| 3 `project-overview.md`: what, actors, flow, rules (canonical §5), stop and ask, doc map | ✅ 2026-10-17 |
| 4 `architecture.md`, `code-standards.md`, `build-plan.md`, tracker | ✅ |
| 5 Tracer bullet unit in `build-plan.md` | ✅ 2026-10-17 |
| 6 Build order with gates and cut list | ✅ drafted · ☐ owner confirmation (Q2) |
| 7 Deny and ask rules, bash guard with its test, format hook | ✅ 2026-10-17 |
| 8 `slice-reviewer` and `security-reviewer` | ✅ 2026-10-17 |
| 9 Tooling gap scan for the stack | ✅ 2026-10-17 (D26–D29) |
| 10 Scaffold spec | ✅ 0001, 0003 (before the playbook) · ☐ 00b |
| 11 Position 00 build | ✅ 00 · ☐ 00b |
| 12 Gate G0 on a clean clone | ☐ |
| 13 UI docs and design reference mapping | ✅ docs exist · ✅ mapping 2026-10-25 (`docs/design/README.md`) |
| 14 Per position loop from 01 | ☐ |
| 15 Independent security review planned before the first money milestone | ✅ G1 in `build-plan.md` |

---

## 7. PSP facts (iyzico, Turkey)

Fill before position 08. Source: iyzico docs, sandbox, or a written answer, **never** assumption.
KSA facts are deferred with the KSA launch (D22).

| # | Question | How to get it | Answer | Confirmed |
| --- | --- | --- | --- | --- |
| 2 | 🔴 Can individual providers be sub-merchants? (B11) | Sandbox (S1) | Docs list `PERSONAL`, `PRIVATE_COMPANY`, `LIMITED_OR_JOINT_STOCK_COMPANY` | ☐ |
| — | Sub-merchant types and required fields per type (G17) | Sandbox onboarding (S1) | | ☐ |
| 4 | Callback or webhook signature scheme, retry policy | Sandbox payment (S1) | | ☐ |
| 5 | Event id available for dedupe | Sandbox payment (S1) | | ☐ |
| 6 | Partial refund while unapproved (for `PARTIALLY_RELEASED`) | Sandbox (S1) | | ☐ |
| — | Approval (release) API behaviour and failure modes | Sandbox (S1) | | ☐ |
| 1 | Max time a payment may stay unapproved; must cover payment window + unlock window × up to 3 + work + 72h release (G2) | Ask (S2) | | ☐ |
| 3 | Settlement delay after approval for new sub-merchants (G16) | Ask (S2) | | ☐ |
| — | Real per-card fee, posted from the actual settlement figure (G3) | Ask (S2) | | ☐ |
| 7 | Agreements users must accept at signup | Ask / docs (S2) | | ☐ |

---

## 8. Test health

| Suite | Status | Last run | Notes |
| --- | --- | --- | --- |
| Guard suite (`npm run guardrails`) | 🟢 | 2026-10-25 | 63/63, including false positive, Edit and MultiEdit cases |
| Typecheck, lint, `lint:rtl`, format check | 🟢 | 2026-10-25 | Lint includes the single door rules |
| Unit (Vitest 5) | 🟢 | 2026-10-25 | 127 tests in 10 files, about 6s |
| Build (`next build`) | 🟢 | 2026-10-17 | ar, tr, en prerendered |
| pgTAP (`supabase test db`) | 🟢 in CI (2026-08-18) · ⏳ new meta tests | — | Needs Docker locally (S11); `02_function_grants` first runs in CI |
| End to end (Playwright, 390px, ar/tr/en) | 🟢 local | 2026-10-17 | 6/6 with axe, no database (`E2E_NO_DB=1`); first CI run after the push |
| Secret scan (gitleaks 8.30.1) | ⏳ | — | First run in CI after the push |
| Money: property, race, idempotency, invariant | 🔴 | — | Required before position 09 |

---

## 9. Standing cautions

- Do not run `npx shadcn init` until B4 lands; it writes a palette into `globals.css`.
- Do not upgrade ESLint past 9.x (dependabot ignores it deliberately).
- Do not create `app/layout.tsx`; `app/[locale]/layout.tsx` renders `<html>`.
- Do not add `APP_REGION` or `APP_CURRENCY`; `lib/env.ts` rejects them (D14).
- Do not run `supabase db push` unless the owner asks, after a dry run and after R1's link check.
- Do not add a write policy to `regions` (reference data; a pgTAP assertion fails if one appears).
- Do not key `platform_settings` on `key` alone (TR and KSA would share values).
- Do not create a domain table without `region`; CI rejects it.
- Do not put tax classification in posting logic (D20), and never net commission into escrow (rule 6).
- Do not assume individuals can be sub-merchants until B11 is confirmed in the sandbox.
- Do not use any connector or the Supabase CLI against a cloud project until it shows the Aldebyani project (R1).
