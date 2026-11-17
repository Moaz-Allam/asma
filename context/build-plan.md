# Build Plan

v3, 2026-10-17, rewritten for the playbook (`docs/engineering-approach.md` §5): positions, gates, cut
list, and a target schedule for the **2026-11-20 Turkey launch** (replanned 2026-10-30, D94; the money positions rewritten for the cash model, D87). Supersedes v2's seven phases, its
"full UI with mock data first" principle, and the 54 numbered features. Spec 0002 keeps the old
numbering; the map at the bottom translates it. **Status: confirmed by the owner 2026-10-17 (D41); replanned by the owner 2026-10-30 (D87 to D95).**

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
| 00b | Scaffold completion: Sentry (PII off, own tunnel), PostHog (typed events, scrubber), health endpoint, alert helper, security headers + CSP, `isDeployment()` fail closed, Vercel preview deploys, KSA switched off | 41, 42 (part) | playbook §5.3, §16 | P0 | [0004](../docs/specs/0004-scaffold-completion/index.md) | ✅ 2026-10-31 (PR #20, `b0d54d7`). Code in `lib/observability/`, `lib/analytics/`, `lib/security/`, `lib/flags/`, `lib/health/`, `lib/deployment.ts` |
| 01 | Sign in and roles: region step (TR only), OTP behind `lib/auth/otp-channel` (channel: phone SMS, 6 digit code, D55; provider S20), Turnstile + rate limits before send, `profiles` (D16 dial code check), role set server side, **agreement statement tick stored with terms version and date (D92)**, `requireUser` / `requireRole`, route groups and app shell, `audit_log`, action guard meta test. Added by the owner (D101): full landing page, its SEO, full account page, as a second pull request | 02, 04 | §2, §11–13, G27 | P0 | [0005](../docs/specs/0005-sign-in/index.md) | 🚧 part 1 merged 2026-10-31 (PR #22), its real calls and reviews still owed; part 2 built 2026-11-01 on `feat/01b-landing-seo-account`, committed 2026-11-10 and not pushed |
| 02 | Provider onboarding and approval: profile (individual or company, D9), documents in a private bucket (signed URLs), admin approve or reject (audited), suspend and lift. No sub-merchant step and no IBAN (D87). The services, districts and work days step moved to 05 (D111) | 30, 50, 34 (part) | §25, G17 | P0 | [0006](../docs/specs/0006-provider-onboarding/index.md) | ✅ merged 2026-11-15 (PR #26, `5f6f283`), on local CI (GitHub CI down); three migrations in the cloud. **AC-29 real calls (and AC-16's Safari PDF) are a hard gate before G1** (D133) |
| 03 | Catalog and pricing engine: categories, services, addons, zones, questions (localised jsonb), structured formulas and modifiers (no eval), minimal admin CRUD, the engine in Postgres with `lib/pricing` as its server only door (D121), price ceiling, tamper test. Stops at the job price | 05–07b, 46 | §20, arch §19 | P0 | [0007](../docs/specs/0007-catalog-pricing-engine/index.md) | ✅ merged 2026-11-15 (PR #27, `734517b`), on local CI (D135): `npm run verify` green (929 unit), pgTAP 797, `test:e2e` 100 passed, `/check verify` passed, security, slice and `/check review` fixes in (D136, D137). Migration `20261115100000_catalog_pricing` in the cloud (S29, 2026-11-15). Code in `lib/pricing/`, `lib/catalog/`, `lib/money/parse.ts`, `actions/admin-catalog.ts`, `actions/admin-pricing.ts`, `components/features/admin/{catalog,pricing}/`. Real calls (AC-26) stay a hard gate before G1 (D135). Five Minor security findings go into 04's first migration (tracker Next) |
| 04 | Post a request: form generated from active questions, runtime Zod, server price with snapshots, address in a PII table, scheduling dates, my requests, cancel while `OPEN`, repeat a past request with the same answers (D56, scope override). Also, from D139: the commission and cash due, stored at publish. Answers are checked in SQL, not by runtime Zod (D125) | 07c, 08, 09, 31 | §13, §23 | P0 | [0008](../docs/specs/0008-post-a-request/index.md) | ✅ merged 2026-11-16 (PR #28, `1118a5b`; spec accepted 2026-11-14; D138 to D145): local CI green, `/check verify` passed, migration in the cloud (S30); SQL review findings carried to 05 (R10); AC-27 real calls owed |
| 05 | Provider feed and apply: the services, districts and work days step (`p4`, moved from 02, D111), PII free short details, zone filter, apply with message (the contact scanner exists from 02), `provider_can_apply()` in the insert policy, applicant cap, per provider rate limit, rival applications invisible | 10, 11 | §13, §22 | P0 | [0009](../docs/specs/0009-provider-feed-and-apply/index.md) | ✅ merged 2026-11-18 (PR #30, `6a7e666`; spec accepted 2026-11-16, D146 to D158): local gate (D158), security and code reviews, migration in the cloud (S31); AC-25 real calls owed |
| 06 | Choose a provider: applicant list, choose → `SELECTED` + `payment_deadline`, others `NOT_SELECTED`, status timeline, deadline hardening | 12, 13, 47 | §21, §22 | P0 | [0010](../docs/specs/0010-choose-a-provider/index.md) | ✅ merged 2026-11-18 (PR #32, `5812073`; spec 0010 accepted 2026-11-17, D159 to D164, D168): local gate, security and code reviews, migration in the cloud (S35); AC-21 real calls owed |
| 07 | Money core, database only: fee payments (commission, provider fee), append only ledger on a small chart of accounts (PSP clearing, commission revenue, provider fee revenue, PSP fees), balanced posting function, idempotency with stored replay, `outbox_events`, `psp_events` (scoped dedupe), the new fee settings replacing 00b's old flags and `hold_hours` (D95), the write guard rule `commission-netted` narrowed to `lib/pricing` (D96), invariants per (region, currency); property and two session race tests | 14, 38, 39, 49 | arch v7, §27–31, D20 | P0 | [0011](../docs/specs/0011-choose-to-launch/index.md), [07](../docs/specs/0011-choose-to-launch/0011-07-money-core.md) | ✅ merged 2026-11-18 (PR #35, `980eb5b`; spec amended D169, as built D170): local gate, security and code reviews fixed, migration in the cloud (S36); carry overs R13 |
| 08 | iyzico door, relay, callbacks: `lib/psp` adapter (fake + standard iyzico checkout, D93), relay worker (Next route `/api/relay` driven by `pg_cron` and `pg_net`, atomic claiming; spec 0011 replaces the Edge Function), verified callbacks only, refund call, reconciliation job | 15, 16, 17 | arch v7, §27 | P0 | [0011](../docs/specs/0011-choose-to-launch/index.md), [08](../docs/specs/0011-choose-to-launch/0011-08-iyzico-relay.md) | ✅ merged 2026-11-17 (PR #38, `05cd9e1`, D173, D174), against the fake; migration in the cloud (S38). 08b fills the iyzico slot after S1 |
| 09 | Customer pays the commission: hosted card page only, the split shown (job price, commission, cash due), agreement reminder line (D92), verified result → `COMMISSION_PAID`, ledger legs (commission, PSP fee), `provider_pay_deadline`, pending payment state. UI waits for S24 | 20 | §21, G12 | P0 | [0011](../docs/specs/0011-choose-to-launch/index.md), [09](../docs/specs/0011-choose-to-launch/0011-09-commission-payment.md) | ✅ merged 2026-11-17 (PR #40; spec amended and accepted 2026-11-17, D175; as built D176): local gate (D177), two reviews fixed (carry overs R14), migration in the cloud (S39); owed: the S37 window (AC-16). The fee window column is `requests.fee_deadline` |
| 10 | Provider pays, mutual reveal: chosen provider pays the fee (fixed or percent, D88) on the hosted card page, both fees `paid` → `UNLOCKED`, contact details revealed both ways by RLS, same query before and after test. UI waits for S24 | 18 | §21, §6 | P0 | [0011](../docs/specs/0011-choose-to-launch/index.md), [10](../docs/specs/0011-choose-to-launch/0011-10-provider-fee-reveal.md) | 🚧 built 2026-11-18 on `feat/10-provider-fee-reveal` (spec amended and accepted 2026-11-17, D178; as built D179): local gate green, two reviews fixed (carry overs R15); owed: the owner's migration push, merge, AC-17 in the S37 window. The reveal door is `applications.unlocked_at` |
| 11 | Work and close: start → done → `AWAITING_CONFIRMATION` + `confirm_deadline`, customer confirms → `COMPLETED`, auto close job. No money attached (D91). UI waits for S24 | 21, 47 | §21 | P0 | [0011](../docs/specs/0011-choose-to-launch/index.md), [11](../docs/specs/0011-choose-to-launch/0011-11-work-and-close.md) | ☐ spec accepted 2026-11-17 (D165, D166) |
| 12 | Expiry, cancellation, fee refunds: payment window expiry, pay window expiry (commission carries, max 3 failed picks, then refund), start and completion deadline flags, cancellation matrix, commission refund through iyzico, admin refund by hand with a recorded reason | 19, 48 | §4, §36 | P0 | [0011](../docs/specs/0011-choose-to-launch/index.md), [12](../docs/specs/0011-choose-to-launch/0011-12-expiry-cancel-refunds.md) | ☐ spec accepted 2026-11-17 (D165, D166) |
| 13 | Transactional email: `lib/email` door (Resend over fetch), templates in three locales, outbox driven sends with idempotency keys (chosen, paid, pay reminder, reveal, completion, refund) | 25 | §24 | P0 | [0011](../docs/specs/0011-choose-to-launch/index.md), [13](../docs/specs/0011-choose-to-launch/0011-13-transactional-email.md) | ☐ spec accepted 2026-11-17 (D165, D166) |
| 14 | Report a problem: either side reports after the reveal, admin queue, warn or suspend, link to the fee refund. The agreement statement text goes live (D92, S16) | 22 | §13, §34 | P0 | [0011](../docs/specs/0011-choose-to-launch/index.md), [14](../docs/specs/0011-choose-to-launch/0011-14-report-problem.md) | ☐ spec accepted 2026-11-17 (D165, D166) |
| 15 | Provider jobs and fees history: read only (jobs taken, fees paid, the cash each job was worth). No balance, no withdrawal, no top up (D91) | 23 | §6 | P1 | [0011](../docs/specs/0011-choose-to-launch/index.md), [15](../docs/specs/0011-choose-to-launch/0011-15-provider-history.md) | ☐ spec accepted 2026-11-17 (D165, D166) |
| 16 | Admin operations: request list, deadline flag queue, manual actions, revenue report | 26, 43 | §35 | P1 | [0011](../docs/specs/0011-choose-to-launch/index.md), [16](../docs/specs/0011-choose-to-launch/0011-16-admin-operations.md) | ☐ spec accepted 2026-11-17 (D165, D166) |
| 17 | Ratings (optional, never gates anything) | 24, 32 | §28, D4 | P2 | — | ☐ |
| 18 | In app notification centre + realtime status | 29, 13 | §24 | P2 | — | ☐ |
| 19 | Trust and quality: metrics, vetting funnel, quality floor, cold start, structured answers, reputation migration (B8, Q9) | 33–37 | §26–33 | P2 | — | ☐ |
| 20 | Invoicing adapter (gated on B9, which may make it P0: what must be invoiced for the two fees) | 51 | G18 | P2 | — | ☐ |
| 21 | Launch hardening: security review (STRIDE on auth, the reveal, fees, callbacks), RLS performance, load check, admin two step login (D96), backups + tested restore, runbooks, wipe test data (no kill switches: owner override 2026-11-17), staging project, Vercel Pro | 27, 28, 40, 42, 44 | arch §37 | P0 | [0011](../docs/specs/0011-choose-to-launch/index.md), [21](../docs/specs/0011-choose-to-launch/0011-21-launch-hardening.md) | ☐ spec accepted 2026-11-17 (D165, D166) |

"Brief" cites `project-overview.md` sections until the brief is imported into `docs/brief/` (S12).

---

## Gates (run in a fresh context)

| Gate | After | Checks |
| --- | --- | --- |
| G0 ✅ 2026-10-31 | 00b | Every scaffold acceptance criterion on a clean clone; CI green on all three jobs (checks, database, e2e); a Vercel preview URL serves the placeholder in `ar`, `tr`, `en` |
| G1 | 11 | The journey (post → apply → choose → commission → provider fee → reveal → done → confirmed) works on a phone in all three locales against the iyzico sandbox; property, race, idempotency, and invariant tests green; Sentry live; uptime alert live; independent security review (`security-reviewer` + `/check review` on a different model) with no open Critical or Major; **the real calls of 02 (AC-29 and AC-16's Safari PDF) pass on the preview (D133)**; **the real calls of 0007 (AC-26 and the real call section of its `verify.md`) pass on the preview (D135)** |
| G2 | 14 | Expiry, cancellation, fee refund, and report tests pass; second independent review |
| G3 | 21 | `npm run launch:gate` passes (no `[tr]` or `[draft]` marker, D100; part 2 adds the samples and the site address). Launch criteria with real data (catalog from B5/B6, legal texts and the agreement statement from B2/B9/B10); production wiped of test data and migrations reapplied; staging created; Vercel Pro; admin two step login; plan limits rechecked (Supabase, Resend, Sentry, PostHog); iyzico live keys; uptime and alerts verified end to end |

---

## Cut list (decided in advance)

Cut **P2 first** (19, then 18, then 17, then 20), **then P1** (16's report first, keeping the deadline
flag queue; then 15). **Never cut P0 reliability**: expiry, fee refunds, idempotency, the reveal policy,
the security review, backups. 17, 16 and 15 ship in the first week after launch, in that order (D96);
18 to 20 follow, unless B9 pulls 20 forward.

---

## Parallel tracks (owner)

| Track | Owner steps | Blocks | Needed by |
| --- | --- | --- | --- |
| Close 00b | Preview check of the relays, Sentry settings (D82 keys, inbound filters, onboarding run) | G0 | ✅ 2026-10-31 |
| Design handoff and tokens | S13 (B4) | UI layer from 01 | ✅ 2026-10-25 |
| Sign in | S20 SMS provider for Turkey, S9 Turnstile, S22 Supabase Auth CAPTCHA and SMS limits | 01 sign in | 2026-11-01 |
| iyzico sandbox | S1 (standard checkout on the existing account, callback, refund) | 08–12 | 2026-11-03 |
| Turkish copy | S21 translator (D58) | Turkish screens from 01 | 2026-11-02, then per position |
| Catalog data | S17 (B5, B6): one worked category first (home cleaning) | 03 content, G3 | first category 2026-11-03, all by 2026-11-14 |
| Design re-export | **S24** (screens in `docs/design/README.md`) | UI of 09, 10, 11, then 12, 14, 15 | **2026-11-08** |
| Email | S4 domain + DNS, S5 Resend + Supabase SMTP | 13, G3 | 2026-11-09 |
| Uptime monitor | S10 (Q3) | G1 | 2026-11-10 |
| iyzico live terms | S2 (B3: real card fee, settlement delay) | G3 | 2026-11-10 |
| Legal | S16 (B2, B9, B10, T&C, privacy, the agreement statement) | 14, G3 | **2026-11-14** |
| Launch accounts | Supabase Pro (D63), Vercel Pro (D25), iyzico live keys, S23 Vercel firewall | 21, G3 | Supabase Pro 2026-11-15; iyzico live keys 2026-11-17 |
| Claims and legacy data | S18 (B7, B8) | public copy, 19 | before any public claim |

---

## Target schedule (a target, not a limit)

Replanned 2026-10-30 (D94): launch moves up to 2026-11-20, using the days the cash model saves (07, 08,
11, 12 and 14 are smaller, D87). 00b ran a day past its 10-30 target, which used the one buffer day this
date allowed, so **no buffer day is left**. A slip now moves the launch or cuts scope. 07 and 08 at one
day each are the tightest estimates, and the critical path runs through the owner tracks above as much
as through code.

| Day | Date | Target | Owner that day |
| --- | --- | --- | --- |
| Sat | 10-31 | 00b → **G0** ✅, `/architect` 01 | S20, S9, S22 |
| Sun | 11-01 | 01 sign in (1 of 2) | S21 translator |
| Mon | 11-02 | 01 sign in (2 of 2) | **S1 iyzico sandbox** |
| Tue | 11-03 | 02 provider onboarding | S17 first category |
| Wed | 11-04 | 03 catalog and pricing (1 of 2) | |
| Thu | 11-05 | 03 catalog and pricing (2 of 2) | |
| Fri | 11-06 | 04 post a request | |
| Sat | 11-07 | 05 feed and apply | |
| Sun | 11-08 | 06 choose a provider | **S24 design re-export** |
| Mon | 11-09 | 07 money core | S4 domain, S5 Resend |
| Tue | 11-10 | 08 iyzico door, relay, callbacks | S10 uptime, S2 live terms |
| Wed | 11-11 | 09 customer pays the commission | |
| Thu | 11-12 | 10 provider pays, mutual reveal | |
| Fri | 11-13 | 11 work and close → **G1** | |
| Sat | 11-14 | 12 expiry, cancellation, fee refunds | **S16 legal**, S17 all data |
| Sun | 11-15 | 13 transactional email | Supabase Pro (D63) |
| Mon | 11-16 | 14 report a problem → **G2** | |
| Tue | 11-17 | 21 launch hardening (1 of 2) | iyzico live keys |
| Wed | 11-18 | 21 launch hardening (2 of 2) → **G3** checks, staging, Vercel Pro | S23 firewall |
| Thu | 11-19 | Go live rehearsal | |
| Fri | 11-20 | **Launch** | |
| After | first week | 17 ratings, 16 admin tools, 15 provider history (D96) | |

---

## Tests carried from v2 (they stay acceptance seeds)

- 03/04: a tampered client price is ignored; unknown answer keys and missing required answers are
  rejected; editing a formula never re-prices an existing request.
- 05: a provider cannot read customer PII on an open request, nor a rival's application; the contact
  scanner rejects a realistic evasion set (Arabic-Indic digits, spacing, spelled digits).
- 07: a duplicate callback posts once; a fee is charged at most once; the invariant holds after
  randomised operation sequences (fast-check). **All three pass before 09 starts.**
- 09: the commission plus the cash due equals the job price, at every percent, after the one rounding step.
- 10: contact details hidden until both have paid and visible after, same query, same user, both
  directions.
- 12: a customer cancellation racing a pay window expiry refunds the commission exactly once.
- 17: skipping the rating changes nothing.

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
