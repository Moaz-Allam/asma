<!-- Imported verbatim on 2026-10-17 from the owner's chat message. Do not edit the body:
     it is the general methodology this project follows (precedence level 8, the lowest).
     Project specific choices live in AGENTS.md and context/. -->

# AI Assisted Build Playbook

Oct 17, 2026 · @moza

## 1. Purpose and how to use this playbook

This playbook turns the way Leal (a tourism booking marketplace) was built with Claude Code into a repeatable workflow for any product: a SaaS tool, a health app, a fintech ledger, an internal tool, a game backend. The product changes; the system around it (context docs, rules that never bend, specs, skills, hooks, guards, agents, MCP connectors, tests, gates, UI system) stays the same.

**Who it is for:** a solo owner or a small team that directs an AI coding agent, makes the business decisions, and wants production quality without a large engineering staff.

**What it proved on Leal (2026-09-26 to 2026-10-17):**

| Measure | Result |
| --- | --- |
| Build positions shipped | 00 scaffold to 06a discovery (8 merged PRs), plus specs for 07 to 11 |
| Specs written | 9 (0001 to 0009), every one cross checked by a second model before acceptance |
| Database tests (pgTAP) | 657 passing, including two-session race tests for overselling |
| Unit tests (Vitest) | 615 passing |
| End to end journeys (Playwright) | 19 passing at 390px in English and Arabic |
| Independent reviews | Slice and security reviews at every merge; gate G1 security review before payments went live |
| Rules that never bend | 11, each enforced at the lowest layer that can enforce it |

**How to use it:**

1. Read sections 2 to 5 once. They are the mental model: priorities, the context system, rules, and the build plan.
2. Use section 20 as the step by step bootstrap for your new project. It points back to the detailed sections.
3. Copy the templates in section 21 into the new repository and fill them in for your domain.
4. Read section 22 (lessons and pitfalls) before you start. Every item there cost real time on Leal.

**What is generic and what is Leal specific:** every section states the general rule first, then shows how Leal applied it. Leal examples (seats, holds, EGP, XPay, Arabic) are illustrations. Replace them with your domain's equivalents; keep the structure.

## 2. Core philosophy

The agent writes most of the code; the system decides whether that code is correct. Every principle below exists because an unguided agent fails in a predictable way.

**2.1 One written priority order.** Leal's was "working transactions > perfect design > advanced features". Write yours in one line at the top of `AGENTS.md`. Every trade off (cut a feature, simplify a screen, skip an animation) is settled by it without a meeting.

**2.2 Scope rule.** Anything not in the product brief is asked about before it is built. The agent proposes; the owner decides; the decision is logged. On Leal this caught additions in both directions: the owner added a display currency and an agency listing page (logged as overrides), and the agent was stopped from inventing features the brief excluded.

**2.3 Rules that never bend.** A short, numbered list of correctness invariants (Leal had 11), each with a one line reason, each enforced at the lowest layer that can enforce it: database constraint or function, then server code, then review. A change that breaks one is a bug even when every test passes. Section 4 shows how to derive them for any domain.

**2.4 Spec first.** No code for a capability without a spec that records the decisions: acceptance criteria, data model, interface, value sources, security model, build plan. The spec is the contract the build is checked against. Section 6.

**2.5 Tracer bullets, strict order.** Build one thin capability at a time, end to end through every layer (migration, access rules, data layer, logic, server action, UI), tested at each layer, before starting the next. Never batch several half built features. Section 5.

**2.6 Tests first on risky paths.** Name the risky paths explicitly (access control, money, concurrency, state machines, callbacks, audit). Those get a failing test before the code. Everything else lands tests with the code.

**2.7 Enforcement beats instruction.** A sentence in `AGENTS.md` can be ignored; a hook, a lint rule, a database guard, or a CI check cannot. Whenever a rule matters, find the layer that makes breaking it impossible, not just discouraged.

**2.8 Independent judgment.** The session that wrote the code never grades its own work alone. Specs get a cross check from another model; slices get a fresh context review; security sensitive gates get an adversarial review.

**2.9 Stop and ask.** The agent stops when: something is not in the brief, a rule would bend, two documents disagree and the precedence order does not settle it, a decision has no spec, a value the feature must show has no named source, or anything touches money, auth, or personal data where the spec is silent. It never picks silently.

**2.10 Living documents.** Docs are updated in the same change that makes them stale. A stale rule is worse than no rule: it is confidently wrong from the first message of every session.

## 3. Repository layout and the context system

The agent starts every session with no memory. The context system is how it learns the project in a few thousand tokens, in the right order, without reading everything.

**3.1 The layout.**

```
AGENTS.md                  entrypoint, tool agnostic (auto loaded)
CLAUDE.md                  one line: @AGENTS.md
context/
  project-overview.md      what we build, actors, core flow, rules that never bend, stop and ask, doc map
  progress-tracker.md      current state, blockers, decision log, open questions, owner checklist
  build-plan.md            how to work, build order (positions), gates, parallel tracks
  architecture.md          trust boundaries, single doors, data model, state machines, per position sections
  code-standards.md        testing, tests first list, naming, boundaries, per position conventions
  ui-tokens.md             raw design values only
  ui-rules.md              how tokens compose into surfaces
  ui-registry.md           every built component, checked before creating one
docs/
  brief/                   the owner's product brief, imported verbatim
  specs/NNNN-title/        one decision each: index.md (build spec) + rationale.md
  reviews/                 dated review and verify reports
  design/                  reference screenshots, brand masters, mapping README
  engineering-approach.md  the general methodology (this playbook's parent)
.claude/
  settings.json            deny and ask permission rules, hook wiring
  hooks/                   guard-bash.mjs (+ test), format-on-write.mjs
  agents/                  slice-reviewer.md, security-reviewer.md
  skills/                  vendored, reviewed, pinned community skills
  launch.json              dev server preview config
```

**3.2 `AGENTS.md`, the entrypoint.** Tool agnostic, so any agent can use it; `CLAUDE.md` is a one line pointer (`@AGENTS.md`). It holds, in this order: one paragraph on the product, launch date and priority order; a dated status line per position; the pinned stack table (exact versions); the commands table (only commands that exist); where to read what; a summary of the rules that never bend (the canonical text lives in `project-overview.md`); how we build; the harness tooling; model and effort posture; the skills inventory (used, overrides, declined with reasons); MCP connectors and their gates; git conventions. Keep it lean: every line must change what the agent would otherwise assume. Delete a line the moment it stops being true.

**3.3 Read order.** `AGENTS.md` (auto) → `project-overview.md` → `progress-tracker.md` → the current position's spec → only the one context doc the task needs. Write "Do not read every doc" explicitly; agents otherwise load everything and burn context.

**3.4 Precedence when documents conflict** (highest first):

1. Rules that never bend (`project-overview.md` §4)
2. The progress tracker's decision log (a recorded owner decision beats a general rule)
3. The spec being built, for its own feature
4. The product brief
5. `architecture.md`
6. `code-standards.md`, `ui-tokens.md`, `ui-rules.md`
7. Build plan task wording
8. The general methodology doc

A context doc that contradicts the brief with no decision log entry explaining why is a bug in the context doc. Not settled by this order: stop and ask.

**3.5 Version stamps.** Every standing document opens with `v2, 2026-09-26, rewritten from the pilot brief` style lines, so anyone can tell how fresh it is.

**3.6 Per position sections.** `architecture.md` and `code-standards.md` grow one section per shipped position ("Departures and live seats (position 03, spec 0004)"). Each section is written by the position that introduced the pattern, so the next position inherits a concrete precedent instead of re-deciding it.

**3.7 Nested `AGENTS.md`.** When an area grows its own conventions (payments, auth, email), put them in `src/<area>/AGENTS.md`, loaded only when working there, with a one line pointer from the root. Keep project wide rules at the root.

## 4. From product brief to rules that never bend

The brief says what the business wants; the rules say what can never go wrong. Derive the second from the first before any code exists.

**4.1 Import the brief verbatim.** Put the owner's brief in `docs/brief/` unchanged and number its sections so every later doc can cite "brief §12". The brief is precedence level 4: specs and the decision log can override it, but only explicitly.

**4.2 Write `project-overview.md`** with six parts: (1) what we are building, launch date, in scope test ("a feature is in scope only if it directly helps sell, operate, or learn"); (2) actors table (who, account or not, what they can do); (3) the core flow in one line of arrows; (4) rules that never bend; (5) when to stop and ask; (6) document map with read order and precedence.

**4.3 How to derive the rules for any domain.** Walk the brief with these seven questions. Each "yes" becomes a numbered rule with a one line "why".

| Question | Leal rule it produced | Equivalent in other domains |
| --- | --- | --- |
| Can we sell or allocate something we do not have? | 1. Never oversell: available = allocated − confirmed − active holds, atomic in the database | Appointment double booking, inventory below zero, a ledger going negative, seat or license over allocation |
| Can a number the user sees or pays be invented or tampered? | 2. Nothing sold is invented: price and totals computed on the server and snapshotted | Invoice totals, dosage calculations, grades, quotas, scores |
| Who must never see whose data? | 3. Private data stays private via row level security and private storage | Patient records, tenant isolation in B2B SaaS, student data, salaries |
| Which external systems are risky or likely to change? | 4. One door per risky system (payments, service role key, email, AI), lint enforced | Any SDK with credentials: SMS, storage, LLM provider, KYC vendor |
| Which records have their own life cycle? | 5. Booking, payment, refund, settlement are separate records with fixed state sets | Order vs shipment vs invoice; claim vs payout; enrollment vs payment |
| What must stay manual or configurable for legal reasons? | 6. No automatic payouts; commission is config, never a literal | Approval steps, fee rates, tax rates, feature flags for regulated actions |
| What must be traceable afterwards? | 7. Consequential operations audited in the same transaction | Clinical edits, permission changes, financial adjustments |

Leal added four more after the first security pass, a pattern worth copying for any product handling money or personal data: (8) only verified payments confirm, never a browser redirect; (9) access without an account needs an unguessable token, never a reference alone, and failed checks are rate limited; (10) secrets never reach the client; (11) user written content is always rendered escaped.

**4.4 Rule format.** Number, bold one line statement, the precise mechanism (formula, where enforced), then *Why:* with the brief section. Refer to rules by number everywhere else ("rule 3"). Keep 6 to 12; more than that and they stop being memorable.

**4.5 Enforce each rule at the lowest layer.** Database constraint or function or row level security > server code > UI > review. Name the enforcing artifact in `architecture.md` and prove it with a test (section 13). If a rule cannot be enforced below review, say so in the rule.

**4.6 Candidate rules.** When review finds a new invariant, record it as a candidate in the decision log, ask the owner, then promote it into §4. Never add a rule silently.

## 5. The build plan: positions, slices, gates

`context/build-plan.md` is the authoritative order of work. It is ordered by the brief's priority list, sliced into tracer bullets, and confirmed by the owner before position 01 starts.

**5.1 The tracer bullet unit.** One user capability, end to end, through every layer it needs, in this order:

1. Migration (schema)
2. Access rules (row level security) plus database functions, constraints, and triggers for anything rule bearing
3. Data layer (typed queries against generated types)
4. Business logic (pure, unit testable)
5. Server action or route handler (validated input, never trusts client values)
6. UI from tokens and rules, in every supported language, checked at phone widths first

Each layer has tests. A slice that skips a layer says so in its spec. Redefine the unit for your domain (for a CLI: command parser → core logic → output; for a data pipeline: source → transform → sink → report), but keep "thin and complete".

**5.2 The build order table.** Columns: `#` (position id), position (one capability, end to end), brief sections, priority (P0, P1, P2), spec link, status (☐ or ✅ with date and PR). A row is checked only when its spec's acceptance criteria are met, never when the code compiles.

**5.3 Position 00 is always the scaffold**: tooling, local database, CI, lint enforced doors, design tokens and brand config, locale routing, analytics and error reporting basics, a placeholder page, preview deployments. It has its own spec and its own gate.

**5.4 Splitting.** A position too big for one slice becomes lettered positions (`02a`, `02b`), each complete and tested. Leal split 02 (sell a trip / extras), 06 (discovery / currency), 08 (agency pages / verification). One spec can cover several positions (spec 0004 covered 03 to 05) when they share a data model.

**5.5 Each position adds its own write path.** Its insert, update, and delete policies and grants live in that position's migration. No position inherits write access a slice did not earn. This is how access control stays reviewable.

**5.6 Gates.** Checkpoints with explicit checks, run in a fresh context:

| Gate | After | Checks |
| --- | --- | --- |
| G0 | Scaffold | All scaffold acceptance criteria on a clean clone; CI green; preview URL serves the placeholder |
| G1 | The core money or data path | Main journey works end to end on a phone in every language; the related brief test scenarios pass automated; error monitoring live; uptime alert live; independent security review |
| G2 | All P1 operations | Remaining brief tests pass; second independent review; admin two step login |
| G3 | Launch | Launch criteria met with real data; production wiped of test data; staging created; paid plan limits rechecked |

**5.7 Cut list and deadline pressure.** Name the order of cuts in advance (Leal: comparison first, then the verified badge), and the rule "cut P2, then P1, never P0 reliability". Deciding cuts under pressure leads to cutting the wrong thing.

**5.8 Parallel tracks.** Non code work the owner runs alongside the build, each with what it blocks: payment contract and legal structure, content and real data, final logo, native speaker copy review, legal research for verification fields, phone numbers.

**5.9 Target schedule.** A day by day target, explicitly "a target, not a limit", with owner steps per day. Record the realistic pace observed (Leal: about one position per working day including spec, migration, tests, UI, review) and replan honestly when it slips.

## 6. Specs: how a decision becomes a build contract

Every position gets a spec written with `/architect` before any code. The spec is what `/develop` builds, what `/check verify` checks, and what reviewers compare the diff against.

**6.1 Shape.** `docs/specs/NNNN-kebab-title/` with two files. `index.md` is the build spec: Summary, Requirements (user stories and IDed acceptance criteria), Decision, Feature design, Build plan, Consequences, Follow-up, and a one line pointer to the rationale. `rationale.md` is the decision record the builder skips: Context, Options considered (2 to 4, each with real cons), Rationale, the owner's answers, "calls made without asking", the cross check summary, and evidence of what existing code was read. A small decision may be one file.

**6.2 The interview (staged, one dimension at a time).** Never present a finished design for a yes or no. Ask each real choice as its own multiple choice question, with exactly one option marked recommended and a one line tradeoff, batched up to four per round:

1. Requirements: core job, happy path, rules and limits, failure cases. Acceptance criteria are derived from the answers.
2. Data model: entities, then fields, then relationships, then constraints. Show the assembled model as a table and get an explicit confirm.
3. Stack and tools: only layers the existing stack does not settle.
4. Interface: every endpoint or action, inputs, outputs, auth, errors.
5. Security and authorization, rule by rule.
6. Edge cases and failure modes, one at a time.

Sort every dimension: INFER (the code or docs already say it; state it back), ASK (only the owner knows), RECOMMEND (expertise settles it; decide and record it under "calls made without asking"). A short interview is a red flag.

**6.3 Read the code first.** Before the interview, read the brief sections, the migrations and modules the feature touches. On Leal this found, before any question was asked, that agencies could read nothing, that a table was granted whole to a shared role, and that a guard refused all non admin writes. Those facts reshaped the options.

**6.4 Acceptance criteria.** Numbered `AC-1` …, each observable and independently checkable, with exact copy, limits, orderings, widths, and error messages. Group them by slice. Every AC maps to at least one build task and every task to an AC.

**6.5 Value sourcing table.** For every value an action produces, computes, or displays, name its source: an input, a column, a derivation, or a prior spec. A value with no source is an undecided input, resolved now. This single table removed most "the builder invented it" bugs (for example where "today" comes from: database clock, server clock, or browser).

**6.6 Feature design fields (all required).** Data model sketch; state transitions; API surface table (endpoint, method, inputs, outputs, auth, errors); value sourcing; key invariants; security model; configuration required; critical test scenarios mapped to ACs.

**6.7 Build plan inside the spec.** Ordered tasks, tests first on risky paths, one migration per slice, each task tagged with its ACs, ending with a docs task.

**6.8 Cross check by a second model (always offered).** A read only subagent on a different model reads the finished spec plus the real code it names and returns: decision completeness gaps (values with no source, decisions the builder would invent), claims that do not match the code, and soundness issues, each with severity and a recommended fix. The owner then picks "apply all recommended", "answer each", or "leave". On Leal, every cross check found 15 to 25 gaps, including blockers: a helper that did not exist, guards that would refuse the planned write, a clock change bug, a page that would crash on free text.

**6.9 Status.** Proposed → Accepted (ratified by owner, dated). Superseded by NNNN when replaced. Assumed when the builder had to go ahead on an undeliberated choice; only `/architect` clears it.

**6.10 Amend in place.** When a build or review changes what a spec says, edit the spec in the same change, add a dated note in `rationale.md`, and log it. A spec that disagrees with the code is a bug.

## 7. The workflow skills

Skills are encoded process: a slash command that loads a tested procedure instead of a fresh improvisation each session. Leal used user level skills (in `~/.claude/skills/`, shared across projects) for the workflow, and project skills (in `.claude/skills/`, committed) for vendor knowledge.

| Skill | When | What it does | Writes |
| --- | --- | --- | --- |
| `/audit` | Greenfield or an undocumented codebase, once | Bootstraps `AGENTS.md` and context files, adding only what is missing | `AGENTS.md`, `CLAUDE.md` pointers |
| `/architect` | Before every position, and whenever a load bearing decision is unmade | Staged interview, recommends, writes the spec, offers the cross check | `docs/specs/` only |
| `/develop` | Building a position from its accepted spec | Reads spec and `AGENTS.md`, builds layer by layer, stops and routes to `/architect` if a decision is missing | Code, migrations, tests |
| `/test` | After code changes | Writes the suite per file: happy path, edge cases, errors, accessibility; honors the tests first list | Tests |
| `/debug` | A failure with an unclear cause | Reproduce → localize → hypothesize → test → minimal fix → verify, then hands a regression test to `/test` | Minimal fix |
| `/check verify` | After `/develop` | Drives the real app against every AC, every surface, every width and language | `docs/reviews/` |
| `/check review` | Before merge and at gates | Senior code review on a different model than the author | `docs/reviews/` |
| `/sync` | After a change merges | Updates `AGENTS.md` status, flags stale specs, reconciles docs with repo evidence; surgical edits only | Docs |
| `/document` | PR text, changelog, release notes, postmortems | Drafts from the real commits and diff | PR body, changelog |
| caveman (plugin) | Optional, chat only | Terse chat output to save tokens; never applied to code, commits, or docs | Nothing |

**7.1 The loop per position:** `/architect` → cross check → owner accepts → branch → `/develop` (tests first on risky paths) → `/test` → local checks (typecheck, lint, RTL lint, format, unit, database, end to end) → `/check verify` → fix with `/debug` → PR → CI green → `/check review` on a different model → fix findings → apply migrations to the cloud (owner asks) → merge → `/sync` → progress tracker updated.

&#91;embedded content: per position loop · 10 steps, 2 fix loops\]

A failed verify goes back to the build through `/debug`; review findings go back to the build before the PR can merge.

**7.2 Project overrides.** Each skill row in `AGENTS.md` has a "project override" column. Example: Leal does not use `/scope` because `build-plan.md` already owns the build order (open question Q1), and `/audit` must not run in bootstrap mode once `AGENTS.md` exists. Write these overrides down or the skill will happily create a parallel source of truth.

**7.3 Skill outputs live in fixed places.** Specs in `docs/specs/`, reviews in `docs/reviews/YYYY-MM-DD-<position>-<kind>.md`. A skill that writes outside its lane is a bug in the skill or its override.

## 8. Community and vendored skills policy

Vendor skills carry current best practice the model may not know. They also carry instructions you did not write. Treat them like dependencies.

**8.1 Before writing a skill, look for an official one.** Check whether each library or service you adopt (database, payments, email, bot protection, analytics) ships a skill. Install and review it rather than re-deriving practice from training data.

**8.2 Review line by line, then vendor.** Copy the skill into `.claude/skills/<name>/`, commit it, and record in `AGENTS.md`: source repository, pinned commit, date, license, what it is used for, and the project override. Leave out anything that runs code or handles secrets (scripts, installers, wizards) unless you have read it.

| Leal skill | Source, pinned | Kept | Left out or overridden |
| --- | --- | --- | --- |
| `supabase` | supabase/agent-skills @ `551274e` | Security checklist, CLI and docs lookup | Its "iterate with execute\_sql, then db pull" flow edits production through the connector; replaced by migration files. Ignore "create .mcp.json" |
| `supabase-postgres-best-practices` | same | Schema, RLS, indexes, locking | None |
| `resend` | resend/resend-skills @ `47e7098` | REST facts: send, idempotency, errors, domains | "Always install the latest SDK": the spec calls the REST API with fetch from one module; the fetch-all script left out |
| Turnstile reference | cloudflare/skills @ `a18ffe2` | One Next.js reference file | The wizard (creates widgets, handles secrets) left out: owner steps |

**8.3 Record declines with reasons**, so the question is not reopened every session. Leal declined: a PostHog instrumentation skill (generic, and its example sends user email to analytics, breaking rule 3); an exchange rate MCP server (publisher domain did not match the provider); a third party skill whose installer downloads and runs binaries; a hosting plugin that added SessionStart hooks injecting its own instructions and a telemetry hook on every skill call.

**8.4 Updating.** Re-review the diff between the pinned commit and the new one, then bump the pin in `AGENTS.md`. Never pull "latest" blindly.

**8.5 Red flags in any skill or plugin:** hooks that run on session start, telemetry, instructions to create config files that point at production, installers, "always use the latest", examples that send personal data to third parties.

## 9. The Claude Code harness: permissions, hooks, launch config

The harness is the layer the agent cannot argue with. Set it up in the first session, before any feature work.

**9.1 `.claude/settings.json`, deny rules.** Deny `Read`, `Edit`, and `Write` on every secret env file pattern, at the root and nested: `.env`, `.env.local`, `.env.*.local`, `.env.development`, `.env.production`, `.env.test`, `.env.staging`, `.env.preview`, `.env.keys`, `.env.vercel`, `.env.sentry-build-plugin`, and `**/` versions of the first three. Keep `.env.example` readable; it lists every variable name with no values. The owner says variable names in chat; values never enter the session.

**9.2 Ask rules.** Commands that publish, deploy, or change shared state ask first: `git push`, `vercel env`, `supabase db push` (both `npx` and bare), `gh repo`. Add your platform's equivalents (a cloud CLI deploy, a package publish, a DNS change).

**9.3 The bash guard hook** (`PreToolUse`, matcher `Bash|PowerShell`, `node .claude/hooks/guard-bash.mjs`). It reads the command JSON from stdin, splits it into segments on `;`, `|`, `&`, and newlines outside quotes, and exits with code 2 (block, reason shown to the agent) when any rule matches:

| Blocks | Why | Allowed instead |
| --- | --- | --- |
| Any segment naming a secret env file | Printing or copying secrets | `vercel env pull`, `test -f`, `ls`, `git check-ignore`, `git status` |
| Recursive `grep` over the repo root without `--exclude=.env*`; `rg --no-ignore` or `-uu` | Searches that print secret files | Search a subfolder, or plain `rg` (respects `.gitignore`) |
| `rm -rf` (and PowerShell `Remove-Item -Recurse`) on `/`, `~`, `.`, `..`, `*`, a drive root, `$HOME` | Wiping the machine or repo | Targeted paths |
| `git push --force` or `-f` or `+ref` (not `--force-with-lease`) | Rewriting shared history | Normal push |
| `git reset --hard origin/`, `git clean -fd` | Discarding work | Ask the owner |
| `DROP DATABASE`, `DROP SCHEMA`, `TRUNCATE TABLE` | Data loss | Migration files |
| `supabase db reset --linked` | Wiping the cloud database | Local reset without `--linked` |
| `vercel ... --prod` | Deploying around review | Production comes from merges to `main` |

Design choices worth copying: it errs toward blocking (a false positive costs a rephrase; a false negative leaks a secret); it scans the whole command, so a commit message that mentions a blocked phrase is blocked too (write the message to a file and use `git commit -F <file>`); unreadable input exits 0 so unrelated work is not blocked; it has its own unit test file (`guard-bash.test.ts`) run by `npm test`.

**9.4 The format hook** (`PostToolUse`, matcher `Edit|Write`, `format-on-write.mjs`). Runs the project's Prettier on the edited file if it is code (`ts`, `tsx`, `js`, `mjs`, `cjs`, `jsx`, `json`, `css`), best effort, never blocks, exits 0. Markdown is excluded so prose diffs stay clean.

**9.5 `.claude/launch.json`.** Named dev server configurations (`jawla-dev`: `npm run dev` on port 3000) so the agent starts previews through the harness, never via a background shell, and can verify UI in the built in browser.

**9.6 `settings.local.json`** for personal, uncommitted preferences only. Shared safety rules always live in the committed `settings.json`.

## 10. Subagents and independent review

A reviewer that shares the author's context shares its blind spots. Leal used three kinds of independent check, each read only, each with a fixed return format.

**10.1 `slice-reviewer`** (`.claude/agents/slice-reviewer.md`; tools Read, Grep, Glob, Bash; model Opus). Runs after a position is built, before merge. It reads `AGENTS.md`, the rules that never bend, the position's spec, then `git diff main...HEAD`, and checks: every AC (met, partial, missing, with file:line evidence); every rule the diff touches, enforced at the lowest layer; whether risky path tests would fail if the rule broke (flags happy path only tests); that the position grants only its own write access; scope creep against the brief; i18n, RTL, and mobile rules for UI. Returns Critical, Major, Minor, an AC table, verification gaps, and merge / fix then merge / rework.

**10.2 `security-reviewer`** (same tools, Opus). Runs at gates and on any PR touching auth, access rules, storage, inventory, payments, tourist access, secrets, or personal data. Its prompt is adversarial ("find what an attacker, a buggy client, or a race condition would exploit") and names the hunt list: access rule gaps, overselling, trusted client values, payment state from redirects, guessable access, secrets outside their door, abuse (hold flooding), web basics (validation, unsafe HTML, open redirects, uploads, CSRF). It must quote the code path before reporting. Returns confirmed vulnerabilities, likely issues, missing guardrails, and "checked and sound" so the owner knows the coverage.

**10.3 Spec cross check** (an ad hoc read only subagent, a different model from the author). Section 6.8. The prompt names the spec, the files to verify claims against, two jobs (decision completeness first, soundness second), a line cap, and "no praise".

**10.4 `/check review` on a different model.** Leal built with Opus and reviewed with Sonnet, so the reviewer does not share the author's habits. Reviews land in `docs/reviews/` with findings by severity and an outcome table after fixes.

**10.5 Rules for every review agent:**

- Read only: no edits; Bash only for `git` and inspection. The main thread applies fixes.
- Never read `.env*` files (repeat this in every agent prompt).
- Fixed output sections, one line per finding: `path:line — problem — fix`.
- Confirm against the actual code before reporting; an accurate mechanism with a wrong premise is not a finding.
- Severity levels are agreed in advance; the owner decides what to fix ("fix all", "fix majors", or each).

**10.6 Read only investigation helpers.** For large codebases, a cheap model scout maps where things are and returns file:line tables instead of file dumps, keeping the main context small. Use them for locating, never for deciding.

## 11. MCP connectors: reaching outside the codebase

Connectors let the agent read deploy logs, error reports, analytics, and database state directly instead of the owner copying them into chat. They also let it change production. Every connector gets an explicit gate.

**11.1 Leal's connector table** (in `AGENTS.md`):

| Server | Used for | Gate |
| --- | --- | --- |
| Supabase | Docs search, advisors (security and performance lints), logs, listing migrations, reading project state | Write tools (create project, apply migration, execute SQL, deploy functions, branches, anything with cost) only when the owner asks in chat. Schema changes go through migration files, never ad hoc SQL |
| Vercel | Deploy status, build and runtime logs | Project creation, deploys, env changes, domains, purchases only when the owner asks |
| PostHog | Analytics events, session replay, server logs | Writes only when the owner asks |
| Sentry | Error monitoring in one named org and project | Writes only when the owner asks; other orgs belong to other work and are off limits |

**11.2 Account hygiene.** Owners often have several orgs and projects in each tool. Name the right one in `AGENTS.md` ("use only the Jawla org's projects; org Moaz belongs to other work"). Before any write, list projects and confirm the target. On Leal the database CLI was signed in to another project twice; a `db push` without checking would have hit the wrong database.

**11.3 Unrelated connectors.** List connectors attached to the account that the project must not use (shops, forms, drives). An agent with a tool tends to use it.

**11.4 Add a connector only when a repeated copy paste need appears.** Start with the database and error tracker; add hosting and analytics when you find yourself pasting logs. Record connectors that failed to connect so the next session does not assume them.

**11.5 When a connector is the only path.** If the CLI is unavailable (Leal: the CLI was signed in to the wrong account), the owner may approve applying a migration through the connector; then rename the local migration file to the version the cloud recorded, so history stays aligned, and log it.

## 12. Guards and enforcement layers

Each rule that never bends is backed by at least one mechanism the agent cannot skip. Stack them so one failing layer is caught by the next.

| Layer | Leal mechanism | What it stops | Generic version |
| --- | --- | --- | --- |
| Harness | Deny rules, ask rules, bash guard hook | Secret reads, force pushes, prod deploys, data wipes | Same, plus your platform's dangerous commands |
| Lint | `no-restricted-imports` / `no-restricted-syntax`: payments and email imported only from their door's `index.ts`; Supabase clients created only in `src/lib/supabase/`; each provider env variable (`XPAY_*`, `RESEND_API_KEY`) readable only inside its door, matched as identifier, literal, and template text | A second import path to a risky system; secrets read anywhere else | One lint rule per single door; an `eslint.rules.test.ts` that proves each rule fires |
| Custom check scripts | `lint:rtl` (`scripts/check-logical-classes.mjs`) fails on physical direction classes (`ml-`, `text-left`, `rounded-l`), with suggested replacements and its own test | Broken right to left layout | A script per project wide invariant the linter cannot express (forbidden words in copy, missing translations, file size limits) |
| Type system | Strict TypeScript; generated database types; `server-only` imports in modules holding secrets | Client bundles importing secret code; schema drift | Same |
| Database | Row level security on every table, default deny; column grants; guard triggers holding transitions, fixed columns, limits; definer functions in a separate `api` schema with an allowlist; atomic functions with row locks for inventory; audit trigger | Overselling, data leaks, illegal state moves, missing audit | The strongest layer you have: database constraints, a domain service with invariants, or a ledger with double entry |
| Meta tests | pgTAP `000` (RLS enabled on every table), `005` (every `api` function with exactly its grantees), `010` (no definer function in `public`; PUBLIC execute revoked on every function) | A new table or function slipping past review with default access | A test that enumerates every resource and checks its policy, so new ones cannot be forgotten |
| Action guards | Every staff server action starts with `requireStaff` or `requireAdmin`; `guards.test.ts` imports every action module and proves each refuses an anonymous caller | An unguarded endpoint | An automatic test over every exported handler |
| Pre commit | husky + lint-staged: format and lint changed files | Unformatted or failing code entering history | Same |
| CI | On every PR and on `main`: typecheck, lint, RTL lint, format check, unit tests, build; database tests on a clean local stack; end to end at 390px in two languages | Anything above slipping through locally | Same three jobs (fast checks, database, end to end) |
| Review | Slice and security reviewers, cross checks, gates | Logic the machines cannot see | Same |

**12.1 The single door pattern.** Every risky integration (payment provider, service role key, email, AI provider) lives behind one module with an adapter interface. Only that module may import the SDK or read the secret. A fake implementation sits behind the same interface for tests and local work and is refused on deployments. The provider can then be swapped (Leal moved from one payment provider to another before building) without touching callers.

**12.2 Fail closed on deployments.** One `isDeployment()` helper decides; secrets, bot checks, and the payment provider refuse to run with test fallbacks there, while email degrades with a warning. Any production build counts as a deployment unless a local only flag is set.

## 13. Code standards and testing strategy

`context/code-standards.md` holds only rules a real decision made, plus a section per shipped position. Add a rule when a decision makes it; delete it when it stops being true.

**13.1 Three test layers.**

| Layer | Tool (Leal) | Location | Covers |
| --- | --- | --- | --- |
| Database | pgTAP via `supabase test db` | `supabase/tests/database/NNN_*.test.sql` | Migrations, access rules, functions, triggers, constraints, races |
| Unit | Vitest | next to the code as `*.test.ts` | Data layer, logic, server actions (with a database client mock), hooks, scripts, lint rules |
| End to end | Playwright | `e2e/` | Journeys at 390px in every language, through a wrapper script |

**13.2 The tests first list** (failing test before code). Generic form; rename for your domain:

- Every access rule: who can and cannot read and write, including anonymous, another tenant, and each role.
- Every scarce resource function (reserve, confirm, release, change capacity), plus a two session race where exactly one wins.
- Every computed amount and its snapshot.
- Every state machine, including illegal transitions refused.
- Time boundaries ("24 hours before") exactly at, just before, just after.
- Every external callback: bad signature refused, replay idempotent, late arrival.
- Audit triggers write who, when, old, new.
- Anything inside a single door.

**13.3 Race tests.** Two real database sessions (Leal used `dblink`) start the same operation at once; the test asserts the invariant afterwards. Race fixtures are committed through the second session and cleaned up, with audit noise suppressed (`session_replication_role = replica`). Scope assertions to the test's own rows so leftover end to end data does not break them.

**13.4 The brief's test scenarios become automated tests** in the position that builds the behavior, and the build plan names which.

**13.5 The end to end wrapper** (`scripts/e2e.mjs`). Starts the local database if needed; builds with local values passed as process variables (they beat env files, so cloud values are never used); turns analytics and error reporting off; seeds accounts with random passwords per run; each visitor sends its own documentation range IP so per address limits never mix runs; moves time with one SQL statement instead of waiting; reads sent emails from a local outbox directory; can reuse the last build only if it made it. Run with limited workers locally if the machine times out.

**13.6 Standards worth copying to any project:**

- Money as integers in the smallest unit plus a currency code; never floats; format only at the edge.
- Time as instants (`timestamptz`); business rules relative to a stored instant, computed in the database, never the browser clock. A fixed business timezone with a conversion helper that refuses times a clock change skips or repeats.
- Expected failures are return values `{ ok: false, code }` mapped to messages; unexpected errors throw to the error tracker. Users never see raw codes.
- Every server action and route handler validates input with a schema library before use.
- Database refusals raise a fixed SQLSTATE with the code as the message and JSON detail when a value is needed (`{"floor": 8}`); one `dbError()` maps them; new codes go into the code list and the message files together.
- Domain modules under `src/lib/<area>/`; single doors with an `index.ts`; config in `src/config/` (brand, platform settings like fees and time windows), never literals.
- Server only modules import a `server-only` guard; client components never import them.
- Forms submit through a helper that keeps typed values after errors and disables submit until hydrated, so a pre hydration submit cannot fall back to a GET that puts values in the URL.
- Lists paginate; page parameters are normalized, a page past the end redirects to the last.

## 14. Security and privacy guidelines

These came from Leal's reviews; almost all transfer to any web product with accounts, money, or personal data.

**14.1 Secrets.** Only publishable values use the public prefix (`NEXT_PUBLIC_`). Provider keys are read only inside their door (lint enforced). The owner puts secrets straight into the hosting env, CI secrets, and local env files; never into chat. The agent never creates accounts, accepts terms, or handles keys; those are owner steps (section 18).

**14.2 Access control lives in the database.** Default deny on every table; policies call private helper functions (`current_staff()`, `is_admin()`, `my_agency_id()`) that return nothing while a user is disabled or still on a temporary password; never authorize from user editable metadata or JWT claims. New tables start with `revoke all`, then grant exactly what the spec lists; new functions revoke PUBLIC execute explicitly (the platform's default grant is easy to miss).

**14.3 Narrow definer functions for partial views.** When a role may see only some rows and columns of a shared table, expose a security definer function that returns exactly those, in a dedicated exposed schema, listed in a meta test. Do not open the base table.

**14.4 Public reads use an anonymous client**, even for signed in staff, so what the public sees never depends on who is signed in. Public queries name every column; anonymous roles get column grants only, so `select *` fails by design.

**14.5 Access without accounts.** Unguessable HMAC tokens with distinct labels, never stored; constant time comparison; a token in a link goes to a route that checks it, sets an httpOnly cookie, and redirects to a clean URL (tokens never stay in the address bar, history, replays, or logs); `__Host-` cookie prefix on deployments; failed checks rate limited per address and resource so shared networks do not lock others out.

**14.6 Abuse limits.** A bot check (Turnstile) before costly actions, checked before the rate limit so bots never write to it; per address limits stored in the database; IPv6 grouped by /64; addresses stored only as keyed hashes.

**14.7 Money and callbacks.** State changes only on verified facts: a signature checked over the raw body with a time tolerance and mode check, or a server to server lookup. Idempotent by event id and by state. Idempotency keys on every outgoing create. Outside work (refund requests, emails, analytics) runs after the database commits and never undoes it; failures alert once per record and a scheduled recheck retries.

**14.8 Personal data never leaves.** A scrubber drops keys like name, email, phone, contact from every analytics and error payload; sensitive URL parameters (`token`, `email`, `phone`, `q`, `ref`, `customer`) are stripped from analytics, error reports, replay events, and Referer headers; elements showing personal data are masked from session replay; staff pages are never recorded; ops emails carry references, not personal data.

**14.9 Web hardening.** One module sets every response header: full Content Security Policy (self, the database, the bot check, the hosting toolbar; `frame-ancestors 'none'`, `form-action 'self'`, `object-src 'none'`), `X-Frame-Options: DENY`, `nosniff`, a Permissions Policy, HSTS. A new third party origin needs an entry there and a test. Never build URLs from the request Host header; one `appOrigin()` helper. Redirect only to allowlisted hosts (Leal: payment pages only on the provider's https domain).

**14.10 Uploads.** The server generates every storage path (random, never reused); type and size checked in the browser, by the bucket, and by a database guard that reads the storage table; never SVG; photos re-encoded in the browser to strip location metadata; files never replaced in place.

**14.11 Content.** All user, staff, and partner written text is rendered escaped, including in emails; plain text only; contact details blocked from public profile text by a database check.

## 15. The UI system

Design gets the same three way split as code: raw values, composition rules, and an inventory. Create all three the first time any real UI is built, not after a few pages have accreted ad hoc.

**15.1 `ui-tokens.md` (raw values only).** Colors with role and a measured contrast table (which pairs pass AA for normal text, which only for large text, which fail: Leal's amber with white text failed at 2.16 and is banned); typography per script (Inter for Latin, Cairo for Arabic) with a size scale and a 14px minimum; radius, shadow, motion; test widths (360, 390, 430px, then tablet and desktop); brand name and logo usage. Tokens become CSS variables or Tailwind `@theme` entries in the scaffold, and no component hardcodes a value that has a token.

**15.2 `ui-rules.md` (composition).** Character in one line plus a "never" list (Leal: large gradients, excessive animation, glassmorphism, cliché decoration); mobile first rules (designed at 390px first; primary actions reachable one handed; no hover only affordances; 44px tap targets); bilingual and right to left rules; button kinds with examples; color use limits; per page layout rules; low availability wording with real numbers only; errors in plain words.

**15.3 `ui-registry.md` (inventory).** Every built component with path, purpose, variants, and the position that added it. Check it before creating any component; a near duplicate is a bug; add a row after creating one.

**15.4 Design references.** The owner's screenshots of a reference product go in `docs/design/` with a `README.md` mapping each screen and section to our pages: copy layout and component shapes, take colors and fonts from our tokens, and our rules win over the reference. List what is excluded from the reference (ratings, wishlists, badges, urgency).

**15.5 Ask where the design comes from.** For each page spec, ask: a design tool, screenshots, the existing UI and tokens, or a suggested direction. Never assume.

**15.6 Internationalization by construction.** All strings in message files (`messages/en.json`, `ar.json`), added to both in the same change, with ICU plurals; a test parses every message; logical layout classes only (enforced by `lint:rtl`); directional icons flip, others do not; money and dates formatted with `Intl` per locale; Western digits on Arabic pages by owner choice; content stored in one language marked `lang` and `dir="auto"`; staff only areas may be single language by decision.

**15.7 Accessibility basics in every AC:** real table semantics for comparison tables; `aria-current` for navigation; `aria-pressed` for toggles with a constant accessible name; focusable scroll regions; one polite status region for announcements; visible focus; text contrast from the token table.

**15.8 Verify in a real browser.** After any UI change, the agent opens the page in the built in browser at each test width and language, reads the accessibility tree, checks computed styles when needed, fixes overflow, and screenshots the result. Leal caught a 9px Arabic overflow, a 39px tap target, and duplicate field ids this way.

## 16. Observability and analytics

Wire the basics in the scaffold so every later position can add its own events and logs.

- **Errors:** one error tracker (Leal: Sentry, EU region) shared config for client, server, and edge with personal data collection off, the DSN from env, replay only on error, and a tunnel route so ad blockers do not drop reports.
- **Product analytics:** typed event names in one module (`AnalyticsEvent` union); each position adds the events it owns; a late position audits that every event in the brief fires. Events carry ids, counts, and codes, never personal data or search text. A server side client for events that happen after a webhook.
- **Session replay:** masked inputs by default, explicit mask attributes on any element showing personal data, staff pages never recorded, URL scrubbing on replay meta events.
- **Server logs:** one logger module (Leal: OpenTelemetry to PostHog Logs) identifying records by id, never by path or personal data (digit runs in paths trip phone number scrubbers).
- **Alerts:** a `raiseAlert(reason, detail)` helper with a typed reason list; alerts that a retry loop can raise again fire once per record, marked in the database; a periodic summary email only when something changed.
- **Health and uptime:** a health endpoint and an external uptime monitor that pages the owner's phone, required at the first gate.
- **Hosting analytics:** if the host adds its own analytics, wrap it to drop query strings and fragments.

**What the brief says not to build** matters too: Leal's brief said "do not build an analytics dashboard", so analysis happens in the analytics tool, not the product.

## 17. Environments, hosting, pinned stack, and cost

**17.1 Pin everything exactly.** `.npmrc` `save-exact=true`, never `^` or `~`; every dependency and its version recorded in the `AGENTS.md` stack table with the reason for any non latest choice (Leal kept TypeScript 6.0.3 because typescript-eslint capped below 6.1, and ESLint 9 because the framework's config broke on 10). "Never add a dependency without pinning it and recording it" is a rule.

**17.2 Leal's stack, as a reference shape** (swap per domain):

| Layer | Leal choice |
| --- | --- |
| Runtime | Node 24 LTS, npm 11 |
| App | Next.js 16 App Router, React 19, TypeScript 6 strict |
| Data, auth, storage | Supabase (Postgres, Auth, row level security, Storage); pg\_cron and pg\_net jobs with secrets in Vault |
| Validation and UI | Zod 4, Tailwind 4 with tokens in `@theme`, next-intl for English and Arabic |
| Hosting and CI | Vercel (functions pinned to one region near the database), GitHub Actions |
| Services | Payment provider behind an adapter, Resend over plain fetch, Sentry, PostHog, Cloudflare Turnstile, an uptime monitor |
| Tests and quality | Vitest, pgTAP, Playwright, ESLint, Prettier, husky with lint-staged |

**17.3 Local first.** The local database runs in Docker on its own port range so it never collides with another project's stack. A `db:env` script writes local values into the development env file, so development never touches the cloud. Seed scripts create local logins with printed or env supplied passwords.

**17.4 Shared database before launch, by decision.** Leal's previews and production shared one cloud database before launch; all data was test data, and gate G3 wipes it, reapplies migrations, and creates a separate staging database. Write this down with "never put real data in it before the gate"; it is a deliberate risk, not an accident.

**17.5 Migrations only.** Schema changes go through migration files, applied locally with a reset, tested, then pushed to the cloud by the owner's request with a dry run first. Never ad hoc SQL against a shared database. An applied migration is never edited; fixes ship as a new migration.

**17.6 Free first, pro at launch.** Leal ran on free plans during the build and planned the upgrade at G3, with the known costs recorded: free hosting is non commercial, the free database pauses after 7 idle days (it happened once) and has no backups. On pro plans the fixed monthly cost was about $94 (hosting $20, database $25, error tracker $29, email $20), about $104 with a staging database, plus per transaction payment fees. Recheck prices before deciding; they change.

## 18. The progress tracker: state, decisions, questions, owner steps

`context/progress-tracker.md` is read at the start of every session and updated at the end. It has five parts.

**18.1 Current state.** Dated bullets, newest at the bottom, saying what was built, what passed (test counts), what was found and fixed, what is on the cloud, and what is next. Specific enough that a cold session can resume.

**18.2 Blockers.** Open risks with their mitigation: shared CLI accounts, free plan limits, top business risk (Leal: whether the payment provider allows a marketplace), shared pre launch database.

**18.3 Decision log.** One table, newest first: date, decision, by (Owner, or Default = chosen by the agent and in force until the owner overrides), where it is recorded. Precedence level 2: a logged owner decision beats a general rule. Superseded rows stay, struck through, with the replacement named. Every spec acceptance, override of the brief, provider switch, and review fix that changes behavior gets a row.

**18.4 Open questions.** Numbered (`Q1`, `Q24`), each with what it blocks, ordered by what they block soonest. Checked before designing anything that touches one. A resolved question moves to the decision log and is struck through here.

**18.5 Owner setup checklist.** Accounts, billing, terms, domains, and secrets are the owner's. Each row: number, the owner action in exact steps (where in which dashboard), then what the agent does after, and what it blocks. Leal had S1 to S15: payment provider keys and webhook, hosting plan, database project, repository, domain and DNS, email provider and tracking off, phone number, error tracker, analytics project, bot check widget, uptime monitor, search console, design screenshots, AI provider key, a Vault secret. The agent never creates accounts, accepts terms, adds payment methods, or reads or pastes secret keys.

**18.6 Bootstrap checklist** with status per step (section 20), so the setup itself is tracked.

## 19. Session cadence and model posture

**19.1 Start of session:** auto loaded `AGENTS.md` → `project-overview.md` → `progress-tracker.md` → the current position's spec → only the doc the task needs. Check git freshness (commits behind `main`) before deciding anything.

**19.2 During:** one position at a time; mark chapters when the phase changes (exploration, implementation, verification); keep the owner posted in short lines; ask with multiple choice options and a recommended default (Leal's owner preferred this; record such preferences in memory).

**19.3 End of session:** update the progress tracker (done, decisions, blockers); fold new permanent decisions into the right doc; run `/sync` after merges; delete or fix any `AGENTS.md` line that stopped being true.

**19.4 Git:** one position = one branch = one PR; Conventional Commits; commit or push only when the owner asks; never force push shared branches; never commit env files except the example; write long commit messages to a file and use `-F` (the guard scans message text).

**19.5 Model and effort posture** (written in `AGENTS.md` so it is not re-decided):

| Work | Model and effort |
| --- | --- |
| Schema, access rules, inventory and concurrency, payments, auth, security review | Strongest model, high effort |
| UI slices built from tokens and rules, CRUD following an existing pattern | Default effort |
| Copy tweaks, renames, formatting, doc updates | Fast model |
| Gate reviews and spec cross checks | A different model from the author, fresh context |

**19.6 Context hygiene.** Long design interviews cost tokens every turn; after a spec is accepted, start the build in a fresh session (`/clear`): the spec is on disk, so nothing is lost. Offload broad code reading to a cheap read only scout that returns a map, not file dumps.

## 20. Tooling gap scan: suggest what is missing, ask before adding

The agent does not wait to be told that a hook, rule, or reviewer is missing. It looks for gaps on a schedule, proposes each fix with a recommendation, and changes nothing until the owner says yes.

**20.1 When the scan runs.**

- At bootstrap, before position 01.
- At the start of every position, after reading its spec.
- When a new dependency, provider, or service is chosen (in the spec's stack walk).
- When a review, verify, or incident finds a problem a machine could have caught.
- When the same mistake or the same copy paste happens twice.
- Before every gate.

**20.2 What it checks, per category.**

| Category | The question the agent asks itself | Example suggestion |
| --- | --- | --- |
| Skills | Does the library or service we just chose ship an official skill? Is a workflow step improvised every time? | "The payment provider publishes a skill at org/repo; review and vendor it at a pinned commit?" |
| Hooks | Did a dangerous or repetitive action happen that a hook could block or automate? | "Add a guard that blocks `kubectl delete` on the prod context?" |
| Context docs | Is a concern scattered across chats with no home? Is a doc stale against the code? | "Create `context/integrations.md`; architecture.md says X but the code does Y, fix it?" |
| MCP connectors | Did the owner paste logs, rows, or dashboards from a tool more than once? | "Connect the error tracker connector, read only, writes gated?" |
| Rules that never bend | Did a review find an invariant not in the list? | "Candidate rule 12: webhook replies only after commit. Promote it?" |
| Agents | Is the same review or investigation run repeatedly with a hand written prompt? | "Add an `accessibility-reviewer` agent with a fixed return format?" |
| Guards | Is a rule enforced only by review or by a sentence? Can a lint rule, database constraint, meta test, or CI step enforce it? | "Add a lint rule so only `src/lib/sms/` may import the SMS SDK?" |
| Guidelines and standards | Did a build make a convention that the next position will need? | "Add 'Uploads' to code-standards from this position?" |
| UI | Was a component built that is not in the registry? A value hardcoded that should be a token? A page with no design source? | "Register `CompareBar`; add a `warning` color token with measured contrast?" |
| Tests | Is a risky path missing from the tests first list or without a race test? | "Add a two session test for the seat decrease?" |
| Observability | Did something fail silently? | "Add an alert reason and a once per record mark?" |
| Owner steps | Does the feature need an account, key, or dashboard setting? | "New owner step S16: create the webhook and add its secret in hosting env" |

**20.3 How a suggestion is presented.** One multiple choice question per gap (batched up to four), with: what to add, where it would live, why now (the trigger that found it), cost (time, context tokens, money), risk (third party code, telemetry, write access), and exactly one option marked recommended, plus "not now" and "never". Third party additions name their source, license, and pinned version.

**20.4 Ask first, always.** No skill, hook, connector, agent, rule, guard, doc, or dependency is added, installed, or changed without an explicit yes in chat for that item. Approval for one item never covers another. The agent never runs third party installers, never enables connector write tools, and never adds hooks that run on session start or send telemetry, even when asked to install something; it reviews the files and asks the owner to run anything that executes code.

**20.5 Record the outcome.** Accepted: build it, add it to the right inventory (`AGENTS.md` skills, connectors, or tooling tables; `project-overview.md` §4 for rules; `code-standards.md` or `ui-*.md` for guidelines) and the decision log. Declined: add it to the declined list with the reason, so it is not proposed again unless the trigger changes.

**20.6 Paste this into `AGENTS.md`:**

```markdown
## Tooling gap scan (ask before adding)

At bootstrap, at the start of each position, when a new service is chosen, when a review finds
something a machine could catch, when a mistake or copy paste repeats, and before each gate:
scan for missing skills, hooks, context docs, MCP connectors, rules that never bend, agents,
guards (lint, database, meta tests, CI), guidelines, UI tokens or registry entries, tests,
alerts, and owner steps. Propose each as a multiple choice question with one recommended option,
what, where, why now, cost, and risk. Add nothing until the owner says yes for that item.
Never run third party installers or enable connector writes. Record accepted items in the
right inventory and the decision log; record declines with the reason.
```

## 21. Adopting this for a totally different category

The workflow transfers unchanged; the brief, rules, stack, and tracer bullet unit are re derived for the new domain. Follow these steps in order; each names the section that details it.

**21.1 Bootstrap, step by step.**

1. Get the owner's brief in writing; import it to `docs/brief/` with numbered sections (§4.1).
2. Create `AGENTS.md` and the one line `CLAUDE.md` (§3.2, template §22.1).
3. Write `context/project-overview.md`: what, actors, core flow, rules that never bend derived with the seven questions, stop and ask, doc map with read order and precedence (§4, §3.3, §3.4).
4. Create stubs for `architecture.md`, `code-standards.md`, `build-plan.md`, `progress-tracker.md` (§3.1, §18).
5. Define the tracer bullet unit for this domain and write it into `build-plan.md` "How to work" (§5.1).
6. Draft the build order from the brief's priorities, P0 first, with gates and a cut list; get the owner's confirmation (§5).
7. Set up `.claude/settings.json` deny and ask rules, the bash guard hook with its test, and the format hook (§9).
8. Add the `slice-reviewer` and `security-reviewer` agents, rewritten for the domain's risks (§10).
9. Run the tooling gap scan for the chosen stack: official skills, connectors, guards (§20, §8, §11).
10. Write spec 0001 for the scaffold with `/architect` (stack walk, pinned versions, single doors, CI, tokens) and get it cross checked and accepted (§6).
11. Build position 00: tooling, local database, lint enforced doors, meta tests, CI with three jobs, pre commit, tokens and brand config, locale routing if bilingual, error and analytics basics, placeholder page, preview deploys (§5.3, §12).
12. Pass gate G0 on a clean clone.
13. The first time real UI is built: create `ui-tokens.md`, `ui-rules.md`, `ui-registry.md`, and the design reference mapping (§15).
14. From position 01 on: the per position loop (§7.1), updating the tracker every session (§19).
15. Plan the independent security review before the first milestone touching auth, money, or real user data (§5.6).

**21.2 What to re derive per domain.**

| Piece | Re derive by asking |
| --- | --- |
| Rules that never bend | The seven questions in §4.3 |
| Tracer bullet unit | What is the thinnest slice a user can actually use end to end? |
| Single doors | Which integrations hold credentials, money, or regulated data, or may be swapped? |
| Tests first list | Which paths, if wrong, lose money, leak data, corrupt state, or break the law? |
| Gates | Which milestone first exposes real users, money, or personal data? |
| Owner steps | Which accounts, contracts, keys, and legal texts must a human obtain? |
| UI rules | What is the product's character, and what must it never look like? |
| Languages and locales | Who are the users, which scripts and directions, which number and date formats? |

**21.3 Worked adaptations.**

| Domain | Example rules that never bend | Tracer bullet example | Single doors | Gate G1 focus |
| --- | --- | --- | --- | --- |
| Clinic appointment booking | Never double book a clinician slot; medical notes visible only to the treating clinic; consent recorded before any reminder; audit every record view and edit | Book one slot → confirmation → reminder | SMS, calendar sync, the database admin key | Health data access, slot races, consent |
| B2B SaaS (team workspace) | Every row carries a tenant id and is filtered by it at the database; billing state only from the provider's signed events; seats never exceed the plan | Create workspace → invite member → member sees only that workspace | Billing provider, email, SSO, admin key | Tenant isolation, billing webhooks |
| Fintech ledger or wallet | Double entry: every movement balances to zero; balances never stored, always derived or reconciled; no transfer without a verified source of funds; idempotency on every movement | Deposit → ledger entries → balance view | Bank or card processor, KYC vendor, admin key | Balance invariants under concurrency, replay |
| Online course platform | A learner sees paid content only with an active entitlement; grades computed on the server; minors' data minimized | Enroll → pay → access lesson 1 | Payments, video host, email | Entitlement checks, content leaks |
| Internal operations tool | Every write audited with actor; role checks in the database; no bulk delete without a dry run | One workflow from request to approval | SSO, the company's APIs | Role escalation, audit completeness |
| Marketplace for services (Leal's shape) | Never oversell capacity; price snapshots; partner data private; payouts manual and configurable | Listing → availability → hold → pay → confirm | Payments, email, admin key, AI | Holds, payments, booking access |

**21.4 What stays identical:** the context layout and read order, precedence, spec format and interview, value sourcing, cross checks, per position loop, harness rules and hooks, review agents' structure, tooling gap scan, decision log and open questions, owner checklist, model posture, and the never pick silently rule.

## 22. Templates to copy

**22.1 `AGENTS.md` skeleton**

```markdown
# AGENTS.md

**<Product>** (`<domain>`): <one sentence>. Launch **<date>**. Priority: <a > b > c>.
Product brief: `docs/brief/<file>.md`.

## Status
<one dated line per position: merged, on cloud, open owner steps>

## Stack (pinned exactly)
| | |
|---|---|
| Runtime / PM | ... |
Never add a dependency without pinning its exact version and recording it here.

## Commands
| Command | Does |
|---|---|
Do not invent commands that don't exist.

## Where to read what
Read order: this file -> context/project-overview.md -> context/progress-tracker.md -> the current
position's spec -> only the context doc the task needs. Do not read every doc.

## Rules that never bend
Canonical text: context/project-overview.md section 4 (it wins if this summary differs).
1. ...
**Scope rule:** anything not in the brief -> ask before building.

## How we build
- Tracer bullets, strict order. Spec first. Tests first on risky paths.
- Each position adds its own write path. Schema changes only via migrations.
- Stop and ask on rule conflicts, missing decisions, unsourced values.
- End of session: update progress-tracker.md.

## Tooling gap scan (ask before adding)
<paste section 20.6>

## Claude Code tooling (.claude/)
<deny and ask rules, hooks, agents, launch config>

## Model / effort posture
<table from section 19.5>

## Skills
| Skill | Source, pinned | Use here | Project override |
**Declined:** <name, date, reason>

## MCP servers
| Server | Use here | Gate |

## Git
- One position = one branch and one PR. Conventional Commits.
- Commit or push only when the owner asks. Never force push. Never commit .env* except .env.example.
```

**22.2 Rule that never bends**

```markdown
N. **<One line statement.>** <Exact mechanism: formula, where it is enforced, which function or
   constraint.> *Why:* brief section X; <the failure it prevents>.
```

**22.3 Build order row and gate row**

```markdown
| 04 | <capability, end to end> | brief 12-15; tests 1-3 | P0 | [0004](../docs/specs/0004-x/index.md) | done 2026-10-10 (PR #5) |
| G1 | 05 | <journey on phone in every language; tests pass; monitoring live; independent security review> |
```

**22.4 Spec `index.md` skeleton**

```markdown
# NNNN. <Title>

**Date**: YYYY-MM-DD
**Status**: Proposed

> Decision history: [rationale.md](rationale.md).

## Summary
## Requirements
**User stories**: ...
**Acceptance criteria**:
- **AC-1**: ...
## Decision
**Chosen option**: ...
**Implementation skills**: ...
## Rationale
Reasoning and options: see rationale.md.
## Feature design
**Data model sketch** / **State transitions** / **API surface** (table) /
**Value sourcing** (Action | Value | Source) / **Key invariants** / **Security model** /
**Configuration required** / **Critical test scenarios** (each verifies AC-n)
## Build plan
1. pgTAP / tests first ..., satisfies **AC-n**
## Consequences
**Positive** / **Negative / tradeoffs** / **Neutral**
## Follow-up
- [ ] ...
```

**22.5 Tracker rows**

```markdown
| 2026-10-14 | **Spec 0007 Accepted** (...). <the decisions> | Owner (asked in chat) | spec 0007 |
| Q24 | **<Question>** <context> | <what it blocks> |
| S6 | <exact owner steps, dashboard paths> | <what the agent does after> | <blocks> |
```

**22.6 `.claude/settings.json`**

```json
{
  "permissions": {
    "deny": ["Read(./.env)", "Read(./.env.local)", "Read(./.env.*.local)", "Read(./**/.env)",
             "Edit(./.env)", "Edit(./.env.local)", "Edit(./.env.*.local)",
             "Write(./.env)", "Write(./.env.local)", "Write(./.env.*.local)"],
    "ask": ["Bash(git push:*)", "Bash(<host> env:*)", "Bash(<db cli> db push:*)", "Bash(gh repo:*)"]
  },
  "hooks": {
    "PreToolUse": [{ "matcher": "Bash|PowerShell",
      "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/guard-bash.mjs\"" }] }],
    "PostToolUse": [{ "matcher": "Edit|Write",
      "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/format-on-write.mjs\"" }] }]
  }
}
```

**22.7 Guard hook skeleton**

```js
#!/usr/bin/env node
// PreToolUse guard. Exit 2 blocks the command and shows the reason to the agent.
import { readFileSync } from "node:fs";
let command = "";
try { command = String(JSON.parse(readFileSync(0, "utf8"))?.tool_input?.command ?? ""); }
catch { process.exit(0); }
const rules = [
  { test: () => /(^|[\s'"/=])\.env(?!\.example)/.test(command), why: "Secret env files are off limits." },
  { test: () => /\bgit\s+push\b.*\s(--force(?!-with-lease)|-f)\b/.test(command), why: "Force push is blocked." },
  { test: () => /\bdrop\s+(database|schema)\b|\btruncate\s+table\b/i.test(command), why: "Use migrations." },
  // add: recursive deletes of broad paths, linked database resets, direct prod deploys
];
for (const r of rules) if (r.test()) { process.stderr.write(`Blocked: ${r.why}\n`); process.exit(2); }
process.exit(0);
```

**22.8 Review agent skeleton** (`.claude/agents/<name>.md`)

```markdown
---
name: <slice-reviewer | security-reviewer>
description: <when to use it, one sentence>
tools: Read, Grep, Glob, Bash
model: <strong model>
---
You review <product>. You did not write this code; judge it cold.
Read: AGENTS.md, project-overview.md section 4, the spec, then `git diff main...HEAD`.
Never read .env* files. Do not edit anything; Bash only for git and read only inspection.
Check: <numbered list>. Confirm each finding against the code path before reporting.
Return exactly: ## Critical ## Major ## Minor ## <table> ## Recommendation
One line per finding: `path:line - problem - fix`. No praise.
```

**22.9 Spec cross check prompt**

```text
You are a read only cross checker. Do NOT edit or write any file. Do NOT fetch any web link.
Read the spec at <path> and its rationale. Verify its claims against: <files>.
Job 1 (primary): decision completeness: every value an action needs whose source the spec does
not name; every decision the builder would invent; every claim that does not match the code.
Job 2: soundness: rule risks, races, deadlocks, missed failure modes, a simpler design.
Output: numbered list, max ~60 lines, grouped Gaps and Soundness, each with severity, location
(AC or section), and a one or two line recommended fix. No praise.
```

## 23. Lessons learned and pitfalls from the Leal build

Each of these cost real time. Read them before starting.

| Pitfall | What happened on Leal | Prevention |
| --- | --- | --- |
| Idle free database pauses | The cloud database auto paused after 7 idle days; previews and production lost their database | Know free plan limits; upgrade at launch; an uptime monitor would have caught it |
| Wrong CLI account | The database CLI was signed in to another project twice; a push would have hit the wrong database | List projects and confirm the target before any push; write the check into the blockers |
| Wizard generated code | Vendor setup wizards created a root `app/`, JS configs, duplicated config files, and an exposed token | Run wizards on a branch, review every file, move code into the project layout, revoke printed tokens |
| Platform default grants | New functions got PUBLIC execute by default even after a per schema revoke | Revoke explicitly per function; a meta test that fails on any missed revoke |
| Shared role, shared grants | Admins and partners shared one database role, so column grants could not separate them | Narrow definer functions for partial views (§14.3) |
| Secrets in analytics | Search text, booking tokens, and references leaked through replay meta events, span attributes, Referer headers, and heatmap keys | One scrubber for every channel, with tests; verify in the real tools, not only in code |
| Token in the URL | A view token in the address reached analytics and history | Token routes that set a cookie and redirect to a clean URL |
| Clock drift inside locks | `now()` is the transaction start; after a lock wait it was stale for expiry decisions | `clock_timestamp()` after locks for time decisions |
| Daylight saving | Midnight does not exist on the spring change day; a date range built from midnight crashed | Compare local dates, not constructed local instants; refuse skipped or repeated times |
| React form behaviour | React 19 cleared fields after an action even on errors; a submit before hydration fell back to GET and put a typed password in the URL | A form helper, `method="post"`, submit disabled until hydrated |
| Memoized reads | The framework memoized identical reads in one render, so a page read stale state after its own write | Redirect after settling instead of re-reading in the same render |
| Tests polluted by other tests | Database assertions read whole tables and failed when end to end rows existed | Scope every assertion to the test's own rows |
| Parallel end to end load | More than 2 local workers timed out | Document the worker count; give each visitor its own address |
| Locale cookie | An Arabic visit made later unprefixed English paths render Arabic | Use explicit locale prefixes in tests |
| Hook blocked a commit | The bash guard blocked a commit whose message mentioned a blocked phrase | `git commit -F <file>` |
| Specs that lie | Built code drifted from its spec after review fixes | Amend the spec in place in the same change; log it |
| A spec naming code that does not exist | Cross checks found helpers that did not exist, guards that would refuse the planned write, a page that would crash | Read the code before the interview; always offer the cross check on money and access specs |
| Unbounded positions | Positions sized as "one day" spilled; launch moved two weeks | Record real pace; name the cut list early; cut early, not late |
| Hidden scope growth | Owner requests beyond the brief (a currency picker, a listing page) | Log each as an override of the brief with the cost, build it as its own slice that can slip |
| Third party setup outside code | Payment marketplace terms, legal pages, phone numbers blocked launch, not code | Owner checklist and open questions from day one; ask providers early |

**The three habits that mattered most:** write the rules that never bend before any code and enforce each at the lowest layer; never accept a spec without a cross check from another model; never let the session that wrote the code be the only judge of it.
