# Build Plan

v3, 2026-10-17, rewritten for the playbook (`docs/engineering-approach.md` §5): positions, gates, cut
list, and a target schedule for the **2026-11-07 Turkey launch**. Supersedes v2's seven phases, its
"full UI with mock data first" principle, and the 54 numbered features. Spec 0002 keeps the old
numbering; the map at the bottom translates it. **Status: confirmed by the owner 2026-10-17 (D41).**

---

## How to work

**The tracer bullet unit.** One position is one user capability, end to end, in this order, with tests
at every layer:

1. Migration (schema), with `region` on every domain table (D14)
2. RLS policies, grants, and database functions, constraints, triggers for anything rule bearing,
   with a negative test proving the wrong user is denied (rule 7)
3. Data layer: typed queries against generated types
4. Business logic: pure and unit tested
5. Server Action or Route Handler: Zod validated input, `requireRole()` first, never trusts a client value
6. UI from tokens and rules in `ar`, `tr`, `en`, checked at 390px first

A position that skips a layer says so in its spec. **Each position adds only its own write path**: its
tables, policies, and grants live in its own migration. (v2's "03 all tables first" is superseded.)

**The loop** is in `AGENTS.md` ("How we build"). A row below is checked only when its spec's acceptance
criteria are met and verified, with the date and PR, never when the code compiles.

**Pace.** Plan on about one position per working day, including spec, migration, tests, UI, and review
(the observed pace on the reference build). Record the real pace in the tracker and replan honestly
when it slips; cut early, not late.

---

## Build order

| # | Position (one capability, end to end) | Old | Brief | P | Spec | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 00 | Scaffold: Next 16, three locales, `proxy.ts`, env schema, Supabase clients, `regions` + `platform_settings`, pgTAP, CI | 01, 45 | §1, D14 | P0 | [0001](../docs/specs/0001-project-setup.md), [0003](../docs/specs/0003-multi-region-foundation.md) | ✅ 2026-08-18 |
| 00b | Scaffold completion: Sentry (PII off, tunnel), PostHog (typed events, scrubber), health endpoint, alert helper, security headers + CSP, `isDeployment()` fail closed, Vercel preview deploys, KSA switched off | 41, 42 (part) | playbook §5.3, §16 | P0 | — | ☐ |
| 01 | Sign in and roles: region step (TR only), OTP behind `lib/auth/otp-channel` (channel: Q4), Turnstile + rate limits before send, `profiles` (D16 dial code check), role set server side, `requireUser` / `requireRole`, route groups and app shell, `audit_log`, action guard meta test | 02, 04 | §2, §11–13, G27 | P0 | — | ☐ |
| 02 | Provider onboarding and approval: profile (individual or company, D9; tax identity), documents in a private bucket (signed URLs), admin approve or reject (audited), sub-merchant registration queued for 08 | 30, 50, 34 (part) | §25, G17 | P0 | — | ☐ |
| 03 | Catalog and pricing engine: categories, services, addons, zones, questions (localised jsonb), structured formulas and modifiers (no eval), minimal admin CRUD, `lib/pricing` server only, price ceiling, tamper test | 05–07b, 46 | §20, arch §19 | P0 | — | ☐ |
| 04 | Post a request: form generated from active questions, runtime Zod, server price with snapshots, address in a PII table, scheduling dates, my requests, cancel while `OPEN` | 07c, 08, 09, 31 | §13, §23 | P0 | — | ☐ |
| 05 | Provider feed and apply: PII free short details, zone filter, apply with message, contact scanner (Arabic-Indic digits), applicant cap, per provider rate limit, rival applications invisible | 10, 11 | §13, §22 | P0 | — | ☐ |
| 06 | Choose a provider: applicant list, choose → `SELECTED` + `payment_deadline`, others `NOT_SELECTED`, status timeline, deadline hardening | 12, 13, 47 | §21, §22 | P0 | — | ☐ |
| 07 | Money core, database only: chart of accounts, append only ledger, balanced posting function, idempotency with stored replay, `outbox_events`, `psp_events` (scoped dedupe), escrows, unlock fees, PSP fee leg, invariants per (region, currency); property and two session race tests | 14, 38, 39, 49 | arch §27–30, D20 | P0 | — | ☐ |
| 08 | iyzico door, relay, callbacks: `lib/psp` adapter (fake + iyzico Marketplace), relay worker (Edge Function + pg_cron, atomic claiming), verified callbacks only, sub-merchant create, reconciliation job | 15, 16, 17 | arch §5, §27 | P0 | — | ☐ |
| 09 | Customer pays: iyzico checkout form (provider hosted page only), verified result → `FUNDED`, escrow and ledger legs (price, commission, PSP fee), `unlock_deadline`, pending payment state | 20 | §21, G12 | P0 | — | ☐ |
| 10 | Unlock and reveal: chosen provider pays the unlock fee via the outbox, paid `unlock_fees` row → `UNLOCKED`, PII revealed by RLS, same query before and after test | 18 | §21, §6 | P0 | — | ☐ |
| 11 | Work and release: start → complete → `AWAITING_CONFIRMATION` + `release_deadline`, customer confirms → release (iyzico approval), auto release job, dispute versus auto release race test | 21, 47 | §21, D3 | P0 | — | ☐ |
| 12 | Expiry, cancellation, refunds: payment window expiry, unlock window expiry (max 3 re-selections, then full refund), start and completion deadline flags, cancellation matrix, refunds via iyzico | 19, 48 | §4, §36 | P0 | — | ☐ |
| 13 | Transactional email: `lib/email` door (Resend over fetch), templates in three locales, outbox driven sends with idempotency keys (chosen, paid, unlock reminder, completion, release, refund) | 25 | §24 | P0 | — | ☐ |
| 14 | Disputes, minimum: open from `UNLOCKED` / `IN_PROGRESS` / `AWAITING_CONFIRMATION`, release suspended, admin resolves full release or full refund (partial is P1) | 22 | §4, §34 | P0 | — | ☐ |
| 15 | Provider earnings view: read only mirror (pending, available, paid out). No top up, no stored balance | 23 | §6 | P1 | — | ☐ |
| 16 | Admin operations: request list, deadline flag queue, manual actions, revenue split report, admin two step login | 26, 43 | §35 | P1 | — | ☐ |
| 17 | Ratings (optional, never gates payment) | 24, 32 | §28, D4 | P2 | — | ☐ |
| 18 | In app notification centre + realtime status | 29, 13 | §24 | P2 | — | ☐ |
| 19 | Trust and quality: metrics, vetting funnel, quality floor, cold start, structured answers, reputation migration (B8, Q9) | 33–37 | §26–33 | P2 | — | ☐ |
| 20 | Invoicing adapter (gated on B9) | 51 | G18 | P2 | — | ☐ |
| 21 | Launch hardening: security review (STRIDE on auth, unlock, escrow, callbacks), RLS performance, load check, backups + tested restore, runbooks, kill switches, wipe test data, staging project, Vercel Pro | 27, 28, 40, 42, 44 | arch §37 | P0 | — | ☐ |

"Brief" cites `project-overview.md` sections until the brief is imported into `docs/brief/` (S12).

---

## Gates (run in a fresh context)

| Gate | After | Checks |
| --- | --- | --- |
| G0 | 00b | Every scaffold acceptance criterion on a clean clone; CI green on all three jobs (checks, database, e2e); a Vercel preview URL serves the placeholder in `ar`, `tr`, `en` |
| G1 | 11 | The money journey (post → apply → choose → pay → unlock → complete → release) works on a phone in all three locales against the iyzico sandbox; property, race, idempotency, and invariant tests green; Sentry live; uptime alert live; independent security review (`security-reviewer` + `/check review` on a different model) with no open Critical or Major |
| G2 | 16 (or 14 if 15–16 are cut) | Expiry, cancellation, refund, and dispute tests pass; second independent review; admin two step login |
| G3 | 21 | Launch criteria with real data (catalog from B5/B6, legal texts from B2/B9/B10); production wiped of test data and migrations reapplied; staging created; Vercel Pro; plan limits rechecked (Supabase, Resend, Sentry, PostHog); iyzico live keys; uptime and alerts verified end to end |

---

## Cut list (decided in advance)

Cut **P2 first** (19, then 18, then 17, then 20), **then P1** (16's report first, keeping the deadline
flag queue; then 15; then partial dispute resolution). **Never cut P0 reliability**: expiry, refunds,
idempotency, the reveal policy, the security review, backups.

---

## Parallel tracks (owner)

| Track | Owner steps | Blocks | Needed by |
| --- | --- | --- | --- |
| Accounts for the scaffold | S3 Vercel, S7 Sentry, S8 PostHog | 00b, G0 | 2026-10-18 |
| Design handoff and tokens | S13 (B4) | UI layer from 01 | 2026-10-19 |
| Email and bot check | S4 domain + DNS, S5 Resend + Supabase SMTP, S9 Turnstile | 01 sign in, 13 | 2026-10-19 |
| Catalog data | S17 (B5, B6): one worked category first (home cleaning) | 03 content, G3 | first category 2026-10-21, all by 2026-11-04 |
| iyzico sandbox | S1 (B11 individual sub-merchant, B3 sandbox facts) | 08–12 | 2026-10-25 |
| Uptime monitor | S10 (Q3) | G1 | 2026-10-29 |
| iyzico live terms | S2 (B3: max hold, real card fee, settlement delay) | G3 | 2026-11-03 |
| Legal | S16 (B2, B9, B10, T&C and privacy texts) | G3 | 2026-11-04 |
| Claims and legacy data | S18 (B7, B8) | public copy, 19 | before any public claim |

---

## Target schedule (a target, not a limit)

P0 alone is 16 positions in 19 days, so there is almost no slack. The critical path runs through the
owner tracks above as much as through code.

| Day | Date | Target | Owner that day |
| --- | --- | --- | --- |
| Sat | 10-17 | Playbook bootstrap ✅ | Confirm the build order (Q2) |
| Sun | 10-18 | 00b → **G0** | S3, S7, S8 |
| Mon | 10-19 | 01 sign in | S13 design handoff, S4, S5, S9 |
| Tue | 10-20 | 02 provider onboarding | |
| Wed | 10-21 | 03 catalog and pricing | S17 first category |
| Thu | 10-22 | 04 post a request | |
| Fri | 10-23 | 05 feed and apply | |
| Sat | 10-24 | 06 choose a provider | S1 sandbox facts |
| Sun | 10-25 | 07 money core | |
| Mon | 10-26 | 08 iyzico door, relay, callbacks | |
| Tue | 10-27 | 09 customer pays | |
| Wed | 10-28 | 10 unlock and reveal | S10 uptime |
| Thu | 10-29 | 11 work and release → **G1** | |
| Fri | 10-30 | 12 expiry, cancellation, refunds | |
| Sat | 10-31 | 13 transactional email | |
| Sun | 11-01 | 14 disputes | |
| Mon | 11-02 | 15, 16 if on pace → **G2** | S2 live terms |
| Tue | 11-03 | Buffer | |
| Wed | 11-04 | 21 launch hardening | S16 legal, S17 all data |
| Thu | 11-05 | **G3** checks, staging, Vercel Pro | |
| Fri | 11-06 | Go live rehearsal | |
| Sat | 11-07 | **Launch** | |

---

## Tests carried from v2 (they stay acceptance seeds)

- 03/04: a tampered client price is ignored; unknown answer keys and missing required answers are
  rejected; editing a formula never re-prices an existing request.
- 05: a provider cannot read customer PII on an open request, nor a rival's application; the contact
  scanner rejects a realistic evasion set (Arabic-Indic digits, spacing, spelled digits).
- 07: concurrent debits never go negative; a duplicate callback posts once; the invariant holds after
  randomised operation sequences (fast-check). **All three pass before 09 starts.**
- 10: PII hidden before unlock and visible after, same query, same user.
- 11, 14: the dispute versus auto release race moves funds exactly once.
- 17: skipping the rating still releases funds.

---

## Definition of done (every position)

- Every acceptance criterion met, with evidence in a `/check verify` report in `docs/reviews/`.
- Tests at every layer: pgTAP (including the negative RLS case), unit, and e2e at 390px in `ar`, `tr`,
  `en` with an axe scan. Risky paths had a failing test first.
- Money touched → idempotent, atomic, balanced, with property and race tests.
- UI touched → tokens only, logical properties, loading, empty, and error states, keyboard reachable,
  44px targets, a `ui-registry.md` row for every new component.
- No secret in client code or the repo. New env variables in `lib/env.ts` and `.env.example` together.
- Docs updated in the same change: the spec amended if the build changed it, a per position section in
  `architecture.md` / `code-standards.md` when a pattern was introduced, the tracker.
- CI green on all three jobs; `/check review` and `slice-reviewer` done; `security-reviewer` done when
  money, auth, PII, or storage was touched; high risk paths called out in the summary.

## Drift check (every few tasks)

Still on the position the tracker names? A gate skipped "for later"? A rule in `project-overview.md` §5
quietly bent? A component or dependency added without its registry or `AGENTS.md` row? An RLS policy
without its negative test? The tracker current? Any "no" gets fixed before continuing.

---

## Old feature map (v2 numbering → positions)

The old per feature notes (UI and logic bullets, tests) are kept verbatim in `feature-notes-v2.md`.
`/architect` reads the notes for a position's old features as requirement seeds, not as a decided spec.

| Old | Position | Old | Position | Old | Position |
| --- | --- | --- | --- | --- | --- |
| 01, 45 | 00 | 12, 13, 47 | 06 | 25 | 13 |
| 02, 04 | 01 | 14, 38, 39, 49 | 07 | 26, 43 | 16 |
| 03 | spread: each position creates its own tables | 15, 16, 17 | 08 | 24, 32 | 17 |
| 05, 06, 07, 07a, 07b, 46 | 03 | 20 | 09 | 29 | 18 |
| 07c, 08, 09, 31 | 04 | 18 | 10 | 33–37 | 19 |
| 10, 11 | 05 | 21 | 11 | 51 | 20 |
| 30, 50 | 02 | 19, 48 | 12 | 27, 28, 40, 44 | 21 |
| 41 | 00b | 22 | 14 | 42 | 00b (flags basics), 21 (kill switches) |
| 23 | 15 | | | | |
