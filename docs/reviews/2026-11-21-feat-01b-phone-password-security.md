# Security review: 01b, phone and password sign in (spec 0012)

**Date:** 2026-11-21 · **Branch:** `feat/01b-phone-password` · **Reviewer:** `security-reviewer` agent, read only ·
**Recommendation:** fix then ship; no high severity finding. How each finding was handled is in D201
(`context/progress-tracker.md`).

## Confirmed vulnerabilities

- **[Low] A first password sends no notice.** Migration `:385` and `:522`: the trigger's `when` list has no
  `auth.password_set`. Exploit: a fresh stolen session calls `updateUser({ password })` on an established account with
  no password (every account from before 01b, anyone who skipped the gate); other sessions end; at the owner's next
  code sign in `continue` sees `has_password` true and shows no step, and no mail goes. Fix: queue the notice on
  `auth.password_set` too; `queue_email` already skips anyone without a confirmed email, and a brand new sign up cannot
  have one.
- **[Low] `/login?reset=1` signs a visitor out on load.** `login/page.tsx:33-35,60` with `LoginForm.tsx:110-112`:
  anyone can post a link that signs out every signed in user who opens it, on that device (a nuisance; no data). Fix: a
  "Sign out and reset" button that calls `signOut`, instead of doing it in the effect.

## Likely issues

- **[Medium] The order of S44 and the cloud push.** S44 says "after 01b merges", but the migration goes to the cloud
  before the merge. In between the cloud runs Supabase's defaults: Secure password change off, minimum length 6. Any
  live session of any age could set a password, and the raw API accepts 6 characters; `password_guard` keeps it. Fix:
  apply S44 before `db push` (safe: `no_password` still blanks every password until the migration lands), and make
  AC-13's "a change on a session older than 24 hours is refused" a gate before the merge. Read the cloud Auth config at
  push time; if the dashboard hides the switch while the Email provider is off, use the Management API.
- **[Medium, before 01b, not made worse] SMS pumping through a phone change.** `phone_fixed` refuses the move only when
  the code is verified; `PUT /auth/v1/user {phone}` still sends a Verify SMS to any number first, with no CAPTCHA, and
  `/reauthenticate` drains the same project cap (S22, 200 per hour). Fix: Twilio Verify Geo Permissions limited to TR
  (SA when KSA opens) and Fraud Guard on. Confirm in AC-13 with `updateUser({ phone: '+44…' })` and Twilio's log.
- **[Low] A sign up race.** Migration `:48`: under READ COMMITTED the update sees the latest committed row. If Auth
  saves the password of an existing unconfirmed user on a repeated `/signup`, a sign up that read the row before the
  owner's verify committed and writes after it keeps the attacker's password. Hardening: also require a profile row
  (onboarding needs the owner's own session, and `continue` sends role-less users to onboarding before the password
  step, so no real flow changes).
- **[Low, before 01b] Sign up may reveal registered numbers** (`config.toml:228`, email auto confirm): a raw `/signup` on
  a registered phone may answer `422 user_already_exists`. Confirm in AC-13 on a registered and an unregistered number;
  if they differ, turn email confirmations on in the cloud.
- **[Low] Signing out other devices ends refresh tokens only.** An access token another device holds still passes
  PostgREST and RLS until it expires (`jwt_expiry = 3600`); server pages are safe (`getUser`). Fix: say "within an hour"
  in the security model, or lower `jwt_expiry`.

## Missing guardrails

- pgTAP 34: one password update under `set local role supabase_auth_admin`, so the definer chain is proven under
  Auth's real role.
- pgTAP 34: a meta test that no `public` function body except `password_guard` mentions `has_password` or
  `password_changed_at`.
- pgTAP 34: a meta test that every trigger function on `auth.users` is a definer with `search_path=""` and no API
  role's EXECUTE.
- A test that each password form's submit is disabled in the server render.
- `npm run launch:gate`: read the cloud Auth config through the Management API and fail on any test OTP entry, a
  minimum below 10, or reauthentication off (the bash guard only stops agents from `supabase config push`).
- `lib/auth/password.ts:136`: `signOutThisDevice` unused; delete it.

## Checked and sound

- `password_guard`: definer, `search_path ''`, execute revoked from public, anon, authenticated and service_role; an
  insert always blanks and sets `has_password` false (e2e proves the real Auth insert); an unchanged hash (null counts
  as empty) returns the row untouched with no audit row and no metadata write; an unproven phone is blanked even with
  the confirmation in the same statement.
- `app_metadata`: no API role can write `auth.users`; only `complete_onboarding` and `promote_to_admin` update it, both
  merging with `||`; no code calls `auth.admin`, `updateUserById` or `createUser`; neither RLS nor the JWT reads
  `has_password`.
- `phone_fixed`: definer, grants revoked; the same phone again is allowed; MFA phone is off.
- The replaced mail functions match their previous bodies except the named lines; grants unchanged; `audit_log_email`
  swallows mail errors, so mail cannot fail an Auth write; one key per audit row, no hash in the row.
- The password never reaches our server: the client goes straight to Supabase, NFC only; all three submits stay
  disabled until the token or hydration; the show and hide toggle is `type="button"`; the scrubber drops password named
  keys and keeps allow listed query parameters only; autocapture and recording off; Sentry gets codes only; e2e checks
  telemetry for both passwords and the phone.
- Enumeration: `invalid_credentials` and `phone_not_confirmed` give one message and one event reason; no Auth bans.
- Redirects: `continueTarget`, `/account/password` and the forms pass `next` through `landingFor` and `safeNext`;
  `continue` sends a relative Location with a constrained locale.
- Reset and sessions: `reason` changes only words; signing out others is retried once, then a warning.
- `config.toml`: minimum 10, no required characters, `secure_password_change = true`, Supabase's notice off, SMS
  confirmations on; test numbers 47 to 49 only in the local file.
- Change form: the phone comes from `profiles.phone` on the server; the token is used once.
