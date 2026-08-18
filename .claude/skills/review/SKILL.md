---
name: review
description: Verify a finished feature is correct, not merely working. Use after implementing any feature in this marketplace, before marking it done in progress-tracker.md, before a demo, or whenever something feels off. Reviews three layers — plan alignment, system integrity, production readiness — and reports findings by severity for the human to triage. Also use to audit work done in an earlier session.
---

# /review

**Working and correct are not the same thing.** A single successful click proves nothing about a
system where the dangerous failures are silent: a missing RLS policy raises no error, a netted
commission balances the screen but not the ledger, a `middleware.ts` protects nothing at all.

Report findings. Do not silently fix them — the human decides what gets fixed and when.
One exception: if you find a rule violation you introduced in this same session, say so and fix it.

---

## Scope first

Establish what is under review before reviewing it:

1. `git diff` (or the named files) — what actually changed.
2. **`specs/<NN>-<slug>/plan.md`** — the confirmed plan. This is the contract.
3. `context/build-plan.md` — the feature entry, if no spec file exists.

Reviewing against nothing produces opinions, not findings. If there is no plan and the feature was
non-trivial, say so as a finding — it means `/architect` was skipped, and there is no agreed
definition of correct to measure against.

---

## Layer 1 — Plan alignment

Did we build the thing we agreed to build?

- Every item in the plan's `## Definition of Done` and `## Tests`: met, partially met, or missed?
- Anything built that was **not** in scope? Extra surface is a liability, not a bonus.
- Anything in the plan quietly dropped — usually a test or a migration detail?
- Does it use the project's vocabulary exactly? It is a **request**, not an order or job posting; an **application**, not a bid or offer.
- Any default silently chosen where the plan said stop-and-ask?

---

## Layer 2 — System integrity

Check against the eleven rules in `CLAUDE.md`. These are the ones that fail silently.

**RLS.** Does every new table have RLS enabled *in its creating migration*? Is there a policy per role, and a test proving the **negative** case? Is every column referenced by a policy indexed, along with every FK? Is `auth.uid()` wrapped as `(select auth.uid())` so it evaluates once per query rather than per row?

**PII.** Is customer contact and exact address reachable only when a **`paid` `unlock_fees` row** exists for that `(request, provider)`? Not on `FUNDED` status. Not filtered in the UI. Does any provider-facing query select a column it should never see?

**Money.** Is every external effect an `outbox_events` row rather than an inline call? Are ledger inserts `ON CONFLICT (idempotency_key) DO NOTHING`? Is commission its own posting leg? Do all account paths exist in `ledger_accounts` with correct `allows_negative`? Is every amount an integer in minor units? Is the balance projection written in the *same transaction* as the ledger? Does an idempotent replay return the **stored response** rather than nothing?

**State.** Is each transition a single atomic conditional update that asserts exactly one row changed? Does every path out of `FUNDED` terminate in released, refunded, or partially released? Is `applications.status` updated in the same transaction as the request status?

**Validation.** Zod at every boundary, re-parsed server-side. External input — webhook payloads, PSP responses — validated too. Object-level authorisation, not just role: does *this* user own *this* row?

**UI.** Verified in RTL, actually viewed? Logical properties only? Four states present (loading skeleton, empty, error, success)? Money rendered from server minor units, never computed? Money and destructive actions behind a confirmation that states the exact amount? Registered in `context/ui-registry.md` with its real classes?

---

## Layer 3 — Production readiness

Would this survive a bad day?

- **Concurrency:** is there a test for parallel execution, not just a happy path? A money feature without a concurrency test is not done.
- **Idempotency:** duplicate webhook, retried action, relay restart mid-flight — does the effect happen exactly once?
- **Invariants:** does `held = released + refunded + remaining` still hold? `available >= 0`? Debits equal credits?
- **Observability:** does a failure here produce a signal a human would see, or does it vanish? Is a `correlation_id` propagated? Is anything logging PII, tokens, or card data?
- **Degradation:** PSP down, webhook never arrives, relay backed up — what does the user see? An honest message, or a half-completed flow?
- **Secrets:** nothing in client code, nothing `NEXT_PUBLIC_`, nothing committed.
- **Cost of being wrong:** if this is broken in production, is it a cosmetic bug, a stuck request, or lost money? Say which.

---

## Report

Group by severity. Be specific — `file:line`, and the concrete failing scenario, not a category name.

```
🔴 CRITICAL   money can be lost, PII can leak, or an invariant can break.
              Blocks done. Blocks merge.
🟠 MAJOR      a rule in CLAUDE.md is violated, or a required test is missing.
              Blocks done.
🟡 MINOR      correct but inconsistent with a standard. Fix now or log it.
🔵 NOTE       an observation for later. Not a defect.
```

For each: what is wrong · the input or interleaving that makes it fail · which rule or doc section it violates · the smallest correct fix.

End with a verdict and nothing softer:

- **DONE** — every layer passes; safe to tick in `progress-tracker.md`.
- **NOT DONE** — list what must close first.

Then: does the diff touch a path in `.github/CODEOWNERS` marked 🔴 (`lib/money`, `lib/psp`,
`lib/pricing`, `supabase/migrations`, `supabase/functions`)? Say so explicitly. That gate is a
code-owner review on the pull request — **it cannot be satisfied by this review, or by a green build.**

On a **DONE** verdict, set `Status: reviewed` in `specs/<NN>-<slug>/plan.md`.

---

## Escalate rather than patch

If the same defect survives one corrective attempt, stop and run `/recover`. Repeated patching of a
design problem is how a ledger gets corrupted.
