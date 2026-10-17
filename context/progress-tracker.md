# Progress Tracker

v3, 2026-10-17, restructured to the playbook's five parts (`docs/engineering-approach.md` §18). Read
at the start of every session, update at the end. If it is not written here, the next session does
not know it.

**Last updated:** 2026-10-17
**Phase:** Bootstrap done (playbook adopted) · position 00 ✅ · next 00b
**Status:** 🟡 Build plan v3 confirmed (D41); bootstrap PR open, waiting for CI and merge
**Next:** Merge the bootstrap PR on green CI → `/architect` position 00b (scaffold completion)

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

---

## 2. Blockers and risks

> Anything open here stops the related work. Do **not** guess and proceed. The B rows stay open until
> the owner supplies the answer (owner's standing instruction).

| # | Blocker or risk | Blocks | Mitigation meanwhile | Status |
| --- | --- | --- | --- | --- |
| B1 | ~~Target market~~ | — | — | ✅ RESOLVED 2026-08-17: both regions, one deployment (D14). Narrowed 2026-10-17: Turkey launches first, KSA later (D22) |
| B11 | 🔴 **Can an individual be a sub-merchant?** A business model check: if individuals cannot onboard, the provider structure changes | 02 (sub-merchant data), 08–12 | Evidence: iyzico's marketplace docs list three sub-merchant types including `PERSONAL`. Not confirmed: run it in the sandbox (S1) | ⏳ open, priority |
| B3 | **PSP facts.** Sandbox answerable: sub-merchant types and fields, callback signature scheme and event id, partial refund while unapproved, approval API shape. Must ask: max hold duration, real per-card fee (§7) | 08–12 | Design to the worst case: `psp_max_hold_hours` in `platform_settings` plus an invariant alert | ⏳ open; sandbox path available (S1, S2) |
| B4 | **Brand: theme, colours, fonts, logo, templates**, plus: Arabic capable font, dark mode in v1? | UI layer from 01 (structure can proceed on placeholder tokens) | Claude Design handoff expected around 2026-10-19 (S13) | ⏳ open |
| B5 | **Pricing formula specifics** per category: questions, types, options, base price, modifiers | 03 content, G3 | The engine is generic; build it against test fixtures, never invented data | ⏳ open |
| B6 | **Launch categories** and each one's questions | 03 content, G3 | Same as B5; start with one worked category (home cleaning) | ⏳ open |
| B2 | **Legal sign off on the custody model**: the platform never holds funds and needs no licence | G3 | None; owner track S16 | ⏳ open |
| B9 | **Professional confirmation of the agent position (D12)** | 20 (invoicing), refund fee absorption, G3 | D20 keeps the ledger shape neutral, so the money core is not blocked | ⏳ open, narrowed 2026-08-18 |
| B10 | **Legally authoritative language** for T&C and provider agreements | T&C copy, provider signup, G3 | None; owner track S16 | ⏳ open |
| B7 | **Public quality claim wording**, backed by a computed rate or verifiable criterion | Public copy, 19 | Ship no claim until decided | ⏳ open |
| B8 | **Legacy provider job counts and past customer list** for the reputation migration | 19 (Q9) | Not in P0 | ⏳ open |
| R1 | **Remote projects not created yet; wrong accounts signed in.** The Supabase, Vercel, Sentry, and PostHog projects for Aldebyani do not exist yet (owner, 2026-10-17). The Supabase CLI sees only `alqafila` and the claude.ai connector only `Jawla` (other work); the old ref `syrhavojjpabwwcaezee` in `supabase/.temp` is unverified | Any cloud push, connector use, previews (G0) | The owner creates the projects (S3, S6, S7, S8), then connects the right accounts. Before any push, `npx supabase projects list` must show the Aldebyani project as linked. Each connector stays off limits until it shows the Aldebyani project | ⏳ open |
| R2 | **Deadline.** P0 is 16 positions in 19 days; owner tracks are on the critical path | Launch date | Cut list decided in advance (`build-plan.md`); replan honestly at each gate | ⏳ watching |
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
| D43 | 2026-10-17 | **Navbar wordmark font: Archivo Black** (OFL), self hosted through `next/font/google` (no third party requests at runtime), the closest free match to the logo's heavy grotesque. Replaced by an SVG wordmark only if the owner supplies one. Built with the app shell in position 01 | Owner | ui-tokens §10 |
| D42 | 2026-10-17 | Priority line confirmed (D35): correct money and private data > core journey end to end in three locales > design polish > extra features | Owner | `AGENTS.md`, project-overview §1 |
| D41 | 2026-10-17 | **Build plan v3 confirmed as drafted**: 22 positions (16 P0), gates G0–G3, the cut list, the target schedule to 2026-11-07. Bootstrap ships as branch `chore/playbook-bootstrap` + PR | Owner | `build-plan.md` |
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
| D22 | 2026-10-17 | **Launch 2026-11-07, Turkey only.** KSA stays in the schema, switched off, until a Saudi PSP is chosen (no evidence iyzico supports SAR or Saudi sub-merchants) | Owner | project-overview §1, architecture regions |
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
| Q11 | **Brand assets (D40).** (a) Put the logo source file in `docs/design/brand/` (an attached chat image cannot be saved by the agent) so the favicons can be generated; ~~(b) wordmark font~~ → Archivo Black (D43); (c) the Arabic spelling of the name, and whether the slogan is translated in `ar`/`tr` | Favicon, `messages` brand strings |
| ~~Q1~~ | ~~Confirm the priority line~~ → resolved by D42 | — |
| Q4 | **Sign in channel at launch.** Email OTP through Resend SMTP (no extra cost; recommended for the 3 weeks) or phone SMS OTP (needs a paid SMS provider; D16 assumed phone identity). Asked again in the 01 spec interview | Spec for 01 |
| Q5 | **Sentry and PostHog data region:** EU (recommended: nearest to TR, GDPR grade) or US | S7, S8, 00b |
| Q6 | **Region for the new Supabase project** (S6). Recommended: `eu-central-1` (Frankfurt), nearest to Turkey; Vercel functions then pin to `fra1` | S6, 00b |
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
| S3 | **Vercel.** vercel.com → Add New → Project → import `Moaz-Allam/asma`, name it `aldebyani` → framework Next.js, Node 24 → add env vars for Preview and Production (names from `.env.example`) → stay on Hobby until G3 | Preview checks, region pin (00b) | G0 | ☐ |
| S4 | **Domain and DNS.** Buy the domain (Cloudflare Registrar sells at cost; it does not sell `.com.tr` or `.sa`) → DNS in Cloudflare → add it to Vercel with DNS only (grey cloud) records → tell me the name | Wires `appOrigin()`, Resend, Turnstile hostnames | S5, S9, G3 | ☐ |
| S5 | **Resend and Supabase SMTP.** Resend → Domains → add the sending domain → add its SPF, DKIM, DMARC records in Cloudflare → verify → create a sending only API key → Vercel env and `.env.local` as `EMAIL_API_KEY` → turn off open and click tracking. Supabase → Authentication → SMTP settings → Resend SMTP (`smtp.resend.com`, port 465, user `resend`, password: an API key) with a `no-reply@` sender. Supabase's built in email only reaches project team members | Email OTP (Q4), position 13 | 01, 13 | ☐ |
| S6 | **Create the Supabase project, then connect the right accounts (R1).** supabase.com → New project `aldebyani` in your own org, Pro plan, region per Q6 → `npx supabase login` with that account (unset any `SUPABASE_ACCESS_TOKEN` that points at another account) → `npx supabase link --project-ref <new ref>` → `npx supabase projects list` must show it as linked. For the MCP: a **scoped** personal access token limited to that project; set `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF` in your shell profile. Reconnect the claude.ai Supabase connector to that org. **Same rule for every service:** connect the account that owns the Aldebyani project (Vercel team S3, Sentry org S7, PostHog project S8) before anything uses it | Verifies each link read only; updates `AGENTS.md` and the tracker with the new refs | Any cloud push, previews (G0) | ☐ |
| S7 | **Sentry.** sentry.io → organisation (region per Q5) → project `aldebyani`, platform Next.js → keep the DSN ready → create an org auth token for source maps (Vercel env only) → tell me the org and project slugs | 00b wires it | 00b, G1 | ☐ |
| S8 | **PostHog.** Sign up (cloud per Q5) → project `aldebyani` → keep the project API key and host ready → session replay: mask all inputs on; autocapture off for now | 00b wires it | 00b | ☐ |
| S9 | **Turnstile.** Cloudflare → Turnstile → Add widget → hostnames: your domain and `localhost` → Managed mode → keep the site key and secret ready | 01 wires it | 01 | ☐ |
| S10 | **Uptime monitor** (Q3): an HTTP monitor on `/api/health` of the production URL, every 5 minutes or faster, alerting your phone and email | Verifies at G1 | G1 | ☐ |
| S11 | **Docker Desktop** (optional): install and start it so `npm run db:test` and `npm run test:e2e` run locally. CI runs both regardless | — | Local runs only | ☐ |
| S12 | **Import the brief.** Put the original brief files (the `.docx` / `.xlsx` that used to be in `context/docs/`) into `docs/brief/`, or tell me where they are | Converts them with numbered sections | Precedence level 4 | ☐ |
| S13 | **Design handoff (B4).** Export the Claude Design screens, logo, colours, fonts into `docs/design/` and say which screen is which page | Records tokens with a contrast table; maps screens | UI layer from 01 | ☐ (~2026-10-19) |
| S14 | **Branch protection.** GitHub → Settings → Branches → rule for `master`: require the `checks`, `database`, `e2e` jobs; block force pushes | — | Protects merges | ☐ |
| S15 | **Close the stale dependabot PR** (TypeScript 5.9.3 → 7.0.2; CI rejected it) | — | — | ☐ |
| S16 | **Legal (B2, B9, B10).** Custody confirmation; agent position; authoritative language; T&C (the service contract is customer to provider; we are intermediary and payment facilitator), privacy notice (KVKK), provider agreement with a data processing clause | Builds the legal pages | G3 | ☐ |
| S17 | **Catalog data (B5, B6).** Launch categories; per category: questions (key, type, options, required, validation), labels in `ar`/`tr`/`en`, base price, modifiers, zones and multipliers; TR commission %, unlock fee, windows. Start with home cleaning | Seeds through admin UI, never invented | 03 content, G3 | ☐ |
| S19 | **Fix `.env.local`.** `npm run dev` stops at boot: its `SUPABASE_DB_POOL_URL` lacks `pgbouncer=true`. Delete that line (it is optional now, D38, and the old project is unverified), or correct it once the new project exists (S6). The agent cannot read or edit this file, by design | Re-runs the dev server preview | Local `npm run dev` | ☐ |
| S18 | **Claims and legacy data (B7, B8).** The public quality claim and how it is computed; legacy provider job counts and the past customer list | 19, public copy | 19 | ☐ |

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
| 13 UI docs and design reference mapping | ✅ docs exist · ☐ mapping (S13) |
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
| Guard suite (`npm run guardrails`) | 🟢 | 2026-10-17 | 41/41, including false positive cases |
| Typecheck, lint, `lint:rtl`, format check | 🟢 | 2026-10-17 | Lint includes the single door rules |
| Unit (Vitest 5) | 🟢 | 2026-10-17 | 127 tests in 10 files, about 4s |
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
