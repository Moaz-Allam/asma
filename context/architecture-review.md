<!-- Converted from context/docs/ARCHITECTURE-REVIEW.docx by .claude/tools/docx-to-md.py.
     The .docx remains the human-authored original; edit that, then re-convert.
     Formatting (tables, images, comments) is lost in this direction. -->

## Architecture Review  -  Technical Critique

Reviewer stance: senior engineering leadership. Scope: engineering only  -  stack, correctness, operability, maintainability. Business model is settled and out of scope.
Verdict: the security model and data design are strong. The transactional integrity model is broken in one specific, serious way, the operational maturity layer is largely absent, and there is one concrete framework bug. None of this is unfixable, but items P0-1 through P0-6 must be fixed before any money moves.

### What is actually good (so the critique is calibrated)

- RLS as the authorization backbone, deny-by-default, with the browser treated as hostile. This is the correct model for a Supabase app  -  without RLS the anon key gives anyone full read/write access to every table in the public schema, and our docs get this right.
- Money as integer minor units, append-only ledger, double-entry, idempotency keys, escrow conservation constraint. This matches the canonical shape: an API layer that takes every request with an idempotency key, a payment state machine that only allows valid transitions, a double-entry ledger never edited in place, a PSP adapter, and a nightly reconciliation job that proves your books match the processor's.
- No fund custody  -  ledger positions with money at a licensed PSP. Correct and matches how ledger-first platforms are built: the ledger is the system of record that tracks every state change while all money movement runs through a connected PSP, bank, or custodian.
- PSP behind an adapter  -  the right call with the market unresolved.
- State transitions as atomic conditional updates with row-count assertions.
That foundation is sound. Everything below is what is missing or wrong on top of it.

## P0  -  Fix before any money moves

### P0-1. The dual-write problem: no transactional outbox ⚠️ most serious finding

What the docs say: "call via PSP adapter, then post ledger in one transaction."
Why that's wrong: you cannot atomically perform an external HTTP call and a database commit. If the PSP call succeeds and the process dies before commit, money moved and the ledger doesn't know. If the commit succeeds and the PSP call times out ambiguously, the ledger claims something that may not have happened. This is the classic dual-write problem and our docs currently instruct the agent to write the broken version.
The fix  -  transactional outbox. Write intent plus the ledger entry to the database first, in the same transaction, then publish to the external payment processor from a durable outbox. The outbox guarantees delivery and lets you retry without double processing. Mechanically: write the ledger entry and an outbox_events row in one Postgres transaction, then a relay publishes to the queue.
Also required: ledger inserts must be replay-safe at the SQL level  -  ledger writes keyed by transaction id and implemented with upserts or INSERT … ON CONFLICT DO NOTHING, so retried processing cannot create duplicate rows.
Action: add outbox_events table, a relay worker, and rewrite every money flow as DB-first, then outbox → PSP. Never PSP-first.

### P0-2. middleware.ts is inert on Next.js 16 🐛 concrete bug in the docs

Our docs specify "middleware protecting /requests, /provider, /admin." But Next.js 16 renamed middleware.ts to proxy.ts  -  if you have not run the codemod, your route protection is silently inactive right now. An agent following our docs on Next 16 ships an app whose route guards do nothing, with no error.
Compounding issue: we list middleware as a protection layer, which invites false confidence. proxy.ts is a UX and routing layer, not a security boundary  -  every Route Handler and Server Action must independently verify the user's identity. Our requireRole() in every action is the real control; the docs must say so explicitly and demote proxy to UX.
Action: rename to proxy.ts, and state in the docs that it is never a security boundary.

### P0-3. Append-only is a convention, not a control

The docs repeat "never UPDATE or DELETE a ledger row." That's a code-review aspiration. A single migration or a service_role script violates it silently.
The fix: enforce it in the database. Revoke UPDATE and DELETE on the postings table for all application service accounts.
Action: REVOKE UPDATE, DELETE ON ledger_entries FROM authenticated, anon, service_role; with writes only through a SECURITY DEFINER posting function. Same for ratings.

### P0-4. Sum-to-zero is enforced in application code, not the database

Our posting function throws if debits ≠ credits. But anything that bypasses the function bypasses the check.
The fix: a database-layer constraint rejects any transaction where postings do not sum to zero.
Action: deferred constraint trigger asserting per-transaction balance at commit. Belt and braces with the function check.

### P0-5. RLS performance is unaddressed  -  this will melt under load

The docs treat RLS purely as a security mechanism and never mention its cost. RLS is one of the easiest ways to wreck performance if you write policies without thinking about how the planner executes them. A naive policy turns a filtered read into a sequential scan  -  the impact on query performance can be massive, especially on queries that look at every row, and queries using limit and offset are affected too because they must query all rows to determine order.
Our provider feed is exactly this shape: a list query, over a growing table, behind a policy, with pagination.
Action: index every column used in a policy; wrap auth.uid() calls so they're evaluated once per query rather than per row; gate merged PRs on EXPLAIN ANALYZE for policy-bearing list queries; run Supabase's built-in advisors, which detect unindexed foreign keys and improperly configured RLS policies in CI.

### P0-6. Transaction-mode pooler constraints are undocumented

The docs mandate the pooler (correct) but not what it forbids. Session-level features  -  prepared statements held across statements, SET that persists, LISTEN/NOTIFY on a pooled connection  -  don't survive in transaction mode. And if your code runs on Vercel or any function-per-request platform, use the transaction-mode pooler URL and disable prepared statements in your client.
An agent that writes SET LOCAL for RLS context, or leaves prepared statements on, gets intermittent failures that look like database flakiness.
Action: document the forbidden list; disable prepared statements in client config; direct connection for migrations only.

## P1  -  Architectural gaps

### P1-1. No SAGA / compensation model

Money flows span PSP + our DB + notifications. The canonical shape includes a transactional outbox plus saga to coordinate multi-step flows across services, with reversals that preserve auditability  -  reversal entries should be explicit, with the original transaction remaining in place. Our docs describe happy-path steps and single-step compensations but no orchestrated saga with defined compensating actions per step.

### P1-2. No circuit breaker, timeout, or retry policy for the PSP

The adapter interface has no resilience contract. Needed: per-call timeouts, bounded retries with jitter, and a circuit breaker that stops cascading failures when a dependency is flaky. Without it, a slow PSP becomes a full outage of request funding.

### P1-3. Chart of accounts is too loose

ledger_entries.account text invites typos and ad-hoc account names. Required: account-path discipline  -  every account type has a stable, machine-readable path, and negative-balance permission is explicit per type in configuration. Define the chart of accounts as an enum/reference table with an explicit allows_negative flag per account.

### P1-4. The fee-netting trap is unguarded

The single most common ledger bug in marketplaces: the root cause turns out to be a fee that was netted from the settlement amount but never recorded as a separate posting. Our commission is deducted at funding  -  it must be its own posting, never an implicit subtraction inside the escrow amount. Add an explicit test.

### P1-5. Idempotency returns nothing on replay

Our helper makes replays no-ops. It should return the original result. Persist enough response data so you can answer repeat calls without recomputing, and store the provider transaction id with the idempotency record to reconcile and dedupe.

### P1-6. Balances: stored projection without a proof

We keep provider_balances as a projection. The stricter school says balance = SUM(ledger), never a stored column; the pragmatic position is balances derived from immutable ledger entries, with cached balances updated transactionally for performance. Ours is acceptable  -  but only with a job that asserts balance == SUM(ledger) per provider and alerts on drift. That assertion is currently missing (we only assert escrow conservation).

### P1-7. Notifications have the same dual-write flaw

In-app row written synchronously, external channels queued  -  but the queue publish is a second write outside the transaction. Route notifications through the same outbox.

### P1-8. No feature flags or kill switches

There is no way to disable unlock charging, funding, or payouts during an incident without a deploy. For a money system this is a serious operational gap. Add flags with a documented kill-switch runbook.

### P1-9. PSP is an unmitigated single point of failure

No degraded mode is defined. Minimum: a maintenance state that blocks new funding attempts with an honest message rather than failing mid-flow, and a documented backlog-drain procedure once the PSP recovers.

## P2  -  Operational maturity (largely absent)

### P2-1. No observability specification

The docs say "monitoring and alerts" without defining anything. Missing: OpenTelemetry tracing across Server Action → DB → outbox → PSP; a structured log schema with correlation IDs; SLOs and error budgets per critical path (funding, unlock, release); named dashboards; and alert thresholds with owners. Observability is a first-class requirement in payment system design, not a launch checklist item.
Minimum SLOs to define: funding success rate, unlock success rate, webhook processing lag, outbox drain lag, reconciliation drift, auto-release job success.

### P2-2. No incident runbooks

Money systems need written playbooks: stuck escrow, webhook storm/replay flood, failed payout, PSP outage, ledger drift detected, duplicate charge reported. Each with detection, diagnosis, containment, and a correction procedure that uses compensating entries.

### P2-3. Testing tooling never named

Our docs demand RLS tests but specify no tool. The concrete answer is pgTAP  -  Supabase includes pgTAP as an extension and supports the pg_prove test runner; tests live in supabase/tests as .sql files, with helpers to authenticate as a user, create test users, and verify RLS policies. There are pgTAP functions specifically for policy assertions: policies_are() tests that the policies on a table are only the ones that should be, policy_roles_are() tests the roles a policy applies to, and policy_cmd_is() tests the command. Add a schema-wide test that verifies RLS is enabled across an entire schema.
Also add property-based testing for ledger invariants rather than fixed fixtures: a pgTAP test asserts a specific value against a fixed fixture, while a property describes an invariant and throws hundreds of valid datasets at it, shrinking to the smallest reproducer on failure  -  well suited to aggregation invariants and RLS policy regressions.
Note: RLS cannot be tested against a mocked database. This is why the tooling choice matters.

### P2-4. No dependency patch policy  -  and this is urgent

Next.js shipped 13 fixes in May 2026 across auth bypass, DoS, SSRF, cache poisoning and XSS, with no mitigation path other than patching, and nine more in July 2026 spanning SSRF, a middleware authorization bypass, DoS, and cache disclosure. Auth-bypass classes are exactly what our threat model cannot absorb.
Action: pin versions, enable automated dependency PRs, define a patch SLA (security patches within 72 hours), and subscribe to framework advisories. Add "current framework version is patched" to the release checklist.

### P2-5. No DR targets

"Backups tested" is not a target. Define RPO and RTO, and rehearse a restore into a scratch project quarterly. For a ledger, also define the point-in-time recovery procedure and who authorises it.

### P2-6. No retention, archival, or partitioning plan

Ledger retention (append-only with 7-year retention is the norm for payment ledgers) versus PII deletion rights under KVKK/GDPR are in direct tension  -  that conflict needs a documented resolution (retain financial records, anonymise personal identifiers). Add partitioning for ledger_entries, notifications, and audit_log.

### P2-7. Admin operational tooling is under-specified

Real operations need: manual escrow release with reason, stuck-request recovery, force-refund with dual approval, webhook replay, and outbox retry  -  all audit-logged. Without these, engineers will fix production with raw SQL, which is how ledgers get corrupted.

### P2-8. No per-endpoint performance budgets

"500 concurrent users" is not actionable. Define p95 latency budgets per critical endpoint and enforce them in load tests.

### P2-9. No staging data strategy

Testing pricing formulas, RLS at volume, and reconciliation needs realistic data. Define an anonymised production-like seed; never copy live PII into staging.

## P3  -  Process and team risk

### P3-1. Single-agent development on a money system

The largest non-technical risk. Mandate human review on every diff touching lib/money, lib/psp, supabase/migrations (policies), and the outbox relay. An agent that can silently weaken an RLS policy to make a test pass is a data-breach vector.

### P3-2. No ADRs

Decisions live scattered across nine documents. Add lightweight Architecture Decision Records so the why survives.

### P3-3. Definition of Done is missing money-specific gates

Add: outbox used (no PSP-first writes), idempotency replay returns the original result, DB-level append-only verified, pgTAP suite green, EXPLAIN ANALYZE reviewed for policy-bearing queries.

## Prioritised remediation plan

#
Item
Effort
Blocks
1
Transactional outbox + relay; rewrite money flows DB-first
L
All money features
2
Rename middleware.ts → proxy.ts; demote to UX layer
S
Phase 1
3
REVOKE UPDATE/DELETE on ledger + ratings
S
Phase 4
4
Deferred sum-to-zero constraint trigger
S
Phase 4
5
RLS perf: indexes, auth.uid() wrapping, EXPLAIN gate, advisors in CI
M
Phase 3
6
Pooler constraints documented; prepared statements disabled
S
Phase 0
7
pgTAP + pg_prove + schema-wide RLS-enabled test
M
Phase 0
8
Chart of accounts with explicit allows_negative
S
Phase 4
9
Explicit commission posting + fee-netting test
S
Phase 5
10
Idempotency stores and replays the original response
S
Phase 4
11
balance == SUM(ledger) assertion job
S
Phase 4
12
Circuit breaker, timeouts, retry policy in PSP adapter
M
Phase 4
13
Feature flags + kill switches
M
Phase 5
14
Observability: OTel, SLOs, dashboards, alert thresholds
L
Phase 7
15
Incident runbooks
M
Phase 7
16
Dependency patch policy + version pinning
S
Phase 0
17
RPO/RTO + rehearsed restore
M
Phase 7
18
Retention/partitioning/PII-deletion policy
M
Phase 7
19
Admin ops tooling
M
Phase 6
20
Human review gate on money/policy diffs
S
Immediately
Items 1-7 and 16 are pre-money-flow blockers. Items 1 and 5 are the two that will hurt most if deferred: the first is a correctness flaw, the second a scalability cliff.

### The one-line summary

The design is secure and correct on paper, but it is not yet transactionally sound (no outbox), not yet operable (no observability, runbooks, or kill switches), and it contains one live framework bug (middleware.ts on Next 16). Fix the outbox first  -  everything else is recoverable in production; a broken money write path is not.
