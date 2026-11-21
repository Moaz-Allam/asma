# 0012. Phone and password sign in (position 01b)

**Date**: 2026-11-20
**Status**: Accepted (by the owner's standing rule, 2026-11-20, after a cross check on Sonnet; D199)
**Amends**: [0005](../0005-sign-in/index.md) AC-1 (the daily sign in) and AC-3 (no account holds a password). Everything
else in 0005 stands: the code route, the bot check, the region hook, onboarding, the account page.
**Amended**: 2026-11-21, after the build and its slice and security reviews, by decisions that win over the first text:
D200 (`autocomplete="username"` in AC-1; the real template count is 24) and D201 (AC-8 also requires a profile; AC-10
mails a first password too; AC-3's reset asks with a button instead of signing out on load; AC-11 holds every password
submit disabled until hydration; S44 comes before the cloud push; the security model states the hour long access token;
AC-13 gains six calls). This text now says what was built; cross checked on Sonnet (3 Major, 7 Minor, all applied as
text) and accepted by the owner 2026-11-21.

## Summary

Today every sign in sends an SMS code. With this change, a person proves their phone with one SMS code when they
create an account, then sets a password, and signs in after that with phone and password. A code is sent again only
to create an account or to reset a forgotten password. This cuts SMS cost, and returning users can still sign in if
SMS delivery in Turkey fails (R7). A password is only ever saved on an account whose phone a code has already
proven, so nobody can register someone else's number with a password of their own.

## Requirements

**User stories**:
- As a returning customer or provider, I want to sign in with my phone and a password, so that I do not wait for an
  SMS every time.
- As a new user, I want to prove my phone once with a code and then choose a password, so that my account is mine.
- As a user who forgot my password, I want to reset it with an SMS code, so that I am never locked out.
- As a user, I want to change my password from my account page, and see when it last changed.
- As the owner, I want fewer SMS sent, and no way for anyone to place a password on a phone they do not hold.

**Prerequisites** (owner steps, not acceptance criteria):
- **S44** (done 2026-11-21), **before the migration is pushed** (D201: until then 0005's `no_password` still blanks every
  password, while a push first would leave the cloud on Supabase's defaults, minimum 6 and no reauthentication). In the
  cloud project's Auth settings: minimum password length **10**, no required character classes;
  **Secure password change on** (a password change needs a session younger than 24 hours, or a code); **Require
  current password off** (its behaviour for an account with no password is undocumented, and the gate would loop);
  Supabase's own "password changed" notification email **off** (our users' email lives in `profiles`, and 13 sends
  the notice); **Prevent use of leaked passwords on** once the project is on Pro (D63; Free does not offer it).
  CAPTCHA stays on from S22: it covers the password sign in too. Then the real calls of AC-13, which also need the cloud
  Phone provider on (S20, S22) and, for the notice, mail on (S43).

**Acceptance criteria** (the contract):

- **AC-1, password sign in.** `/{locale}/login` opens on phone and password (an unknown `mode` means this mode). The
  phone field is 0005's (0005 AC-2: the same formats, Arabic Indic digits folded in `lib/region/phone.ts`, the same
  format and region refusals with 0005's messages and no Auth call). The password field hides the text with a show and
  hide button and uses `autocomplete="current-password"`; the phone field uses `autocomplete="username"`, so
  password managers pair the two (D200: not `username tel`, because the HTML autofill grammar takes one field name and
  axe fails two, WCAG 1.3.5; `type="tel"` keeps the number keypad). The password is sent exactly as typed after Unicode NFC normalization: never trimmed, its
  digits never folded. Submitting needs a live bot check token (0005 AC-4). The browser calls Supabase Auth
  `signInWithPassword({ phone, password, options: { captchaToken } })` through `lib/auth`, never a Server Action of
  ours (D98). An empty password field shows `password_empty` ("Enter your password.") with no Auth call. Success goes to
  `/{locale}/continue`, keeping `next` and `as`.
- **AC-2, nothing reveals an account.** For a phone that passes the AC-1 format and region check, an unknown phone, a
  wrong password and an account with no password yet all show one message (`bad_credentials`: "That phone and
  password do not match"; the empty field message of AC-1 is about the form, not the account), with the links of AC-3 beside it. Auth's codes map as: `invalid_credentials` and
  `phone_not_confirmed` → `bad_credentials`; `captcha_failed` → `bot_check_failed`; `over_request_rate_limit` →
  `limit_ip`; a dropped request → `network`; any other code → `network` with `report: true`, never
  `bad_credentials`. No raw Auth message ever shows. Response timing is Auth's and is not claimed equal. An event
  `password_sign_in_failed { reason }` fires with `reason` one of `credentials`, `limit`, `bot_check`, `network`,
  never the phone.
- **AC-3, the code route stays.** `/{locale}/login?mode=code` is 0005's phone and code flow, unchanged (0005 AC-1 to
  AC-6, its limits, its `login_step` storage). The password mode links to it twice: "New here? Create an account"
  (`?mode=code`) and "Forgot your password?" (`?mode=code&reset=1`), each keeping `as=provider` and `next`. `reset=1`
  alone also opens the code mode. The code
  mode links back: "I have a password". The landing page's start buttons (hero, closing call, the provider join link)
  open `?mode=code`; the header's Sign in opens the password mode. `reset=1` is kept with the phone in `login_step`, so
  a reload on the code step keeps it, and goes to `continue` after the code. A signed in visitor still goes from
  `/login` to `/continue` (as today), except when the URL carries `reset=1`: then the page asks first. It shows the
  reset title, a line saying this device is signed in, and a "Sign out and reset" button; the click signs this device
  out (the `signOut` action) and shows the code mode, so a reset always starts from a fresh code session. Opening the
  link alone signs nobody out (D201: a posted `?reset=1` link signed out everyone who opened it). If that sign out
  fails, the reset still goes on: the code sign in replaces this device's session, and AC-5's sign out of every other
  session ends the old one; if that also fails, only AC-5's warning shows and the old session stays valid.
- **AC-4, a password is required, at `continue`.** `/{locale}/continue` routes, in order: no role → onboarding (as
  today); a role and no password → `/{locale}/account/password?next=…`; `reset=1` → `/{locale}/account/password?
  reason=reset&next=…`; otherwise the landing (as today). Onboarding's success now goes to `continue` (with `next` and
  `as`), so a new account reaches the password step. "Has a password" is `app_metadata.has_password` on the user that
  `getUser` returns, so it is fresh right after a change; the JWT and RLS never read it. `reset=1` on an account with no
  password lands on the first password step (the order above), so its words and its event reason are `first`. This gate is a guide, not a
  boundary: `guardPage`, `requireRole` and `guardedAction` stay as they are, a user with a role and no password can
  still use the app until their next code sign in brings them back to the gate, and rule 11 (a role) is unchanged.
  The account page shows a reminder with a link while no password is set.
- **AC-5, setting a password.** `/{locale}/account/password` (signed in, any role) shows a new password field and a
  repeat field, each with show and hide and `autocomplete="new-password"`, and the rules in words. With a password
  already set and no `reason`, the page sends to `/account`. The form refuses before calling Auth:
  - fewer than 10 characters (counted in Unicode code points), or more than 72 bytes in UTF 8 (Auth's limit, counted
    with `TextEncoder`; the message says it in plain words: about 72 Latin letters or about 36 Arabic letters);
  - two fields that differ;
  - a weak choice, by a check in the browser only (the password never reaches our server, so the raw API can skip it,
    which is accepted): only digits, one repeated character, containing the account's own phone digits (the national
    ten), or on a bundled list of the 1,000 most common passwords (`lib/auth/common-passwords.ts`, from SecLists' top
    1,000, MIT, recorded in its header).
  It normalizes to NFC exactly as AC-1, calls `updateUser({ password })` through `lib/auth`, then signs out every other
  session (`signOut({ scope: 'others' })`, retried once; if both fail it shows "Other devices may still be signed in"
  and reports to Sentry), fires `password_set { reason }` on success only (`first` when the user had no password,
  `reset` with `reason=reset`, `change` from AC-7), and goes to `next` or the landing. Auth errors map: `weak_password`
  → `weak_password` (the message asks for a longer or less common one, covering Pro's leaked check later),
  `same_password` → `same_password`, `reauthentication_needed` → `reauth_needed` ("Sign in again with a code to
  continue": a link to `?mode=code&reset=1&next=…` carrying the page's own `next`; that page then asks, AC-3), a dropped request → `network`, any other
  → `network` with `report: true`.
- **AC-6, reset.** With `reason=reset` the page says the password is being replaced and asks no current password: the
  code sign in that led here has just created the session, so Secure password change lets it through. `reason` in the
  URL only changes words and the event reason; Auth decides what is allowed.
- **AC-7, change from the account page.** `/{locale}/account` gains a Password section: when it was last changed
  (`app_metadata.password_changed_at`, in the region's time zone), and a change form: current password, new password,
  repeat, one bot check. The browser first calls `signInWithPassword` with the account's own phone (read on the server
  from `profiles.phone` and passed to the form, never typed), the current password and the token, then `updateUser({
  password })` with the session that call returned, then signs out other sessions as AC-5. The token is used once, by
  the sign in. A wrong current password shows `bad_credentials`; so does an empty one, with no Auth call. "Forgot it?"
  is a link to `?mode=code&reset=1&next=/account`; that page then asks before signing out (AC-3). The current password check guards against slips, not attackers: anyone holding a session
  younger than 24 hours can call `updateUser` directly, which the security model accepts.
- **AC-8, the database guards.** A migration replaces 0005's `no_password` trigger on `auth.users` with
  `password_guard`, `before insert or update of encrypted_password`, one `security definer` function with `search_path
  = ''` and every API role revoked (Auth's own role runs it):
  - insert: the password is always blanked and `has_password` set false, because an account is only ever created by a
    code; a sign up that carries a password (a raw API call) saves none;
  - update where `new.encrypted_password is not distinct from old.encrypted_password`: return `new` untouched (Auth
    lists the column on most of its writes; nothing may happen on those);
  - update to a different, non empty value: kept only when `old.phone_confirmed_at` is not null, meaning a code had
    proven the phone before this write, **and** a `profiles` row exists for the account (onboarding wrote it, with the
    owner's own session, after the code); otherwise blanked. So registering someone else's number with a password,
    then waiting for them to confirm it, saves nothing (D104 holds). The profile rule (D201) closes a race: under READ
    COMMITTED a repeated raw sign up that read the row before the owner's code committed, and writes after it, would
    see the confirmation in `old`. `continue` sends onboarding before the password step, so no real flow changes. A
    refused write blanks the column, even over an existing hash; that needs an account holding a password without a
    profile, which cannot happen (a password is kept only with a profile, and no role deletes one, 0005 AC-24);
  - after the rule, on a changed value: `raw_app_meta_data.has_password := (new.encrypted_password <> '')`; when a
    non empty password is kept, `raw_app_meta_data.password_changed_at := now()` and one `audit_log` row:
    `auth.password_set` when the old value was empty, `auth.password_changed` otherwise; actor `new.id` (`auth.uid()`
    is null in Auth's connection), entity type `auth_users`, entity `new.id`, region from `profiles.region` (a kept
    write always has a profile), values holding no hash.
  A second trigger, `phone_fixed`, `before update of phone on auth.users`, raises `phone_immutable` when `old.phone`
  is neither null nor empty and `new.phone` differs, so a phone change through `updateUser({ phone })` cannot move the sign in key
  away from `profiles.phone` (an exposure 0005 left open that password sign in makes worse).
- **AC-9, Auth settings.** Local `supabase/config.toml`: `minimum_password_length = 10` (from 6), `password_requirements
  = ""`, `[auth.email] secure_password_change = true` (from false; it is the project wide switch despite its section),
  `[auth.email.notification.password_changed]` left off. The e2e stack runs on these. The cloud settings are S44. The
  per IP limit on sign ins and verifies stays at Auth's default, 30 in 5 minutes.
- **AC-10, the notice.** An `auth.password_set` or `auth.password_changed` audit row queues 13's mail
  `password_changed` to the account owner when they have a confirmed email (13's rule): a password was saved on the
  account, when, and if it was not them, reset it with an SMS code and contact support. A brand new sign up has no
  confirmed address at its first password, so it gets nothing; an established account that sets its first password
  gets the notice (D201: a fresh stolen session could otherwise set one on an account with none, unseen, and the
  owner's next code sign in would no longer show the password step). So a person who confirms an email before setting
  their first password, and every account from before 01b that has a confirmed email, gets it on their own first set;
  that is accepted, and the mail's "if this was not you" wording fits both cases. Most users have no email, so the AC-7 "last
  changed" line is their notice; that gap is accepted. `queue_email` and `email_context` (14's bodies, for the new
  template) and `queue_audit_email` and the `audit_log_email` trigger (16's bodies, `20261128090000_admin_operations.sql`)
  are replaced from their latest bodies plus these two actions; pgTAP 29's mapping list and template count follow (24
  templates: 14 had already brought 13's twenty to 23, D200). Mail stays off until S43.
- **AC-11, words, events, privacy.** Every new string lives in `ar`, `tr` and `en` (Login, Account). The events
  `password_signed_in`, `password_sign_in_failed { reason }` and `password_set { reason }` are typed in
  `lib/analytics/events.ts` and pass its filter. No phone and no password ever reaches an event, a log, Sentry or our
  server: the password goes from the browser to Supabase Auth only. A unit test proves the scrubber drops any key
  named like `password`. Every password form's submit (login, set or reset, change) stays disabled until the page has
  hydrated (`useHydrated`), so a tap or Enter before then can never be a native GET carrying a password into a URL
  (D201); `password_set` is sent as a beacon, because a full page load follows.
- **AC-12, tests.**
  - pgTAP: `05_sign_in` updated (insert, unconfirmed update and a proven phone with no profile stay blank, a proven and
    onboarded change keeps); a new `34_phone_password`: every branch of AC-8 (the no profile branch too), an update of
    `last_sign_in_at` alone writing no audit row and leaving `has_password` alone, the blanked branch leaving
    `has_password` false, `password_set` then `password_changed`, `has_password` surviving `complete_onboarding` and
    `promote_to_admin`, `phone_fixed`, the grants, two guardrails (every public trigger function on `auth.users` is a
    definer with an empty `search_path` and no API grant; no public function but `password_guard` names `has_password`
    or `password_changed_at`), the mail map for both actions. The local test runner may not become
    `supabase_auth_admin`, so the chain under Auth's own role is proven by the e2e, which writes through real Auth.
  - Unit: `lib/auth/password.ts` and its error map, the NFC and 72 byte counts (Arabic and Turkish samples), the weak
    check, the `continue` routing, the account page reminder.
  - e2e at 390px with axe in three locales, test numbers 47 to 49: a new account by code, onboarding, the password step,
    sign out, sign in with the password, a wrong password message, a reset by code and the new password working (from
    the login and, signed in, through the "Sign out and reset" button), a change from the account page with "last
    changed" updated and the other device signed out, a raw sign up whose password is never saved, and the three
    password forms' submits disabled with JavaScript off.
  - The 13 copies of the sign in and onboarding helpers in `e2e/` become one shared module with one test password
    constant; a first sign in sets the password on the gate page. A fixture that writes a user by SQL may give it a
    password only by an update after `phone_confirmed_at` is set (the insert would blank it).
- **AC-13, real calls** (recorded in `0005-sign-in/verify.md` under 01b, after S44, on a preview): a password sign in
  with a real Turnstile token; the same call with no token refused; a raw `signup` with phone and password leaving no
  password; a first password set on a session older than 24 hours for an account with no password (if Auth answers
  `reauthentication_needed`, AC-5's exit to the code route is what users get, and it is noted); the reset session
  passing Secure password change; a change on a session older than 24 hours refused; a 10 character Arabic password
  accepted; `updateUser({ phone })` refused by `phone_fixed`; the exact Auth error codes seen, checked against AC-2 and
  AC-5's maps; the notice reaching the outbox (needs S43 and a confirmed address). Added by D201: the change on a
  session older than 24 hours being refused is a **gate before the merge**; a five Arabic letter (10 byte) password
  sent raw, to learn whether Auth's floor counts bytes or code points (the form counts code points, so it is never
  laxer); no new `audit_log` row after a password sign in (Auth never rehashes on sign in); `updateUser({ phone:
  '+44…' })` checked in Twilio's log (SMS cost, S20's Geo Permissions and Fraud Guard); a raw `signup` on a registered
  and on an unregistered number answering alike (if they differ, turn email confirmations on in the cloud). A stub
  proves the SDK, never the settings.

## Decision

**Chosen option**: Option 1: Phone and password, the password saved only after a code has proven the phone.

The code stays for creating an account and resetting a password; daily sign in uses phone and password through
Supabase Auth, and a database trigger refuses any password on an account whose phone no code has proven.

**Implementation skills**: `supabase` (`supabase/agent-skills`, `.claude/skills/supabase/`) · `supabase-postgres-best-practices` (`supabase/agent-skills`, `.claude/skills/supabase-postgres-best-practices/`) · `twilio-verify-send-otp` (`twilio/ai`, `.claude/skills/twilio-verify-send-otp/`)

## Feature design

**Data model sketch**: no new table and no new column. `auth.users.encrypted_password` (Auth's own) is guarded by
`password_guard`; `auth.users.phone` by `phone_fixed`; `auth.users.raw_app_meta_data` gains `has_password` (boolean,
absent means false) and `password_changed_at` (timestamp), written only by `password_guard` (a pgTAP guardrail checks no
other public function names them); `audit_log` gains the actions `auth.password_set` and `auth.password_changed`, both
mailed.

**State transitions** (per account):
`no account` → (code verified, 0005) → `phone proven, no role` → (onboarding) → `role, no password` → (AC-5) →
`role, password`. `role, password` → (AC-6 reset or AC-7 change) → `role, password` (new). A password never exists in
`no account`, before the phone is proven, or before onboarding (D201).

**API surface** (all in the browser through `lib/auth`, straight to Supabase Auth, as D98; no Server Action and no
Route Handler is added, so 01's action guard test is unchanged):

| Call | Where | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `signInWithPassword` | login, password mode; AC-7's first step | phone (E.164), password (NFC), captchaToken | session | public, CAPTCHA, per IP limit | `bad_credentials`, `bot_check_failed`, `limit_ip`, `network` |
| `signInWithOtp` / `verifyOtp` | login, code mode | as 0005 | session | as 0005 | as 0005 |
| `updateUser({ password })` | `/account/password`, account page | new password (NFC) | user | session younger than 24 h | `weak_password`, `same_password`, `reauth_needed`, `network` |
| `signOut({ scope: 'others' })` | after any set or change | none | none | session | retried once, then a warning |
| `signOut` action (`signOutHere`, `scope: 'local'`) | the "Sign out and reset" button on `?mode=code&reset=1` for a signed in visitor (reached from "Forgot it?" and `reauth_needed`) | none | none | session | a failure still goes on: the code sign in replaces the session |
| `GET /{locale}/continue` | after any sign in and after onboarding | `reset`, `as`, `next` | redirect | session | to login when none |

`lib/auth/password.ts` exports `signInWithPassword`, `setPassword`, `changePassword` (the AC-7 pair),
`signOutOtherDevices` and the pure checks (`passwordProblems(text, phone)`); `lib/auth/auth-errors.ts` gains the maps;
`lib/auth/session.ts` puts `hasPassword` and `passwordChangedAt` on `SessionUser` from `app_metadata`.

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| Password sign in | phone in E.164 | the phone field, folded by `lib/region/phone.ts` (0005 AC-2) |
| Password sign in | bot check token | the Turnstile widget (0005 AC-4) |
| `continue` | whether to send to `/account/password` | `app_metadata.has_password` from `getUser`, written by `password_guard` |
| `continue` | reset intent | the `reset=1` query, carried from the login link through `login_step` (AC-3) |
| Set password | the length rules (10 code points, 72 bytes) | Auth settings (AC-9, S44), repeated in the form for its messages |
| Set password | the weak list and the phone digits | `lib/auth/common-passwords.ts`; the phone from `profiles.phone`, passed by the server page |
| Set password | the event reason | `first` from `has_password` false, `reset` from `reason=reset`, `change` from AC-7 |
| Change password | the account's phone | `profiles.phone` read on the server page and passed to the form |
| Account page | last changed | `app_metadata.password_changed_at`, shown in `regions.timezone` of the user's region |
| Notice (set or change) | recipient and send rule | the user's confirmed email, 13's `queue_audit_mail`; both audit actions (D201) |
| Notice | the time it names | the outbox row's `created_at` (`changed_at` in `email_context`, written in the same transaction as the change), shown in `regions.timezone` of the user's region and the profile's locale |
| Notice | the button | label `Email.password_changed.action`, target `/{locale}/login?mode=code&reset=1` in the recipient's locale |
| Notice | how long it may wait | 24 hours from the change (`queue_audit_mail`'s send window), then dropped |
| Notice | whether a preference can silence it | never: it carries no topic, so the notice switches of the account page do not apply |
| Audit rows | actor, entity, region | `new.id`; region from `profiles.region` (a kept write always has a profile, D201) |
| Account page | the time zone of "last changed" | `profiles.region` through `getProfile` (the owning row, rule 10), never the `app_metadata` copy |

**Key invariants**:
- No account ever holds a password unless a code proved its phone before the password was written and onboarding
  made its profile (AC-8, D201).
- Every password submit is disabled until hydration, so no password ever rides in a URL (AC-11).
- An Auth write that does not change the password changes nothing else either (AC-8).
- A password sign in never reveals whether a phone has an account (AC-2).
- A password never passes through our server, a log, an event or Sentry (AC-11).
- `has_password` and `password_changed_at` are written only by `password_guard`; no API role can write `app_metadata`
  (0005 AC-9).
- `auth.users.phone` never changes once set (AC-8).

**Security model**: Supabase Auth checks the password, the bot check token and the per IP limit; the app adds nothing
in between (D98). Credential stuffing is bounded only by the bot check and the per IP cap: this plan has no per
account lockout and no leaked password check before Pro. A stolen session older than 24 hours cannot change the
password without a code (Secure password change); a fresh one can, by calling Auth directly, and then the owner sees
"last changed", gets the notice if they have email (for a first password too, D201), and every other session ends.
Ending other sessions revokes their refresh tokens at once; an access token another device already holds still passes
PostgREST and RLS until it expires (one hour, `jwt_expiry`), while server pages refuse it at once because they ask
`getUser`. Lowering `jwt_expiry` is the lever if the owner wants a shorter window. A signed in account can still make
Auth text a code to any number through `updateUser({ phone })` or `reauthenticate` (no CAPTCHA there; it existed
before 01b): `phone_fixed` stops the move, and S20's Turkey only Geo Permissions and Fraud Guard bound the cost. Admins sign in the same way and
pass the same gate; `promote_to_admin` merges into `app_metadata`, so `has_password` survives it; position 21 adds
their second factor (`aal2`). KVKK: no new personal data is collected; the hash stays inside Auth. Recovery stays SMS
based, so a SIM swap remains the same risk it is today.

**Configuration required**: no new environment variable. Auth settings only: AC-9 locally, S44 in the cloud.

**Critical test scenarios**:
- Happy path: code, onboarding, password, sign out, password sign in lands home, verifies **AC-1**, **AC-4**, **AC-5**.
- Failure: a raw sign up with a password, then the code, leaves no password and `continue` asks for one, verifies **AC-8**.
- Failure: an Auth write of `last_sign_in_at` alone writes no audit row, verifies **AC-8**.
- Failure: unknown phone and wrong password show the same message, verifies **AC-2**.
- Reset: a code with `reset=1` lands on the reset page and the new password works, verifies **AC-3**, **AC-6**.
- Change: the wrong current password is refused; the right one changes it, updates "last changed" and ends other
  sessions, verifies **AC-7**.
- Permission: no API role can call `password_guard`, write `app_metadata` or change `auth.users.phone`, verifies **AC-8**.
- Failure: a password on a proven phone with no profile yet is blanked, verifies **AC-8** (D201).
- Privacy: with JavaScript off, every password form's submit is disabled, verifies **AC-11** (D201).
- Abuse: opening `/login?reset=1` while signed in signs nobody out until the button is pressed, verifies **AC-3** (D201).

## Migration plan

**Strategy**: no flag; the gate at `continue` is the migration (there are no real users before launch).
**Phases**:
1. S44 turns on the cloud settings first (D201); `no_password` still blanks every password, so this is safe alone.
2. The migration ships the triggers (pushed 2026-11-21); existing accounts keep working, and at their next code sign in
   `continue` asks each for a password.
3. The real calls of AC-13 prove the settings, once the Phone provider is on (S20, S22).
**Rollback**: revert the pull request (which removes the password pages, the gate at `continue` and every read of
`has_password`) and ship a migration that puts back 0005's `no_password` trigger, drops `password_guard` and
`phone_fixed`, and restores the previous bodies of `queue_email`, `email_context`, `queue_audit_email` and the
`audit_log_email` trigger (14's and 16's). `no_password` blanks a password at the next write that changes it; until
then saved passwords keep working, and the code route never left.
**Risks**: Secure password change behaving differently for phone accounts than documented, and the exact Auth error
codes (AC-13 proves both before anyone relies on them).

## Build plan

Tracer bullet, tests first on the risky path (the triggers and the error maps).

1. pgTAP `34_phone_password` and the `05_sign_in` update first, then migration
   `20261129090000_phone_password.sql`: `password_guard` replacing `no_password`, `phone_fixed`, `has_password` and
   `password_changed_at`, the audit rows, `queue_audit_email` and its trigger from 16's bodies plus
   `auth.password_changed`, pgTAP 29's list, satisfies **AC-8**, **AC-10**.
2. `supabase/config.toml` password settings, satisfies **AC-9**.
3. Unit tests first, then `lib/auth/password.ts`, `common-passwords.ts` and the `auth-errors.ts` maps, satisfies
   **AC-1**, **AC-2**, **AC-5**, **AC-6**, **AC-7**.
4. `session.ts` (`hasPassword`, `passwordChangedAt`), the `continue` routing and onboarding's success target, with unit
   tests, satisfies **AC-4**, **AC-6**.
5. The login page's two modes, the links, the reset sign out, the landing buttons, satisfies **AC-1**, **AC-2**,
   **AC-3**.
6. `/account/password` with the set and reset form, and the account page's Password section (last changed, reminder,
   change form with the bot check), satisfies **AC-4**, **AC-5**, **AC-6**, **AC-7**.
7. The `password_changed` mail template in three locales, satisfies **AC-10**.
8. Events, the scrubber test, every string in three locales, satisfies **AC-11**.
9. The shared e2e helper replacing the 13 copies, then `e2e/phone-password.spec.ts`, satisfies **AC-12**.
10. After S44 and the merge: the real calls in `verify.md`, satisfies **AC-13**.

## Consequences

**Positive**:
- SMS only at sign up, reset and recovery: lower Twilio cost, and returning users still get in if Turkish SMS
  delivery breaks (R7).
- The pre registration attack 0005 closed by banning passwords stays closed, now by the proven phone rule, and the
  phone can no longer be changed under the account.

**Negative / tradeoffs**:
- Passwords bring guessing and reuse attacks, bounded only by the bot check and the per IP cap: no per account
  lockout on this plan, and no leaked password check until Pro. On shared mobile carrier addresses the per IP cap can
  also block real users at a busy moment; it is watched, not changed.
- A fresh stolen session can change the password; most users have no email, so the "last changed" line is their only
  notice.
- One more screen when signing up, and a password step for every existing account at its next code sign in. A user
  can skip it by leaving the page and keep using codes until then.
- Every e2e spec's sign in helper changes (folded into one shared module).
- People who forget passwords still cost an SMS; the saving depends on how often people sign out or change devices,
  since sessions already last a long time.

**Neutral**:
- `auth.users` keeps a password hash for most accounts, inside Auth only.
- The `password_changed` mail joins 13's list (24 templates, D200) and covers a first password too (D201); a 1,000 word
  list ships in the browser bundle of the password pages only.
- A password is kept only after onboarding (D201): an account that has proven its phone but not onboarded cannot hold
  one, which no real flow needs.

## Follow-up

- [x] S44 (owner): the cloud Auth settings above, done 2026-11-21 before the migration push.
- [ ] S20 and S22 (owner): the cloud Phone provider on with Twilio Verify, then AC-13's real calls with D201's additions;
      the 24 hour change refusal gates the merge.
- [ ] Proposed, not added (tooling gap, ask first; R22): `npm run launch:gate` reads the cloud Auth config through the
      Management API and fails on any test OTP entry, a minimum below 10, or reauthentication off.
- [ ] Leaked password protection when the project moves to Pro (D63, position 21).
- [ ] Position 21: consider passkeys (Supabase lists them) as a phishing proof second way in, review a per phone cap
      on code sends (D98's open note), and watch the per IP sign in cap on launch day.

## Rationale

Reasoning and options: see [rationale.md](rationale.md).
