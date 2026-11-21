# Slice review: 01b, phone and password sign in (spec 0012)

**Date:** 2026-11-21 · **Branch:** `feat/01b-phone-password` · **Reviewer:** `slice-reviewer` agent, read only ·
**Recommendation:** fix then merge. How each finding was handled is in D201 (`context/progress-tracker.md`).

## Critical

None. `password_guard` was traced against every Auth write path the reviewer could reach: the insert, a write that
leaves the hash unchanged, a password plus confirmation in one statement, a raw sign up followed by the code, and a
phone change. On each path a password is kept only on a phone a code already proved, and from the browser it goes only
to Supabase Auth. All three password forms were traced too.

## Major

- `components/features/auth/PasswordLoginForm.tsx:143`, `components/features/account/ChangePasswordForm.tsx:156`,
  `components/features/account/SetPasswordForm.tsx:137`. No test protects the "no password reaches our server" rule
  before hydration. Before hydration, only the disabled submit button stops a native GET from putting `password=`,
  `current=` or `repeat=` into the URL. On the login and change forms that protection is accidental (`token` is null in
  the server render). Fix: an explicit `useHydrated()` on both forms, and an e2e with JavaScript off asserting each
  password form's submit is disabled.

## Minor

- Spec `index.md:39` still says `autocomplete="username tel"`, and lines 124 and 290 say "twenty one templates"; D200
  changed both. Amend the spec.
- `context/architecture.md:858` §15 still says "No account holds a password" and names `no_password`. Rewrite it for
  `password_guard`, `phone_fixed`, `has_password` and `password_changed_at`, and the password step at `continue`.
- `app/[locale]/(account)/account/page.tsx:42`: the "last changed" time zone is read from `user.region` (a copy in
  `app_metadata`); the owning row's region, `profile.region` (rule 10), is already loaded. Use it.
- `lib/auth/password.ts:136`: `signOutThisDevice` is exported and never called. Delete it.
- `supabase/tests/34_phone_password.test.sql:159`: nothing proves `has_password` survives `promote_to_admin` and
  `complete_onboarding`. Add both.
- Migration `:384`: `auth.password_set` sends no mail, so a fresh stolen session can set a first password on an account
  that has none, with no notice; the owner's next code sign in no longer shows the password step. Write the risk into
  the spec, or let the owner decide to mail `password_set` for established accounts.
- Migration `:85`: `phone_fixed` blocks only the final phone write; `PUT /auth/v1/user {phone}` still makes Auth text a
  code to any number (before 01b too). Add to the follow up for position 21, beside the per phone cap.

## Acceptance criteria

| AC | Status | Evidence |
| --- | --- | --- |
| AC-1 | Met (D200: `username`) | `login/page.tsx`, `PasswordLoginForm.tsx`, `PasswordField.tsx`, `password.ts`; e2e `phone-password.spec.ts` |
| AC-2 | Met | `auth-errors.ts`, `PasswordLoginForm.tsx`, `Login.errors.bad_credentials` in three locales, `tests/auth-password.test.ts`; e2e same text for unknown phone and wrong password |
| AC-3 | Met | `login/page.tsx`, `LoginForm.tsx`, `login-step.ts`, landing links, `SiteHeader.tsx` Sign in opens the password mode; e2e |
| AC-4 | Met | `lib/auth/continue.ts`, `continue/route.ts`, `actions/onboarding.ts`, `session.ts`, `PasswordSection.tsx`, `tests/auth-continue.test.ts` |
| AC-5 | Met | `account/password/page.tsx`, `SetPasswordForm.tsx`, `password.ts`, `auth-errors.ts`; e2e no `PUT /user` on refusals |
| AC-6 | Met | `account/password/page.tsx`, `continue.ts` |
| AC-7 | Met | `account/page.tsx`, `PasswordSection.tsx`, `ChangePasswordForm.tsx`, `password.ts`; e2e wrong current refused, "last changed" moves, other device signed out |
| AC-8 | Met | migration; pgTAP 34; pgTAP 05 |
| AC-9 | Met | `config.toml` |
| AC-10 | Met (D200: 24 templates) | migration (replaced bodies diffed against 14's and 16's: only the named changes); `templates.ts`; pgTAP 34, 29 |
| AC-11 | Met | `events.ts`, `scrub.ts`, `tests/observability-scrub.test.ts`; e2e `expectNothingSecret`; replay masks inputs |
| AC-12 | Met | pgTAP 05, 29, 34; unit tests; `e2e/auth.ts`; `phone-password.spec.ts`; numbers 47 to 49 |
| AC-13 | Owed (S44) | Nothing in the code contradicts it; the outbox item also needs S43 |

## Verification gaps

1. Whether Auth's minimum length counts bytes or code points (GoTrue is believed to use Go `len`, bytes). The form
   counts code points, so it is never laxer; AC-13 should send a five Arabic letter (10 byte) password raw.
2. If hosted Auth ever rehashes at sign in, `password_guard` would log `auth.password_changed` and mail a false notice.
   AC-13: after a password sign in, no new `audit_log` row.
3. AC-13's outbox item needs S43 (mail on) and a confirmed email.
4. The dry run should confirm the hosted `postgres` role can drop `no_password` and create both triggers.
5. Disabled buttons before hydration were confirmed by reading only.
6. The reviewer relied on the reported `verify`, pgTAP and e2e results.
7. CAPTCHA on `grant_type=password` in the cloud is provable only by AC-13.

## High risk paths touched

`supabase/migrations/20261129090000_phone_password.sql` (triggers on `auth.users`, four replaced mail bodies),
`supabase/config.toml`; the mail idempotency key is reused unchanged. Also sensitive: `lib/auth/**`. Not touched:
`lib/money`, `lib/psp`, `lib/pricing`, `supabase/functions`, `.claude`.
