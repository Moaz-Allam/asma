# Handover, 2026-11-19 (late): position 13, transactional email, mid build

For the next Claude Code session in `D:\work\web\asma`. Supersedes `docs/handover-2026-11-19.md` (that one is about
merging 12, which is done: `29c4fec`; you can delete it). Read this, then `AGENTS.md`, then the spec
`docs/specs/0011-choose-to-launch/0011-13-transactional-email.md` in full (it is the build contract; rules R-1 to R-15
win over the ACs). Do not reread the context docs; the map below is what you need.

## Owner rules in force (memory `owner-decision-style`)

- Never ask; take the recommended option, record it as a decision row, list the choices in the final report.
- **CI is GitHub only (D187).** No local `verify`, `db:test`, `test:e2e`, builds or Docker. CI runs on `pull_request`,
  so open the PR early to get feedback. `database` (pgTAP) is the fast signal; `e2e` takes about 31 minutes.
- The agent pushes the migration (CLI, dry run first, must list only `20261125090000_transactional_email.sql`) and
  merges, in that order, after the three checks pass. Never force push.
- Chat in caveman mode; code, commits, docs in normal prose. Commit messages go in a file in the session scratchpad
  (`git commit -F`), never a fixed name in shared temp.

## Where it stands

Branch `feat/13-transactional-email`, level with `origin/master`. **Nothing is committed and nothing has run.**

| Piece | State |
| --- | --- |
| Migration `supabase/migrations/20261125090000_transactional_email.sql` (1178 lines) | ✅ drafted, one fix owed (step 1) |
| Seed: `emails_enabled` on for TR (`supabase/seed.sql`) | ✅ |
| Old pgTAP files the lane split breaks: 03 (`_enabled` list), 18 and 19 (claim tests now use `payment.verify`), 20 (cron list gains `relay-email`) | ✅ edited |
| pgTAP `supabase/tests/29_transactional_email.test.sql` | ☐ designed below, not written |
| `lib/db/database.types.ts` | ☐ |
| `lib/email/` door, drivers, 20 templates, catalogue strings | ☐ |
| Relay `email` task, `/api/relay` task list | ☐ |
| `lib/env.ts`, `lib/deployment.ts`, `.env.example` | ☐ |
| Lint rule + proofs, source test, scrubber keys | ☐ |
| Account confirm page and actions, customer banner, provider prompt, `email_unconfirmed` mapping | ☐ |
| e2e, test numbers, unit tests | ☐ |
| Docs (ui-registry, build plan, tracker D192), PR, reviews, push, merge | ☐ |

## What the migration already does (read it, do not rewrite it)

Sections in order: pgcrypto in `extensions`; five settings per region (`emails_enabled`, `apply_needs_email` false;
`pay_reminder_hours` 4, `email_link_hours` 24, `confirm_reminder_hours` 24) with checks and the guard widened;
`email_confirmations` (RLS, deny policy, no grant, one live per profile); `action_counters` check widened to
`email_confirm`; two lane indexes; readers `emails_enabled(region)` (fail closed) and `email_settings(region)` (raises
`email_settings_invalid`); `queue_email(...)` (insert `on conflict do nothing`, skips unconfirmed recipients except
`confirm_email`, honours topics); `queue_audit_mail(...)` (key `email:<audit_id>:<recipient>:<template>`);
`start_email_confirmation(profile)` returns `queued` / `no_email` / `already_confirmed` / `rate_limited`;
`queue_audit_email(audit_id)` (the AC-3 map); `queue_offer_email(application_id)`; triggers `audit_log_email` (the
`when` list is the map), `applications_offer_email`, `applications_need_email`, `outbox_strip_token`; `claim_outbox`
replaced with a kind filter; `claim_email_outbox`; `finish_email(id, outcome, claim_token, detail default null)`;
`email_context(outbox_id)`; `request_email_confirmation()`, `confirm_email(token)`; `queue_reminders()`;
`emails_housekeeping()`; `relay_kick` accepts `email`; cron `relay-email` (every minute), `emails-reminders`
(`*/15`), `emails-housekeeping` (`17 3 * * *`).

`email_context` answer shape (the TS side parses this):

```json
{ "status": "skip", "reason": "email_off | stale | unconfirmed | condition" }
{ "status": "send", "template": "...", "email": "...", "locale": "ar|tr|en", "region_locale": "tr",
  "timezone": "Europe/Istanbul",
  "values": { "side": "customer|provider|null", "request_id": "uuid|null", "service": {"tr": "..."} | null,
              "start_at": "iso|null", "deadline": "iso|null", "amount": 0, "currency": "TRY|null",
              "fee_id": "uuid|null", "carried": true, "token": "base64url|null" } }
```

## Decisions taken while building (write them as one row, D192, in `context/progress-tracker.md`)

Owner standing rule (D183): recommended option each time.

1. `finish_email` gets a 4th optional `p_detail`: R-11 must store `http_422:validation_error`, and the spec's three
   argument signature has nowhere to put it. Stored only if it matches `^[a-z0-9_:]{1,100}$`, else the outcome.
2. `outbox_strip_token` is a separate trigger named to fire after `outbox_events_guard` (same timing fires in name
   order), so the guard still refuses any payload edit and only the strip drops `token`.
3. `email_confirmations` has a deny policy (`using (false)`), as `action_counters` does: test 00 requires one policy
   on every RLS table. The spec says "no policy"; the effect is the same.
4. Send time conditions for the reminders too: `pay_window_closing` needs the request still `SELECTED` (customer) or
   `COMMISSION_PAID` (provider) on that application; `closes_soon` still `AWAITING_CONFIRMATION`.
5. Confirm refusals: used → `link_used`; revoked, expired or address changed → `link_expired`; unknown, malformed or
   someone else's → `invalid_link`.
6. A `confirm_email` row kicks `relay_kick('email')` (the person is waiting for the link).
7. The counter window is `date_trunc('hour', now(), 'UTC')`, as 09's.
8. `lib/deployment.ts` cannot import `lib/email` (no `@/` imports there), so it reads `EMAIL_DRIVER` itself, as it
   does `PSP_DRIVER`: refuse `fake` on production; `EMAIL_API_KEY` and `EMAIL_FROM` required only with `resend`;
   `EMAIL_FAKE_FILE` refused on Vercel (`vercelOnly: true`, `optional: true`, `valid: () => false`).
9. The customer banner shows only while the region's `emails_enabled` is on (else "Send link again" dead ends on
   `emails_off`).
10. A late refund has no receipt, so its customer link is `/requests/<id>`.
11. Every `Email.*` string carries `[draft] ` (Turkish: `[draft] [tr] ` + English, as the legal drafts do).
12. The apply gate reads `apply_needs_email` alone (step 1), so a broken reminder setting never stops applying.

## Next steps, in order

1. **Fix the apply gate.** In the migration, `applications_need_email()` calls `email_settings()`, which raises when
   any of the five settings is bad and would block every application. Add `apply_needs_email(p_region)` (sql, stable,
   fail closed to false, like `emails_enabled`, revoke all) and use it in the trigger.
2. **pgTAP 29** (`supabase/tests/29_transactional_email.test.sql`). Copy the helpers of
   `supabase/tests/27_expiry_cancel_refunds.test.sql` (ids, `as_user`, `call_as`, `probe`, `err`, `req`, `choose`,
   `cfee`, `pfee`, `paycom`, `payfee`, `age`) and of `25_work_and_close.test.sql` (0 fee path to UNLOCKED, `today`,
   `start_job`, `finish_job`, `confirm_job`). Id prefix `...0000002900`. Users: c1 (customer, email confirmed,
   locale en), c2 (customer, no email), a1 a2 (providers, confirmed), a3 (provider, no email); profiles may be inserted
   with `email` and `email_confirmed_at` set (the guard and audit triggers are update only). Set `payments_enabled`
   and `emails_enabled` true for TR at the start (do not rely on the seed). Snapshot
   `{"rounding_minor": 100, "service": {"name": {"tr": "Temizlik", "en": "Cleaning"}}}`. Helpers worth writing:
   `who(uuid)` → tag, `mails(p)` → sorted `template>tag` list of a request's rows, `queued(audit_id)`,
   `audit(action, type, entity, new_value)` (synthetic rows; audit_log has no action check),
   `key(action, entity, who, template)`, `verdict(key)` → `send` or the skip reason. Sections: settings, checks,
   guard, reader raising (probe: disable `pricing_settings_guard`, delete a key); table RLS, policy, no grants; real
   flow on one request (3 × `new_offer`, `chosen`, `commission_received` + `pay_your_fee`, 2 × `contacts_ready`);
   replay writes nothing; unconfirmed recipient, topic off, switch off; synthetic rows for every other map row
   (late refund: insert a `fee_refunds` row `kind 'late'`, `psp_payment_id 'pay-29-late'`, `reason 'late_payment'`,
   then a `fee.late` row naming it, then `fee.refunded` on it); each "only if" through `email_context` (withdraw for
   `chosen`, cancel at COMMISSION_PAID for `pay_your_fee` and a real refund via `apply_fee_refunded`, re-pick for
   `pick_again`, provider status in a probe for `account_approved`); `email_off`, `stale`, unconfirmed at send time,
   address changed then confirmed; confirmation (digest equals `extensions.digest(token, 'sha256')`, 43 char token,
   one live, revoke on resend, rate limit 3 then `rate_limited`, used, expired by moving `created_at` and `expires_at`
   back, someone else's, malformed, anon `42501`); lanes (first mark every pending or claimed row done, because 19 and
   28 commit rows through dblink); `finish_email` outcomes and the sanitized detail; token strip on done, failed and
   an expired lease (attempts 6); the apply gate on and off; R-2 forced error (break a setting, a move still commits,
   one `email:<audit>:queue_failed` row); reminders (lead window, short window skipped, passed deadline skipped, one
   row on a second run, provider side via a 0 commission request, closes soon only with `auto_close_enabled`);
   housekeeping; grants (no anon or authenticated on internals; service role on the three relay functions;
   authenticated on the two confirmation functions); the `when` list equals the map (regex over
   `pg_get_triggerdef`); the three cron jobs. Start every assertion line with `SELECT ` and count them with grep for
   `plan(N)`.
3. **`lib/db/database.types.ts`** by hand (no Docker): table `email_confirmations`; the non trigger functions,
   alphabetical (trigger functions are not in the generated file).
4. **`lib/email/`** (`import 'server-only'`): `emailDriver()` (`getEnv().EMAIL_DRIVER`), drivers `off` (`email_off`),
   `fake` (append one JSON line `{id, key, to, from, subject, text, html, template, locale}` to `EMAIL_FAKE_FILE`;
   no file → `retry` with detail `not_configured`), `resend` (`fetch` POST `https://api.resend.com/emails`, Bearer key,
   `Idempotency-Key` = outbox key, 15 s timeout; 2xx `sent`, 409 `invalid_idempotent_request` `already_sent`, 409
   `concurrent_idempotent_requests` / 429 / 5xx / timeout `retry`, other 4xx `rejected`; detail `http_<status>:<name>`,
   never the message). Templates: one function each, `{ subject, text, html }`, strings from `messages/<locale>.json`
   `Email.<template>` through next-intl `createTranslator`; values: strip bidi controls and newlines, clamp to 120
   chars, escape the whole HTML line; one table layout shell with `dir` and `lang`; links `appOrigin()` + `/<locale>`
   + AC-5 path. Reuse `localized` (`lib/catalog/localized.ts`), `instantLabel` (`lib/requests/view.ts`),
   `formatMoney` (`lib/format/money.ts`), `appOrigin` (`lib/http/origin.ts`).
5. **Relay**: `lib/relay/email.ts` `runEmail({ db, worker, now, sleep })`: claim 10 through `claim_email_outbox`,
   25 s deadline checked before each claim, `email_context` per row, skips finish at once, sends paced to 2 a second,
   finish through `finish_email`; logs only id, template, outcome. Add `'email'` to `RELAY_TASKS` and `runTask` in
   `lib/relay/task.ts`; fix the `kind_not_built` comment in `lib/relay/drain.ts`; update the "four tasks" test in
   `tests/relay-routes.test.ts`.
6. **Env**: `lib/env.ts` (`EMAIL_DRIVER` enum default `off`; `EMAIL_API_KEY`, `EMAIL_FROM` (refine a sender shape),
   `EMAIL_FAKE_FILE` optional); `lib/deployment.ts` per decision 8; `.env.example` names (the e2e wrapper blanks every
   documented name, then sets its own).
7. **Lint** (`eslint.config.mjs`): an email key group (`EMAIL_API_KEY`, `EMAIL_FROM`, `EMAIL_DRIVER`,
   `EMAIL_FAKE_FILE`) exempt in `lib/email/**`, `lib/env.ts`, `lib/deployment.ts`; a selector for the literal
   `api.resend.com` outside `lib/email`; `@/lib/email` importable only by the `RELAY` globs and tests, plus the
   `import()` / `require()` form. Proofs in `tests/lint/eslint-rules.test.ts`; a source test that only `lib/relay`
   imports `@/lib/email`.
8. **Scrubber**: add `subject` and `html` to `PERSONAL_KEYS` in `lib/observability/scrub.ts`; tests for those and
   for `t` dropped from `/ar/account/email/confirm?t=...`.
9. **UI and catalogues**: `actions/account.ts` gains `requestEmailConfirmation` and `confirmEmail` (`guardedAction`,
   `any_role`); `lib/account/profile.ts` gains `getEmailStanding(userId)` (confirmed, `emails_enabled`,
   `apply_needs_email` for the profile's region, read with the user's client); the email field in
   `components/features/account/AccountForm.tsx` shows confirmed or not with a `type="button"` "Send link again";
   new page `app/[locale]/(account)/account/email/confirm/page.tsx` (signed out → `/login?next=/account/email/confirm?t=...`,
   `safeNext` accepts it; then `guardPage('any')`; one Confirm button posting `confirmEmail`; one message per code
   with "Send link again"); banner on `app/[locale]/(customer)/requests/(list)/page.tsx` and in the dialog of
   `components/features/requests/OfferList.tsx` (prop from `app/[locale]/(customer)/requests/[id]/page.tsx`); provider
   prompt on `provider/feed/page.tsx` and `provider/feed/[id]/page.tsx` while `apply_needs_email` is on;
   `email_unconfirmed` in `PROVIDER_FEED_DB_CODES` (`lib/provider-feed/constants.ts`) and `ProviderFeed.errors`. CI
   fails when a catalogue key is missing in one locale. New components get rows in `context/ui-registry.md`.
10. **e2e**: `e2e/transactional-email.spec.ts`. Numbers `emailCustomer: 37`, `emailProvider: 38` in `e2e/numbers.ts`
    and the six `90555{1,2,3}0000{37,38} = "123456"` lines in `supabase/config.toml`. `scripts/e2e.mjs` sets
    `EMAIL_DRIVER: 'fake'` and `EMAIL_FAKE_FILE` (an absolute path under `.next/`, not `test-results/`, which Playwright
    clears). Copy `sql()`, `script()`, `signIn`, `onboard`, `axe` from `e2e/choose-provider.spec.ts`; kick with
    `POST /api/relay`, header `x-relay-secret: e2e-relay-secret-0000000000000000000000`, body `{task: 'email'}`, then
    poll the fake file. Journeys: save an email on `/account`, read the link from the file, confirm once, a second use
    refused; and a choose plus a paid commission driven as each user (set confirmed emails by SQL in two updates: the
    address, then `email_confirmed_at`, because the guard clears it on an address change), expected templates in
    `outbox_events` and in the file. 390px, axe, three locales.
11. **Docs and ship**: tracker D192 (decisions above) and status; build plan row 13 `🚧`; PR (body ends with the Claude
    Code line); GitHub checks; reviews: `security-reviewer` (Opus) and `/check review` on Sonnet; fix; push the
    migration with the CLI (memory `supabase-cli-push-check`); merge; `/sync`.

## The map at a glance (templates, recipients, links)

Customer links `/requests/<id>` (receipt `/receipts/<fee_id>` for a paid commission or a refunded fee); provider links
`/provider/applications`; account mails `/account`; confirm `/account/email/confirm?t=<token>`.

| Template | To | Values used |
| --- | --- | --- |
| `new_offer` | customer | service |
| `chosen` | provider | service, start |
| `pay_your_fee` | provider | service, amount (provider fee), deadline |
| `commission_received` | customer | service, amount (0 when no fee row), fee_id |
| `contacts_ready` | both | service, start, side |
| `job_started` | customer | service |
| `please_confirm` | customer | service, deadline only when auto close is on |
| `job_completed` | provider | service |
| `request_cancelled` | either | service, start, refund amount (customer, when refunded) |
| `pick_again` | customer | service, carried |
| `pick_ended`, `window_missed` | provider | service |
| `payment_too_late` | payer | amount (late refund), side |
| `fee_refunded` | payer | amount, fee_id, side |
| `confirm_email` | that profile | token, deadline (link expiry) |
| `account_approved`, `account_rejected`, `account_suspended` | provider | none |
| `pay_window_closing` | customer or provider | service, deadline, side |
| `closes_soon` | customer | service, deadline |

## Gotchas found this session

- `.claude/hooks/guard-bash.mjs` blocks any shell line mentioning the env example file name, and recursive greps from
  the repo root: use the Grep tool or a subfolder.
- Race tests 19 and 28 commit rows through dblink; they persist into later test files. Scope every assertion in 29 to
  your own ids.
- Test 25 hashes all of `outbox_events` before and after; the triggers must write nothing for fixtures without a
  confirmed email (they do not).
- `apply_to_request` has no exception handler, so `email_unconfirmed` reaches `lib/provider-feed` as the message.
- Postgres `CASE` in PL/pgSQL needs an `ELSE`; the migration has them.
- Line ending warnings on the edited tests are harmless (autocrlf).

## Owner items (none block the code)

S1 iyzico sandbox facts (08b), S5 Resend key and S4 domain (then S43: `EMAIL_DRIVER=resend`, key and sender on
Vercel, `emails_enabled` on for TR, later `apply_needs_email`), R7 SMS in Turkey, B2, B5, B6, B7, B9, B10. No admin
account exists in the cloud yet. The Next.js 16.4.3 advisory notice on builds is the owner's call.
