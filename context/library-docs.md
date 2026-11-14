# Library Docs

> The approved dependency list, why each exists, and the gotchas that actually bite.
> **Rule: do not add a dependency without adding it here first, with a justification.** Prefer the platform over a package.

Versions are recorded in `progress-tracker.md` once pinned. Always check the official docs for the installed version — the notes below are about *how we use it*, not a substitute for the docs.

---

## Core

### Next.js (App Router)
- Server Components by default; `'use client'` only at leaves that need interactivity.
- **Server Actions** are our main mutation path. They are public HTTP endpoints — always validate input and check authorisation inside them. Being "server-side" is not authorisation.
- Use `revalidatePath` / `revalidateTag` after mutations; stale money UI causes support tickets.
- Route Handlers (`app/api/.../route.ts`) for webhooks — needed for raw body access.
- **Gotcha:** `import 'server-only'` on any module holding secrets or money logic, so a stray client import fails at build time rather than leaking.

### TypeScript
- Strict. DB types generated from Supabase after every migration.

### Tailwind CSS
- Utility classes only, from the token scale. **No arbitrary values** (`w-[437px]`) — see `ui-tokens.md`.
- **RTL:** use logical properties (`ms-`/`me-`, `ps-`/`pe-`, `start-`/`end-`) instead of `ml-`/`mr-`/`left-`/`right-`. Not optional — direction is a runtime value (`ar` is RTL, `tr`/`en` are LTR), so physical utilities are wrong in one direction by construction.

---

## UI

### shadcn/ui
- Components are **copied into the repo**, not installed as a black-box dependency — so they are ours to edit, and edits must follow `ui-rules.md`.
- Add via the CLI, one component at a time, only when a screen needs it.
- **Do not restyle primitives ad hoc.** Theme comes from tokens (`ui-tokens.md`), which the human will supply. Until then, use defaults.
- Register every component you add in `ui-registry.md`.
- **Gotcha:** several primitives (dropdown, select, popover, sheet, toast) need RTL and direction checks — verify each in RTL before marking done.

### Radix UI (transitive, via shadcn)
- Don't install or use directly unless a shadcn component wraps it. Accessibility behaviour comes from here — don't fight it with custom key handlers.

### lucide-react
- Icon set. **Directional icons must mirror in RTL** (chevrons, arrows). Non-directional (check, user) must not.

---

## Backend

### Supabase — Auth
- Session JWT carries the user id and claims. **Role lives in `app_metadata`** and is set server-side only. A client can never assign or change its own role.
- OTP: rate-limit request and verify per phone, per IP, per device, and add a bot challenge — otherwise SMS-pumping fraud will cost real money.
- **Gotcha:** phone/SMS auth availability depends on the market and provider. If unavailable, use email OTP and record the decision in `progress-tracker.md`.

### Supabase — Postgres + RLS
- **RLS is the security backbone.** Enable on every table, deny by default, in the creating migration.
- Policies read the JWT (e.g. `auth.uid()`). Keep them simple and readable; complex policies hide bugs.
- Money operations go in `SECURITY DEFINER` functions with a locked `search_path`. Never let clients write directly to `ledger_entries`, `escrows`, `provider_balances`, or `unlock_fees`.
- **Gotcha:** `SECURITY DEFINER` bypasses RLS by design — every such function must do its own authorisation check. This is the single most dangerous construct in the codebase.
- **Gotcha:** RLS filters rows, not columns. To hide PII columns from providers, use a **view or an explicit column list**, not just a row policy.

### Supabase — Storage
- Verification documents go in a **private** bucket, served only via short-lived signed URLs. No public buckets for anything user-uploaded.
- Validate MIME type and size server-side; never trust the client's declared type. **Overridden in 02 (D116, spec 0006):** the bucket checks the declared type and size, the browser checks the first bytes for honest mistakes, and `register_provider_document` cross checks type, extension, size and folder from `storage.objects`; no server can read bytes a hostile client could not also avoid. Real responses: the section below "Supabase Storage: what real calls return".

### Supabase — Edge Functions
- Used for: PSP webhooks and scheduled jobs (auto-release, unlock-window expiry, reconciliation, invariant checks).
- Keep them stateless and idempotent — they will be retried.

### Supabase — Realtime
- Scope subscriptions per request/user. **Verify RLS applies to Realtime** before subscribing to any table with PII; if in doubt, subscribe to a safe projection.

---

## Validation and utilities

### Zod
- One schema per boundary in `lib/validation/`, shared client/server. Server always re-parses.
- Also validate **inbound webhook payloads** and PSP responses — external input is untrusted.

### date-fns (or equivalent, once pinned)
- All timestamps stored in **UTC**; convert at display time only.
- Deadlines (`unlock_deadline`, `release_deadline`) are computed and compared **server-side**. Never trust a client clock.

---

## Payments — PSP

> **Never import a PSP SDK in feature code.** Everything goes through the adapter in `lib/psp/` (see `architecture.md` §5).

### The model (D87, D93)
The gateway only takes the platform's own two fees. The job price is cash, outside the platform. There is no hold, no release and no payout, so no marketplace product is needed.

### iyzico (Turkey): standard checkout
- A hosted card page into the platform's own merchant account, per payment. No saved cards at launch.
- A payment counts only from a verified callback or a server to server lookup, never the browser redirect (rule 3).
- Refunds go through the API, from the relay. The card fee on a refunded payment is not recovered (D13).
- Still to confirm: the tracker's PSP table (S1, S2), including whether the existing account allows standard checkout and which iyzico agreements users must accept.

### PayTabs (Saudi Arabia)

> **Deferred with the KSA launch (D22, 2026-10-17).** PayTabs was the earlier assumption for KSA; the
> Saudi PSP is chosen later (Q7). Kept as research notes for that decision.

- Split payouts are **API-only** (dashboard is monitoring only). Marketplace/sub-merchant and escrow-style payout rules are configurable.
- **mada support is mandatory** for Saudi cards.
- Onboarding KYC is slower than alternatives — plan for it.
- **ZATCA e-invoicing** is a Saudi obligation — confirm who is responsible before launch.

### Things to confirm with the PSP before Phase 5 (record in `progress-tracker.md`)
1. Maximum hold duration ≥ our 72-hour release window.
2. Can **individual** (non-company) providers be sub-merchants?
3. Settlement delay after release.
4. Webhook signature scheme + retry policy + event id for dedupe.
5. Refund and partial-refund support while held.

### Non-negotiables when integrating
- Verify webhook signatures on the **raw** body.
- Dedupe on the PSP event id.
- Re-verify amount and status against our records — never trust the payload.
- The browser redirect is **not** proof of payment.
- Sandbox keys in dev/staging; live keys only in production.

---

## Testing

- Test runner and RLS-testing approach to be pinned in Phase 0 and recorded here.
- **Required capabilities:** run a real Postgres with our migrations, impersonate different users to test policies, and run operations in parallel to test concurrency. A mocked database cannot test RLS — do not try.

---

## Explicitly not used

| Not used | Why |
| --- | --- |
| Any client-side money math library | Money is computed server-side only |
| ORMs that bypass RLS by default | RLS is the security model; don't route around it |
| `localStorage`/`sessionStorage` for auth or money state | Not a trust boundary; use server session |
| Custom crypto | Use the platform's / PSP's |
| A component library other than shadcn/ui | One system only; see `ui-rules.md` |

---

## Adding a dependency — checklist

- [ ] Does the platform, Supabase, or shadcn already do this?
- [ ] Is it maintained, and reasonably sized?
- [ ] Does it need a secret or phone home? (If yes → probably no.)
- [ ] Does it touch money, auth, or PII? (If yes → **stop and ask**.)
- [ ] Added here with a one-line justification and version pinned.

---

## Before Using Any Library

Before implementing any feature that uses a third-party library:

1. **Check `AGENTS.md`** at the project root — it lists every skill installed for this project and how to use it. Skills contain up-to-date API documentation and patterns specific to this codebase.
2. **Check whether an MCP server is configured** for that library. If one is available, use it before falling back to general knowledge.
3. **Read this file** for project-specific patterns that override general library knowledge.

The order of authority is:

```
AGENTS.md skills  →  MCP server docs  →  this file  →  official docs  →  general knowledge
```

**Never rely on training-data memory for an API surface that may have changed.** Next.js 16, React 19, Tailwind v4, and the PSP SDKs have all changed recently. Verify before implementing.

---

## Environment Variables by Library

| Library | Variables |
| --- | --- |
| Supabase (browser) | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| Supabase (server) | `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_POOL_URL` |
| PSP — Turkey | `IYZICO_BASE_URL`, `IYZICO_API_KEY`, `IYZICO_SECRET_KEY`, `IYZICO_WEBHOOK_SECRET` |
| PSP — Saudi | `PAYTABS_BASE_URL`, `PAYTABS_PROFILE_ID`, `PAYTABS_SERVER_KEY`, `PAYTABS_WEBHOOK_SECRET` |
| OTP channel | `OTP_CHANNEL`, `SMS_API_KEY` |
| Notifications | `WHATSAPP_API_KEY`, `EMAIL_API_KEY` |
| App config | `APP_DEFAULT_LOCALE`, `APP_SUPPORTED_LOCALES` — **no `APP_REGION`** (D14) |

Full table with secret classification: `code-standards.md` §22.

---

## Tailwind CSS v4

- Tokens defined with `@theme` in `app/globals.css`. **No `tailwind.config.ts` for colours**
- Utility classes are generated automatically from `--color-*` variables
- **Never** use arbitrary values or raw Tailwind colour classes
- **RTL:** logical properties only (`ms/me`, `ps/pe`, `start/end`) — direction flips per locale at runtime
- v4 differs meaningfully from v3 — check the v4 docs, not v3 memory

## next-intl

The i18n layer. Full project spec: [`i18n.md`](i18n.md). Library-level notes:

- Route segment `app/[locale]/...`; `defineRouting({ locales: ['ar','tr','en'], defaultLocale })`.
- `generateStaticParams()` returns the locale list so pages stay statically renderable.
- Each locale layout: validate with `hasLocale()` → `notFound()`, then `setRequestLocale(locale)`.
  **Repeat `setRequestLocale` in each `page.tsx`** — without it the page opts out of static rendering.
- `proxy.ts` (never `middleware.ts`) handles locale negotiation. Routing/UX only — not authorisation.
- **`localePrefix: 'always'` (D19)** — every locale is prefixed; there is no unprefixed route.
  `as-needed` gives exactly one locale the bare URL, which cannot express a per-region default
  (`tr` for TR, `ar` for KSA), and region is unknown until login. `/` is a negotiation endpoint.
- Formatting comes from the same layer: `useFormatter` / global `formats` for dates, numbers, lists.
- **Gotcha:** `dir` is not managed for you. Derive it from the locale (`i18n.md` §4) and set it on
  `<html>` alongside `lang`. Hardcoding either direction is the bug this whole model exists to avoid.

## next/font

- One family covering **Arabic *and* Latin Extended** (`ı İ ş ğ ç ö ü` for Turkish), exposed as `--font-sans`
- Include `arabic` and `latin-ext` subsets, not just `latin`
- Never a system-font fallback as primary
- **Gotcha:** many Arabic-capable fonts ship a weak or absent Latin Extended range. Verify glyph
  coverage in all three languages before committing — a missing `ğ` shows as tofu to every Turkish user

## date-fns

- All timestamps stored **UTC**; convert at display only
- `unlock_deadline` and `release_deadline` are computed and compared **server-side** — never trust a client clock
- Arabic locale for display formatting

## Zod

- One schema per boundary in `lib/validation/`, shared client and server
- **Server always re-parses** — client validation is UX only
- Also validate **PSP responses and webhook payloads** — external input is untrusted

---

## Deliberately Not Used

| Not used | Why |
| --- | --- |
| `tailwind.config.ts` for colours | Tailwind v4 uses `@theme` |
| Any client-side money library | Money is server-computed only |
| An ORM that bypasses RLS | RLS is the security model |
| `localStorage` / `sessionStorage` for auth or money | Not a trust boundary |
| A second component library | shadcn/ui only |
| Custom crypto | Use the platform's or the PSP's |

---

# ⚠️ v5 — REVIEW FIXES

## Testing: pgTAP + pg_prove (this is the named tool)

Earlier docs demanded RLS tests without naming a tool. **The answer is pgTAP**, which Supabase ships as an extension with `pg_prove` support.

- Enable the `pgtap` extension; tests live in `supabase/tests/**.sql`.
- Run with `supabase test db` (or `pg_prove`).
- Community test helpers provide authenticate-as-user, create-test-user, and RLS verification utilities.
- **Policy-specific assertions:** `policies_are()` (a table has exactly the expected policies), `policy_roles_are()`, `policy_cmd_is()`.
- **Add a schema-wide test asserting RLS is enabled on every table** in the public schema — this catches the "forgot to enable RLS on the new table" failure, which is the single most common Supabase security incident.
- **RLS cannot be tested against a mocked database.** Tests must run against a real Postgres with our migrations applied.

### Property-based testing for ledger invariants

Fixed-fixture tests miss edge cases. For invariants (`held = released + refunded + remaining`, `debits = credits`, balance projections), use property-based testing: describe the invariant, generate many valid datasets, and let the framework shrink to the smallest failing case. Use it for aggregation invariants and RLS regressions; keep pgTAP for specific policy assertions.

## Supabase Auth, Turnstile, Twilio Verify: what real calls return (checked 2026-10-31)

From the local Auth server (CLI 2.114.0), by real calls; `tests/auth-errors.test.ts` quotes them. Twilio
Verify's own limits and the per IP limit need the cloud project: `docs/specs/0005-sign-in/verify.md`.

- **The `before_user_created` hook fires on `/otp`** for a new number, before any SMS. A refusal answers
  `400` with `error_code: "unknown"` and our own message (`phone_not_supported`), so match the message.
- **Two limits share one code.** The per phone window and the hourly cap are both `429`
  `over_sms_send_rate_limit`; the text tells them apart: `For security purposes, you can only request this
  after N seconds.` against `SMS rate limit exceeded`.
- **A test number with a fixed code skips the SMS path,** so it never hits the hourly cap, and the local
  server applies no per IP limit (`over_request_rate_limit` needs the cloud).
- A wrong code, an expired code and an unknown phone all answer `403` `otp_expired`.
- A provider failure is `422` `sms_send_failed`, with the provider's error page in the text.
- `signup` with an email answers `400` `email_provider_disabled`.
- **A phone and password sign up works on the API** when phone sign up is on: `200`, no session, a code goes
  out. Without the `no_password` trigger, the victim's code would confirm the attacker's password. With it,
  a password sign in after the code answers `400` `invalid_credentials`.
- `signOut()` ends every device by default: pass `{ scope: 'local' }`.
- `getClaims()` refreshes an expired session and verifies the token: locally with asymmetric keys, through
  `getUser` with a symmetric one. It returns errors rather than throwing, unless the fetch itself fails.
- `request.url` in a Route Handler under `next start` says `localhost` whatever the browser used. Build a
  redirect from it and the cookies stay behind on `127.0.0.1`. Send a relative `Location`.
- **Zod 4 on load runs `Function("")`** to see whether it can compile (`allowsEval`), inside a try. Under the
  nonce CSP that is a `script-src eval` violation on every page that imports it. Keep Zod out of browser
  code, or set `z.config({ jitless: true })` first.
- **Turnstile with `'strict-dynamic'`:** the script with the page nonce plus `frame-src
  https://challenges.cloudflare.com` is all it needs. Proved with the test key in Chromium and stable Chrome.
- `tailwind-merge` must be told our `--text-*` scale, or `text-body` counts as a colour and removes
  `text-text-primary` beside it (`lib/utils.ts`).
- **`shadcn add`** with a hand written `components.json`, at CLI 4.21.5, generated `import { cn } from "cn"` and
  installed the `cn` package (published days earlier), and did not install `clsx`, `tailwind-merge`,
  `class-variance-authority` or `lucide-react`. Read what it wrote before trusting it.

## Supabase Storage: what real calls return (checked 2026-11-10, local stack, storage-js 2.112.3)

Position 02 (spec 0006). Recorded from real calls against local Storage with a real provider token, for
the code map in `lib/storage/files.ts`.

- **Every refusal answers HTTP 400.** The real status is the body's `statusCode` string, and storage-js
  puts it on `StorageApiError.statusCode` (with `code`): `403` `AccessDenied` "new row violates row-level
  security policy" (no policy, another folder, no consent); `415` `InvalidMimeType` (declared type not in
  the bucket's list); `413` `EntityTooLarge` (over `file_size_limit`); `409` `KeyAlreadyExists` (upsert off,
  object there). Map on `statusCode`/`code`, never on the HTTP status.
- **`remove()` reports only what it deleted.** An object the policy hides (another folder, or a file a row
  points to) is missing from the list with status 200 and no error, so compare the list with what you asked.
- **`createSignedUrl` on an object you cannot select** answers 404 `NoSuchKey`, never 403: the select
  policy hides the row. Signing needs the select policy; downloading by the token then needs none.
- **A Blob body is sent as a form part with the Blob's own type, and `contentType` is ignored there.** A PDF
  picked on Android with an empty `File.type` is refused as `invalid_mime_type`. `uploadProviderFile`
  rewraps every body as `new Blob([file], { type })` (found by `/develop` 2026-11-10).
- `cacheControl: '0'` is stored as `metadata.cacheControl = "max-age=0"`; `metadata.size` and
  `metadata.mimetype` are set when the upload returns, so `register_provider_document` reads them then.
- **`storage.protect_delete()`** is a trigger on `storage.objects` that refuses every SQL `DELETE` unless
  `storage.allow_delete_query` is `true` for the transaction (the Storage API sets it). pgTAP sets
  `SET LOCAL storage.allow_delete_query = 'true'` to prove the delete policy.
- A migration may insert into `storage.buckets` and create policies on `storage.objects` as `postgres`;
  the cloud project accepted both on 2026-11-10. `storage.objects.name` has the default collation: compare
  it with a `collate "C"` column as `name collate "C"`, or Postgres cannot pick a collation.

## Telemetry relays: what real traffic sends (checked 2026-10-31)

Found by running the relays against the real services. A stub in the browser proves the SDK, never the
handler, so a relay needs one real call before it counts as proved.

- **posthog-js 1.418:** a capture is `POST /e/` with no query string, a gzip body, `Content-Type:
  text/plain`, and the events as `{ api_key, batch, sent_at }`. It falls back to `?compression=base64`.
  Recognise gzip by its first two bytes, never by a parameter.
- **CSP reports in Chrome:** with both `report-uri` and `report-to` in the policy, Chrome uses only
  `report-to`. That is the Reporting API: `application/reports+json`, an array of `{ age, type:
  "csp-violation", url, user_agent, body }` with camelCase keys (`documentURL`, `blockedURL`). A browser
  without `report-to` uses `report-uri`: `application/csp-report`, `{ "csp-report": { … } }` with kebab
  case keys.
- **The Reporting API needs https.** On `http://localhost` Chrome reports nothing at all. Stable Chrome
  uploads within seconds over https, headless on a throwaway profile too (`channel: 'chrome'`).
  Playwright's `chromium_headless_shell` and the desktop app's built in browser did not upload in 100
  seconds, so neither can prove this path.
- **Sentry's `/security/` endpoint** answers `200` with an empty body to every form, so the answer proves
  nothing: look for the event. Both forms become `csp` events. Reports from a `localhost` document never
  appeared, most likely Sentry's default CSP source list.
- **`'strict-dynamic'` in Chromium** lets a running script add an inline `<script>` through
  `createElement` with no violation. That is its trust model, not a hole in the policy. For a test
  violation, load an image from another origin.

## Next.js — v5 corrections

- **`proxy.ts`, not `middleware.ts`.** The old convention is deprecated in Next 16 and a leftover file is silently ignored. Codemod: `npx @next/codemod@canary middleware-to-proxy .`
- Proxy defaults to the Node.js runtime; the `runtime` config option is unavailable there.
- Proxy is **not** a security boundary — authorisation goes in every Server Action and Route Handler.
- **Patch cadence matters:** the framework had 13 security fixes in May 2026 and 9 in July 2026, including middleware/proxy authorization bypass and SSRF. Pin versions, automate dependency PRs, patch security releases within 72 hours.

## Supabase — v5 corrections

- **Transaction-mode pooler** for all serverless access; **disable prepared statements**; no persistent `SET`, no `LISTEN`/`NOTIFY`. Direct connection for migrations only.
- **RLS has a real performance cost.** Index policy columns; wrap `auth.uid()` as `(select auth.uid())`; run `EXPLAIN ANALYZE`; use Supabase's database advisors in CI to catch unindexed foreign keys and misconfigured policies.
- `SECURITY DEFINER` functions bypass RLS by design — each one must perform its own authorisation check and pin `search_path`.

## New required libraries

| Library | Purpose |
| --- | --- |
| `pgtap` (Postgres extension) | RLS and schema testing |
| `pg_prove` / `supabase test db` | Test runner |
| OpenTelemetry SDK | Tracing across action → DB → outbox → PSP |
| A feature-flag mechanism | Kill switches without deploy (can be a DB table + cache) |

Add the property-based testing library once the language/runtime for it is chosen; record the choice in `progress-tracker.md`.
