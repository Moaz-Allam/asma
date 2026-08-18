---
name: architect
description: Think through a feature like a senior engineer before any code exists. Use before implementing anything non-trivial in this marketplace — money flow, RLS policy, state transition, pricing, PSP interaction, or a multi-file feature. Surfaces the decisions, names the failure modes, and produces a written plan the human confirms before implementation starts. Also use when a task's scope or correctness criteria feel unclear.
---

# /architect

A thinking session, not a grilling session. The output is a **plan the human agrees to**, not code.

Skip it only for genuinely mechanical work — a typo, a copy change, a registered component reused as-is.

---

## 1. Establish the ground truth

Before proposing anything, know these. Read, do not assume.

- **Which feature number is this?** `context/build-plan.md` — features are numbered and ordered. Building 18 before 38 exists is a known trap; the v5 phase order is `14 → 38 → 39 → 15 → 16 → 17`.
- **What phase are we in, and is anything blocking?** `context/progress-tracker.md` §4. An open blocker on this path means stop, not proceed-with-a-guess.
- **Has this been decided already?** `progress-tracker.md` §5 decision log. Do not re-litigate a recorded human decision.
- **Which of the eleven rules does this touch?** `CLAUDE.md`. Name them explicitly in the plan.

If the task contradicts a doc, say so and resolve it by the precedence order in `CLAUDE.md` before planning further.

---

## 2. State the feature at the right altitude

Write it down in this shape. Concrete enough to implement, loose enough to survive contact with the schema.

```
FEATURE   <number + name from build-plan.md>
INTENT    one sentence: what a user can do afterwards that they cannot do now
ACTORS    customer | provider | admin | relay worker | cron | PSP webhook
TRIGGER   what starts it
OUTCOME   the state of the world when it has succeeded
NOT DOING explicitly out of scope for this task
```

`NOT DOING` is load-bearing. Scope creep in this codebase is how a task ships without its RLS test.

---

## 3. Work the questions that actually decide the design

Answer the ones that apply. Say "n/a" out loud rather than skipping silently.

**Data.** New tables or columns? Which migration? What is the RLS policy, in one sentence per role — and what is the *negative* case the test will prove? Which policy columns need an index?

**State.** Does this move a request between states? Which transition, and what guard makes it happen exactly once? Is the corresponding `applications.status` updated in the *same transaction*?

**Money.** Does anything move? Then: what is the deterministic idempotency key? What are the ledger legs, and is commission its own leg? Which `ledger_accounts.path` values, and is `allows_negative` right for each? What is the compensating posting if this needs to be undone? What is the outbox `event_type`?

**PII.** Does a provider-facing surface exist here? What exactly do they see pre-unlock? Would the UI still be safe if RLS vanished?

**Concurrency.** What happens if this runs twice at once? If a retry lands after a timeout? If a dispute races auto-release? Name the atomic operation that makes the bad interleaving impossible.

**Trust.** What is client-supplied here, and where is it re-validated server-side? Which Zod schema?

**Failure.** What does the user see when the PSP is down, the webhook never arrives, or the relay is mid-flight? Silent failure is not an option in a money path.

**Verification.** How will we *prove* this works — not observe it working once? Name the tests: RLS negative, concurrency, idempotency, invariant, integration.

---

## 4. Name the failure mode you are most likely to hit

One paragraph, honest. Not a formality — the point is to pick the design that makes that specific failure impossible rather than unlikely.

Recurring ones in this codebase: a table shipped without RLS · a PSP call left inline in a Server Action · a fee netted but never posted · a projection updated outside the ledger transaction · a `key` renamed and orphaning stored answers · a screen that only works LTR.

---

## 5. Produce the plan — as a file, not a chat message

Write it to **`specs/<NN>-<feature-slug>/plan.md`** (e.g. `specs/18-unlock-fee-reveal/plan.md`).

This matters more than it looks. A plan that lives only in the conversation dies at the next
compaction, session end, or handoff — and then `/review` has nothing to check the build against,
and the next session re-derives decisions that were already made. Committed alongside the code, the
plan is a durable record of intent that survives all three.

```markdown
# <NN> <Feature name>

Status: proposed | confirmed | built | reviewed
Date: <today>

## Intent
<one sentence — what a user can do afterwards that they cannot do now>

## Rules engaged
<which of the eleven in CLAUDE.md, by number, and how this respects each>

## Migration
<file, tables, RLS policies per role, constraints, indexes on policy columns and FKs>

## Server
<actions / route handlers / edge functions, and the guard at the top of each>

## Outbox events
<event_type per external effect, with its deterministic idempotency key — or "none">

## UI
<components reused from ui-registry.md, or new ones with justification>

## Tests
<one line each. Must include the RLS negative case, and for money: concurrency,
 idempotency, and the invariant assertion>

## Definition of Done
<the applicable build-plan.md checklist items>

## Decisions
<non-obvious choices + reason + reversible?  These get mirrored to progress-tracker.md>

## Open questions
<for the human — or "none">

## Out of scope
<restated from §2>
```

Then **stop and ask for confirmation.** Do not begin implementing. On confirmation, change
`Status:` to `confirmed` — that word is what `/review` checks the implementation against.

If the plan reveals a question from `project-overview.md` §8 — funds custody, PII exposure, weakening RLS, a non-idempotent money op, a missing PSP capability, an undecided market, a legal/ZATCA implication — surface it as a blocker for `progress-tracker.md` §4 instead of choosing a default.

---

## 6. After the human confirms

Mirror the plan's `## Decisions` into `progress-tracker.md` §5 (or §13 during build) — the spec file
carries the detail, the tracker is the index the next session actually reads. Then implement one
thing at a time, and run `/review` when the feature is complete.

**When requirements change mid-build:** update the spec file and note what changed and why. Do not
let the code drift away from a stale plan — a plan nobody maintains is worse than no plan, because
`/review` will validate against fiction.
