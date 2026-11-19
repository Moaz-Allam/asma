# 0011-21. Launch hardening (position 21)

Child of [0011](index.md). Follows the cross child contract there. **High risk: auth, security, data.**

## Summary

The last position before launch. Admins sign in with a second step from an authenticator app. A staging project takes
over the previews, so production holds only real data. A restore drill proves the backups work. A load check proves 50
people at once stay fast. Cleanup jobs delete what KVKK says we must not keep. A full security review runs, runbooks are
written, the test data is wiped by the owner, and G3 is checked. There are no kill switches (owner, 2026-11-17).

## Requirements

**User stories**:
- As the owner, I want a stolen admin password or phone alone to be useless, so that money and documents stay safe.
- As the owner, I want proof that I can restore the database and that the site holds launch traffic.

**Prerequisites**: 16 merged; G2 passed. Branch `feat/21-launch-hardening`. Owner steps: Supabase Pro (D63), S34 staging,
Vercel Pro (D25), S23 firewall, S2 and iyzico live keys, S10 uptime, S16 periods.

**Acceptance criteria**:
- **AC-1**: Admin two step login with Supabase Auth MFA (TOTP): `/[locale]/admin/security` enrols an authenticator app
  through `lib/auth`; every admin page's `guardPage` sends an `aal1` admin to a challenge page; `is_admin()` returns true
  only when the token's `aal` is `aal2`. pgTAP proves an `aal1` admin token is refused by every admin policy and
  function. The UI ships one deploy before the SQL change, so the first admin enrols first (runbook step).
- **AC-2**: Staging is a second Supabase project (S34) with iyzico sandbox keys; Vercel Preview env points at it,
  Production at the production project with live keys. `lib/deployment.ts` refuses a production deployment whose
  Supabase URL is the staging ref, and a preview whose URL is the production ref (the refs as env names). Ends R4.
- **AC-3**: Restore drill: restore the latest daily backup of production (Supabase Pro) into a temporary new project, or
  a downloaded backup into the local stack, never into staging (previews use staging, and production data must not
  reach them). Run `npm run db:test` and `ledger_check` for every region, delete the temporary copy, and record the time
  and steps in `docs/runbooks/restore.md`.
- **AC-4**: Runbooks in `docs/runbooks/`: relay stalled, refund failed and refund by hand, reconcile mismatch, ledger
  unbalanced, iyzico down, Resend down, restore, rotate a secret (iyzico, relay, Resend, Sentry), SMS blocked in Turkey
  (R7), enrol or recover an admin authenticator, the wipe (AC-8).
- **AC-5**: Load check: `scripts/load.mjs` (Node `fetch`, no new dependency) runs 50 concurrent virtual users for 10
  minutes on staging with the fake PSP: open landing, sign in fixture users, browse the feed, post, apply, choose, pay.
  p95 under 1 second for pages and actions, no 5xx. Every RLS heavy query (`request_applicants`, the feed,
  `request_contacts`, `my_jobs`, `admin_requests`, `admin_revenue`) gets `explain analyze` on seeded volume with the
  indexes it needs. Results in `docs/reviews/<date>-load.md`.
- **AC-6**: Retention jobs, daily, as the relay's `retention` task (08 AC-5; `pg_cron` calls the route, because Storage
  objects and Auth users can only be deleted through their APIs): abandoned sign ups after 30 days (D101); rejected or abandoned provider
  files after `provider_file_retention_days`, doing nothing while it is unset (D114); report photos
  `report_photo_retention_days` after the report is handled (the object and its row; the report text stays), and `report-photos` objects never registered after 24 hours (0011-14 X-6). Each job
  logs counts only.
- **AC-7**: Security review: STRIDE (a checklist of spoofing, tampering, repudiation, information disclosure, denial of
  service, elevation of privilege) on sign in, the reveal, both fees, the relay and callbacks, storage; `security-reviewer`
  and `/check review` on another model; no open Critical or Major. Also reviewed here, with these defaults unless the
  review finds a reason to change them: D128's signed link stays at 60 seconds with the accepted admin risk; D98 gets a
  per phone cap of 10 codes a day only if Twilio's usage of the first weeks shows abuse (else none). Each outcome is a
  tracker decision row.
- **AC-8**: The wipe: the owner, not the agent, removes test data from production by the runbook (the bash guard blocks
  data wipes and linked resets by design), reapplies migrations, seeds settings from S17, and runs a check script that
  every domain table holds only seed rows.
- **AC-9**: Plan limits rechecked with real numbers (R3): Supabase, Vercel, Resend, Sentry (both projects), PostHog;
  Vercel firewall rules live (S23); uptime alert proven end to end (S10).
- **AC-10**: G3 passes: `npm run launch:gate` (no `[tr]`, `[draft]`, sample data, empty site address; borrowed photos
  gone, Q12), real catalog from B5 and B6, legal texts from B2, B9, B10, production wiped, staging live, Vercel Pro,
  admin two step login, iyzico live keys, alerts verified end to end.

## Decision

TOTP through Supabase's own MFA; staging as a separate project; a drill, not a promise, for backups; no kill switches.

## Feature design

**Data model**: none new besides cron jobs. `is_admin()` changes body (adds the `aal` check).

**Configuration required**:
- `SUPABASE_STAGING_REF`, `SUPABASE_PRODUCTION_REF`: project refs (not secrets) for the deployment check.
- Staging copies of every existing variable in Vercel Preview (S34).

**Security model**: admin power needs two factors; previews can never reach production data; deletion jobs are the only
writers that delete personal data, and they log counts only.

**Critical test scenarios**: an `aal1` admin token is refused everywhere (AC-1); a preview pointed at the production ref
refuses to boot (AC-2); the restore drill passes pgTAP (AC-3).

## Build plan

1. Admin MFA UI and `guardPage` change (deploy first), then the `is_admin()` migration with pgTAP; satisfies **AC-1**.
2. Deployment ref check; with S34, previews to staging; satisfies **AC-2**.
3. Retention jobs migration; satisfies **AC-6**.
4. Load script, explain plans, indexes; satisfies **AC-5**.
5. Restore drill and runbooks; satisfies **AC-3**, **AC-4**.
6. Security review and fixes; satisfies **AC-7**.
7. Owner: wipe, plan checks, live keys; G3 in a fresh context; satisfies **AC-8** to **AC-10**.

## Consequences

- Positive: the launch rests on proven restores, measured load and a reviewed attack surface.
- Negative: an admin who loses their phone is locked out until the recovery runbook is followed; no kill switch, so an
  incident is stopped by a deploy or a settings change.
- Neutral: staging doubles the Supabase projects to keep in step (every migration pushed twice).

## Rationale

Supabase MFA uses the session we already trust, so `aal2` is one claim to check in two places. A drill is the only proof a
backup restores; a promise from the plan page is not.
