# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your
training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed
deprecation notices.

# AGENTS.md — Aldebyani

v3, 2026-10-17, rewritten as the entrypoint when the project adopted `docs/engineering-approach.md`.

**Aldebyani** (slogan: **Aldebyani Home Care**; repo codename `asma`; D40) is a home services marketplace: a customer posts a request, providers apply free, the customer
picks one and **pays first** into escrow held by a licensed PSP, then the **chosen provider pays an
unlock fee** to see the customer's details, the work happens, and the funds are released. Revenue is
the unlock fee plus commission. **We never hold funds.** Three locales (`ar` RTL, `tr`, `en`), two
regions (TR, KSA) in one deployment, separated by a `region` column.

Launch **2026-11-28, Turkey only** (iyzico Marketplace; replanned 2026-10-28, D65). KSA stays in the schema, switched off until a
Saudi PSP is chosen. Priority (owner confirmed, D42): **correct money and private data > the core
journey working end to end in all three locales > design polish > extra features.**

Product brief: `docs/brief/` (not imported yet, owner step S12). Until then the product sections of
`context/project-overview.md` stand in for it.

## Status

- 2026-08-18 · **00 scaffold** ✅ (specs 0001, 0003): Next 16, three locales, `proxy.ts`, env schema,
  Supabase clients, `regions` + `platform_settings` with RLS and pgTAP. CI green. Cloud projects exist
  since 2026-10-18 (Vercel `aldebyani`; Supabase org `aldebyani`, project `lrejqpcgsugjiijuakoq`,
  eu-central-1); no migration pushed yet; the remaining account steps are in R1.
- 2026-10-17 · **Playbook bootstrap** done: docs layout, harness, review agents, quality tooling.
  Verified locally (verify, build, e2e 6/6). Build plan v3 confirmed (D41). Merged (PR #17).
- 2026-10-25 · **Design handoff imported** (PR #18; S13, B4 closed, D48–D61): `docs/design/` (source,
  53 screens, tools), the UI context rewritten from it, the write guard hardened. Tokens and fonts land
  in `app/globals.css` with the first UI position.
- 2026-10-28 · **Replanned** (D65): launch 2026-11-28, same scope; EU data regions (D62). Next:
  `/architect` 00b, G0 by 2026-10-30.
- 2026-10-28 · **00b built** (spec 0004, D74–D78) on `feat/00b-scaffold-completion`: Sentry and PostHog
  doors, nonce CSP, `/api/health`, flags, alerts; migration applied to the cloud. Open: preview proof,
  alert rules, dashboard settings, G0.

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
| App | `next` 16.4.3 · `react` / `react-dom` 19.2.8 · `typescript` 5.9.3 | TS 7 failed CI (dependabot PR). `next` 16.4.3 (2026-10-28, D66): 16.3.1 had critical unauthenticated remote code execution advisories |
| i18n | `next-intl` 4.13.7 | |
| Data | `@supabase/supabase-js` 2.112.3 · `@supabase/ssr` 0.12.4 · `server-only` 0.0.1 | |
| Errors, traces, logs | `@sentry/nextjs` 10.75.2 (brings `@sentry/cli` 2.58.6) | Spec 0004 AC-20: the lowest version with Turbopack source map upload and Sentry Logs with `beforeSendLog`, raised to the first one clear of the critical tunnel advisory GHSA-mchm-gjx6-7h55 (every 10.x below 10.75.2). Released 2026-09-22. Owner choice 2026-10-28. Imported only in `lib/observability/` |
| Analytics | `posthog-js` 1.418.11 | Spec 0004 AC-20: the lowest version with every option we set plus the fixes for a relative `api_host` proxy (scripts added several times) and the cookieless id leak. Released 2026-08-24. Owner choice 2026-10-28. Imported only in `lib/analytics/` |
| Validation | `zod` 4.6.7 | Below 4.6.6, oversized constrained collections can exhaust memory (advisory, D66) |
| Styling | `tailwindcss` + `@tailwindcss/postcss` 4.3.3 · shadcn/ui CLI deferred | B4 resolved 2026-10-25 (D48). shadcn init writes its own palette: run it only after the tokens land in `app/globals.css` (`ui-tokens.md` §13), and map its names to ours |
| Lint | `eslint` 9.39.5 · `eslint-config-next` 16.4.3 · `typescript-eslint` 8.67.0 | ESLint 10 crashes eslint-config-next's react plugin; held at 9 (dependabot ignores ≥10) |
| Format, pre commit | `prettier` 3.9.9 · `husky` 9.1.7 · `lint-staged` 17.6.0 | Owner pinned |
| Unit tests | `vitest` 5.0.5 · `fast-check` 4.10.2 | Owner pinned vitest (5.0.5 for an advisory in `@vitest/mocker`, D66); fast-check for money property tests |
| End to end | `@playwright/test` 1.63.0 · `@axe-core/playwright` 4.13.0 · override `playwright-core` 1.63.0 | Owner pinned Playwright; axe 4.14.0 was 2 days old; the override stops axe's open peer range pulling a second `playwright-core` |
| Database tests | `supabase` CLI 2.114.0 (pgTAP via `supabase test db`) | |
| Types | `@types/node` 26.2.0 · `@types/react` 19.2.18 · `@types/react-dom` 19.2.4 | |

**Services** (accounts are owner steps; no SDK is installed until its position's spec says so):
Supabase (org `aldebyani`, eu-central-1; Free until launch, then Pro, D63) · iyzico Marketplace (TR) ·
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
| `npm run test:e2e` | Playwright through `scripts/e2e.mjs`: local Supabase, 390px, `ar` + `tr` + `en` |
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
2. Customer PII is visible only when a `paid` row exists in `unlock_fees` for that `(request, provider)`
   (`FUNDED` is not enough), and no provider ever reads another provider's data. RLS, never React.
3. No external call in a request path: DB transaction → `outbox_events` → relay → PSP. The relay is the
   only mutating caller of `lib/psp`. Money state changes only on verified PSP facts, never a redirect.
4. Money is integer minor units. No float, no client side money arithmetic, one rounding step.
5. `ledger_entries` and `ratings` are append only (`UPDATE`/`DELETE` revoked). Corrections are new postings.
6. Every money operation is idempotent, atomic, and balanced. Deterministic keys from domain ids, a
   replay returns the stored response, balances never go negative, held funds leave exactly once,
   and commission is its own ledger leg.
7. RLS enabled + policy + negative test in the same migration and commit as the table.
8. Never execute an admin authored string (`eval`, `new Function`). Formulas are structured rows.
9. The platform never holds user funds. No top up, no stored balance; `FEATURE_STORED_BALANCE_WALLET` OFF.
10. Three locales, two regions, by construction: direction from the locale, logical properties,
    semantic tokens, no hardcoded strings, region from the owning row, no Turkish case folding of ids.
11. `proxy.ts`, never `middleware.ts`. `requireRole()` runs inside every Server Action and Route Handler.

**Lifecycle:** `OPEN → SELECTED → FUNDED → UNLOCKED → IN_PROGRESS → AWAITING_CONFIRMATION → RELEASED`.
`FUNDED → OPEN` when the provider misses the unlock window: funds stay held, the customer re-selects
without paying again (max 3, then full refund). Every path out of `FUNDED` ends in exactly one of
released, refunded, partially released.

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
  is touched where the spec is silent; holding funds or a top up is implied; PII would show before
  unlock or across providers; an RLS policy would be weakened; a money operation cannot be idempotent
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
(architecture.md §42). A file named `*relay*` gets the outbox relay's rights (PSP, service role), so no
other module may be named that way.

| System | Door | Notes |
| --- | --- | --- |
| Supabase | `lib/db/` | The service role client (`lib/db/admin.ts`) for webhooks, jobs and the relay only; `createAnonClient()` for machine endpoints; the `Db` type for callers |
| PSP | `lib/psp/` | Only the outbox relay calls it (rule 3) |
| Sentry | `lib/observability/` | `next.config.ts` may import only `withSentryConfig` from `@sentry/nextjs/config`. Server: `initServer`, `captureRequestError`, `log`, `raiseAlert`; browser: `initClient`, `reportClientError`, `routerTransitionStart`; routes: `createEnvelopeForwarder` (`/api/e`), `createCspReportForwarder` (`/api/csp`) in `forward.ts` (D83). One scrubber (`scrub.ts`) for every signal, CSP reports included |
| PostHog | `lib/analytics/` | `initAnalytics`, `track`, `trackPageview`; events typed in `events.ts`, filtered again in `filter.ts`; route: `createPostHogForwarder` (`/api/a/*`) in `forward.ts` (D83) |
| Telemetry keys | the two doors, `lib/env.ts`, `lib/deployment.ts`, `next.config.ts` | `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_POSTHOG_KEY`; `SENTRY_AUTH_TOKEN` in `next.config.ts` only. Others ask `sentryDsn()` or `posthogKey()` |
| Public machine endpoints | `app/api/health`, `app/api/e`, `app/api/a/[...path]`, `app/api/csp` | No session, so no `requireRole()` (D71, D83); position 01's action guard meta test exempts exactly these by name |

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
| `launch.json` | `asma-dev`: `npm run dev` on port 3000, for previews in the built in browser |

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

**Cloud accounts (rechecked 2026-10-28, R1):** the Vercel project `aldebyani` and the Supabase org
`aldebyani` exist, and so do the Sentry org and project `aldebyani` and the PostHog EU project `aldebyani`. The Supabase CLI
is linked to `lrejqpcgsugjiijuakoq` but still logged in to another account: log in with the `aldebyani`
account before any push. The old ref `syrhavojjpabwwcaezee` is retired.

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
