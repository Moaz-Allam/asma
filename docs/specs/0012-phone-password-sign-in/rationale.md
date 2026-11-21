# 0012. Phone and password sign in: decision record

## Context

> ⚠️ Premise note: sessions already last a long time (refresh token rotation, no time box), so a returning user on
> the same phone rarely needs a code today. Most SMS go to new accounts, which still need one each. The saving comes
> from sign ins after a sign out, on a new device, and in shared browsers, and the larger gain is resilience: if SMS
> delivery to Turkish networks breaks after the 2026-11-18 sender ID rule (R7), returning users still get in. The
> decision is still sound for that reason; the owner should not expect SMS volume to fall in proportion to sign ins.

Spec 0005 made the phone the only identity: every sign in sends a six digit code through Twilio Verify, and a trigger
blanks any password Auth would store (D104). The owner asked on 2026-11-20 to send codes only when an account is
created and when a password is forgotten, and to sign in with phone and password otherwise, to cut the SMS bill and
the exposure to Turkish carrier filtering.

The forces: the product is pre launch with no real users, so existing accounts can be moved by a gate; the project
runs Supabase Auth on the Free plan until launch (D63), which rules out the leaked password check and every Auth hook
that the Pro plan does not include; send and check already run from the browser straight to Auth (D98), and the app
holds no Turnstile secret; and D104 exists because a phone sign up that accepts a password at once looked able to let
an attacker register a victim's number with the attacker's password and wait for the victim to confirm it with a code.

Supabase Auth (as of 2026-11) supports `signInWithPassword` with a phone, applies the CAPTCHA to the password grant,
offers Secure password change (a change needs a session younger than 24 hours, or a code sent by `reauthenticate`),
a free "Require current password" switch whose behaviour for an account with no password, or right after a reset, the
docs do not state, and leaked password protection on Pro only. Not deciding keeps every sign in on SMS, with its cost
and its single point of failure.

## Options considered

### Option 1: Phone and password, the password saved only after a code has proven the phone

Accounts are still created by a code. Afterwards the user sets a password with `updateUser`, which a database trigger
accepts only on an account whose phone was already confirmed. Daily sign in is `signInWithPassword`; reset is a code
sign in followed by setting a new password; a change on the account page proves the current password by signing in
with it first.

**Pros**:
- Keeps D104's protection without relying on how Auth treats a repeated sign up of an unconfirmed number.
- No Server Action, no secret, no new service: the D98 pattern, one trigger, Auth settings.
- Reset and change need no undocumented Auth switch: a fresh session is enough for Secure password change.

**Cons**:
- One more screen at sign up, and a gate for existing accounts.
- Passwords add guessing and reuse risk; no leaked password check before Pro.

### Option 2: Supabase's own phone and password sign up

`signUp({ phone, password })` with "Confirm phone" on: Auth stores the password at sign up and sends a code to confirm
the number.

**Pros**:
- One step at sign up, the documented Supabase flow, less code.

**Cons**:
- Reopens D104's question: an attacker can sign up a victim's number with a password of their own; safety then rests
  on how Auth handles the victim's later sign up of the same unconfirmed number, which this project has not proven.
- The `no_password` trigger would have to go entirely, removing the database's last word on passwords.

### Option 3: Keep codes only, and cut SMS another way

Stay passwordless: make sessions last longer, send codes over WhatsApp through Twilio Verify, or add a per phone daily
cap.

**Pros**:
- No password risk at all; nothing new to remember for users.

**Cons**:
- Sessions already last a long time, so there is little left to cut there; a WhatsApp channel still depends on one
  provider and on users having WhatsApp; a cap protects the bill, not the user's ability to sign in.
- Does nothing for R7's single point of failure.

### Option 4: Passkeys

Sign in with a device passkey after the code proves the phone once (Supabase lists passkey support).

**Pros**:
- No SMS and no password to guess or reuse; phishing proof.

**Cons**:
- New in Supabase, not proven in this project; many users in the market share devices or use older phones; recovery
  still needs SMS. Better as a later second way in than as the main one before launch.

## Rationale

Option 1 meets the owner's goal (codes only at sign up and reset) while keeping the one property D104 was written to
protect: a password exists only on an account whose phone a code has proven. Moving that guarantee from "no password
ever" to "no password before the phone is proven" is a small change in one trigger, provable in pgTAP, and it does not
depend on undocumented Auth behaviour. Option 2 is less code but trades that guarantee for trust in an edge of Auth's
sign up handling, which is exactly the kind of assumption the 0005 cross check refused.

The flows are shaped by what Supabase documents on the Free plan. Reset and the first password both run on a session a
code has just created, so Secure password change lets them through with no current password and no second SMS. The
account page change proves the current password by signing in with it, which also refreshes the session, so it needs
neither the undocumented "Require current password" switch nor a code. The gate (`has_password` in `app_metadata`,
written by the trigger) mirrors the onboarding gate and costs no extra query, because `getUser` already returns the app
metadata; it sits at `continue`, the one place every sign in passes, rather than on every page. Options 3 and 4 stay open: passkeys are the natural next step once Supabase's support has matured, and a per
phone cap is already a position 21 note.

## Cross check (Sonnet, 2026-11-20)

Seventeen findings (one Critical, ten Major, six Minor), all applied. The Critical one: Auth lists
`encrypted_password` on most of its row writes, so the trigger as first drafted would have written an audit row and a
notice on every sign in; it now returns untouched when the hash does not change, and pgTAP proves it. The Major ones
settled the trigger's `has_password` and `password_set` rules and its definer shape, stated that the current password
check on the account page guards against slips rather than attackers, defined the login page for a signed in visitor
and every reset link (sign this device out, then a code), moved the gate from every page to `continue` (simpler, and
no lost `next`), pinned the password rules (NFC, code points, the 72 byte count, a browser only weak check), kept
0005's region message out of the shared credentials message, and named how e2e users get passwords and what the real
calls must prove. The Minor ones added the event reason rules, the retried sign out of other devices, the S44 switch
for Supabase's own notice, the per IP cap as a stated risk, the `phone_fixed` guard, and the admin note.

## Choices taken under the owner's standing rule (2026-11-18: recommended option; D183)

Each is the recommended option; the runner up is named so the owner can overturn it.
- Password set in its own step after onboarding (runner up: a password field inside the onboarding form).
- The password is required at `continue`, after every code sign in and after onboarding, with a reminder on the
  account page (runner up: a gate on every private page in `guardPage`, which the cross check found loses `next` and
  needs an exemption mechanism for little gain before launch).
- A browser only weak password check (digits only, one repeated character, the own phone, the 1,000 most common)
  until Pro's leaked check (runner up: the length rule alone).
- `auth.users.phone` fixed once set (runner up: leave 0005's exposure open).
- Minimum 10 characters, no character classes (runner up: 8 with mixed classes).
- The account page change asks the current password and signs in with it (runner up: a code by `reauthenticate`).
- Other sessions end after any set or change (runner up: keep them).
- A change notice by email, not on the first set (runner up: no notice).
- Login opens in password mode; the landing page's start buttons open the code mode (runner up: code mode by default).
- The per IP limit stays at Auth's default (runner up: lower it).
- No feature flag (runner up: a flag in `platform_settings`).
