# 0005. Sign in and roles: rationale

Decision record for [index.md](index.md). `/develop` does not need this file.

## Context

> ⚠️ Premise note: this position grew past sign in. The owner added the full landing page, its SEO and
> the full account page on 2026-10-31. With no buffer day left (R2), one pull request would push position
> 02 to about 11-04 and the launch to about 11-22, and landing work sits below "core journey" on the D42
> priority line. The owner kept the scope and chose one spec with two pull requests, so the core merges
> by 11-02. Sample prices on the landing page also override `ui-rules.md` §11, by owner choice: a launch
> gate keeps them from reaching real users.

Position 01 is the first real feature. Everything after it needs a verified identity, a role, a region
and an app shell. It is scheduled for two days with no buffer, and it depends on three owner steps
(S20, S9, S22). The compliance scope is KVKK: phone, name and email are personal data. Assumed from
earlier work: Supabase Auth as the identity service, EU hosting (D62), and the D16 rule that a phone's
dial code decides its region.

Forces that shaped the design:

- **The Auth API is public.** The anon key ships to every browser, so anyone can call `/auth/v1/otp`
  directly. Any check that lives only in our app protects honest users and nobody else.
- **SMS costs real money.** SMS pumping (bots requesting codes to premium numbers) is the known attack on
  phone sign in.
- **Turkish carriers changed the rules.** Twilio's Turkey page says that from 2026-11-18, messages with
  unregistered sender IDs are blocked. Registration takes about 2 weeks and needs company papers. Launch
  is 2026-11-20.
- **A Turnstile token works once.** With S22 on, Supabase Auth redeems it, so a second check by our server
  would fail with `timeout-or-duplicate`.
- **Serverless calls share an IP.** From a Server Action, Supabase counts Vercel's address, so its per IP
  limits (30 per 5 minutes) would apply to all users together.
- **The brief's action guard exempts only machine endpoints** (`AGENTS.md`). A public sign in Server
  Action would need a new exemption.
- **Rule 10:** nothing may hardcode Turkey, and anonymous users cannot read `regions`.

## Options considered

### Where send and check run

**Option 1: browser to Supabase Auth (chosen).** The form calls Auth directly with the token. Enforcement
is inside Auth: CAPTCHA, limits, and the `before_user_created` hook.

- Pros: per IP limits see real visitors. No secret key. The action guard stays exact. No function call per
  send. The token check sees the visitor's own address.
- Cons: no per phone daily cap. A network block on `*.supabase.co` stops sign in.

**Option 2: Server Action on Vercel.** The action validates, then calls Auth.

- Pros: one server place for validation and logging, and Auth stays reachable where the browser cannot
  reach it.
- Cons: per IP limits need `Sb-Forwarded-For`, which needs a new `sb_secret` key (legacy keys are not
  supported) and a project setting. Two new guard exemptions. Limits added here are still walked around
  by a direct call, so they are UX, not security.

**Option 3: Server Action plus a Send SMS hook.** Every SMS passes our endpoint.

- Pros: the only option with a real per phone daily cap, and it works with a Turkish provider.
- Cons: our own SMS sending, a signed webhook, a 5 second limit, a rate table, and a preview cannot test a
  hook that lives on production. More than the schedule holds.

### SMS provider

**Twilio Verify (chosen).** Built into Supabase, no app code, fraud protection, attempt limits. Twilio's
error page for this rule points OTP senders to Verify, which it says takes care of registrations. Cons:
about $0.05 per success plus the SMS fee, codes only, and the Turkey claim needs written confirmation
(S20). **Twilio SMS with an own sender ID:** cheaper, but needs about 2 weeks and company papers, landing
around the carrier deadline with no slack. **A Turkish provider with a hook:** local sender name and
usually cheap, but one more build day and our own sending code. This stays the fallback if Twilio says no.

### Where the role lives

**`profiles` plus `app_metadata`, one write (chosen).** Follows architecture §15, keeps the existing
`platform_settings` policy working, and needs no owner step. Con: a copy kept equal only by one function
and a test. **`profiles` only:** always fresh, but needs a policy rewrite and a recursion trap on `profiles`.
**Custom access token hook:** one truth, but a hook bug blocks every sign in.

### `audit_log` shape

**Plain table (chosen).** Each partition would count as a table for the RLS meta test and two CI checks,
for a few rows per user. Con: a planned conversion if it ever grows. **Partitioned from day one:** follows
architecture §39, at the price of policies per partition or exemptions in the checks.

## Rationale

Option 1 wins because of who the real threat is. The attacker calls Auth directly, so limits worth having
must live inside Auth, and once they do, a Server Action adds a secret key, an IP forwarding setting and
guard exemptions in exchange for protection that a direct call skips anyway. The missing per phone daily
cap is the honest cost. Auth's 60 second window, the hourly fuse of 200, one Turnstile solve per send, and
Twilio's geo permissions bound it, and position 21 reviews it again.

Twilio Verify wins on the calendar: it is the only option that can work by 11-18 with no registration of
ours, subject to the written answer in S20. Because `complete_onboarding` repeats the region check, no bad
profile can exist even if the hook fails, so the hook is defense in depth for cost, not the only guard for
correctness.

The cross check on Sonnet (2026-10-31, 25 findings, all applied by the owner's choice) changed three
things worth keeping here. Proxy redirects cover GET pages only, because Server Actions are POSTs to the
page route. No account holds a password, because a direct phone and password sign up looks able to
pre register a victim's number and keep working after the victim confirms it. Without a trigger, the
window before onboarding stays open. And `localhost` stays off the production Turnstile widget, because
Supabase checks only the token.

Choices made in the spec without a question (the small internal calls):

- `getUser()` on the server rather than `getClaims()`: it reads the role fresh and sees a removed user.
  Runner up: `getClaims()`, faster, but the role can lag. The proxy uses `getClaims()` because it runs on
  every page and is UX only.
- Column grants plus a trigger for audit rows, rather than a profile RPC: a direct API update is still
  recorded.
- A `notification_preferences` table rather than a jsonb column: typed, policy bound, and easy for 13 to
  read. Runner up: jsonb on `profiles`, one less table, but user written JSON needs its own validation.
- Static card images rather than `next/og`: its renderer does not shape Arabic text.
- One `/login` route with two client steps rather than the design's `/login/verify`: a refresh must not
  need the phone in the URL.
- Redirects rather than `forbidden()`: that API is still experimental.
- Explicit Turnstile rendering with `next/script` rather than `@marsidev/react-turnstile`: the vendored
  reference covers it, with one less dependency and direct control of the nonce.
- `guardedAction` checks auth before Zod (a change from code standards §19's order) so the guard test can
  prove refusal on any input, and an anonymous caller learns nothing about the schema.

## References

**Project sources**:
- `AGENTS.md`: doors, rules 2, 7, 10, 11, the action guard scope.
- `context/project-overview.md` §5, §12, §13, §17, §24.
- `context/architecture.md` v7, §13, §15, §32, §39, §42.
- `context/progress-tracker.md`: D15, D16, D42, D55, D57, D58, D60, D61, D68, D77, D86, D92, D96, R6.
- `context/open-questions.md` G27. `docs/design/README.md`. `context/ui-tokens.md` §13.
- `context/library-docs.md` (Telemetry relays): a stub proves the SDK, never the handler.
- Cloud check, 2026-10-31: `postgres` can update `auth.users` and bypasses RLS; `supabase_auth_admin`
  does not bypass RLS, so the hook is a definer function.

**Practices & standards**:
- Enforce at the lowest layer an attacker cannot skip.
- Idempotent writes for double submits.
- Least privilege through column grants.

**Links** (checked during this design, 2026-10-31):
- Turkey SMS guidelines (Twilio): https://www.twilio.com/en-us/guidelines/tr/sms
- Sender ID error 30018 (Twilio): https://www.twilio.com/docs/api/errors/30018
- Registering a sender ID in Turkey (Twilio): https://help.twilio.com/articles/4416881468187
- Alphanumeric sender ID for Verify (Twilio): https://help.twilio.com/articles/19753651809947
- Verify geo permissions (Twilio): https://www.twilio.com/docs/verify/preventing-toll-fraud/verify-geo-permissions
- Max check attempts, error 60202 (Twilio): https://www.twilio.com/docs/api/errors/60202
- Max send attempts, error 60203 (Twilio): https://www.twilio.com/docs/api/errors/60203
- Verify pricing (Twilio): https://www.twilio.com/en-us/verify/pricing
- Twilio skills: https://www.twilio.com/docs/ai/skills
- Auth rate limits (Supabase): https://supabase.com/docs/guides/auth/rate-limits
- Auth hooks (Supabase): https://supabase.com/docs/guides/auth/auth-hooks
- Before User Created hook (Supabase): https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook
- Send SMS hook (Supabase): https://supabase.com/docs/guides/auth/auth-hooks/send-sms-hook
- CAPTCHA protection (Supabase): https://supabase.com/docs/guides/auth/auth-captcha
- Phone login (Supabase): https://supabase.com/docs/guides/auth/phone-login
- Token validation (Cloudflare): https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
- Turnstile testing keys (Cloudflare): https://developers.cloudflare.com/turnstile/troubleshooting/testing/
- shadcn skills: https://ui.shadcn.com/docs/skills
