# Verify: 0011-08 PSP door, relay, callbacks · spec 0011-08 · updated 2026-11-17

_`/check verify` 2026-11-17: ticked steps were run against the served build (fake PSP, local stack); the 404 check
with the fake off is proven by the action guard test only, and the deployment check waits for S32 and S33._

_Steps derived from spec 0011-08 acceptance criteria (and rules R-1 to R-16). `/check verify` runs these; `/test`
locks the durable ones. Each step names the test that already proves it, where one exists._

## UI / manual (local stack, `PSP_DRIVER=fake`, `node scripts/e2e.mjs --reuse-build --serve`)
- [x] Queue a commission checkout as `postgres` (`start_checkout`), post `{task:"drain"}` to `/api/relay` with the
      e2e secret → the attempt turns `ready` with a URL on `http://localhost:3100/<locale>/dev/fake-checkout/fk1_…` → AC-7, AC-21
- [x] Open that URL at 390px in `ar`, `tr`, `en` → the test card page, axe clean, six outcomes → AC-15, U-6
- [x] Pick "succeeds", then "Return to the shop" → 303 to `/<locale>/pay/<attempt>`; one `callback` PSP event, no
      money change → AC-8, R-1
- [x] Drain again → the fee stays `pending`, a `late` refund is `done` with `fr_fp1_…`, two journals, `ledger_check`
      shows no imbalance → AC-10, AC-11, A-4 (`e2e/relay.spec.ts`, ar)
- [x] Pick "Webhook only" → no way back; drain → refunded the same way, one `verify:webhook:` row → AC-9, AC-15 (tr)
- [x] Pick "fails" → attempt `failed` with `psp_failed`, nothing refunded → AC-10 (en)
- [ ] With `PSP_DRIVER` unset (`off`), the card page and `/api/psp/fake-checkout` are 404 → AC-15, AC-17

## Commands
- [x] `npm run db:test` → `20_relay` 109/109: settings, functions, refusals, denied anon and customer calls, guard,
      strip filter, schedules → AC-6, AC-18, AC-20, R-6, R-8 to R-12, R-16
- [x] `npx vitest run tests/psp-contract.test.ts` → the PSP contract on the fake; off and the iyzico slot refuse;
      15 second timeout → AC-1, AC-2, AC-4, AC-11, AC-15, R-2, R-14, R-15
- [x] `npx vitest run tests/relay-handlers.test.ts tests/relay-routes.test.ts` → initialize, verify, refund, drain
      (claim token round trip, stale, last try, deadline, unfinished), heartbeat, route door (404, 400, 202),
      callback, webhook, daily compare → AC-0, AC-5, AC-7 to AC-13, AC-19, R-2 to R-4, R-7, R-11 to R-14
- [x] `npx vitest run tests/deployment-psp.test.ts` → off and fake boot keyless; fake refused on production; iyzico
      needs its keys, relay secret, server DSN, live host only on production → AC-2
- [x] `npx vitest run tests/payments-checkout-url.test.ts` → URL check and host lists match the adapters → AC-21, R-5
- [x] `npx vitest run tests/lint/eslint-rules.test.ts tests/action-guard.test.ts` → door proofs and the seven
      machine endpoints plus the dev only route → AC-3, AC-17
- [x] `npx vitest run tests/observability-scrub.test.ts` → a full iyzico style answer leaves no buyer, token or page → AC-16
- [x] `e2e/relay.spec.ts` "no client bundle holds the server only DSN" → AC-14
- [ ] On a deployment after S32 and S33 (A-1): a `drain` run is logged, the `relay-drain` check in appears in the
      server only Sentry project, a wrong secret answers 404, a test alert lands in the server project only → AC-13, AC-14

## Value sourcing
- [x] Fee amount, currency, kind from `fee_payments` via `checkout_context` → change the fee amount, the token and
      the refund follow it (`20_relay` checkout_context test)
- [x] Buyer city from `psp_buyer_city` (Istanbul, Riyadh) → a missing key alerts `checkout_settings_invalid` (handler test)
- [x] Checkout hold from `checkout_hold_minutes` → an attempt older than the hold fails `init_late` (handler test)
- [x] Payer IP from `checkout_attempts.payer_ip` → cleared 2 hours after the attempt finished (`20_relay` R-8)
- [x] Card page locale from `checkout_attempts.locale`, else the region's default → `20_relay` checkout_context and callback
- [x] Card page hosts from the active adapter → a URL on another host is `url_refused` (handler test)
- [x] PSP payment id, amount, currency, cut from the verified retrieve → mismatch outcome books late with `reconcile_mismatch`
- [x] Region of a PSP event: attempt, else fee or refund, else home region → `20_relay` psp_webhook tests
- [x] Payments on or off per region, read once per initialize row → off fails `payments_disabled`; verify and refund still run
- [x] Retry schedule from 07's `finish_outbox` → drain tests (first and last try)
- [x] Relay URL and secret from Vault and `RELAY_SECRET` → `20_relay` relay_kick tests, route tests

## Acceptance-criteria coverage
- AC-0 drain tests · AC-1 contract · AC-2 deployment-psp · AC-3 lint proofs · AC-4 iyzico slot (refuses; facts (a)
  to (l) in its header) · AC-5 route tests, e2e · AC-6 `20_relay` · AC-7 handler tests, e2e · AC-8 callback tests,
  e2e · AC-9 webhook tests, e2e tr · AC-10 handler tests, e2e · AC-11 handler tests, e2e · AC-12 `20_relay`, daily
  compare tests · AC-13 heartbeat tests, deployment check owed · AC-14 e2e bundle scan, deployment check owed ·
  AC-15 contract, e2e · AC-16 scrub test · AC-17 action guard · AC-18 `20_relay`, handler tests · AC-19 drain tests ·
  AC-20 `20_relay` · AC-21 URL tests, `20_relay`, handler tests
