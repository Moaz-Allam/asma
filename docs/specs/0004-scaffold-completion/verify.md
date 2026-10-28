# Verify: Scaffold completion (00b) · spec 0004 · updated 2026-10-28

_Steps derived from spec 0004 acceptance criteria and its Value sourcing table. `/check verify` runs
these; `/test` locks the durable ones. A preview needs the owner logged in to Vercel (login protection
stays on, D72)._

**Evidence so far (2026-10-28):** local `npm run verify`, 338 unit tests, pgTAP 42/42, e2e 23/23 in
`ar`, `tr`, `en`; preview `96a26c7` built (maps uploaded and deleted, release = full SHA); throwaway
`verify/00b-sentry` proved AC-1, AC-2, AC-3, AC-4, AC-11, AC-14, AC-18 in Sentry (ALDEBYANI-2 to 5,
resolved); the geo rule (D79) and the two alert rules (D80) are in place.

## UI / manual

- [ ] Open the preview at `/ar`, `/tr`, `/en` → each renders in its language, `dir` is `rtl` for `ar`
      and `ltr` otherwise, no console error → AC-16, AC-17
- [ ] In the network panel, the page response carries `Content-Security-Policy` with a nonce, and every
      `<script>` Next renders has that same nonce; a reload gives a new nonce → AC-13 (nonce source)
- [ ] The page response carries `Strict-Transport-Security: max-age=86400`, `X-Content-Type-Options:
      nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`,
      `Cross-Origin-Opener-Policy: same-origin`, `Permissions-Policy: camera=(), microphone=(),
      geolocation=(), payment=()` → AC-12
- [ ] `connect-src` holds `'self'` plus the Supabase origin with `https` and `wss` (on a local stack:
      `http` and `ws`) → AC-13 (Supabase origin source)
- [ ] `report-uri` points at `o<org>.ingest.de.sentry.io/api/<project>/security/?sentry_key=<key>`
      from the DSN, with `report-to csp-endpoint` and a matching `Reporting-Endpoints` header →
      AC-13 (report endpoint source)
- [ ] Browse a page, wait a few seconds: one `$pageview` reaches `/api/a/…` with a scrubbed
      `$current_url` (no `token`, `code`, `email`, `phone`, `q`, `ref`, `customer`, no `#fragment`)
      and `app_env` equal to `preview` (`production` on production) → AC-6, AC-7 (`app_env` source)
- [ ] Switch language with the switcher → one `locale_changed` with `from_locale` the old locale and
      `to_locale` the new one, then the next `$pageview` → AC-7 (switcher source)
- [ ] After a visit, DevTools shows no cookie except `NEXT_LOCALE`, and `localStorage` and
      `sessionStorage` are empty → AC-4, AC-6
- [ ] Every request in the network panel stays on the page's origin (Supabase aside) → AC-2, AC-6
- [ ] Throw a server error and a browser error on a throwaway branch → both issues in Sentry with frames
      mapped to source files, `environment` `preview`, `release` the full SHA, messages showing
      `[email]`, `[ip]`, `[phone]`, no `user`, no `geo`, no cookie or IP header → AC-1, AC-3, AC-18
- [ ] The browser error has a masked replay attached; a session without an error keeps none → AC-4
- [ ] A crash that escapes the locale layout (throw in the layout on a throwaway branch) shows the
      `Error` copy in the URL's locale with the right direction; with an unknown first segment, in the
      default locale → AC-17 (locale and copy sources)

## Commands

- [ ] `curl -sS <preview>/api/health` (logged in, or with the owner's browser) → `200`
      `{"status":"ok","db":"ok","commit":"<full SHA>","region":"fra1","checkedAt":"<ISO>"}` and
      `Cache-Control: no-store` → AC-10 (commit, region, db sources)
- [ ] Two requests within 5 seconds return the same `checkedAt`; one after 5 seconds a new one →
      AC-10 (checkedAt source, memo)
- [ ] Locally, with the database stopped, `/api/health` → `503`
      `{"status":"degraded","db":"down",…}` and no error text → AC-10
- [ ] `VERCEL=1 VERCEL_ENV=preview npx next build` with no `VERCEL_GIT_COMMIT_SHA` → refused, naming
      it; the same with a US DSN or a `phx_` PostHog key → refused, naming each → AC-9 (release name,
      DSN, PostHog key sources)
- [ ] `VERCEL=1 APP_LOCAL_ONLY=1 npx next build` → refused, naming `APP_LOCAL_ONLY` → AC-9
- [ ] `npm run build` without `APP_LOCAL_ONLY` and without keys → refused (a local production build
      counts as a deployment); with `APP_LOCAL_ONLY=1` → builds, no `.map` left under `.next/static`
      → AC-9 (`isDeployment` sources), AC-1
- [ ] On a Vercel build log: `Uploaded files to Sentry`, `Release: <full SHA>`, then
      `sourcemaps: none left under .next/static.` → AC-1 (release and token sources)
- [ ] `npx vitest run tests/observability-scrub.test.ts tests/analytics.test.ts` → green, property tests
      included → AC-3, AC-7
- [ ] `npx vitest run tests/deployment.test.ts tests/env.test.ts` → green → AC-9
- [ ] `npx vitest run tests/security-headers.test.ts tests/proxy.test.ts` → green → AC-12, AC-13
- [ ] `npx vitest run tests/health.test.ts tests/flags.test.ts tests/observability-doors.test.ts` →
      green → AC-5, AC-10, AC-11, AC-14
- [ ] `npx vitest run tests/observability-shared.test.ts` → production samples 0.1, preview 1, local 0;
      `/api/e` and `/api/a` get no span → AC-2, AC-5 (sample rate source)
- [ ] `npx vitest run tests/lint/eslint-rules.test.ts` → 35 proofs green → AC-8
- [ ] `npx supabase test db` → 42/42: KSA inactive, the 10 flags, the `_enabled` CHECK both ways, the
      exact grants, `health_ping` for `anon` and `authenticated` only → AC-10, AC-14, AC-15 (flag value
      source)
- [ ] `E2E_NO_DB=1 npm run test:e2e` → green in `ar`, `tr`, `en` → AC-2, AC-3, AC-6, AC-7, AC-10, AC-12,
      AC-13
- [ ] Flip `TR funding_enabled` to `false` in the table editor; the next `isEnabled` read returns
      `false` with no deploy; flip back → AC-14 (flag value source)
- [ ] Read a flag with the anonymous client (or a missing key) → `false`, a `flag_read_failed` log,
      and one Sentry event tagged `alert`, `region`, `cause`, fingerprint `alert` / reason /
      `region:flag` → AC-11, AC-14 (fingerprint and tag sources)
- [ ] In Sentry Logs, a server record carries `event`, `correlation_id` equal to the trace id of its
      request, and only `request_id`, `region`, `user_id` as ids → AC-5 (correlation id source)
- [ ] In Sentry, alert rules `1429069` and `1429070` exist, limited to tag `alert` and environment
      `production`, emailing the owner → AC-11
- [ ] Sentry project settings: IP storage off, the geo removal rule, the scrubber keys as additional
      sensitive fields, inbound filters for extensions, localhost and legacy browsers → AC-3, AC-21
- [ ] PostHog project settings: discard client IP on, autocapture off, recordings off, cookieless on
      → AC-6

## Acceptance criteria coverage

- AC-1 · Sentry errors with mapped frames, environment, release, maps deleted: throwaway branch,
  Vercel build log, local build step
- AC-2 · tunnel, no trace headers, no spans for telemetry paths: e2e off origin check,
  `observability-shared` tests
- AC-3 · scrubbing: scrubber property tests, e2e scrubbed envelope, throwaway branch, geo rule
- AC-4 · replay on error only, masked, no storage: throwaway branch replay, storage check
- AC-5 · logger: door tests, Sentry Logs record check
- AC-6 · cookieless PostHog: e2e storage and pageview checks, PostHog settings
- AC-7 · allow listed events: analytics tests, switcher step
- AC-8 · doors: lint proofs
- AC-9 · deployment gate: deployment tests and the refused builds
- AC-10 · health: health tests, `curl` steps, pgTAP grants
- AC-11 · alerts: door tests, anonymous flag read, alert rules
- AC-12 · security headers: header tests, response check
- AC-13 · nonce CSP: CSP and proxy tests, e2e nonce and violation checks, prerender manifest test
- AC-14 · money flags: flags tests, pgTAP, table editor flip
- AC-15 · KSA off: pgTAP
- AC-16 · preview in `fra1` serving three locales: preview visit, build log
- AC-17 · global error and boundaries: throwaway layout crash
- AC-18 · Sentry verification: done 2026-10-28; Sentry's onboarding run is completed by the owner in
  Sentry
- AC-19 · skills: `AGENTS.md` entries and `VENDORED.md`
- AC-20 · pins and install scripts: `package.json`, `AGENTS.md` stack table
- AC-21 · inbound filters, noise lists, quotas: Sentry settings and the quota check
