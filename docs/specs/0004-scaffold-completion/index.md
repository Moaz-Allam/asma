# 0004. Scaffold completion (position 00b)

**Date**: 2026-10-28
**Status**: Accepted (confirmed by the owner 2026-10-28, after a cross check on a second model)
**Amended**: 2026-10-29 after the reviews, by decisions that win over this text: D82 (Sentry sensitive
fields are a narrow list), D83 (`/api/e`, `/api/a/*` and `/api/csp` are our own Route Handlers, not
rewrites or `tunnelRoute`; CSP reports go to `/api/csp`), D84 (the alert fingerprint carries the
environment), D85 (URL parameters are an allow list). 2026-10-30: the money flags change in position 07
(D87, D95).

## Summary

This position finishes the scaffold so every later position can see its errors, count its usage,
and switch money features off safely. Sentry (EU) becomes the one place for errors, traces (timed
request paths), logs and alerts; PostHog (EU) counts anonymous usage without storing anything on the
visitor's device, so no consent banner is needed for now. Pages get a strict Content Security Policy
(a header that tells the browser which scripts may run), the five money switches move into the
database per region, KSA is switched off, and a deployment refuses to run without its error and
analytics keys. It closes gate G0: a preview serves the placeholder in `ar`, `tr` and `en`, and a test
error shows up in Sentry with a readable stack trace and no personal data.

## Requirements

**User stories**:
- As the owner, I want every error on a preview or production reported to me with a readable stack
  trace and no personal data, so that I fix problems before customers notice.
- As the owner, I want an alert on my phone when a money safety check fails, so that I act at once.
- As the owner, I want anonymous usage numbers without a consent banner, so that I learn how the
  product is used while staying inside KVKK (Turkey's data protection law).
- As the owner, I want to switch any money feature off per region without a deploy, so that I can
  stop damage instantly.
- As a visitor, I want the site to refuse injected scripts and framing, so that my data stays safe.
- As the uptime monitor, I need one endpoint that tells "app up" from "database down".

**Prerequisites** (not acceptance criteria, but the build cannot pass G0 without them):
- D66 merged to `master` (done 2026-10-28, `64d2613`); this branch merges `master` before task 2.
- Before task 7: the 00b migration pushed to the cloud project by the owner (dry run first), which
  needs the Supabase CLI logged in to the `aldebyani` account (S6); `NEXT_PUBLIC_SENTRY_DSN` and
  `SENTRY_AUTH_TOKEN` present in both the Preview and Production scopes on Vercel.
- Before task 10: the PostHog EU project exists (S8) and `NEXT_PUBLIC_POSTHOG_KEY` is present in both
  Vercel scopes.

**Acceptance criteria** (the contract):
- **AC-1**: An error thrown in a Server Action, a Route Handler, a server component or a client
  component on a deployment reaches Sentry org and project `aldebyani` (EU) tagged with the
  environment (`production` or `preview`) and the release (the full commit SHA, the same name
  Vercel's Sentry integration uses), on the server and in the browser alike. Its stack trace maps to
  source files: source maps are uploaded at build, an upload failure fails the Vercel build, and a
  post build check finds no `.map` file under `.next/static` on a deployment build.
- **AC-2**: Browser reports travel through the same origin path `/api/e` (the tunnel), which forwards
  to the EU ingest host, so they still arrive when the browser blocks `*.sentry.io`. No trace header
  is sent to any other origin (`tracePropagationTargets` empty), and no span is recorded for
  `/api/e` or `/api/a`.
- **AC-3**: No payload leaves with personal data. For Sentry, the scrubber walks only user data
  fields (event `extra`, `request`, breadcrumb `data`, log attributes, span attributes, user defined
  `contexts`, replay URLs) and never SDK owned fields. It drops values under the keys in Key
  invariants, strips the sensitive URL parameters (`token`, `access_token`, `refresh_token`,
  `token_hash`, `code`, `email`, `phone`, `q`, `ref`, `customer`) and every URL fragment, and redacts
  email addresses, IPv4 and IPv6 addresses, and phone numbers (anchored pattern, message like fields
  only). `onRequestError` keeps only allow listed request headers (never `cookie`, `authorization`,
  `x-forwarded-for`, `x-real-ip` or `x-vercel-ip-*`), and `user` is never set. If the scrubber throws,
  the event is dropped. For PostHog, events carry only their typed properties, scrubbed URLs and the
  allow listed event names. Sentry `sendDefaultPii` is off. Property tests and recorded real Sentry
  and PostHog payloads prove it.
- **AC-4**: Sentry keeps a replay (a recording of the screen) only for a session in which an error
  happened (session rate 0, on error rate 1), with every text node, input and media element masked.
  The replay integration loads lazily after hydration and keeps nothing in `sessionStorage`
  (`stickySession: false`). PostHog session recording is off.
- **AC-5**: Production samples 10% of traces and previews 100%. Server logs go through one logger to
  Sentry Logs (`enableLogs` on). Each record carries `event` (from the `LogEvent` union),
  `correlation_id` (the active trace id, or a fresh one per job run), and only ids from `LogIds`
  (`request_id`, `region`, `user_id` as the internal uuid), never personal data or a URL path holding
  it. When the SDK is off, the logger mirrors to the console.
- **AC-6**: PostHog (EU Cloud) runs in cookieless mode through the same origin path `/api/a`, starting
  after hydration. Every option is set explicitly: `cookieless_mode: 'always'`,
  `person_profiles: 'never'`, autocapture, pageleave, heatmaps, dead clicks, exception capture,
  session recording, surveys and remote feature flags all off, and the client IP not sent. Each event
  carries `app_env` (`production`, `preview` or `local`). After a visit, neither PostHog nor Sentry
  has left any cookie, `localStorage` or `sessionStorage` entry.
- **AC-7**: Only events in the `AnalyticsEvent` union are sent: the type rejects any other name at
  build, and a runtime allow list in `before_send` drops anything else, including SDK generated
  events. 00b defines `$pageview` (sent manually on each route change, URL scrubbed per AC-3) and
  `locale_changed` with `from_locale` and `to_locale`.
- **AC-8**: Only `lib/observability/` imports `@sentry/*` and only `lib/analytics/` imports
  `posthog-*`. Everything else calls named door functions: `instrumentation.ts`,
  `instrumentation-client.ts`, `proxy.ts` (the CSP builder in `lib/security/csp.ts`, which parses
  the DSN without importing the SDK), `app/[locale]/error.tsx`, `app/global-error.tsx` and
  `LocaleSwitcher`. `next.config.ts` may import only the Sentry build wrapper. Only the doors,
  `lib/deployment.ts`, `lib/env.ts` and `next.config.ts` read `NEXT_PUBLIC_SENTRY_DSN`,
  `SENTRY_AUTH_TOKEN` and `NEXT_PUBLIC_POSTHOG_KEY`. Each rule and each exemption is proven to fire
  by `tests/lint/eslint-rules.test.ts`, in the same change that creates its door (architecture §42).
- **AC-9**: `isDeployment(env)` is true whenever `VERCEL` is `1`, and for any production build or
  server unless `APP_LOCAL_ONLY` is exactly `1`; `APP_LOCAL_ONLY=1` together with `VERCEL=1` is a
  build and boot error. The requirements per environment are the matrix in Configuration required.
  On a deployment, a missing or malformed key stops the build (`next.config.ts`, build phase) or the
  boot (`register()`) with a message naming the variable: the DSN must point at `*.de.sentry.io`, the
  PostHog key must start with `phc_`, and a Vercel build without a commit SHA fails. Each key becomes
  required in the task that adds its door (the DSN in task 5, the PostHog key in task 10).
- **AC-10**: `GET /api/health` answers 200 `{ status: "ok", db: "ok", commit, region, checkedAt }` only
  when `health_ping()` returns `true` within 2 seconds. A timeout, an error, `false` or an abort all
  give the same 503 `{ status: "degraded", db: "down", commit, region, checkedAt }`. A result is
  reused for 5 seconds per server instance. The response sends `Cache-Control: no-store`, needs no
  session, and never contains personal data, a secret or error text.
- **AC-11**: `raiseAlert(reason, detail)` accepts only a reason from the `AlertReason` union and sends
  one Sentry event tagged `alert`, fingerprinted by reason plus record id. 00b defines
  `flag_read_failed`, raised with record id `region:flag` and a `cause` (`error`, `missing`,
  `not_boolean`, `timeout`). The send is flushed before the function freezes. Two Sentry alert rules,
  both filtered to events tagged `alert` in `production`, email the owner (push to the Sentry phone
  app comes from the owner's notification settings): one on a new alert issue, one when an alert
  issue passes 10 events in 10 minutes. A real `raiseAlert` from the preview proves delivery.
- **AC-12**: Every response carries `Strict-Transport-Security: max-age=86400` (raised to two years
  with `includeSubDomains` once the final domain exists, S4), `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`,
  `Cross-Origin-Opener-Policy: same-origin`, and a `Permissions-Policy` that turns off camera,
  microphone, geolocation and payment.
- **AC-13**: Every page response carries an enforced `Content-Security-Policy` with a fresh nonce (a
  random one time token) per request, built by `lib/security/csp.ts`, with exactly the directives in
  the CSP policy table below. The nonce reaches Next through the request headers and the policy is
  also set on the response. Pages render per request (no `generateStaticParams`, the locale layout
  forced dynamic), and no locale page appears in the prerender manifest. The Vercel toolbar is off on
  previews. A missing or malformed DSN leaves out only the report directives; the proxy never throws.
  `/ar`, `/tr` and `/en` raise zero `securitypolicyviolation` events with both SDKs running.
- **AC-14**: `platform_settings` holds the five money flags per region (`funding_enabled`,
  `unlock_enabled`, `payouts_enabled`, `auto_release_enabled`, `notifications_enabled`; TR `true`, KSA
  `false`), and a key ending `_enabled` can only hold a JSON boolean. `isEnabled(flag, region, db)`
  reads the row on every call through a signed in or admin client, with a 2 second limit. A read
  error, a timeout, a missing or hidden row, or a non boolean returns `false`, logs, and raises
  `flag_read_failed`. Changing the row changes the next read with no deploy. The five flag variables
  leave `.env.example`.
- **AC-15**: The KSA row in `regions` has `active = false` and all its flags are `false`, proven by
  pgTAP. (Nothing reads `regions.active` until 01; the flags are the switch that acts in between.)
- **AC-16**: Functions run in `fra1`. A preview deployment of this branch serves the placeholder in
  `ar`, `tr` and `en` to the logged in owner; Vercel login protection stays on for previews, with
  share links for anyone else. Env values exist in both the Preview and Production scopes: public
  ones are set through the Vercel connector, secrets by the owner, and Vercel's Sentry integration may
  provide its own. No secret value passes through the chat.
- **AC-17**: A crash that escapes the locale layout shows a short message in the visitor's locale (the
  first segment of `usePathname()`, else the default locale) with the right direction, using only
  the `Error` part of each message catalogue. Error boundaries report an error only when it has no
  `digest` (a digest means the server already reported it), so nothing is reported twice.
- **AC-18**: A verification preview from a throwaway branch (`verify/00b-sentry`, never merged) has one
  Route Handler and one client button that throw. Both errors appear in Sentry with mapped frames, and
  their raw event JSON shows no personal data in `user`, `request`, breadcrumbs or `contexts`. The
  preview is reached through a share link kept out of the chat and the commits. Sentry's onboarding
  run `e892146afa` then reaches completed (test error sent and confirmed, production prepared, stack
  traces checked).
- **AC-19**: The Sentry skills come from Sentry's official Claude plugin (`sentry:sentry-instrument`,
  `sentry:sentry-get-started`, `sentry:sentry-setup-releases`, `sentry:sentry-create-alert`; owner
  choice 2026-10-28), recorded in `AGENTS.md` with the plugin source and the date checked; no copies are
  vendored. PostHog's `nextjs-app-router` skill (`PostHog/skills` at `1914a60`, path
  `skills/posthog/integration/skills/nextjs-app-router/`) is vendored under
  `.claude/skills/posthog-nextjs-app-router/` with a `VENDORED.md` (source, pin, MIT, kept, left out,
  overrides) and listed in `AGENTS.md`. Wherever a skill advises running a setup wizard or differs from
  this spec, this spec wins.
- **AC-20**: `@sentry/nextjs` is pinned to the lowest version that uploads Turbopack source maps and
  supports Sentry Logs with `beforeSendLog`, found with `sentry:sentry-instrument`; `posthog-js` is
  pinned likewise. Each is at least 7 days old (unless a security release), recorded in the
  `AGENTS.md` stack table, and every install script they bring (Sentry's CLI binary first) is
  reviewed and allowed per version (D45) before the first Vercel build.
- **AC-21**: Sentry's inbound filters drop browser extension errors, localhost events and legacy
  browsers; known extension noise is listed in `ignoreErrors` and `denyUrls`. The free plan quotas are
  checked against expected launch volume in task 15, and the sample rates adjusted if needed.

## Decision

**Chosen option**: one EU observability backend (Sentry for errors, traces, logs, replays on error and
alerts), a cookieless anonymous PostHog for product analytics, a strict nonce CSP on every page,
database flags per region read live and failing closed, and a deployment guard that refuses to run
without error and analytics keys.

Owner decisions taken in the design conversation on 2026-10-28 (record as D67 onward on acceptance):
flags in the database in 00b · cookieless analytics, no banner · Sentry replay on error only, PostHog
replay off · Sentry DSN and PostHog key both required on deployments, each from the task that adds its
door · Sentry Logs · tracing 10% production, 100% preview · alerts through Sentry now, summary email at
13 · strict nonce CSP, enforced now, reported to Sentry · health checks app plus database · alert
dedupe by Sentry grouping, plus an escalating rule · flags TR on, KSA off · live flag reads, fail
closed · server side analytics with its first event (08 or 09) · events `$pageview` and
`locale_changed` · Vercel login on previews, share links when needed · the agent sets public Vercel
env values, the owner sets secrets · Sentry skills from Sentry's Claude plugin, PostHog's skill
vendored. From the cross check (all recommended fixes accepted): keep Vercel's Sentry integration ·
Vercel toolbar off on previews · one PostHog project with an `app_env` property · Sentry replay with
`stickySession: false` · HSTS at one day until the domain exists.

**Implementation skills**: `sentry:sentry-instrument`, `sentry:sentry-get-started`,
`sentry:sentry-setup-releases`, `sentry:sentry-create-alert` (Sentry's official Claude plugin, user
level) · `nextjs-app-router` (`PostHog/skills`, `.claude/skills/posthog-nextjs-app-router/`, vendored in
task 1) · `supabase`, `supabase-postgres-best-practices` (`supabase/agent-skills`, `.agents/skills/`,
linked into `.claude/skills/`, for the migration and `health_ping()`)

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

**Data model sketch** (no new tables; one migration):

| Object | Kind | Change | Access |
| --- | --- | --- | --- |
| `regions` | table (exists) | KSA row: `active = false` | read: signed in (unchanged) |
| `platform_settings` | table (exists) | 10 rows `(region, key, value)`: the five flags × TR `true`, KSA `false`, seeded with `on conflict (region, key) do nothing`. New CHECK: `right(key, 8) <> '_enabled' or jsonb_typeof(value) = 'boolean'` | read: signed in; write: admin (unchanged) |
| `health_ping()` | SQL function (new) | `returns boolean`, `language sql`, `stable`, `security invoker`, body `select true` | `execute` to `anon` and `authenticated`; revoked from `PUBLIC`; entered in `supabase/tests/02_function_grants.test.sql` anon allow list ("position 00b, spec 0004: health endpoint database ping") |

Flags are keyed `(region, key)`; `platform_settings.region` already references `regions.code`. No
seeded key ends in `_enabled` today. pgTAP proves the CHECK both ways: `x_enabled` with a string is
rejected, `xenabled` with a string is accepted. A flip in the Supabase table editor records no
`updated_by`; accepted until the admin UI (16) adds audit.

**State transitions**: none (a flag is on or off; flipping is a row update by an admin).

**API surface**:

| Endpoint or function | Method | Key inputs | Key outputs | Auth | Key errors |
| --- | --- | --- | --- | --- | --- |
| `/api/health` | GET | none | `status`, `db`, `commit`, `region`, `checkedAt` | public | 503 `degraded` |
| `/api/e` (Sentry tunnel, a rewrite made by `withSentryConfig`) | POST | Sentry envelope from the SDK | Sentry's answer | public | Sentry 4xx passed through |
| `/api/a/*` (PostHog proxy: `/api/a/static/*` and `/api/a/array/*` to `https://eu-assets.i.posthog.com`, the rest to `https://eu.i.posthog.com`) | GET, POST | PostHog payloads from the SDK | PostHog's answer | public | passed through |
| `isDeployment(env)`, `missingDeploymentKeys(env, phase)` (`lib/deployment.ts`) | function | an env record, the build or runtime phase | `boolean`, the missing or malformed key names | build and server | throws on `APP_LOCAL_ONLY=1` with `VERCEL=1` |
| `buildCsp(nonce, options)`, `cspReportUri(dsn)` (`lib/security/csp.ts`) | function | nonce, environment, Supabase URL, DSN | the policy string, the report URI or none | proxy | never throws |
| `initServer()`, `initClient()`, `captureRequestError()`, `reportClientError(error)`, `onRouterTransitionStart`, `raiseAlert(reason, detail)`, `log` (`lib/observability/`) | functions | as named | none | server or client as named | never throw |
| `initAnalytics()`, `track(event, props)` (`lib/analytics/`) | function, client | `AnalyticsEvent` and its typed props | none | client | do nothing without a key or under test |
| `isEnabled(flag, region, db)` (`lib/flags/`) | function, server only | `MoneyFlag`, `Region`, a `Db` client (type exported by `lib/db`) | `boolean` | the client's RLS (signed in or admin) | never throws; `false` on any failure |
| `createAnonClient()` (`lib/db/anon.ts`) | function, server only | none | a stateless anonymous Supabase client (no cookies) | `anon` | none |

**CSP policy** (built per request; `<nonce>` fresh each time):

| Directive | Value |
| --- | --- |
| `default-src` | `'self'` |
| `script-src` | `'self' 'nonce-<nonce>' 'strict-dynamic'`, plus `'unsafe-eval'` in development only (dev overlay); PostHog's lazy bundles load through the trust `'strict-dynamic'` passes on |
| `style-src` | `'self' 'unsafe-inline'` (style attributes; no nonce here, because a nonce would cancel `'unsafe-inline'`) |
| `img-src` | `'self' blob: data:` |
| `font-src` | `'self'` (next/font is self hosted) |
| `connect-src` | `'self'` plus the Supabase origin, with `https`/`wss` or `http`/`ws` taken from the URL's scheme |
| `worker-src` | `'self' blob:` (Sentry Replay's compression worker) |
| `frame-src` | `'none'` |
| `frame-ancestors` | `'none'` |
| `object-src` | `'none'` |
| `base-uri` | `'self'` |
| `form-action` | `'self'` |
| `report-uri`, `report-to` | the Sentry security endpoint derived from the DSN; left out when the DSN is missing or malformed |

No `upgrade-insecure-requests` (local and e2e run on http). The proxy matcher takes the object form,
skips prefetch requests (`next-router-prefetch`, `purpose: prefetch`), and keeps the existing
`api|_next|_vercel|dotted path` exclusions; a "page response" is any response the matcher reaches.

**Value sourcing**:

| Action | Value | Source |
| --- | --- | --- |
| Sentry init (server) | environment, release | `VERCEL_ENV`, `VERCEL_GIT_COMMIT_SHA`; else `local` |
| Sentry init (browser), PostHog `app_env` | environment, release | `NEXT_PUBLIC_APP_ENV`, `NEXT_PUBLIC_APP_RELEASE`, mirrored at build by `next.config.ts` `env` from the two Vercel variables; else `local` |
| Sentry build | release name | the same full SHA, passed to `withSentryConfig`; a Vercel build without it fails |
| Sentry init | DSN | `NEXT_PUBLIC_SENTRY_DSN` (public by design) |
| Sentry init | trace sample rate | from the environment: `0.1` production, `1.0` preview, `0` local (owner decision) |
| Sentry build | org, project, region, telemetry | constants `aldebyani`, `aldebyani`, EU `sentryUrl` (`https://de.sentry.io`), telemetry off; confirm with `sentry:sentry-setup-releases` |
| Sentry build | auth token | `SENTRY_AUTH_TOKEN` (read only by `next.config.ts`, lint enforced; Vercel exposes project env to functions too, so "build only" is a lint rule, not a platform guarantee) |
| CSP | nonce | `crypto.randomUUID()`, base64, per request in `proxy.ts` |
| CSP | report endpoint | derived from the DSN: the ingest host, project id and public key of the Sentry security endpoint |
| CSP | Supabase origin and scheme | `NEXT_PUBLIC_SUPABASE_URL` |
| PostHog init | key | `NEXT_PUBLIC_POSTHOG_KEY` |
| PostHog init | `api_host`, `ui_host` | constants `/api/a` and `https://eu.posthog.com` (D62) |
| `locale_changed` | `from_locale`, `to_locale` | `LocaleSwitcher`: the active locale and the chosen one |
| health | `commit` | `VERCEL_GIT_COMMIT_SHA`, else `local` |
| health | `region` | `VERCEL_REGION` (the function region, such as `fra1`), else `local`; never the business region |
| health | `checkedAt` | server clock, ISO 8601 UTC (the time of the reused result during the 5 second window) |
| health | `db` | `health_ping()` through `createAnonClient()` with `AbortSignal.timeout(2000)`; the ping is injectable for unit tests |
| `isDeployment` | result | `VERCEL`, `NODE_ENV`, `NEXT_PHASE`, `APP_LOCAL_ONLY` |
| `isEnabled` | flag value | the `platform_settings` row `(region, key)` through the caller's client |
| `isEnabled` | `region` | the owning row, passed by the caller (rule 10); never a client value |
| `raiseAlert` | fingerprint | `['alert', reason, detail.recordId]`; `flag_read_failed` uses `region:flag` |
| `raiseAlert` | tags | `alert: reason`, `region` when given, `cause` when given |
| logger | `correlation_id` | the active trace id; in a job, a new propagation context per run |
| global error page | locale | the first segment of `usePathname()` when it is a supported locale, else `routing.defaultLocale` |
| global error page | copy | the `Error` part of `messages/{ar,tr,en}.json`, imported statically |

**Key invariants**:
- Personal data never leaves. One scrubber, `lib/observability/scrub.ts`, walks user data fields only
  and keeps a list of reserved SDK fields it never touches. It matches keys after lowercasing and
  folding `-` to `_`, and drops a value when the key is one of `name`, `first_name`, `last_name`,
  `full_name`, `email`, `phone`, `phone_number`, `contact`, `address`, `street`, `district`, `city`,
  `postal_code`, `building`, `apartment`, `lat`, `lng`, `latitude`, `longitude`, `location`,
  `coordinates`, `iban`, `card`, `card_number`, `password`, `otp`, `token`, `secret`, `jwt`,
  `authorization`, `cookie`, `note`, `description`, `message`, `body`, `comment`, `national_id`,
  `tckn`, `identity_number`, `passport`, `tax_id`, `tax_number`, `birth_date`, `date_of_birth`,
  `dob`, or ends in `_email`, `_phone`, `_address`, `_token`, `_secret`, `_key`, `_password`. In free
  text it redacts email addresses, IPv4 and IPv6 addresses, and phone numbers with the anchored
  pattern `(?<![\w-])\+?\d(?:[\s().-]?\d){6,}(?![\w-])`, applied to message like fields only, so
  trace ids, uuids and commit SHAs survive. A scrubber failure drops the event. PostHog uses only
  the URL scrub plus typed properties and the event allow list.
- Neither SDK writes to the device, and PostHog never identifies anyone.
- On a deployment, error reporting and analytics are on: their keys exist and are well formed, or it
  does not build or boot.
- `APP_LOCAL_ONLY` is never `1` on Vercel.
- Only the doors import the SDKs or read their keys.
- A money flag fails closed, and only a JSON boolean can be stored under an `_enabled` key.
- The health answer is never cached by anyone but its own 5 second memo, and never holds personal
  data.
- KSA is inactive.
- Every page response has the enforced CSP with a fresh nonce; no script runs without it.
- Observability never breaks a request, and it never loses its last event: sends are not awaited on a
  request's critical path but are flushed with Next's `after()` (work that runs after the response),
  `onRequestError` awaits its capture, and every helper swallows its own failures.

**Security model**:
- Public on purpose: `/api/health`, `/api/e`, `/api/a/*`, all under `/api/`, which `proxy.ts` already
  skips, so none of them is localised. Rewrites run after the proxy. 01's action guard meta test must
  exempt `/api/health` by name (Follow-up); `/api/e` and `/api/a/*` are rewrites, not handlers.
- Flags: read by signed in users (existing RLS) and by server jobs through the admin client; an
  anonymous client always reads `false`. Written by admins only (existing policy). Until the admin UI
  (16), the owner flips a flag in the Supabase table editor.
- `health_ping()`: callable by `anon` and `authenticated` only, and it reads nothing.
- Compliance scope: KVKK, held to GDPR grade practice. Cookieless analytics without a banner and masked
  error replays that store nothing on the device rest on legal confirmation under S16 (Follow-up).
- Dashboard settings (owner): Sentry "prevent storing of IP addresses" on, the scrubber key list added
  to its data scrubbing, and the inbound filters of AC-21; PostHog "discard client IP data" on,
  autocapture off, recordings off.
- Vercel: login protection on previews; Vercel toolbar off on previews.

**Configuration required**:

| Variable | Dev and vitest | CI build, e2e (`APP_LOCAL_ONLY=1`) | Vercel preview and production |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SENTRY_DSN` | optional; SDK off without it | a dummy DSN of the right shape, so the SDK runs against the e2e stubs | required at build and boot from task 5; host `*.de.sentry.io` |
| `SENTRY_AUTH_TOKEN` | not used | not used | required at build only |
| `NEXT_PUBLIC_POSTHOG_KEY` | optional; SDK off without it | a dummy `phc_` key | required at build and boot from task 10; starts with `phc_` |
| `APP_LOCAL_ONLY` | not set | `1` | never set (an error) |
| `NEXT_PUBLIC_APP_ENV`, `NEXT_PUBLIC_APP_RELEASE` | derived (`local`) | derived (`local`) | derived from `VERCEL_ENV`, `VERCEL_GIT_COMMIT_SHA` |

- Each SDK is enabled by its key alone (`enabled = Boolean(key)`), not by `isDeployment()`.
- Vercel's Sentry integration may add `SENTRY_ORG`, `SENTRY_PROJECT` and `SENTRY_DSN`; they are
  accepted only if no code reads them outside the door. Task 7 lists the Vercel variable names (never
  values) in both scopes and adds only what is missing.
- Removed: `FUNDING_ENABLED`, `UNLOCK_ENABLED`, `PAYOUTS_ENABLED`, `AUTO_RELEASE_ENABLED`,
  `NOTIFICATIONS_ENABLED` (now database rows). `FEATURE_STORED_BALANCE_WALLET=false` stays (rule 9).
- `AGENTS.md` Commands and `.env.example` note that a local `npm run build` or `npm start` now needs
  `APP_LOCAL_ONLY=1`.
- `lib/deployment.ts` has no dependencies and uses only erasable TypeScript, because Next loads
  `next.config.ts` through Node's native TypeScript resolver (explicit `.ts` extension on the
  import; `tsconfig` allows it).
- `vercel.json`: function region `fra1`.

**Critical test scenarios**:
- Happy path: the verification preview's two errors appear in Sentry with mapped frames,
  `environment: preview`, the full SHA release, and no personal data in the raw JSON, verifies
  **AC-1**, **AC-2**, **AC-18**.
- Happy path (e2e, SDKs on with dummy keys, `/api/e` and `/api/a` stubbed): `/ar`, `/tr`, `/en` load
  with the CSP and zero violations; a pageview reaches the stub with a scrubbed URL and `app_env`;
  nothing leaves the origin; no cookie or storage entry remains, verifies **AC-6**, **AC-7**,
  **AC-13**, **AC-4**.
- Failure: the database ping times out, errors or returns `false`, and `/api/health` answers the same
  503 body each time, verifies **AC-10**.
- Failure: a flag read errors, times out or finds no row, so `isEnabled` returns `false`, logs, and
  raises `flag_read_failed` with record id `region:flag`, verifies **AC-11**, **AC-14**.
- Failure: a deployment build without `NEXT_PUBLIC_SENTRY_DSN`, or with a DSN outside
  `*.de.sentry.io`, fails naming it; `APP_LOCAL_ONLY=1` with `VERCEL=1` refuses to build or boot,
  verifies **AC-9**.
- Privacy (tests first): property tests over random nested payloads seeded with personal data keys,
  values, URL parameters, fragments and IPs, plus recorded real Sentry and PostHog payloads, come out
  clean while trace ids, uuids, SHAs and SDK fields survive; a throwing scrubber drops the event,
  verifies **AC-3**.
- Permission: `anon` can execute `health_ping()` but reads no `platform_settings` row; a string under
  an `_enabled` key is rejected; an SDK import outside its door fails lint, and each exemption is
  proven, verifies **AC-8**, **AC-10**, **AC-14**, **AC-15**.

## Build plan

Tracer Bullet: one error travels end to end from a preview to Sentry first, then each layer
thickens. Tests come first on the risky paths: the scrubber, `isDeployment()`, flags, the CSP builder,
and health.

**Slice 0, preparation**
1. Merge `master` into this branch (D66 is a prerequisite). Vendor PostHog's `nextjs-app-router` skill
   at its pin with a `VENDORED.md` (the owner reviews it line by line); record it and Sentry's plugin
   in `AGENTS.md`, satisfies **AC-19**.
2. Pin `@sentry/nextjs` and `posthog-js`; review and allow their install scripts per version, Sentry's
   CLI first; record both in the stack table, satisfies **AC-20**.

**Slice 1, the thread: one error from a preview into Sentry**
3. One migration: KSA inactive, the 10 flag rows, the `_enabled` CHECK, `health_ping()` with its
   grants; pgTAP for each, the CHECK both ways, and the grant test allow list entry, satisfies
   **AC-14**, **AC-15**, **AC-10**.
4. `lib/deployment.ts` and the env schema (tests first): the environment matrix, the build check in
   `next.config.ts`, the boot check in `register()`, the client mirrors `NEXT_PUBLIC_APP_ENV` and
   `NEXT_PUBLIC_APP_RELEASE`, the flag variables removed; `scripts/e2e.mjs` and the CI build set
   `APP_LOCAL_ONLY=1` and the dummy keys; the `AGENTS.md` Commands note, satisfies **AC-9**.
5. `lib/observability/` door: the scrubber (tests first, property based, recorded fixtures), Sentry
   server and client init (no edge init: the proxy runs on Node and no route uses the edge runtime),
   the hooks for every signal, `instrumentation.ts` (`register`, an awaited `onRequestError`),
   `instrumentation-client.ts` (Replay lazy, `stickySession: false`), `withSentryConfig` (tunnel
   `/api/e`, EU `sentryUrl`, release name, telemetry off, an upload failure fails the build, delete
   maps after upload, and the post build `.map` check), the DSN requirement, its lint rules and
   proofs, satisfies **AC-1**, **AC-2**, **AC-3**, **AC-4**, **AC-8**, **AC-9**.
6. `/api/health`, `createAnonClient()` and the 5 second memo (tests first), satisfies **AC-10**.
7. Owner: push the migration (dry run first), set the env values in both Vercel scopes, turn the
   Vercel toolbar off on previews. Agent: `vercel.json` (`fra1`), the public env values through the
   connector, the preview of this branch, then the `verify/00b-sentry` preview, the raw event check,
   and Sentry's onboarding run through `sentry:sentry-get-started`, satisfies **AC-1**, **AC-16**,
   **AC-18**.

**Slice 2, headers and CSP**
8. Static security headers for every route in `next.config.ts`, satisfies **AC-12**.
9. `lib/security/csp.ts` (tests first) and its use in `proxy.ts`, passed through the request headers
   into the next-intl proxy and set on the response (a unit test checks Next sees
   `content-security-policy`); the matcher's object form; `generateStaticParams` removed, the locale
   layout forced dynamic, a prerender manifest test; the e2e `securitypolicyviolation` check,
   satisfies **AC-13**.

**Slice 3, analytics**
10. `lib/analytics/` door: `posthog-js` cookieless through `/api/a` (the three rewrites plus
    `skipTrailingSlashRedirect`, accepting that `/ar` and `/ar/` both answer), every option explicit,
    `app_env`, the manual pageview and `locale_changed`, the runtime allow list, lazy init after
    hydration, the PostHog key requirement, its lint rules and proofs, the e2e storage and stub checks,
    satisfies **AC-6**, **AC-7**, **AC-3**, **AC-8**, **AC-9**.

**Slice 4, logs, alerts, flags**
11. The logger to Sentry Logs with `LogEvent`, `LogIds`, the correlation id, the console mirror and the
    `after()` flush, satisfies **AC-5**, **AC-3**.
12. `raiseAlert` with `AlertReason`, the per record fingerprint and the flush; the two alert rules
    through `sentry:sentry-create-alert` and the Sentry connector (ask gated); a real alert from the
    preview reaches the owner, satisfies **AC-11**.
13. `lib/flags/` `isEnabled` (tests first) with the `Db` type, the 2 second limit, and a test for each
    failure shape, satisfies **AC-14**.

**Slice 5, close out**
14. `app/global-error.tsx` localised from `usePathname()`, both boundaries reporting only errors
    without a digest, satisfies **AC-17**.
15. Owner dashboard settings in Sentry (IP storage off, scrubber keys, inbound filters) and PostHog;
    the quota check; `.env.example`, the `AGENTS.md` doors table, stack table and MCP rows; the tracker;
    drop the `posthog-wizard-2026-10-27` stash; every check on a clean clone for G0, satisfies
    **AC-3**, **AC-16**, **AC-20**, **AC-21**.

## Consequences

**Positive**:
- Errors, traces, logs, replays and alerts live in one EU backend, joined by trace id.
- No consent banner is needed for now, and nothing is stored on the visitor's device.
- A money feature can be switched off per region in seconds, without a deploy.
- Injected scripts and framing are blocked from day one, while the app is small and easy to fix.
- The health check's regular pings also keep the Free Supabase project from pausing (D63).

**Negative / tradeoffs**:
- Every page renders per request: no static pages or CDN caching for pages, and more function time on
  Vercel.
- Analytics are anonymous and approximate: no per user funnels, and unique visitors are estimated.
- PostHog session replay is unavailable while analytics stay cookieless.
- A preview cannot build until its scope holds the keys; until then other branches' previews (including
  Dependabot's) fail too.
- A local `npm run build` or `npm start` needs `APP_LOCAL_ONLY=1` from now on.
- Sentry's free plan quotas (errors, replays, logs, spans) can drop events at launch volume.
- Each later third party script needs the nonce, and each position adds its own CSP sources (Turnstile
  in 01, Supabase storage images in 02, the iyzico redirect in 09); `style-src` keeps
  `'unsafe-inline'` for style attributes.
- HSTS protects for one day only until the final domain exists.

**Neutral**:
- New env variables and five removed ones, in both Vercel scopes.
- One vendored skill (PostHog) to review and keep pinned; Sentry's plugin updates itself, so its
  advice can change between builds.
- Two Sentry connections exist (the claude.ai connector and the plugin's own server); either works.

## Follow-up

- [ ] S16 (legal): confirm cookieless analytics without a banner and masked error replays under KVKK.
  If a banner is wanted, a new spec covers consent, PostHog replay and identification.
- [ ] Q3 and S10: choose the uptime monitor and point it at the production alias's `/api/health` (not a
  login protected preview) by G1.
- [ ] Position 01: the action guard meta test exempts `/api/health` by name; the region step reads
  `regions.active`; Turnstile sources join the CSP.
- [ ] Position 02: `camera=(self)` in `Permissions-Policy` if the liveness selfie runs in the browser.
- [ ] Position 13: the alert summary email, sent only when something changed.
- [ ] Positions 08 or 09: the server side PostHog client, with its first server event.
- [ ] Positions 16 and 21: the admin flag UI with audit, and the kill switch runbook.
- [ ] S4 (domain): raise HSTS to two years with `includeSubDomains`, and decide on `preload`.
- [x] On acceptance: owner decisions recorded as D67 to D73 in the decision log (2026-10-28).
