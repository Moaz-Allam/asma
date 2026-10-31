# 0005. Sign in and roles (position 01)

**Date**: 2026-10-31
**Status**: Accepted (confirmed by the owner 2026-10-31, after a cross check on a second model)

## Summary

This position lets a person sign in with a phone number and a six digit SMS code, choose once whether
they are a customer or a provider, accept the agreement, and reach their own part of the app in `ar`,
`tr` or `en`. Sending and checking the code run straight from the browser to Supabase Auth, because
Auth is public anyway, so the limits and checks that truly hold live inside Auth (a Turnstile bot
check, send limits, and a database hook that refuses a phone outside a live region). The owner also
added the full landing page, its SEO, and the full account page to this position, so it ships as one
spec in two pull requests: part 1 (the core) merges first so position 02 starts on time, and part 2
follows in its own session. Temporary content (sample prices, draft legal text, Turkish strings still
awaiting translation, indexing off) is held back from real users by a launch gate script.

## Requirements

**User stories**:
- As a customer or provider, I want to sign in with my phone and a code, with no password, so that
  joining takes under a minute.
- As a new user, I want to choose my role once and accept the agreement once, so that I only do it one
  time.
- As a returning user, I want to stay signed in on my phone and land on my own home, so that I am not
  sent a code on every visit.
- As a user, I want to edit my name, language, contact email and notices in one place.
- As a visitor, I want a landing page in my language that explains the price, the cash payment and
  how to start.
- As the owner, I want SMS cost bounded even when someone attacks the Auth API directly.
- As the owner, I want every role and identity change recorded, and every server action proven to
  refuse an anonymous caller.

**Prerequisites** (owner steps, not acceptance criteria; real sign in cannot be proved without them):
- **S20, rewritten.** Open a Twilio account, add funds, create one Verify Service named `Aldebyani`
  with a 6 digit code. Turn on Fraud Guard (Verify, Services, SMS and RCS tab). Allow only Turkey in
  Verify, Settings, Geo permissions (this is what stops SMS pumping to foreign numbers). Add a Twilio
  usage alert. **Ask Twilio in writing:** does Verify deliver to Turkish networks after 2026-11-18 with
  no sender ID registration of ours, or must we register our own sender for Verify, and at what price
  per SMS? Twilio's error page says Verify takes care of registrations for OTP, but its Verify sender
  article says some countries still need your own sender, and it does not name Turkey. Carriers block
  unregistered sender IDs from that date, and own registration takes about 2 weeks and needs a company
  certificate, signed letters and a stamp. If the answer is no, stop and tell the agent: the choices are
  an own registered sender on Verify, started at once, or a Turkish provider behind a Send SMS hook,
  one more build day.
- **S9, rewritten.** Turnstile widget, Managed mode. Hostnames: `aldebyani.vercel.app`, the preview
  branch alias of `feat/01-sign-in`, and the real domain when S4 lands. **Not `localhost`:** Supabase
  checks only the token, not its hostname, so a listed `localhost` would let anyone mint tokens on
  their own machine. Local work uses the local stack with Cloudflare's test key. The site key goes to
  Vercel as `NEXT_PUBLIC_TURNSTILE_SITE_KEY`. The secret goes **only** into Supabase (S22), never into
  Vercel or `.env.local`.
- **S22, rewritten.** After the owner pushes the part 1 migration (dry run first), in this order, in the
  cloud project's Auth settings:
  1. Phone provider on, set to **Twilio Verify**, with the S20 values. **Confirm phone on** (with it
     off, anyone can sign up a number with a password and no code).
  2. Email provider **off**. Anonymous sign ins off. Manual linking off.
  3. Hooks: **Before User Created** on, Postgres, `public.check_new_user`.
  4. CAPTCHA protection on, Turnstile, the S9 secret.
  5. Rate limits: SMS per hour **200**. OTP send window per phone **60 seconds**. Sign ins and verifies
     per IP stay at the defaults, 30 per 5 minutes.
- **S25, new.** A support WhatsApp number per region (E.164). The link stays hidden until it exists.
- **S16, added.** Twilio and Cloudflare receive phone numbers and IP addresses abroad: confirm the KVKK
  basis and the privacy notice wording. Confirm 30 days for abandoned sign ups. Check the agreement
  statement and the FAQ answers on refunds and cash.
- **S4.** The real domain turns indexing on (AC-30). Needed by G3.

**Acceptance criteria** (the contract):

*Part 1, pull request 1: sign in, roles, shell, basic account.*

- **AC-1**: At `/{locale}/login` a visitor enters a phone, passes the bot check, receives a 6 digit code
  by SMS, enters it and ends signed in. New and returning numbers see the same form, the same messages
  and the same send behavior, so nothing reveals whether a number has an account.
- **AC-2**: The form accepts `555 123 45 67`, `0555 123 45 67` and `+90 555 123 45 67`, in Western or
  Arabic Indic digits (`U+0660` to `U+0669` and `U+06F0` to `U+06F9`), and sends E.164
  (`+905551234567`). A landline, a short number or a number from another country is refused in the form
  with a message that says how to fix it, with no Auth call and a `phone_rejected` event whose `reason`
  is `not_mobile`, `too_short` or `other_country`. Digit folding lives in `lib/region/phone.ts`, a `.ts`
  module, so no Arabic character sits in a `.tsx` file.
- **AC-3**: Inside Auth, the `before_user_created` hook refuses a new user with no phone (email or
  password sign up) or with a phone that is not a mobile number of an active region, before any SMS is
  sent. KSA numbers are refused while `regions.active` is false, and switching KSA on is a data change
  with no code change. `complete_onboarding` repeats the check, so no profile can exist with a bad
  number even if the hook is off. No account ever holds a password: a trigger on `auth.users` keeps
  `encrypted_password` empty, so an attacker cannot sign up a victim's number with a password and wait
  for the victim to confirm it by code. If cloud refuses the trigger, `complete_onboarding` blanks the
  password instead, and the owner is told the gap that remains before onboarding.
- **AC-4**: Every send carries a fresh Turnstile token to Supabase Auth, which is the only checker.
  The app holds no Turnstile secret and never calls siteverify. The widget resets after every attempt.
  The send button stays disabled until a live token exists. A token expires after 300 seconds: the
  button disables again and the widget refreshes itself. The widget language follows the locale, with
  the light theme. A widget that cannot load shows an error with a retry, and nothing is sent.
- **AC-5**: Auth enforces the limits of S22, and Twilio Verify adds its own: a code lives 10 minutes,
  takes 5 checks, and one verification takes 5 sends. Each limit has its own stable code and message:
  `limit_phone`, `limit_ip`, `limit_sms_cap`, `limit_checks`, `limit_sends`. `limit_checks` tells the
  user a new code is needed. The map comes from real Auth responses; where Auth answers two limits the
  same way, they share a code and a message. Every limit fires a `code_limited { limit }` event, and
  `limit_sms_cap` also reaches Sentry so the owner sees it. The message never shows a raw code. The
  resend button waits 60 seconds with a visible countdown, needs a fresh token, and a change number
  link returns to the phone step.
- **AC-6**: Code entry is six boxes that accept typing, paste and phone autofill
  (`autocomplete="one-time-code"`), in Western or Arabic Indic digits, and submit at the sixth digit.
  A wrong or expired code shows one message that offers a new code. The code never appears in a URL.
  A reload on the code step keeps working (phones often reload after a trip to the SMS app): the phone
  and send time stay in `sessionStorage` under `login_step`, wrapped in try and catch, for 10 minutes or
  until sign in succeeds. The phone step offers "I already have a code" while that value is live.
- **AC-7**: A signed in user with no role lands on `/{locale}/onboarding`: role (customer selected, or
  provider when the login link carried `as=provider`), full name, and a required tick with links to
  `/terms` and `/privacy`. Every other signed in page sends them back here until they finish.
- **AC-8**: `complete_onboarding` runs as one transaction. It creates the `profiles` row, one
  `terms_acceptances` row (version from `platform_settings`, locale, database time) and one `audit_log`
  row, and writes `role` and `region` into `app_metadata`. Region and phone come from the verified
  `auth.users` row, never from the client. `admin` is refused, an unticked statement is refused, and an
  unconfirmed phone is refused. A retry or double submit changes nothing and returns the same
  destination, and a second call with another role keeps the first role. The action then refreshes the
  session so the token carries the role.
- **AC-9**: One phone holds one role. No API role can change `role`, `region` or `phone`. A trigger
  refuses any change to `region` or `phone`, for every role.
- **AC-10**: After onboarding a customer lands on `/requests/new` and a provider on `/provider/profile`.
  After later sign ins a customer lands on `/requests`, a provider on `/provider`, an admin on `/admin`.
  A `next` path is honoured only when it passes `safeNext` and the role may open it. A signed in user at
  `/login` or the landing page goes to their home. `/continue` moves the URL to `profiles.locale` and
  sets the locale cookie to match (`i18n.md` §4). That is the only place: a shared `/en/...` link opened
  later stays in English. A new profile takes the locale of the URL it signed up on, which amends
  `i18n.md` L1.
- **AC-11**: `proxy` becomes async. It refreshes the session on every page request that carries an Auth
  cookie, and makes no Auth call for a visitor with none. On a GET page request with no session it
  redirects away from `/requests`, `/provider`, `/admin`, `/account`, `/continue` and `/onboarding` to
  `/login?next=`. A POST carrying `next-action` always passes through, so the action itself returns
  `unauthorized`. Refreshed cookies go on the forwarded request headers (so this render sees them) and
  on the final response, whether that is the next-intl response or a redirect, along with the CSP,
  `Reporting-Endpoints` and the cache headers `setAll` hands over. This is UX only. An Auth outage
  passes through to the page guard, and the proxy never throws. `tests/proxy.test.ts` moves to `await`
  and keeps proving all of it.
- **AC-12**: `lib/auth/session.ts` exports `getSessionUser`, `requireUser`, `requireRole` and
  `guardPage`. The user is verified with the Auth server (`getUser`), and the role comes from
  `app_metadata`. A render reuses one check through React `cache`. An action does not, so
  `guardedAction` checks once and passes the user to its handler. In a Server Action a refusal returns `{ success: false, error:
  'unauthorized' }` or `'forbidden'`, never a throw. A page with no session goes to login, no role goes
  to onboarding, and the wrong role goes to their own home. Every page calls `guardPage` itself, because
  layouts do not run again on client navigation.
- **AC-13**: The action guard meta test imports every module under `actions/` and proves each export
  refuses an anonymous caller. Every `app/api/**/route.ts` must be one of exactly four names
  (`app/api/health`, `app/api/e`, `app/api/a/[...path]`, `app/api/csp`) or refuse an anonymous caller.
  Sign in itself adds no exemption, because it is not a Server Action.
- **AC-14**: RLS (rule 7), each with a negative pgTAP test in the same change: a user reads only their
  own `profiles` and `terms_acceptances` rows, an admin reads all, and anon reads nothing. `audit_log` is
  readable by admins only. No API role, `service_role` included, can insert, update or delete
  `terms_acceptances` or `audit_log`. The meta tests stay green with every new function in place, and
  the anon allow list gains only `public_region_info()`.
- **AC-15**: `audit_log` records account created, role promoted and name changed (email changed in part
  2), each with who, when, old, new and region. The database writes them, so a direct API update is
  recorded too.
- **AC-16**: `promote_to_admin(phone)` runs only from the SQL editor (no API role may call it). It sets
  the role in both places and writes the audit row. The account must already have a profile.
- **AC-17**: The shell exists: route groups `(public)`, `(auth)`, `(customer)`, `(provider)`, `(admin)`,
  `(account)`, each private group `noindex`. `SiteHeader` with the wordmark, the signed out pills, the
  role menu (only pages that exist: customer Requests, New Request, Account; provider Dashboard, Profile,
  Account; admin Dashboard, Account) and the initial avatar. `BottomTabBar` on phones. No bell before 18.
  Home pages for later positions show `EmptyState`.
- **AC-18**: Tokens and fonts land as `ui-tokens.md` §13 says: ramps, `@theme inline` with `--color-*:
  initial` first (D61), the three fonts through `next/font/google`. The `/* placeholder */` escape is
  deleted from the write guard in the same change (D60), and so is the `color-contrast` disable in
  `e2e/smoke.spec.ts`. shadcn is initialized after the tokens, at an exact CLI version, and mapped to
  our names, with only the components 01 uses. Its physical classes are converted to logical ones, so
  `lint:rtl` passes. Each component gets a `ui-registry.md` row and an RTL check. Each new package gets
  an exact pin, an `AGENTS.md` stack row, and an install script review.
- **AC-19**: `/{locale}/account` (both roles): edit full name, phone read only with a verified note,
  language saved to `profiles.locale`, sign out of this device only (`signOut({ scope: 'local' })`, since
  the library default ends every device, and a test proves it). `LocaleSwitcher` calls `updateLocale`
  for a signed in user and sets the cookie alone for a visitor.
- **AC-20**: `/terms` and `/privacy` exist as simple draft pages, `noindex`, in all three locales. The
  tick shows the draft D92 statement. Each draft text starts with the visible marker `[draft] ` in the
  catalogues. `platform_settings` holds `terms_version` = `"draft-1"` per region.
- **AC-21**: Every new string lives in all three catalogues. Turkish keys awaiting the translator hold
  the English text with the prefix `[tr] `, never machine output (D58), and a test counts them. Phone
  numbers and codes stay LTR inside RTL text, with Western digits. Screens pass at 360, 390, 430 and
  1280 px, `tr` first, with no overflow on Turkish strings.
- **AC-22**: The events `code_requested`, `code_verified`, `code_limited { limit }`, `onboarding_completed
  { role }` and `phone_rejected { reason }` are typed in `lib/analytics/events.ts` and added to
  `project-overview.md` §17. No phone, code, name or id reaches Sentry or PostHog, proven by assertions
  on the captured payloads of the sign in journey. Only unexpected Auth errors and `limit_sms_cap` reach
  Sentry, by stable code.
- **AC-23**: The CSP adds `frame-src https://challenges.cloudflare.com`, and the Turnstile script carries
  the page nonce. No CSP violation fires on `/login`, proven in a real browser with Cloudflare's test
  key. A wider policy is added only if that proof shows it is needed.
- **AC-24**: The local stack runs real phone sign in: test numbers with fixed codes in `config.toml`, the
  hook on, `enable_confirmations` true, email sign up off. The e2e journey (sign up, role, home, sign out,
  sign in, wrong role) passes in `ar`, `tr`, `en` at 390px with axe, contrast included. The wrapper runs
  `supabase db reset` first, because no role may delete these rows, and each test in each project has
  its own number. The fixture allows the Supabase origin and stubs Cloudflare's script with
  `page.route`, so no journey depends on Cloudflare. The storage assertions allow `login_step` on
  `/login` only. CI drops `E2E_NO_DB` (R6), so the health e2e runs there.
- **AC-25**: Tooling (owner approved 2026-10-31): the bash guard blocks `supabase config push`. Only
  `lib/auth/` calls `supabase.auth`, with one exemption, `lib/db/proxy.ts`, where the session refresh
  must live; `proxy.ts`, `actions/` and pages call named `lib/auth` functions. Lint bans `getSession()`
  everywhere. Each rule has a proof. The
  `database` CI job runs the advisors, and security findings fail it. `scripts/launch-gate.mjs`, run by
  `npm run launch:gate` at G3 and not in CI, fails while a `[tr]` marker or a `[draft]` marker remains.
- **AC-26**: Real calls, recorded in `verify.md`, because a stub proves the SDK and never the handler. On
  a preview against cloud Auth: a real Turnstile token, a real SMS to a real Turkish number, a real
  check, a real session. Direct Auth API calls are refused: email sign up, a foreign number, a send with
  no token, a phone and password sign up that tries to skip the code. After a phone and password sign
  up followed by a real code, a password sign in fails.

*Part 2, pull request 2: full landing, SEO, full account.*

- **AC-27**: The landing page follows `s1` in order: header with anchors and pills, hero, four promises,
  how it works, prices, categories, offers band, trust section, quick start, FAQ, closing call, footer.
  Phone width first, hamburger menu in a sheet. Copy is rewritten for the cash model (D87) with no
  escrow wording. It states plain process facts only, no quality claim (B7). Stand in panels replace
  every borrowed photo (Q12). Signed out calls lead to `/login?next=/requests/new`, provider calls to
  `/login?as=provider`. The owner approves the copy on the preview.
- **AC-28**: Prices, categories and the sample cards in how it works show the values drawn in `s1`
  (owner override 2026-10-31 of `ui-rules.md` §11 and the design README, for these landing sections
  only). They live in one file, `lib/landing/samples.ts`, with amounts in integer minor units through
  `MoneyDisplay`, and are replaced by catalog data after 03. The launch gate fails while the file's
  `SAMPLE_DATA` flag is true.
- **AC-29**: SEO: a title and description per locale, a canonical URL, `hreflang` for `ar`, `tr`, `en`
  and `x-default`, Open Graph and Twitter cards with a static image per locale, JSON-LD (`Organization`,
  `WebSite`, `Service`, `FAQPage`), `sitemap.xml` with locale alternates, `robots.txt`, a web manifest,
  one `h1`, real landmarks, and every FAQ answer present in the server HTML. Every private page is
  `noindex`, always.
- **AC-30**: Indexing is one switch. While `APP_SITE_URL` is empty, or on any preview, every page says
  `noindex`, `robots.txt` disallows all, and the sitemap is empty. With it set on production, the landing
  page and final legal pages become indexable with no code change.
- **AC-31**: Lighthouse on `/tr` at phone width, on a build with `APP_SITE_URL` set: SEO at least 95,
  accessibility at least 95, best practices at least 90, performance at least 80, recorded in `verify.md`.
  If performance misses, load PostHog and Replay after hydration (R6).
- **AC-32**: The account page gains the contact email and the notification table. Email is for notices
  only, never sign in, shown as not confirmed, and nothing is sent to it until position 13 confirms it.
  The table shows email only: no SMS column, no in site column, no activity tiles, no bank link. Rows
  follow the notice map in Feature design, per role. Rows with a topic can be turned off, and the rest
  are always on and shown that way. The provider page links to the profile and services pages.
- **AC-33**: `notification_preferences` RLS: a user reads and writes only their own rows, with the region
  of their own profile, proven by a negative pgTAP test. No row means on.
- **AC-34**: When `support_whatsapp` exists for the region, the footer link appears, and so does a help
  line after a failed code, after any limit message, and with `phone_taken`. When it does not, all of
  them stay hidden.
- **AC-35**: The launch gate also fails while `SAMPLE_DATA` is true or `APP_SITE_URL` is empty for
  production. Run at G3.

## Decision

**Chosen option**: Option 1, browser to Supabase Auth, with Twilio Verify as the SMS provider.

The browser calls Supabase Auth directly for send and check. Enforcement lives inside Auth (Turnstile,
limits, the `before_user_created` hook) and in the database (`complete_onboarding`). `profiles` plus
`app_metadata` hold the role, written once in one transaction. Reasoning and options: see
[rationale.md](rationale.md).

**Implementation skills**: `supabase` (`supabase/agent-skills`, `.agents/skills/supabase/`) ·
`supabase-postgres-best-practices` (`supabase/agent-skills`, `.agents/skills/supabase-postgres-best-practices/`) ·
`turnstile-spin` (`cloudflare/skills`, `.claude/skills/turnstile-spin/references/nextjs-app.md`) ·
`tailwind-design-system` (`.claude/skills/tailwind-design-system/`) ·
`posthog-nextjs-app-router` (`PostHog/skills`, `.claude/skills/posthog-nextjs-app-router/`).
To vendor in task 1, each read line by line, pinned at a commit, with a `VENDORED.md`, never through an
installer: `shadcn` (`shadcn/ui`, `.claude/skills/shadcn/`) · `optimise-seo` (`mblode/agent-skills`,
`.claude/skills/optimise-seo/`) · `twilio-verify-send-otp` (`twilio/ai`,
`.claude/skills/twilio-verify-send-otp/`, public beta).

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

**Data model sketch** (owner confirmed 2026-10-31):

`profiles`, one row per onboarded user:

| Column | Type | Rules |
| --- | --- | --- |
| `id` | uuid PK | FK `auth.users(id)` on delete restrict. Deletion means anonymising (architecture §39), a later position |
| `role` | text not null | check in `customer`, `provider`, `admin` |
| `region` | text not null | FK `regions(code)`. Trigger refuses any change |
| `phone` | text not null unique, collate "C" | E.164. Trigger refuses any change. D16 check below |
| `full_name` | text not null | check 2 to 100 characters after trim |
| `locale` | text not null | check in `ar`, `tr`, `en` |
| `email` | text null, collate "C" | Part 2. Contact only. Lowercased with plain `toLowerCase`, never a Turkish locale |
| `email_confirmed_at` | timestamptz null | Part 2. Stays null until 13 |
| `created_at`, `updated_at` | timestamptz not null | |

D16 check, literal because a check cannot read another table: `(region = 'TR' and phone ~ '^\+905[0-9]{9}$')
or (region = 'KSA' and phone ~ '^\+9665[0-9]{8}$')`. `public.phone_region()` and `lib/region/phone.ts` hold the
same patterns, and a test proves all three agree. Do not call `phone_region()` from the check: every update
of the row runs the check as the caller, who has no execute grant.

`terms_acceptances`, one row per acceptance, append only:

| Column | Type | Rules |
| --- | --- | --- |
| `id` | uuid PK | |
| `user_id` | uuid not null | FK `profiles(id)` on delete restrict |
| `region` | text not null | FK `regions(code)` |
| `terms_version` | text not null | Unique with `user_id` |
| `locale` | text not null | |
| `accepted_at` | timestamptz not null | Database time |

`audit_log`, append only, plain table (architecture §39 gets a note: partition when it grows):

| Column | Type | Rules |
| --- | --- | --- |
| `id` | bigint identity PK | |
| `actor_id` | uuid null | `auth.uid()`, null from the SQL editor. No FK, history outlives users |
| `action` | text not null | `account.created`, `account.promoted`, `profile.name_changed`, `profile.email_changed` |
| `entity_type`, `entity_id` | text not null | |
| `region` | text null | D15. On the CI exempt list already |
| `old_value`, `new_value` | jsonb null | May hold a name or email: admin read only, covered by the later anonymising work |
| `created_at` | timestamptz not null | Index on time, index on `(entity_type, entity_id)` |

`notification_preferences` (part 2), only for rows a user turned off or on:

| Column | Type | Rules |
| --- | --- | --- |
| `user_id` | uuid not null | FK `profiles(id)`. PK with `topic` |
| `topic` | text not null | check in `new_offer`, `new_matching_request`, `work_updates`, `ratings` |
| `region` | text not null | FK `regions(code)`. Index |
| `email_enabled` | boolean not null | |
| `updated_at` | timestamptz not null | |

New `platform_settings` keys per region: `terms_version` (`"draft-1"`), `support_whatsapp` (no row until S25).

**Notice map** (`lib/notifications/topics.ts`, from `project-overview.md` §24; position 13 sends by it):

| Events (§24) | Who | Row | Topic |
| --- | --- | --- | --- |
| 1 new request in your zones | Provider | New requests | `new_matching_request` (can turn off) |
| 2 a provider applied | Customer | New offers | `new_offer` (can turn off) |
| 9 work started, 12 job completed | Customer, provider | Work updates | `work_updates` (can turn off) |
| 13 please rate, 14 you received a rating | Customer, provider | Ratings | `ratings` (can turn off) |
| 3, 4, 5, 6 chosen, paid, pay window | Both | Payments and deadlines | always on |
| 7, 8 contact details open | Both | Contact details | always on |
| 10, 11 confirm, closes soon | Customer | Confirm the job | always on |
| 15, 16 problem reports | Reporter, admin | Problem reports | always on |
| 17 cancelled, 19 fee refunded | Both | Cancellations and refunds | always on |
| 18 approved or rejected | Provider | Account approval | always on |

**Database functions** (each revokes `PUBLIC`, pins `search_path`, passes `supabase/tests/02`):

| Function | Kind | Executable by | Job |
| --- | --- | --- | --- |
| `public_region_info()` | definer, stable | `anon`, `authenticated` (allow list, spec 0005) | Active regions: `code`, `dial_code`, `support_whatsapp`. Public facts only |
| `phone_region(text)` | invoker, immutable | none | Region code for a mobile number, or null |
| `check_new_user(jsonb)` | definer | `supabase_auth_admin` only | The hook. Strips any leading `+`. Refuses with `http_code` 400 and message `phone_not_supported` |
| `complete_onboarding(p_role, p_full_name, p_locale, p_accept_terms)` | definer | `authenticated` | AC-8. Returns `{ role, region, created }` |
| `promote_to_admin(p_phone)` | definer | none (SQL editor) | AC-16 |
| `profiles_guard()` | invoker, trigger | none | Before update on `profiles`: refuses `region` or `phone` changes |
| `profiles_audit()` | definer, trigger | none | After update on `profiles`: writes `audit_log` when `full_name` or `email` changes. Definer, because `authenticated` cannot insert there |
| `no_password()` | invoker, trigger | none | Before insert or update of `encrypted_password` on `auth.users`: sets it empty (AC-3) |

`complete_onboarding` raises `phone_taken` when `profiles.phone` already exists under another id, which
can happen after an Auth phone change.

Grants (D77, each table its own): `profiles` select to `authenticated`, `service_role`; update on
`full_name`, `locale` (and `email` in part 2) to `authenticated`. `terms_acceptances` and `audit_log`
select to `authenticated`, `service_role`. `notification_preferences` select, insert, update to
`authenticated`, select to `service_role`. `regions` stays as it is.

**State transitions**: account: no account → code requested → phone verified, no role → onboarded as
customer or provider. Only `promote_to_admin` moves customer or provider to admin. There is no other
transition.

**Routes**:

| Path | Group | Who | Notes |
| --- | --- | --- | --- |
| `/{locale}` | `(public)` | everyone | Signed in goes to `/continue`. Small in part 1, full `s1` in part 2 |
| `/{locale}/terms`, `/privacy` | `(public)` | everyone | Draft, `noindex` |
| `/{locale}/login` | `(auth)` | signed out | `?next=`, `?as=provider`. One page, two steps: the phone stays in client state, never the URL |
| `/{locale}/continue` | `(auth)` | signed in | Renders nothing, redirects (AC-10) |
| `/{locale}/onboarding` | `(auth)` | signed in, no role | `s11` plus name and tick |
| `/{locale}/requests`, `/requests/new` | `(customer)` | customer | `EmptyState` until 04 |
| `/{locale}/provider`, `/provider/profile` | `(provider)` | provider | `EmptyState` until 02 |
| `/{locale}/admin` | `(admin)` | admin | `EmptyState` until 16 |
| `/{locale}/account` | `(account)` | any role | `s12`, `p16` |

**API surface**:

| Name | Kind | Key inputs | Key outputs | Auth | Key errors |
| --- | --- | --- | --- | --- | --- |
| `sendCode` in `lib/auth/otp-channel.ts` | Browser to Auth, `signInWithOtp` | `phone` (E.164), `captchaToken` | ok | public, CAPTCHA | `limit_phone`, `limit_ip`, `limit_sms_cap`, `limit_sends`, `bot_check_failed`, `phone_not_supported`, `send_failed`, `network` |
| `checkCode` in `lib/auth/otp-channel.ts` | Browser to Auth, `verifyOtp` type `sms` | `phone`, `code` | session cookies | public | `wrong_or_expired`, `limit_checks`, `limit_ip`, `network` |
| `completeOnboarding` in `actions/onboarding.ts` | Server Action | `role`, `fullName`, `accepted` (literal true) | `destination` | `requireUser` | `validation_failed`, `phone_not_eligible`, `phone_taken`, `unauthorized` |
| `signOut` in `actions/account.ts` | Server Action | none | ok | `requireUser` | `unauthorized` |
| `updateAccount` in `actions/account.ts` | Server Action | `fullName` | ok | `requireRole` any | `validation_failed` |
| `updateLocale` in `actions/account.ts` | Server Action | `locale` | ok | `requireRole` any | `validation_failed` |
| `updateEmail` (part 2) | Server Action | `email` or null | ok | `requireRole` any | `validation_failed` |
| `setNotificationPreference` (part 2) | Server Action | `topic`, `enabled` | ok | `requireRole` any | `validation_failed` |

`lib/auth/otp-channel.ts` keeps the swappable shape (`send`, `check`) with one phone adapter; email is not
built (D55). Its local fake is the local stack with test numbers. `guardedAction` in `lib/auth/action.ts`
wraps every Server Action: auth first (so the guard test holds on any input), then Zod, then the handler,
inside the try and catch of code standards §19, returning stable codes.

**Value sourcing**:

| Action | Value | Source |
| --- | --- | --- |
| Login page | Dial code, active regions | `public_region_info()` through `createAnonClient()` |
| Login page | Turnstile site key | `NEXT_PUBLIC_TURNSTILE_SITE_KEY` |
| Login page | Script nonce | `x-nonce` request header from `proxy.ts` |
| Send | E.164 phone | `normalizePhone(input, dialCode)` in `lib/region/phone.ts` |
| Code step after reload | Phone, send time | `sessionStorage` key `login_step`, 10 minutes |
| Send | Token | Turnstile callback in `BotCheck` |
| Resend | 60 seconds | `RESEND_SECONDS` in `lib/auth/limits.ts`, equal to the S22 window |
| Onboarding | Region | `phone_region()` of `auth.users.phone`, with `regions.active` |
| Onboarding | Profile phone | `'+' || auth.users.phone`, requires `phone_confirmed_at` |
| Onboarding | Terms version | `platform_settings (region, 'terms_version')`, read inside the function |
| Onboarding | Locale | `getLocale()` from the validated URL segment |
| Onboarding | Accepted time | Database clock |
| Onboarding | Preselected role | `as` query value, only ever `provider`. The chosen role is still validated |
| Routing | Home, first stop | `homeFor(role)`, `firstStopFor(role)` in `lib/auth/roles.ts` |
| Routing | Return path | `safeNext(value)`: starts with one `/`, no scheme or backslash, under 200 characters, under `/requests`, `/provider`, `/admin` or `/account` after the locale |
| Pages | Role and region | `user.app_metadata` from `getUser()` |
| Header | Menu items | `lib/navigation/menus.ts`, only built pages |
| Header | Initial | First grapheme of `profiles.full_name` |
| Audit | Actor, region | `auth.uid()`, `profiles.region` |
| Landing | Sample amounts, categories | `lib/landing/samples.ts`, from `s1` |
| SEO | Base URL | `siteUrl()` in `lib/seo/site.ts`: `APP_SITE_URL`, else `VERCEL_PROJECT_PRODUCTION_URL`, else localhost |
| SEO | Indexable | `indexable()`: `APP_SITE_URL` set and `VERCEL_ENV` is `production` |
| SEO | Card image | `public/og/{locale}.png`, 1200 by 630, made once in a real browser, because `next/og` does not shape Arabic |
| SEO | `areaServed` | Active regions from `public_region_info()` |
| SEO | FAQ JSON-LD | The `Landing.faq` catalogue keys in the page locale |
| Footer, help line | Support link | `public_region_info().support_whatsapp` |
| Account | Rows | `lib/notifications/topics.ts` |

**Key invariants**:
- Authorization never trusts the client: role, region, phone and terms version are all read on the
  server side or in the database.
- A profile exists only for a confirmed phone of an active region (rule 10, D16).
- `profiles.role` equals `app_metadata.role` for every user, proven by pgTAP.
- `terms_acceptances` and `audit_log` are append only.
- `getUser()`, never `getSession()`, decides identity on the server.
- The Turnstile token is redeemed once, by Supabase Auth.
- No row in `auth.users` holds a password.
- Fixed test codes exist only in local `config.toml`, and `supabase config push` is blocked.
- `next` never leaves the site.
- Never case fold an identifier under a Turkish locale (rule 10).

**Security model**: compliance scope is KVKK (Turkey's data protection law); phone, name and email are
personal data. Anonymous visitors read only `public_region_info()`. A user reads and edits only their
own row, and an admin reads across regions (D15). `service_role` stays out of every user request path.
The browser is hostile: `/auth/v1/*` is public, so direct calls are the threat model, and AC-3 and AC-26
are written against them. Proxy checks are UX only (rule 11). `app_metadata` can lag up to one hour inside
a token, which only affects RLS on an admin demotion; `requireRole` reads fresh. Admin two step login
ships in 21 (D96).

**Failure handling**:
- Auth or network down: send and check show a plain error with retry, and say that nothing changed.
- Turnstile blocked by an extension or network: AC-4.
- Two tabs or double submit: `complete_onboarding` is idempotent, and `terms_acceptances` is unique on
  user and version.
- Session gone mid onboarding: the action returns `unauthorized`, and the client goes to login.
- `profiles.locale` missing for a role holder cannot happen: the write is one transaction.
- Hook off or failing: AC-3's second check still refuses at onboarding.

**Configuration required**:
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`: public. Optional in `lib/env.ts`, required on a deployment in
  `lib/deployment.ts`. The e2e wrapper passes Cloudflare's always pass test key.
- `APP_SITE_URL`: optional, https, no trailing slash. Empty until S4.
- Remove the stale `OTP_CHANNEL` and `SMS_API_KEY` from `.env.example`. Twilio values live only in the
  Supabase dashboard.
- `supabase/config.toml`: `[auth.sms]` `enable_signup = true`, `enable_confirmations = true`,
  `max_frequency = "1s"` (a retry must not hit the window; the 60 second limit is proved on the
  preview); `[auth.sms.twilio]` enabled with literal dummy values, replacing the `env()` token, because
  only test numbers are used and CI has no secret; `[auth.sms.test_otp]` one number per test and
  project; `[auth.email]` `enable_signup = false`; `[auth.hook.before_user_created]` enabled with
  `pg-functions://postgres/public/check_new_user`; `[auth.rate_limit]` `sms_sent`, `sign_in_sign_ups` and
  `token_verifications` raised, because every local call shares 127.0.0.1. CAPTCHA stays off locally.
- Cookies: `secure` on deployments, set through `cookieOptions` in every Supabase client in `lib/db/`.
  Other flags stay library defaults (the browser client must read them).

**Critical test scenarios**:
- Happy path: new number signs up as customer, reaches `/requests/new`, signs out, signs in, reaches
  `/requests`; same for provider, in three locales, verifies **AC-1**, **AC-7**, **AC-8**, **AC-10**, **AC-24**.
- Failure: a foreign, landline or email sign up through the real local Auth API is refused before any
  SMS, verifies **AC-3**. A double submit with a different role keeps the first role and one acceptance
  row, verifies **AC-8**.
- Failure: a Turnstile token that Auth rejects, an over limit send, and a wrong code each show their
  message with no internals, verifies **AC-4**, **AC-5**, **AC-6**.
- Auth and permission: anon, another user and a customer are each denied each table, a client cannot
  change `role`, `region` or `phone`, every action refuses anonymous, a customer on `/admin` goes home,
  verifies **AC-9**, **AC-12**, **AC-13**, **AC-14**.
- Injection: `next=https://evil.example`, `next=//evil.example`, `next=/\evil.example` all land on the
  role home, verifies **AC-10**.
- Telemetry: no phone or code in any captured payload, verifies **AC-22**.
- Indexing: empty `APP_SITE_URL` and a preview both serve `noindex` and a disallow all robots file,
  verifies **AC-30**.

## Build plan

Tracer bullet, tests first on every access rule and door. Part 1 merges before part 2 starts, as
`feat/01-sign-in`, then `feat/01b-landing-seo-account` (owner decision: one spec, two pull requests).

*Part 1, target 2026-11-02.*

1. Tooling: vendor the three skills (read, pin, `VENDORED.md`); bash guard for `supabase config push`;
   the `lib/auth` door and `getSession` ban with lint proofs; satisfies **AC-25**.
2. Tests first, then migration `sign_in_and_roles`: `profiles`, `terms_acceptances`, `audit_log`, settings
   seeds, every function and trigger in the table, grants, RLS, allow list entry; pgTAP for each rule; satisfies
   **AC-3**, **AC-8**, **AC-9**, **AC-14**, **AC-15**, **AC-16**, **AC-20**.
3. Local Auth config; `lib/region/phone.ts` with the three way pattern test; real local calls prove the hook
   fires on `/otp` (if it does not, stop and return to `/architect`); satisfies **AC-2**, **AC-3**, **AC-24**.
4. `lib/db/proxy.ts`, async `proxy`, session refresh, GET only redirects, the cookie handoff, keeping the
   CSP and locale behavior, `tests/proxy.test.ts` moved to `await`; satisfies **AC-11**.
5. `lib/auth/`: `session`, `action`, `roles`, `otp-channel`, `limits`, the Auth error map checked against
   real local responses; the action guard meta test; satisfies **AC-10**, **AC-12**, **AC-13**.
6. Tokens, fonts, guard escape and contrast disable removed, shadcn init at an exact CLI version,
   Button, Input, Label, Checkbox, Switch, Accordion, Sheet and InputOTP converted to logical classes, each
   new package pinned and listed (Radix, class variance authority, clsx, tailwind merge, lucide,
   `input-otp` and any others the CLI adds), registry rows; satisfies **AC-18**.
7. `/login`: `PhoneField`, `CodeField`, `BotCheck`, the two steps, CSP change, deployment key; satisfies
   **AC-1**, **AC-2**, **AC-4**, **AC-5**, **AC-6**, **AC-23**.
8. `/continue`, `/onboarding`, `completeOnboarding`, `/terms`, `/privacy`; satisfies **AC-7**, **AC-8**,
   **AC-10**, **AC-20**.
9. Route groups, `SiteHeader`, `BottomTabBar`, `InitialAvatar`, `EmptyState`, menus, home placeholders, a
   small landing with the sign in pills; satisfies **AC-17**.
10. `/account`, `signOut`, `updateAccount`, the `LocaleSwitcher` change; satisfies **AC-19**.
11. Analytics events, catalogues, `[tr]` count, three locale screen pass; satisfies **AC-21**, **AC-22**.
12. e2e journeys, drop `E2E_NO_DB`, advisors in CI, `scripts/launch-gate.mjs`; satisfies **AC-24**, **AC-25**.
13. Owner: push the migration, run S20, S9, S22, set the env value. Then the real calls of `verify.md`,
    `/check verify`, reviews (`slice-reviewer`, `security-reviewer`, `/check review` on another model),
    merge; satisfies **AC-26**.

*Part 2, in its own session beside position 02.*

14. Migration `account_notifications`: `email`, `email_confirmed_at`, `notification_preferences`, the
    email audit row, pgTAP; satisfies **AC-15**, **AC-33**.
15. Account page: email field and notification table; satisfies **AC-32**.
16. `lib/seo/`, `APP_SITE_URL`, metadata, `robots`, `sitemap`, manifest, JSON-LD, card images; satisfies
    **AC-29**, **AC-30**.
17. `MoneyDisplay`, landing sections, `lib/landing/samples.ts`, copy in `ar` and `en` with `tr` marked,
    footer, support link; satisfies **AC-27**, **AC-28**, **AC-34**.
18. Launch gate lines, Lighthouse, owner copy approval, reviews, merge; satisfies **AC-31**, **AC-35**.

Docs in the same change: `project-overview.md` §13, §17; `architecture.md` §15, §39, §42 (the Bot check
row: no door or secret until the first own siteverify caller) and a position section; `code-standards.md`
§19 (auth before validation inside `guardedAction`), §22 (drop `OTP_CHANNEL` and `SMS_API_KEY`, add the
new variables), §37; `ui-rules.md` §11, §14; `ui-registry.md`; `i18n.md` (the marker, L1);
`library-docs.md` (Auth, Turnstile, Twilio facts); `build-plan.md` (the 01 row, a landing note, the
launch gate in G3); the tracker's decision log, including the `ui-rules.md` §11 override.

## Consequences

**Positive**:
- Real enforcement sits where direct calls cannot go around it, and the action guard needs no exception.
- Per IP limits count real visitors, with no secret key on any server path.
- No SMS code to own: Twilio handles delivery and fraud checks.
- KSA later is a data change plus Twilio's geo setting.

**Negative / tradeoffs**:
- No per phone daily cap: Auth only offers a per phone window, so a patient attacker can text one number
  once a minute, each send costing one Turnstile solve. Accepted for launch; reviewed in 21.
- A network that blocks `*.supabase.co` blocks sign in, because the browser talks to Auth directly.
- Twilio is the single sender, at about $0.05 per success plus the SMS fee. Changing it means a Send
  SMS hook. Verify sends codes only, so notice SMS would need a second sender.
- `app_metadata` copies `profiles.role`, and only a test keeps them equal.
- Part 2 runs beside 02, so `messages/*.json` and `globals.css` can conflict on merge.
- Sample prices on a public page can mislead if they outlive the gate. Indexing stays off until S4.
- Landing and SEO work comes before the money positions, against the D42 priority line, by owner choice.

**Neutral**:
- `proxy.ts` becomes async and reads the session on pages that carry an Auth cookie. A visitor with no
  cookie costs no Auth call. On the local stack (symmetric keys) that read is a network call; with
  asymmetric keys it is local.
- A user could change their Auth phone through the API. `profiles.phone` keeps the signup number, and
  a later sign up with the old number gets `phone_taken`.

## Follow-up

- [ ] Position 21: nightly job removes accounts with no profile after 30 days (owner choice; S16 confirms
      the period). Anonymising and account deletion (architecture §39). STRIDE review of code guessing
      and of Auth phone changes.
- [ ] Position 13: the email confirm step; it reads `notification_preferences` with no row meaning on.
- [ ] Position 18: the bell and the in site column. The SMS column returns when a notice sender exists.
- [ ] Positions 04, 12: the activity tiles, with cash model labels.
- [ ] Position 03: replace `lib/landing/samples.ts` with catalog data. After S24: compare `s1`, `s2`, `s11`
      and `p1` with the new export, and add the `p1` panel. After Q12: owned images replace stand in panels.
- [ ] Position 04: its spec decides whether request posting needs a Turnstile check of our own, which
      creates `lib/turnstile/` and its secret.
- [ ] `/sync`: `AGENTS.md` stack rows for the new pinned packages, the `lib/auth` door, the vendored skills,
      the connectors the owner connected, S25 and the new owner steps.
- [ ] Owner: the shadcn MCP is a CLI step after shadcn init (`npx shadcn@latest mcp init`). It writes
      `.mcp.json`, which is never committed (D64). SEO connectors are useful once the domain is live.
