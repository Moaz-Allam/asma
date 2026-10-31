# Verify: Sign in and roles (01) · spec 0005

_Steps derived from the spec's acceptance criteria and its Value sourcing table. `/check verify` runs
these; `/test` locks the durable ones. A stub proves the SDK, never the handler, so the real call
section stays manual on purpose. Never paste a phone number, code or secret into this file._

## Recorded on the local stack, 2026-10-31

Real calls to the local Auth server (CLI 2.114.0), for the error map (`tests/auth-errors.test.ts`):

| Call | Status | `error_code` | Message |
| --- | --- | --- | --- |
| `/otp`, new TR test number | 200 | | |
| `/otp`, foreign, landline, KSA while off | 400 | `unknown` | `phone_not_supported`, from our hook, before any SMS |
| `/otp` again inside the window | 429 | `over_sms_send_rate_limit` | `For security purposes, you can only request this after N seconds.` |
| `/otp` past the hourly cap | 429 | `over_sms_send_rate_limit` | `SMS rate limit exceeded` |
| `/otp` provider failure | 422 | `sms_send_failed` | `Error sending confirmation OTP to provider: …` |
| `/signup`, email | 400 | `email_provider_disabled` | `Email signups are disabled` |
| `/otp`, email | 422 | `email_provider_disabled` | `Email logins are disabled` |
| `/signup`, phone and password | 200 | | No session; a code goes out |
| `/verify`, wrong, expired or unknown | 403 | `otp_expired` | `Token has expired or is invalid` |
| Password sign in after the code | 400 | `invalid_credentials` | The row's `encrypted_password` is empty |

The per IP limit did not fire locally, and Twilio's own limits need Twilio: both are recorded below, on a
preview. `limit_ip`, `limit_sends` and `limit_checks` in the error map are written from documentation until then.

Turnstile: the real script with Cloudflare's test key on a local build, in Chromium and stable Chrome: the
script carries the nonce, a token arrives, the send button enables, and no CSP violation fires → AC-23.

## Real calls, part 1 (a preview on the shared cloud project, after S20, S9, S22 and the migration push)

- [ ] Open `/tr/login` on the preview. The Turnstile widget solves, and a code reaches a real Turkish
      phone by SMS. Sender name and language noted here → AC-1, AC-4
- [ ] Enter the code. A session exists, and a new user lands on onboarding → AC-1, AC-7
- [ ] Finish onboarding as a customer. In the database: one `profiles` row, one `terms_acceptances` row
      with `draft-1`, one `audit_log` row, and `raw_app_meta_data` holding `role` and `region` → AC-8
- [ ] Sign out, sign in again: no onboarding, lands on `/requests` → AC-10
- [ ] Direct API, with the public key only, each refused and no SMS sent → AC-3, AC-4, AC-26:
      - `POST /auth/v1/signup` with an email and password
      - `POST /auth/v1/signup` with a phone and password: no session comes back without a code
      - `POST /auth/v1/otp` with a foreign number and a real token
      - `POST /auth/v1/otp` with a Turkish number and no token
- [ ] On the local stack first, then here on cloud: `POST /auth/v1/signup` with a phone and password,
      complete a real code for that number, then `signInWithPassword` fails, and the row's
      `encrypted_password` is empty → AC-3, AC-26. If the cloud refuses the trigger, say so to the owner
- [ ] Two sends to one number inside 60 seconds: the second is refused, the UI shows the plain message
      → AC-5
- [ ] Real Auth responses for each limit recorded, for the error map: per phone, per IP, hourly cap, 5
      checks, 5 sends. Note any that Auth answers the same way → AC-5
- [ ] In Twilio, the Verify log shows the sends, geo permissions allow only Turkey, and the usage alert
      exists → S20
- [ ] The Sentry and PostHog events from this run hold no phone number and no code → AC-22
- [ ] `/api/health` is 200 and no new CSP report arrived → AC-23

## Local stack

- [x] Real local calls prove the hook fires on `/otp` for a new number, with the exact error Auth returns
      recorded for the error map → AC-3, task 3
- [x] A wrong code and an expired code each map to their message through real local Auth responses
      → AC-6
- [ ] A Server Action POST with no session returns `unauthorized`, not a redirect → AC-11, AC-12
- [x] `signOut` on one device leaves a second device signed in → AC-19
- [x] Reload on the code step, then enter the code: sign in works → AC-6
- [x] A `supabase config push` command is refused by the bash guard → AC-25
- [x] `npm run verify`, `npm run db:test`, `npm run test:e2e` green, with the health e2e running against the
      local stack → AC-24

## Database (pgTAP)

- [ ] Anon, another user, a customer and a provider are each denied every read and write the spec denies
      → AC-14
- [ ] A client cannot change `role`, `region` or `phone`, and `service_role` cannot write `audit_log` or
      `terms_acceptances` → AC-9, AC-14
- [ ] `complete_onboarding` refuses `admin`, an unticked statement, an unconfirmed phone and a phone with no
      active region; a repeat call with another role changes nothing → AC-8
- [ ] The three copies of the mobile pattern agree on one sample table → AC-3
- [ ] `profiles.role` equals `app_metadata.role` for every fixture user → Key invariants

## UI / manual

- [ ] `/login`, `/onboarding`, `/account`, every home page at 360, 390, 430 and 1280 px, `tr` first, then
      `ar`, `en`; no overflow, RTL correct, phone and code LTR → AC-17, AC-21
- [ ] Paste a code, use phone autofill, type Arabic Indic digits in both the phone and code fields → AC-2,
      AC-6
- [ ] Keyboard only through sign in and onboarding; axe clean → AC-24
- [ ] A customer opens `/admin`, a provider opens `/requests`: each lands on their own home → AC-12
- [ ] `next=https://evil.example`, `//evil.example` and `/\evil.example` all land on the role home → AC-10
- [ ] Change language on `/account`, sign out, sign in on a fresh browser: the URL follows the profile
      → AC-10, AC-19

## Part 2

- [ ] The owner reads the landing copy on the preview in `ar` and `en` and approves it; no escrow wording,
      no quality claim → AC-27
- [ ] Prices and categories match `s1` and render through `MoneyDisplay`; `npm run launch:gate` fails while
      `SAMPLE_DATA` is true → AC-28, AC-35
- [ ] View source on `/tr`, `/ar`, `/en`: title, description, canonical, four `hreflang` links, Open Graph,
      Twitter, four JSON-LD blocks, every FAQ answer present; no CSP violation → AC-29
- [ ] Share the preview link in WhatsApp: the card shows the right image and text → AC-29
- [ ] With `APP_SITE_URL` empty, and on any preview: `noindex`, `robots.txt` disallows all, the sitemap is
      empty. With it set on a local production build: the opposite → AC-30
- [ ] Lighthouse scores recorded here, on a build with `APP_SITE_URL` set → AC-31
- [ ] Turn off each of the four topics, reload, see it held; locked rows have no switch → AC-32, AC-33
- [ ] With no `support_whatsapp` row, the footer link and help line are absent; add a local row, and both
      appear → AC-34
