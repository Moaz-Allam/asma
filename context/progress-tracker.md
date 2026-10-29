# Progress Tracker

v3, 2026-10-17, restructured to the playbook's five parts (`docs/engineering-approach.md` §18). Read
at the start of every session, update at the end. If it is not written here, the next session does
not know it.

**Last updated:** 2026-10-28
**Phase:** Bootstrap done · design imported (PR #18) · position 00 ✅ · 00b in progress
**Status:** 🟡 00b built and pushed (branch `feat/00b-scaffold-completion`), migration in the cloud; preview proof, alert rules and dashboards open; launch 2026-11-28 (D65)
**Next:** finish 00b tasks 7, 12, 15 (preview, `verify/00b-sentry`, Sentry alert rules, dashboard settings), then PR, `/check verify`, reviews → G0 by 2026-10-30

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
- **2026-10-28** · **00b built** (`/develop`, spec 0004), on `feat/00b-scaffold-completion`: `master`
  merged (D66); PostHog skill vendored; Sentry 10.75.2 and posthog-js 1.418.11 pinned (D74); install
  scripts reviewed (D75); migration `20261028180000_flags_ksa_health` (flags per region, the `_enabled`
  CHECK, KSA off, `health_ping`, explicit grants D77) applied locally and, after a dry run, to the cloud
  (verified through the connector, advisors clean); `lib/deployment.ts` gate; the Sentry and PostHog
  doors with one scrubber; nonce CSP and security headers; `/api/health`; `isEnabled`; `raiseAlert`;
  the logger; the localized global error page. Local: verify green, 338 unit tests, pgTAP 42/42, e2e
  23/23 (4 single locale skips). Found and fixed: the URL scrubber redacted IP hosts, which lost every
  local pageview silently. The e2e fixture hides Playwright's bot signals (posthog-js drops bot traffic,
  which is right in production). Local Supabase moved to ports 544xx (D76). The Supabase CLI had
  fallen back to another account; the owner logged in again and relinked. The Vercel connector still
  answers 403 on the team scope after two approved links, so the owner set the env values in the
  dashboard. Branch pushed 2026-10-28; CI runs on the PR.
- **2026-10-28** · **00b proven on Vercel previews** (owner logged in). Feature preview `96a26c7`: built
  in `fra1`, source maps uploaded then deleted (`sourcemaps: none left under .next/static.`), release =
  full SHA, locale pages and `/api/health` dynamic. Throwaway `verify/00b-sentry` (never merged): the
  Route Handler error (ALDEBYANI-2) and the client button error (ALDEBYANI-3) reached Sentry with frames
  mapped to source, `environment: preview`, the full SHA release, messages scrubbed (`[email]`, `[ip]`,
  `[phone]`), no `user`, a masked replay attached on error; the anonymous flag read failed closed and
  raised `alert flag_read_failed` (ALDEBYANI-5, tags `alert`, `region: TR`, `cause: error`). Found:
  Sentry derived `geo.city` and `geo.country_code` from the connection IP on arrival (the tunnel forwards
  the visitor's IP); the owner added the Sentry rule "Remove anything from `$user.geo.**`" (D79) and the
  next event carried no geo. Alert rules created through the connector: `1429069` (new alert issue) and
  `1429070` (10 events in 15 minutes; Sentry has no 10 minute window), both limited to tag `alert` and
  `environment eq production` (Sentry refused an environment filter before the first production event).
  Not done by the agent: Sentry's onboarding run (its skill only takes a code from the session's first
  prompt), so the owner completes it in Sentry.
- **2026-10-29** · **00b on a clean clone** (G0 run): a fresh clone of `f636c8f` from GitHub, `npm ci`,
  `npm run verify` (guard 63/63, 338 unit tests), `E2E_NO_DB=1 npm run test:e2e` 23 passed and 4 single
  locale skips; PR #20 green on every check (checks, database, e2e, Vercel). Quota check done (D81).
  Reviews: `slice-reviewer` (fix then merge), `security-reviewer` (fix then ship) and `/check review`
  on Sonnet (changes requested); no Critical finding. Reports in `docs/reviews/2026-10-29-*`. Owner
  decisions D82 to D86. Fixed on the branch:
  - the telemetry relays are our own Route Handlers (`/api/e`, `/api/a/*`, `/api/csp`, D83), so no
    visitor cookie, referer or IP reaches Sentry or PostHog, only our DSN and key are served, and CSP
    reports are scrubbed;
  - the scrubber: URLs inside any text (absolute and relative), frame paths, `GET /path?…` names, the
    URL parameter allow list (D85), fragment attributes, IPv4 before a full stop and IPv6 with an
    embedded IPv4, Arabic-Indic digit phones, non ASCII emails, camelCase and dotted keys, Postgres
    `details` and `hint`, the `feedback` and `state` contexts, `ui.*` selector attribute values, and a
    bounded walk (cycles, 1000 per level, 50,000 nodes);
  - `beforeSendSpan` in both SDKs, a server `tracesSampler` that ignores an incoming sampling flag,
    replay `maskAttributes` (href, src, value, alt, action), `$geoip_disable` and no top level `$set`;
  - the alert fingerprint carries the environment (D84) and rule `1429069` also fires on a regression;
  - `isEnabled` turns down an unknown region or flag without an alert; pgTAP proves a non admin cannot
    insert or delete a flag; the RLS meta test covers partitioned tables and views;
  - the proxy never throws (tested against the real environment), `check-sourcemaps.mjs` checks every
    deployment build, AC-17 is tested, the registry has `GlobalError`;
  - lint closes `import()`, `require()`, destructured keys and computed or spread `process.env` (D86).
  Unit tests 461 (from 338), lint proofs 51 (from 35). Still to do before merge: the default privileges
  migration (needs Docker to read the local defaults), `npm run db:test`, e2e with the database, a
  preview check of the three relays. Owner steps left in Sentry: the onboarding run, the 26 keys of D82
  as additional sensitive fields, the inbound filters (browser extensions, localhost, legacy browsers,
  web crawlers), and a look that spike protection is on.

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
| R1 | **Cloud accounts partly connected** (rechecked 2026-10-28). Exist: Vercel project `aldebyani` (S3 ✅), Supabase org `aldebyani` with project `lrejqpcgsugjiijuakoq` (eu-central-1, linked; it replaces the old unverified ref `syrhavojjpabwwcaezee`), Sentry org and project `aldebyani` (EU). Missing: the Sentry auth token for source maps (S7); the PostHog EU project and the connector's sign in to it (S8); the Supabase CLI login to the `aldebyani` account (it still sees only `alqafila`); the project MCP's env vars (D64) | Any cloud push, G0 | Before any push, `npx supabase projects list` must show `lrejqpcgsugjiijuakoq` as linked. Each connector is used only for the `aldebyani` org or project; `Jawla`, `jawla-i1` and `alqafila` are other work and off limits | ⏳ open. 2026-10-28 evening: the CLI had fallen back to another account; the owner logged in again and relinked (`projects list` shows `lrejqpcgsugjiijuakoq` linked). The Vercel connector still gets 403 on the team scope `moaz-allam-4163s-projects` after two approved links; the Vercel CLI here is logged in to the owner (`moaz-allam-4163`) and is the working path for read only checks |
| R2 | **Deadline.** Replanned 2026-10-28 (D65): 16 P0 positions from 2026-10-29 to the 2026-11-28 launch, with 3 buffer days. The owner steps in `build-plan.md` (parallel tracks) are on the critical path, S1 and S16 most of all | Launch date | Cut list decided in advance (`build-plan.md`); replan honestly at each gate | ⏳ watching |
| R3 | **Free plan limits.** Vercel Hobby forbids commercial use; Sentry and PostHog free quotas | G3 | Test data only before G3; Vercel Pro at G3 (D25); Sentry and PostHog quotas checked against launch volume 2026-10-29 (D81), recheck at G3 | ⏳ planned |
| R4 | **Shared pre launch database.** Previews and production share the one Supabase project until G3 (D37) | G3 | Test data only; G3 wipes it, reapplies migrations, creates a staging project | ⏳ deliberate |
| R5 | **Forged alerts through the public DSN** (security review 2026-10-29). Alerts are recognised by a tag and environment the sender sets, and the server sends them with the DSN every browser has, so anyone can post a fake `alert` event in `production` (an owner email each) or spend the 5k error quota so a real alert is dropped | 08 (first money alert that matters) | Spike protection; rule `1429070` only fires past 10 events. Before 08: server errors and alerts through a server only DSN in a separate Sentry project, alert rules on that project only, a per key rate limit on the browser DSN, and the outbox email (13) as an independent channel for money alerts | ⏳ planned |
| R6 | **00b review follow ups, each tied to the position that needs it.** Before the reveal page (10): a `data-pii` container that replay blocks, and replay DOM attribute scrubbing beyond `maskAttributes`. When 01 drops `E2E_NO_DB`: an e2e test that `/api/health` answers 200 against a real database. When the first public page reads a flag: debounce `flag_read_failed` per record. Measured, not yet acted on: posthog-js and Replay still ship in the first load bundle (start after hydration, load before it), and the pageview fires at navigation start, so a redirected navigation counts a page | 01, 10, G1 | Recorded here so each lands with its position | ⏳ planned |

> ⚠️ **Never implement wallet top up or a stored balance.** Blocked by design (`project-overview.md`
> §6), not only by B2.

---

## 3. Decision log

Newest first. **By:** Owner (asked in chat), or Default (chosen by the agent, in force until the owner
overrides). A recorded owner decision beats a general rule (precedence level 2). Superseded rows stay,
struck through, with the replacement named.

| # | Date | Decision | By | Where |
| --- | --- | --- | --- | --- |
| D86 | 2026-10-29 | **Guardrails from the 00b reviews** (tooling gap scan). Accepted: lint closes dynamic `import()`, `require()` and destructured or computed `process.env` around the doors; a migration revokes the cloud's permissive default privileges so new tables and functions start closed everywhere, with a grants meta test and an RLS meta test that also covers partitioned tables and views. Recorded as owner steps: Supabase Auth CAPTCHA and SMS limits before 01 (S22), Vercel firewall rate limits before G3 (S23). Not chosen: an e2e project with tracing and replay on (heavier, slower CI) | Owner (asked in chat) | `eslint.config.mjs`, `supabase/migrations/`, `supabase/tests/`, S22, S23 |
| D85 | 2026-10-29 | **URL parameters: an allow list, not a deny list** (spec 0004 AC-3 amended): every URL sent to Sentry or PostHog keeps only `utm_*` and `page` parameters and drops every other parameter and every fragment, so a new parameter name is safe by default | Owner (asked in chat) | `lib/observability/scrub.ts` |
| D84 | 2026-10-29 | **The alert fingerprint carries the environment:** `alert / reason / recordId / environment` (spec 0004 AC-11 amended), so a preview alert can never hide the first production alert inside an existing issue. Sentry rule `1429069` also fires on a regression, so a resolved alert that comes back emails again | Owner (asked in chat) | `lib/observability/alert.ts`, Sentry rule `1429069` |
| D83 | 2026-10-29 | **Telemetry relays are our own Route Handlers** (spec 0004 amended after the reviews): `/api/e` (Sentry envelopes), `/api/a/*` (PostHog capture) and `/api/csp` (CSP reports) replace the Next rewrites, the SDK's `tunnelRoute` and the direct `report-uri` to Sentry. Each forwards only to a fixed EU destination, only for our DSN or project key, with a request header allow list (no cookie, referer, authorization or visitor IP reaches Sentry or PostHog) and a size cap under Vercel's 4.5 MB body limit; CSP reports pass the scrubber like every other signal. They are public machine endpoints like `/api/health` (no session, no `requireRole()`, D71). Cost: each telemetry request is a function invocation (Hobby includes 1M a month) | Owner (asked in chat) | `app/api/e`, `app/api/a`, `app/api/csp`, `lib/observability/`, `lib/analytics/`, `lib/security/csp.ts`, `next.config.ts`, AC-2, AC-3, AC-13 |
| D82 | 2026-10-29 | **Sentry "Additional Sensitive Fields" get a narrow list, not the whole scrubber key list** (deviates from spec 0004's "the scrubber key list added to its data scrubbing"). Sentry matches each entry as a substring of every key and every value (its docs: the entry `exp` removes "Unexpected error"), so short keys such as `name`, `message`, `body`, `description`, `lat`, `card`, `city`, `note` would wipe browser names, breadcrumb messages, log bodies, span descriptions and ordinary words. The 26 entries: `first_name`, `last_name`, `full_name`, `email`, `phone`, `address`, `street`, `district`, `building`, `apartment`, `postal_code`, `latitude`, `longitude`, `coordinates`, `iban`, `card_number`, `national_id`, `tckn`, `identity_number`, `passport`, `tax_id`, `tax_number`, `birth_date`, `date_of_birth`, `jwt`, `otp`. The short keys stay with our own scrubber (`lib/observability/scrub.ts`), and Sentry's defaults already cover password, secret, token, auth, bearer and credentials | Owner (asked in chat) | Sentry project settings, AC-3 |
| D81 | 2026-10-29 | **Free plan quotas checked against launch volume (spec 0004 AC-21):** the first month after launch is planned at under 1M page views. At that load every free quota holds with the spec's sample rates, so they stay (traces 0.1 production, 1 preview, 0 local; replays 0 per session, 1 on error). Quotas a month: Sentry Developer 5k errors, 5M spans, 5 GB logs, 50 replays; PostHog free 1M events. A full page load measured about 40 spans on the preview, so traces at 0.1 fit about 1.2M page loads. Errors follow bugs, not traffic, and spike protection cuts bursts; the 50 replays can run out in a month with many error sessions, which drops only replays. Over quota, both free plans drop data and never bill. Sentry's web crawler inbound filter is turned on as well, beyond the three filters AC-21 names (crawlers that run JavaScript would spend the error quota). Recheck with real numbers at G3 (R3) | Owner (asked in chat) | `lib/observability/shared.ts`, `lib/observability/client.ts`, Sentry inbound filters, R3 |
| D80 | 2026-10-28 | **Sentry alert rules (spec 0004 AC-11):** `1429069` emails the owner on a new issue tagged `alert` in `production`; `1429070` when such an issue passes 10 events in 15 minutes (Sentry offers 1, 5, 15 minute windows, not 10; every case of 10 in 10 also meets 10 in 15). Re-notification at most every 30 minutes. The production limit is an event filter until a production event exists | Owner (asked in chat) | Sentry project `aldebyani` |
| D79 | 2026-10-28 | **No visitor location in Sentry:** Sentry derives `geo.city` and `geo.country_code` from the connection IP even with IP storage off, and the tunnel forwards the visitor's IP. Project rule "Advanced Data Scrubbing: Remove, Anything, `$user.geo.**`" strips it on arrival; verified on the next preview event. The browser `culture.timezone` and device model remain (non identifying SDK device facts; S16 may rule otherwise) | Owner (asked in chat) | Sentry project settings, AC-3, AC-18 |
| D78 | 2026-10-28 | **00b implementation defaults** (agent, during `/develop`): the Sentry DSN must be the SaaS ingest host `o<org>.ingest.de.sentry.io` (only that shape engages the `/api/e` tunnel), not any `*.de.sentry.io`; source maps and the Sentry release exist only on a deployment build (the build plugin otherwise loads a local `.env.sentry-build-plugin` token and would upload a developer's build); the browser keeps no `dataCollection` object (it flips unset categories to permissive) and sets `sendDefaultPii: false`; posthog-js has no client option to withhold the IP (`ip` is a no op), so the project's "Discard client IP data" setting carries it (D68); PostHog loads no external script and no remote config (`disable_external_dependency_loading`, `advanced_disable_flags`), so a project setting cannot switch a feature back on | Default | `lib/deployment.ts`, `next.config.ts`, `lib/observability/`, `lib/analytics/client.ts` |
| D77 | 2026-10-28 | **Explicit table grants, the same everywhere:** the cloud project kept Supabase's old default privileges (anon, authenticated and service_role held every privilege on every table, TRUNCATE included) while the local stack and CI use the hardened defaults (none), so the same migrations behaved differently. The 00b migration revokes all on `regions` and `platform_settings` and grants exactly the access model: read to authenticated and service_role, write on `platform_settings` to authenticated (the admin policy decides). pgTAP pins the grants. Each later table's migration grants its own access explicitly | Owner (asked in chat) | `20261028180000_flags_ksa_health.sql`, `supabase/tests/03` |
| D76 | 2026-10-28 | **Local Supabase on ports 544xx**, not the CLI default 543xx: the owner runs other local Supabase projects on the defaults. CI and the e2e wrapper read the ports from `supabase status` | Owner (asked in chat) | `supabase/config.toml` |
| D75 | 2026-10-28 | **Install scripts approved** after review: `@sentry/cli` 2.58.6 (a no op when its platform binary package is installed, else a checksum verified download) and `core-js` 3.51.0 (a donation banner, through posthog-js) | Owner (asked in chat) | `package.json` `allowScripts`, `AGENTS.md` |
| D74 | 2026-10-28 | **SDK pins:** `@sentry/nextjs` 10.75.2, the lowest version with Turbopack source map upload and Sentry Logs with `beforeSendLog`, raised to the first one clear of the critical tunnel advisory GHSA-mchm-gjx6-7h55; `posthog-js` 1.418.11, the lowest with every option we set plus the relative `api_host` and cookieless id fixes | Owner (asked in chat) | `package.json`, `AGENTS.md` stack table |
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
| S3 | **Vercel.** vercel.com → Add New → Project → import `Moaz-Allam/asma`, name it `aldebyani` → framework Next.js, Node 24 → add env vars for Preview and Production (names from `.env.example`) → stay on Hobby until G3 | Preview checks, region pin (00b) | G0 | ✅ 2026-10-18 by the owner (found 2026-10-28). Env (2026-10-28): Sentry's and Supabase's Vercel integrations added their variables (Supabase ones in Production only); the agent added `APP_DEFAULT_LOCALE`, `APP_SUPPORTED_LOCALES` (both scopes) and the public Supabase URL and anon key (Preview). Then the owner added `SUPABASE_SERVICE_ROLE_KEY` to Preview and gave the PostHog project key, which the agent set in both scopes; every required name is in both scopes, `APP_LOCAL_ONLY` in neither. No Vercel drain exists (checked 2026-10-28), so the integration's `SENTRY_VERCEL_LOG_DRAIN_URL` is unused and no raw log bypasses the scrubber |
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
| S22 | **Supabase Auth hardening before 01 (D86).** In the cloud project's Auth settings: turn on CAPTCHA protection with Turnstile (the S9 secret), and set the SMS and OTP rate limits, so nobody can call the Auth API directly to sign up or send SMS around the app's bot check (SMS pumping) | Sends the steps with the 01 spec; the app side sends the Turnstile token with each OTP request | 01 | ☐ |
| S23 | **Vercel firewall rate limits before G3 (D86).** On the Pro plan: rate limit rules for the pages, `/api/health` and the telemetry relays (`/api/e`, `/api/a/*`, `/api/csp`), so a flood cannot spend the function quota or the Sentry and PostHog quotas | Proposes the limits from the first weeks of real traffic | G3 | ☐ |
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
| 12 Gate G0 on a clean clone | ◐ clean clone green 2026-10-29 (verify, 338 unit tests, e2e); closes when the review fixes are green in CI and the owner's Sentry settings are in |
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
| Guard suite (`npm run guardrails`) | 🟢 | 2026-10-28 | 63/63, including false positive, Edit and MultiEdit cases |
| Typecheck, lint, `lint:rtl`, format check | 🟢 | 2026-10-28 | Lint includes the single door rules, now with the Sentry and PostHog doors (35 proofs) |
| Unit (Vitest 5) | 🟢 | 2026-10-28 | 338 tests in 19 files (scrubber, deployment gate, CSP, proxy, health, flags, doors, analytics), about 5s |
| Build (`next build`) | 🟢 local · 🔴 first preview | 2026-10-28 | Locale pages are dynamic (nonce CSP); the first Vercel preview stopped at the build gate as designed: `NEXT_PUBLIC_POSTHOG_KEY` missing |
| pgTAP (`supabase test db`) | 🟢 local | 2026-10-28 | 42/42 on the local stack (ports 544xx, D76), including `03_flags_and_health` and the grant pins; CI runs on the PR |
| End to end (Playwright, 390px, ar/tr/en) | 🟢 local | 2026-10-28 | 23 passed, 4 single locale skips: smoke, CSP and headers, both SDKs against stubs, storage, scrubbed payloads, health, prerender manifest (`E2E_NO_DB=1`) |
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
