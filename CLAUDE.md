<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

# Home-services marketplace — agent operating rules

Multilingual (`ar`/`tr`/`en`) marketplace. Two regions (Turkey · Saudi Arabia) in **one deployment**,
separated by a `region` column; an account belongs to exactly one region.
Customer posts a request → providers apply free → customer picks one
→ **customer pays** → **chosen provider pays the unlock fee** → PII revealed → work → release.
Revenue = unlock fee + commission. **A licensed PSP holds all funds; we never do.**

Stack: Next.js 16 (App Router) · React 19 · TypeScript strict · Tailwind v4 · shadcn/ui · Supabase (Postgres + RLS) · Zod · PSP adapter (iyzico TR / PayTabs KSA).

---

## The eleven rules that are never negotiable

Violating any of these is a bug even when tests pass. Most produce **no error** — just a leak or lost money.

1. **Price, commission, and fees are computed server-side.** The client sends answers, never a price.
2. **Customer PII is revealed only when a `paid` row exists in `unlock_fees` for that `(request, provider)`.** Request status `FUNDED` is *not* sufficient. Enforced by RLS, never by hiding a field in React.
3. **No external call in a request path.** Money flow is **DB transaction → `outbox_events` → relay worker → PSP**. The relay is the only mutating caller of `lib/psp`.
4. **Money is integer minor units.** No float, no double, no client-side money arithmetic. One rounding step, at the documented place.
5. **`ledger_entries` and `ratings` are append-only.** `UPDATE`/`DELETE` are `REVOKE`d at the database level. Corrections are new compensating postings.
6. **Every money operation is idempotent, atomic, and balanced.** Deterministic keys derived from domain ids. A replay returns the *stored* response. **Commission is its own ledger leg** — never `escrow = price − commission` as one line.
7. **RLS enabled + policy written + negative test proving the wrong user is denied** — all in the same migration/commit as the table. Missing RLS throws no error; it just leaks.
8. **Never `eval`, `new Function`, or otherwise execute an admin-authored string.** Pricing formulas are structured rows interpreted by our own code. An admin account is not a code-execution boundary.
9. **The platform never holds user funds.** No wallet top-up, no stored balance. `FEATURE_STORED_BALANCE_WALLET` stays OFF until legal sign-off is recorded.
10. **Three locales (`ar` RTL · `tr` LTR · `en` LTR), two regions (TR · KSA).** Direction is derived from the locale at runtime — never hardcoded. Logical properties only (`ms/me`, `ps/pe`, `start/end`); semantic tokens only — no hex, no raw Tailwind colour classes, no arbitrary values. No hardcoded user-facing strings. **Never case-fold an identifier with a Turkish locale** (`I`↔`ı`). See `context/i18n.md`.
11. **`proxy.ts`, never `middleware.ts`** (Next 16 silently ignores the old name). Proxy is routing/UX only — `requireRole()` runs independently inside **every** Server Action and Route Handler.

**Canonical request lifecycle** — the docs contain a superseded earlier ordering; this one wins:

```
OPEN → SELECTED → FUNDED → UNLOCKED → IN_PROGRESS → AWAITING_CONFIRMATION → RELEASED
```

`FUNDED → OPEN` if the provider misses the unlock window: **funds stay held**, the customer re-selects without paying again. Every path out of `FUNDED` ends in exactly one of released / refunded / partially-released.

---

## Read just-in-time, not all at once

`context/` is ~4,500 lines. Loading it all degrades output quality and burns the budget you need for the actual work. **Read the row that matches the task, not the whole directory.**

| Task at hand | Read |
| --- | --- |
| **Every session, first** | `context/progress-tracker.md` — phase, blockers, decision log |
| Business rule, flow, or "is this in scope?" | `context/project-overview.md` |
| Schema, RLS, outbox, pricing pipeline, invariants | `context/architecture.md` |
| Writing code — templates, money, errors, testing | `context/code-standards.md` |
| What to build next, phase gate, Definition of Done | `context/build-plan.md` |
| Library API or gotcha, PSP facts, pgTAP | `context/library-docs.md` |
| Anything visual | `context/ui-rules.md`, then `ui-tokens.md`, then check `ui-registry.md` |
| Locales, direction, translatable content, Turkish casing | `context/i18n.md` |
| Known doc conflicts before trusting a section | `context/contradictions.md` (13, all fixed) |
| Gaps, ambiguities, unstated assumptions | `context/open-questions.md` — check before designing a feature it names |
| The v5 corrections in full, with reasoning | `context/architecture-review.md` (P0-1…P0-6) |
| What a feature was *agreed* to do | `specs/<NN>-<slug>/plan.md` — written by `/architect`, checked by `/review` |

**Precedence when documents disagree:** `project-overview.md` §5–6 → a recorded human decision in `progress-tracker.md` → `architecture.md` → `code-standards.md` / `ui-rules.md` → `build-plan.md` wording. A `v5` section overrides an earlier `v3`/`v4` section in the same file. Unresolved after that → **stop and ask**.

---

## Session protocol

**Start** — read `progress-tracker.md`. Confirm the phase, check §4 blockers, pick the next unchecked task, then read only the doc rows that task needs. Returning to multi-session work → `/remember restore`.

**During** — one task at a time, fully. Before any third-party library: load its skill, then `library-docs.md`. Never rely on memory for an API that may have changed.

**End** — update `progress-tracker.md` (phase, decisions, blockers, handoff notes). New UI component → `/imprint`. Feature spanning sessions → `/remember save`.

---

## Context and token discipline

- **Notes over recall.** Long task → keep findings in `NOTES.md` at the repo root (gitignored). It survives compaction; your context does not.
- **Identifiers over payloads.** Hold file paths and grep results, not whole files. Read the section, not the document.
- **Delegate what pollutes.** Spawn a subagent when a subtask would dump large irrelevant output into the main thread — RLS/pgTAP suite authoring, log or migration spelunking, wide codebase searches. Give it a self-contained brief, a required output shape, and expect ~1–2k tokens back.
- **Verification is a separate pass.** A verifier needs only the success criteria and the artifact — not the implementation history. Say "run the complete test suite", never "check the tests".
- **Multi-agent costs 3–15× the tokens.** Justify it with context isolation, real parallelism, or specialisation. Otherwise stay single-threaded.

---

## Guardrails are mechanical, not aspirational

`.claude/hooks/` blocks the failure modes above at write time — hex colours, physical direction utilities, float money, `eval`, `service_role` in client code, `NEXT_PUBLIC_` on a secret, PSP imports outside the relay, `middleware.ts`, `select('*')`, ledger mutation.

A hook firing is information, not an obstacle. **Never work around one** — fix the code, or if the rule is genuinely wrong for the case, stop and say so. Editing a hook to make your own diff pass is the same failure class as weakening an RLS policy to make a test go green.

---

## Human review gate — cannot be self-approved

`lib/money/**` · `lib/psp/**` · `lib/pricing/**` · `supabase/migrations/**` · `supabase/functions/**` · `.claude/**` · any change to an idempotency key derivation.

Enforced by `.github/CODEOWNERS` plus branch protection, not by a rule in a document. A green build
is not a review. Say explicitly when a diff lands in one of these paths.

---

## Stop and ask — do not guess

Holding user funds or building top-up · PII visible pre-unlock or cross-provider data access · weakening/bypassing any RLS policy · a money op that cannot be made idempotent or atomic · the PSP lacking an assumed capability · market (TR vs KSA) matters and isn't recorded · legal/tax/KYC/ZATCA implications · **the same problem persisting after one corrective attempt → `/recover`**.

Full list and reasoning: `project-overview.md` §8.

---

## Skills

`/architect` before non-trivial work · `/review` after a feature · `/imprint` after a UI component · `/recover` when one fix didn't hold · `/remember save|restore` across sessions.
