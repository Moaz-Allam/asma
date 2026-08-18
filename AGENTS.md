# AGENTS.md

The operating rules for this project live in **[CLAUDE.md](CLAUDE.md)**. Read that file first —
it carries the never-negotiable rules, the canonical request lifecycle, the just-in-time reading
map for `context/`, and the session protocol.

This file exists because it is the cross-tool convention (Claude Code, Cursor, Copilot, Codex,
Windsurf all look for one of these two names) and because `context/library-docs.md` points here.
There is exactly one source of truth; this is a pointer, not a second copy.

## Installed skills

Invoked as slash commands; defined in `.claude/skills/<name>/SKILL.md`.

| Skill | When |
| --- | --- |
| `/architect` | Before any non-trivial feature. Produces a plan you confirm before code exists. |
| `/review` | After a feature. Three layers: plan alignment, system integrity, production readiness. |
| `/imprint` | After any UI component. Captures actual classes into `context/ui-registry.md`. |
| `/recover` | When one corrective attempt did not hold. Triages fix vs reset vs rethink. |
| `/remember` | `save` at session end, `restore` at session start, for multi-session work. |

## Vendor skills

Installed in `.agents/skills/`, symlinked into `.claude/skills/`. They load by description and cost
nothing until triggered.

| Skill | Load it before |
| --- | --- |
| `supabase` | Any Supabase work — auth, `@supabase/ssr`, Edge Functions, Realtime, Storage, CLI, MCP, or debugging an RLS surprise |
| `supabase-postgres-best-practices` | **Any** schema, migration, RLS policy, index, trigger, or function change — "even for a one-column change or a single query" |
| `tailwind-design-system` | Tailwind v4 `@theme` token work |

Install more with `npx skills add <org>/<repo>`. **Review a skill before use — skills run with full
agent permissions.**

Authority order, which the vendor skills do **not** override:

```
context/*.md  (how WE do it)   →   vendor skill / MCP docs (how the tool works)   →   general knowledge
```

`context/ui-tokens.md` beats `tailwind-design-system`. `context/architecture.md` beats
`supabase-postgres-best-practices`. Where a vendor skill and a project rule conflict, the project rule
wins — and if the vendor skill is right and we are wrong, say so rather than silently following either.

## Configured MCP servers

`.mcp.json` declares two:

| Server | Purpose | Needs |
| --- | --- | --- |
| `context7` | **Version-accurate docs for any library.** `resolve-library-id` then `query-docs`. This is the answer to "never rely on training memory for an API that may have changed" | nothing (anonymous rate limit) |
| `playwright` | Verify screens in **RTL** — the check `ui-rules.md` §3 requires before any UI task is done | nothing |
| `supabase` | Read-only schema and RLS policy inspection | `SUPABASE_PROJECT_REF` + `SUPABASE_ACCESS_TOKEN` in the environment |

**Context7** is configured on the anonymous tier, which is rate-limited. For higher limits, get a key
at context7.com and either set `CONTEXT7_API_KEY` and add an `Authorization: Bearer` header to
`.mcp.json`, or run `npx ctx7 setup --claude` yourself — it generates and stores a key, so it is
yours to run, not the agent's.

Use it for Next.js 16, React 19, Tailwind v4, Zod, shadcn/ui and both PSP SDKs — every one of which
has changed recently. It does **not** override `context/library-docs.md`: that file records how *we*
use a library, which beats how the library documents itself.

The Supabase server **will not connect until those two variables are set** (see `.env.example`).
That is expected while blocker B3 is open. If it is silently absent, that is why.

Per `context/library-docs.md`, the order of authority for any library question is:

```
installed skill  →  MCP server docs  →  context/library-docs.md  →  official docs  →  general knowledge
```

Never answer an API-surface question from training memory. Next.js 16, React 19, Tailwind v4 and
both PSP SDKs have all changed recently.

## Guardrails — four layers, deliberately overlapping

| Layer | Mechanism | Catches |
| --- | --- | --- |
| Write time | `.claude/hooks/guard.mjs` (PreToolUse) | 16 silent-failure rules, before the file lands |
| Session start | `.claude/hooks/session-context.mjs` | Current phase, open blockers, the three doc corrections that produce wrong code |
| Permission | `.claude/settings.json` → `ask` | Migrations, `lib/money`, `lib/psp`, `lib/pricing`, guard edits, destructive Supabase commands |
| CI | `.github/workflows/ci.yml` | The same rules for commits the hooks never saw — plus pgTAP against a real Postgres |
| Merge | — | **Solo project (D18): no code-owner gate.** `/review` + green CI + an explicit callout when a diff touches a high-risk path. Restore CODEOWNERS if a second engineer joins. |

The hooks are editable but gated behind a permission prompt, not denied outright — a guardrail that
can never be maintained is its own failure mode. Weakening one is still a deliberate act: say so
explicitly rather than folding it into an unrelated diff.

Regression suite for the guards themselves: `node .claude/evals/guard.test.mjs` (33 cases, including
false-positive checks). It runs in CI. A guard that stops firing is worse than no guard.

## Utilities

`python .claude/tools/docx-to-md.py context/docs/NAME.docx` — the eleven remaining `.docx`/`.xlsx`
files in `context/docs/` are unreadable by agent file tools. Convert on demand, not in bulk;
converting all of them would recreate the context bloat `CLAUDE.md` exists to prevent.
