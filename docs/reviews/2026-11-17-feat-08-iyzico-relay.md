# Review, feat/08-iyzico-relay, 2026-11-17

**Reviewed by**: Sonnet 5.5 (author on a different model)
**Scope**: 55 files, branch feat/08-iyzico-relay (commits f9eee6a and 2faa081 on top of b137a68)
**Verdict**: Changes requested

## Summary

The change builds the PSP door with off, fake and iyzico slot drivers, the outbox relay with its drain, heartbeat and reconcile tasks, the callback and webhook routes, the `relay` migration, and the fake card page. It follows the spec and its amendment rules closely: lock order matches 07, every relay write goes through a service role function, claim tokens are passed back as strings, and the tests are broad. There are no blockers. Two majors remain: a reconcile design flaw that makes every abandoned card page raise a failed outbox row and an alert, and the daily reconcile orchestration, which is the code that decides when money alerts fire, having no test at all.

## Major

### 🟠 Reconcile verify rows retry on pending, so every abandoned card page ends in an `outbox_failed` alert, `lib/relay/handlers.ts:230` and `supabase/migrations/20261120090000_relay.sql:573`

**Problem**: `reconcile_pending` queues a new `payment.verify` row (new key per 15 minute window) for every attempt that has been `ready` for more than 10 minutes. `verifyPayment` answers `retry('pending')` when the PSP says pending and the attempt is still `ready`. An abandoned card page (the customer closes the tab) is the normal case, and it stays pending until the token dies. So each such attempt collects about 8 verify rows before the final window, and each row runs the whole 6 try schedule (1, 5, 30, 120, 720 minutes) and then lands in `failed`. The heartbeat then alerts `outbox_failed` once per row. The sweep also has no upper bound: a `ready` attempt whose final verify keeps returning `pending` (or whose adapter never reports `expired`) is queued again every 15 minutes forever, and its `payer_ip` is never cleared because `finished_at` stays null. The spec says "else the row retries by the schedule" for callback and webhook rows, but it never intended reconcile rows to alert; the fake hides this because its token expires in 30 minutes and the non final expired answer returns done.
**Why it matters**: Alert fatigue on the money alert channel from the first real abandoned checkout (launch), which buries real `outbox_failed` and `refund_failed` alerts; unbounded row growth; personal data (payer IP) kept past the 2 hour promise of R-8.
**Suggested fix**: Let the handler tell reconcile origin rows apart (add an `origin` field to the payload, or use a different `final` style flag) and finish them as done on `pending`, because the next window queues another. Keep the retry for callback and webhook rows only. Bound the `ready` sweep (for example stop queuing after a day, and have the final verify or a SQL step move a `ready` attempt past that age to `abandoned` when the PSP says anything other than paid). Add a test for a pending retrieve on a reconcile row and a pgTAP case for the age bound.

### 🟠 The daily reconcile orchestration is untested, `lib/relay/reconcile.ts:83`

**Problem**: `tests/relay-routes.test.ts` covers only the three pure helpers (`previousLocalDay`, `isLastDailyRun`, `dailyMismatch`). `reconcileDaily` itself is not run by any test: the chunk of 25, the 40 second break, the skip on a `retrievePayment` failure, the `reconcile:<day>:<id>` event write, the `reconcile_mismatch` alert, the "unfinished" alert on the last run, and the `ledger_unbalanced` alert per imbalance. The e2e suite does not call the task either. The pgTAP file proves the list function only.
**Why it matters**: This is the only detector of a PSP and ledger difference (A-2: it corrects nothing, it only alerts). A wrong loop, a dropped `await`, or a wrong alert record id would pass every suite and fail silently in production. Per the guide, untested branching and alerting logic on a money path is Major.
**Suggested fix**: Add a handler level test in the style of `relay-handlers.test.ts`: mock `call` and the adapter; assert one compare per row, an alert on each kind of mismatch, no event written when the retrieve fails, the break at the deadline, the unfinished alert and the ledger alerts only on the last run, and one alert record format per case.

## Minor

### 🟡 The last daily run is picked by wall clock minute, so a late kick silently skips the books check, `lib/relay/reconcile.ts:55`

**Problem**: `isLastDailyRun` is true only when the UTC time is hour 1 and minute 50 or later. If the 01:50 kick is delayed across 02:00 (pg_net queue, a cold start, the 10 second timeout, a retried cron), the "payments still unfinished" alert and the whole `ledger_check` never run for that day.
**Why it matters**: The ledger imbalance alert is the only scheduled books check; a day can pass with neither check and no signal.
**Suggested fix**: Decide the last run by the work left and the day, not the clock: run `ledger_check` on every run after the list is empty (it is cheap), or accept any hour from 1:50 to 3:00 UTC. Also have the heartbeat alert when no reconcile event exists for yesterday by a set hour.

### 🟡 `runHandler` swallows every non database exception without a trace, `lib/relay/drain.ts:73`

**Problem**: A `TypeError` or any other unexpected throw becomes the string `handler_error`, with no log line and no Sentry capture. The row retries six times and ends as `outbox_failed` with `last_error = handler_error`.
**Why it matters**: A real defect in a handler (the likeliest thing in the first live week) cannot be diagnosed from the alert. `task.ts:68` has the same shape for whole tasks (`relay_task_failed` with no cause).
**Suggested fix**: Log the error class name and, for `RelayDbError`, the function and code, through the existing scrubbed logger (never the message, which can carry values). Use a new log event or an extra field in `LogIds`.

### 🟡 Drain deadlines add up to more than the route's `maxDuration`, `lib/relay/drain.ts:28`

**Problem**: A run may claim at 39 seconds and each handler may run up to 60 seconds, but the function is cut at 60 seconds (`app/api/relay/route.ts:22`). The `outbox_unfinished` log (which fires at the 60 second handler limit) can never run before the platform kills the function. The spec (R-3) states "well inside the 2 minute lease", which holds for the lease but not for `maxDuration`.
**Why it matters**: A slow PSP (15 second calls, two or three per handler) makes rows end by a kill, each one burning a claim attempt. Six lost claims fail the row with `lease_expired`.
**Suggested fix**: Set the handler limit below the remaining function time (for example `min(60s, 55s minus elapsed)`), or lower the claim deadline to about 25 seconds, and state it in the spec.

### 🟡 The heartbeat stamps failed rows before it alerts them, `lib/relay/heartbeat.ts:23` with `supabase/migrations/20261120090000_relay.sql:694`

**Problem**: `outbox_health()` sets `alerted_at` in its own transaction and returns the rows. If the function is cut or the process dies before the alerts and `mark_refund_failed` run, those rows are never returned again.
**Why it matters**: For a refund row this leaves the fee refund `queued` forever, with no alert and no retry. The window is small, but it is a money row, and R-13 argues the opposite way for apply alerts.
**Suggested fix**: Stamp after the alert (a second function `ack_outbox_alerted(ids)`), or let `mark_refund_failed` run inside `outbox_health` for refund rows.

### 🟡 `/api/relay` answers 405 to other methods, not 404, `app/api/relay/route.ts:26`

**Problem**: AC-5 says anything but an authenticated POST answers 404 so the route is invisible. Next answers 405 (with an `Allow` header) for GET and other verbs, which shows the route exists.
**Suggested fix**: Export `GET`, `PUT`, `PATCH`, `DELETE` and `OPTIONS` handlers that return the same 404, or note the deviation in the spec. Add one test.

### 🟡 `psp_bad_response` alerts on every try of an initialize row, `lib/relay/handlers.ts:147`

**Problem**: The verify and refund handlers alert only on `row.attempts === 1`; the initialize handler alerts on each of the six tries.
**Suggested fix**: Gate on `row.attempts === 1` like the others (the fingerprint joins them, but the noise still counts as events).

### 🟡 `checkout_context` raises `not_found` when the payer's profile row is gone, `supabase/migrations/20261120090000_relay.sql:342`

**Problem**: The inner join on `profiles` turns a deleted or anonymised profile into `not_found`, so a pending initialize or verify row for that payer retries and alerts as `idempotency_conflict`, and a late payment for that payer is never applied.
**Suggested fix**: Use a left join for the profile columns (name and email are only for the card page request) and let `initializeCheckout` fail the attempt cleanly when the name is missing.

### 🟡 The seed hides the migration's own default in tests, `supabase/seed.sql:6` with `supabase/tests/03_flags_and_health.test.sql:23`

**Problem**: The 03 test no longer pins `payments_enabled` for TR, and the 20 test only proves KSA is off. Nothing proves the migration seeds TR off, which is the cloud default that matters for A-1 ("both regions stay false in the cloud").
**Suggested fix**: In `20_relay.test.sql`, run the migration's insert logic against a clean copy, or assert the seed is the only writer (for example check `supabase/seed.sql` text in a harness test). At minimum add a CI note that the cloud value is checked at S37.

### 🟡 A cut daily run does not reach the second region, `lib/relay/reconcile.ts:98`

**Problem**: The 40 second deadline only breaks the inner row loop; the outer region loop continues and issues new list calls (and, on the last run, the unfinished and ledger checks) past the deadline. With two active regions the run can overrun `maxDuration`.
**Suggested fix**: Check the deadline in the region loop too, and keep the last run checks outside the deadline guard but bounded.

## Nits

- ⚪ `lib/relay/handlers.ts:107`, the outbox row id is logged in the `request_id` field; add a `row_id` field to `LogIds` so a log reader is not misled.
- ⚪ `lib/relay/handlers.ts:34` and `supabase/migrations/20261119090000_money_core.sql:1443`, the six try limit is written twice; share it or add a test that ties them.
- ⚪ `lib/relay/callback.ts:43`, `key in fields` also matches inherited keys like `constructor`; use `Object.hasOwn` or a null prototype object.
- ⚪ `lib/env.ts` adds `IYZICO_WEBHOOK_SECRET`, which nothing reads and `lib/deployment.ts` does not check; drop it until 08b or document it.
- ⚪ `lib/relay/fake-checkout.ts:53`, choosing an outcome again resets `retrieves` and `refunds`, so a fake refund can be repeated after a second pick; harmless on the fake but it makes the fake diverge from a real PSP. The fake's retrieve counter is also a plain read then write (`lib/psp/fake.ts:168`), so two concurrent verifies can both count once.
- ⚪ `docs/specs/0011-choose-to-launch/0011-08-iyzico-relay.md` still shows the four parameter `psp_webhook`, the `{ ran, failed }` output of `/api/relay` (the route answers 202 `{ accepted }`), and AC-13's "since the last run"; record the as built forms in the spec.

## Judgment on the deliberate choices

- **`psp_webhook` fifth parameter `p_home_region` (sound).** The spec could not work without a region for a webhook that matches no attempt, fee or refund (the event table requires one). The value comes from the signed adapter's constant, never from the request, and the function checks it against `regions`. Update the spec text.
- **ESLint RELAY glob narrowed to `lib/` (sound, and stronger).** The old `**/relay/**` gave `app/api/relay/route.ts` PSP and service role rights, which contradicts AC-3. The routes now reach the database only through `lib/relay`. One side effect to know: `lib/relay/db.ts` exports `relayDb()`, so any route can obtain the service role client through it; keep that in the review checklist for 09 and later.
- **Tests may import `lib/psp` (sound).** The override restores only the PSP exemption; the admin and other door rules still apply to tests.
- **`lib/deployment.ts` names `IYZICO_*` and `RELAY_SECRET` (sound, with a caveat).** It follows the `SENTRY_AUTH_TOKEN` precedent and only checks presence and shape. The exemption is a regex for the whole file, so a later edit could read and pass a value on; the deployment test does not assert otherwise.
- **The fake's payment ids embed its token (sound).** The fake token is not a secret, the id never leaves test and preview, `PSP_DRIVER=fake` is refused on production, and nothing logs a payment id (alerts carry fee and refund ids). It would be wrong for iyzico, and the comment in `fake.ts` says so.
- **`supabase/seed.sql` turns payments on for TR locally (sound).** It is local only and the migration seeds both regions off. See the minor finding on proving the cloud default.

## Strengths

- Lock order follows D169 in every new function, finished rows answer `{changed: false}` instead of an error, and `fail_attempt` and `lock_attempt` keep it in one place.
- The relay keeps rule 3 by structure: callback and webhook only store and queue, money moves only through `apply_fee_paid` and `apply_fee_refunded` from a retrieve done by the relay, and the echoed conversation and basket ids are checked before anything is applied.
- The refund path is safe to crash anywhere: the adapter reads existing refunds first on every try, `apply_fee_refunded` stores id and `done` together, and `finish_outbox` runs last with the exact claim token string.
- `isAllowedCheckoutUrl` is pure, takes the host list as an argument, and is checked again in SQL; the payload strip, payer IP clearing and scrubber keys cover the personal data rules, each with a test.
- Per row error isolation in `reconcile_pending`, the outbox alert stamp, the fail closed `payments_enabled`, and widened guards on the attempt table are all backed by pgTAP with denied role cases.

## Test coverage

Strong: the PSP contract suite (fake), handler tests for initialize, verify and refund including crash replays, drain tests for claim size, stale finish, lease, deadline and give up, route tests for the relay, callback and webhook, deployment and lint proofs, a long pgTAP file with denied anonymous and customer calls for every function, and an end to end late payment and refund loop. Gaps: `reconcileDaily` (Major above), reconcile verify rows on a pending retrieve (no test, and the flaw above), the heartbeat crash window, `/api/relay` with other methods, and the fake checkout route (covered only through e2e).

## Resolutions (2026-11-17, by the author)

| Finding | Resolution |
| --- | --- |
| Major 1, reconcile rows retry on pending | Fixed: a reconcile check carries `origin: reconcile` and finishes on pending; no check after 26 hours; IPs cleared once an attempt started more than 2 hours ago. Tests in `relay-review-fixes.test.ts` and pgTAP |
| Major 2, `reconcileDaily` untested | Fixed: orchestration tests for compare and event per row, mismatch record ids, a PSP failure recording nothing, the deadline (rows and regions), the last run's books and unfinished alerts, a late run, an inactive region |
| Last run by wall clock | Fixed: a run from 01:50 to 02:59 UTC is the last |
| `handler_error` silent | Fixed: `relay_handler_failed` logged with the class name or the function and code (a new `code` log id), never a message |
| Drain deadlines over `maxDuration` | Fixed: last claim at 25 s, handler cut at 30 s. Tighter than R-3's 40 and 60; to record in the spec |
| Heartbeat stamps before alerting | Fixed: `outbox_health` marks the refund failed in its own transaction |
| `/api/relay` 405 | Fixed: every other method is a 404 |
| `psp_bad_response` on every try | Fixed: first try only |
| `checkout_context` inner join on profiles | Fixed: left join |
| Seed hides the cloud default | Fixed: a test reads the migration (both regions `false`) and the seed (TR only) |
| Region loop past the deadline | Fixed: a late run starts no other region's compare |
| Nit, row id in `request_id` | Kept: the `code` field carries the detail; a `row_id` field is a later tidy up |
| Nit, six tries written twice | Kept: tied by the drain tests on attempts 1 and 6 |
| Nit, `key in fields` | Fixed: `Object.hasOwn` |
| Nit, unused `IYZICO_WEBHOOK_SECRET` | Kept for 08b (S1 names the signing secret) |
| Nit, fake reset on a second choice | Fixed with security S4 |
| Nit, spec text out of date | Owed to `/architect`: the fifth `psp_webhook` parameter, the 202 `{ accepted }` answer, AC-13's stamp, the 25 s and 30 s drain limits, the reconcile origin and 26 hour bound, the fake fence |

