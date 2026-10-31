# Review, feat/00b-scaffold-completion, 2026-10-29

**Reviewed by**: Claude Sonnet 5.5 (author on Claude Opus 5.5)
**Scope**: 70 files plus package-lock.json, branch vs master (PR #20). The diff base given was 5127f78, the stale
local `master`; `origin/master` is 64d2613 (D66 already merged) and gives the same 70 files.
**Verdict**: Changes requested

## Summary

00b adds the Sentry and PostHog doors with one scrubber, a nonce CSP, security headers, `/api/health`, database
money flags per region (with KSA off and explicit grants), the deployment key gate, and the single door lint rules
with proofs. The structure is sound and the risky parts the spec named (deployment gate, flags, CSP, health) are well
tested. The headline issues are all in the scrubber, the one piece every signal passes through: URLs embedded in
message text keep their tokens and fragments, and it has no guard against cyclic or very wide data (exponential time
on a cyclic console argument). There are no Critical findings (Critical is the README name for the guide's Blocker).
Everything below was checked against the code and, where a claim needed proof, by running the real functions.

How the evidence was produced: the real `lib/observability/scrub.ts` run under Node's native TypeScript, the
installed `@sentry/*`, `posthog-js` and `next` sources read in `node_modules`, ESLint run on a snippet from stdin, and
the ten unit test files for this change run once (200 tests, all green). No file other than this one was written. High
risk paths touched: the migration (reviewed in full), `.claude/**` (a one line date change and the vendored PostHog
skill, whose three file hashes match `VENDORED.md`). No money, PSP, pricing or idempotency code is in this change.
`.mcp.json` was not read.

## Major

### Major: URLs inside message text keep their tokens, codes and fragments, `lib/observability/scrub.ts:196`
**Problem**: `redactData` (196-198) and `redactMessage` (201-203) redact emails, IPs and, in message mode, phone
numbers only. URL stripping runs only when a whole value is a URL or sits under a URL like key (`walk`, 248-252), and
in span descriptions (`scrubUrlsInText`, 242-244, used once at 338). Exception values, `message`, `logentry`,
breadcrumb `message` and console `arguments` strings that merely contain a URL pass through untouched. Run against the
real scrubber, `Redirect to https://x.test/auth/callback?code=abc123&access_token=zzz#refresh_token=yyy failed` and
`Failed to fetch RSC payload for https://x.test/tr/a?token=t0k&email=ali%40x.com. Falling back` both come out
unchanged (the URL encoded email also slips past the EMAIL pattern). Next's client router logs exactly this shape
(`node_modules/next/dist/client/components/router-reducer/fetch-server-response.js:227`), and Sentry's console
integration turns every console call into a breadcrumb `message`.
**Why it matters**: AC-3 promises that `code`, `token_hash`, `access_token`, `refresh_token` and every fragment never
leave. These are short lived credentials, and they would sit in a third party store. The proof so far (ALDEBYANI-2 to 5,
the unit tests, the e2e error) seeded emails, IPs and phones, never a URL in the middle of a sentence.
**Suggested fix**: apply the existing URL scrub to every absolute URL found inside user data text, inside
`redactData`, so message, exception value, logentry, breadcrumb message and console arguments all get it (params,
fragment, credentials). Add example and property tests with URLs mid sentence, URL encoded emails and fragments.

### Major: The scrubber has no cycle or size guard; cyclic console data costs exponential time, `lib/observability/scrub.ts:145`
**Problem**: `walk` (246-261) stops at depth 12 but keeps no visited set and no node budget. `beforeBreadcrumb`
(`lib/observability/client.ts:56`, `lib/observability/server.ts:47`) runs `scrubBreadcrumb` on the RAW
`data.arguments` of every console call: the SDK's console breadcrumb (`@sentry/core` `integrations/console.js`, and
`@sentry/browser` `integrations/breadcrumbs.js:112`) puts the raw arguments in `data`, and `addBreadcrumb` calls
`beforeBreadcrumb` on them ahead of any normalisation that could break a cycle. An object with k self references costs
about k^12 steps. Measured: k=2 3 ms, k=3 38 ms, k=4 328 ms; k=6 extrapolates to about 40 s. A React synthetic event, a
DOM node carrying `__reactFiber$...` or a Supabase client is much wider than that. There is also no cap on breadth.
**Why it matters**: it breaks the key invariant "Observability never breaks a request" (spec 0004). One
`console.log(event)` freezes the tab (390px phones are the target) or burns the function's time, synchronously inside
the `console.*` call. The property tests only generate acyclic trees, so nothing sees it.
**Suggested fix**: track visited objects (replace a repeat with the filtered marker), cap total nodes and breadth per
level (Sentry's own `normalize` uses 1000), and treat "budget exceeded" like a throw (filter or drop). Add a test with
a cyclic, wide object under a time limit.

## Minor

### Minor: IP and phone redaction is partial for several real forms, and the property tests cannot see it, `lib/observability/scrub.ts:120`
**Problem**: measured with the real functions.
- An IPv4 right before a full stop is not an IP match (the lookahead `(?![\w.])` refuses a dot): 2000 of 2000 sampled
  addresses followed by "." survive in user data fields (`extra`, span and log attributes, non console breadcrumb
  data), for example `blocked 203.0.113.9.` In message like fields it only disappears because the phone pattern
  happens to match it, giving `[phone]`.
- IPv6 with an embedded IPv4 (1618 of 4000 `fc.ipV6()` samples) is cut in the wrong place: `::ffff:203.0.113.9` becomes
  `[ip].0.113.9`, `c8:22::c8:67.3.216.85` becomes `[ip].3.216.85`, `d3:a4:d:2c:669:3:48.111.6.224` becomes
  `d3:a4:d:2c:669:3:[ip]`. IPv4 mapped addresses are what Node reports for a dual stack peer.
- The phone pattern allows one separator character between digits, so `+90 (555) 123 45 67` becomes
  `+90 (555) [phone]`. It matches ASCII `\d` only, so phone numbers typed in Arabic Indic digits (the `ar` locale) are
  never redacted.
- The tests: `tests/observability-scrub.test.ts:171-175` asserts only that the whole seeded string is absent, so a
  partial redaction passes, and the table at line 195 pins `(555) [phone]` as the expected output.
**Why it matters**: AC-3 says IPv4, IPv6 and phone numbers are redacted. A partial IP still gives away 24 bits, and the
tests claim a proof they do not give. Practical exposure today is narrow (the visitor IP headers are already dropped).
**Suggested fix**: allow punctuation after and before an address (a dot followed by a digit is the only real
continuation), match the embedded IPv4 forms before the plain IPv6 branch, fold Arabic Indic digits to ASCII before
matching, and accept runs of separators. Strengthen the property assertions: the output must equal the input with the
seeded value replaced by exactly one marker, with no residue of any octet, group or digit.

### Minor: Personal key matching ignores camelCase, `lib/observability/scrub.ts:151`
**Problem**: keys are lowercased and `-` is folded to `_`, nothing else, so `phoneNumber`, `firstName`, `fullName`,
`postalCode`, `customerEmail`, `accessToken`, `apiKey` and `clientSecret` are not personal keys. `scrubEvent` on
`extra: { phoneNumber: '0555 123 45 67', firstName: 'Ali', accessToken: 'abc123secret' }` returns it unchanged. JS
objects are camelCase by convention. The spec's wording ("lowercasing and folding `-` to `_`") has the same hole.
**Why it matters**: no `extra` door exists today, so the exposure is console data and future callers, but it becomes
real at position 01 when forms start to hold phone numbers and names.
**Suggested fix**: split camelCase boundaries before lowercasing (`phoneNumber` becomes `phone_number`), add camelCase
cases to the `isPersonalKey` tests, and amend the spec's invariant.

### Minor: Replay masks text and inputs but not DOM attributes such as `href`, `lib/observability/client.ts:68`
**Problem**: Sentry Replay's default `maskAttributes` is `title`, `placeholder`, `aria-label` (installed
`@sentry/replay`, esm `index.js:8178`). `beforeAddRecordingEvent` scrubs only rrweb events of type 4 (page URL) and 5
(custom), not the DOM snapshot and mutation events that carry attributes. A `tel:`, `mailto:` or `wa.me` link, or an
`href` with `?customer=`, would sit in a replay attached to an error.
**Why it matters**: AC-4 is met as written (text, inputs, media). But position 10 shows the customer's phone and address
to the paid provider, which is exactly data that must stay behind the unlock (rule 2). Not a problem today: no page
renders contact data yet.
**Suggested fix**: before position 10, add `maskAttributes` for `href`, `src` and `action` (or `block` the contact
elements), and add an e2e that triggers an error on a page with a `tel:` link and inspects the replay.

### Minor: "The proxy never throws" is only true against a mocked environment, `proxy.ts:29`
**Problem**: AC-13 and `tests/proxy.test.ts:59-69` say a missing or malformed DSN only drops the report directives.
In the real stack `sentryDsn()` is `getEnv().NEXT_PUBLIC_SENTRY_DSN` (`lib/env.ts:146-148`), and `getEnv()` throws on a
malformed DSN (zod refine, `lib/env.ts:75-80`; `tests/env.test.ts:52-55` proves it). The proxy test replaces
`@/lib/env` (`tests/proxy.test.ts:15-18`), so those rows prove nothing about `proxy()` itself. In practice
`register()` throws first and the app never boots, so the branch is unreachable and the AC text is wrong.
**Why it matters**: a contract and its test disagree with the running code, and the proxy now depends on the whole
server environment for every page request, which it did not before.
**Suggested fix**: either read the DSN leniently in the proxy (catch, treat as none) to honour the AC, or amend the AC
and drop the misleading test rows.

### Minor: Several acceptance criteria have no automated proof, `lib/observability/client.ts:91`
**Problem**:
- AC-17: the digest rule in `reportClientError` (`lib/observability/client.ts:91-99`), both boundaries, and the
  locale and direction choice in `app/global-error.tsx:26-36` have no test at all. `verify.md` leaves the throwaway
  layout crash unchecked and the evidence list omits AC-17.
- AC-2, AC-4, AC-5 configuration: `initServer`, `initClient` and the replay options (`sendDefaultPii`,
  `tracePropagationTargets: []`, the replay sample rates, `maskAllText`, `stickySession: false`, `enableLogs`,
  `ignoreSpans`) are never asserted. `init` is mocked in `tests/observability-doors.test.ts:39` and never inspected, so
  a refactor that drops `stickySession: false` or a mask flag stays green.
- AC-8 says each exemption is proven. No case covers `lib/env.ts` reading the PostHog key, `next.config.ts` reading the
  DSN or the PostHog key, or the analytics door being refused the DSN and the auth token.
- The proxy matcher's `missing` prefetch conditions (`proxy.ts:65-68`) are not asserted anywhere.
**Why it matters**: branching and privacy relevant code with no durable proof; the spec asked for proof on exactly
these paths.
**Suggested fix**: small unit tests with `init` mocked and its options asserted; `reportClientError` with and without a
`digest`; a render or e2e check of `GlobalError` per locale including `dir`; the missing lint cases.

### Minor: The telemetry key lint rule can be bypassed by destructuring, `eslint.config.mjs:84`
**Problem**: `restrictedSecrets` matches `MemberExpression`, `Literal` and `TemplateElement` only. Linting
`const { SENTRY_AUTH_TOKEN, NEXT_PUBLIC_POSTHOG_KEY } = process.env;` as `lib/requests/probe.ts` raised nothing; only
the member expression on a later line fired. The older secrets (service role key, PSP keys) share the hole.
`AGENTS.md` says the auth token is read in `next.config.ts` only, "lint enforced".
**Why it matters**: a door that can be walked around with one syntax is a sentence, not a guard (architecture.md §42).
**Suggested fix**: add a `Property[key.name=/^(...)$/]` selector for object patterns and shorthand properties, for both
lists, with a proof case each.

### Minor: UI registry not updated for the error boundaries, `app/global-error.tsx:1`
**Problem**: the project rule (AGENTS.md, `/develop` override) is that new components get a `context/ui-registry.md`
row in the same change. `GlobalError` has none, and the `ErrorBoundary` entry (`context/ui-registry.md:161, 275-288`)
still says the digest is logged and the retry calls `reset()`, while the code reports to Sentry and calls `retry()`.
**Suggested fix**: add the row and refresh the notes.

### Minor: The "lazy" telemetry still ships in the first load bundle, `lib/analytics/client.ts:1`
**Problem**: both SDKs are static imports reached from `instrumentation-client.ts`; only their start is deferred by
`afterHydration`. `loadReplay` (`lib/observability/client.ts:68-85`) does `await import('@sentry/nextjs')` of a module
already imported statically, so it splits nothing. In the local production build (`.next`, 2026-10-28) the root main
files total about 869 KB (274 KB gzip), and the chunks that mention posthog and replay (one of 83 KB gzip, two more
Sentry chunks of 36 KB and 21 KB) are among them, fetched before first paint on every page.
**Why it matters**: AC-4 and AC-6 say "lazy, after hydration" to protect the first render on 390px phones; most of that
saving is not realised. This is a measured size of the whole bundle, not a per library figure.
**Suggested fix**: `await import('posthog-js')` inside the idle callback; for Replay, move the integration behind a
door module that is dynamically imported, or state the cost in the AC. Measure before and after.

### Minor: D77 fixes two tables, not the cause, `supabase/migrations/20261028180000_flags_ksa_health.sql:26`
**Problem**: the revoke and re-grant covers `regions` and `platform_settings` only. The cloud project's default
privileges (anon, authenticated and service_role get everything on every new table) are untouched, so each table
created later still starts wide open at the GRANT level in the cloud, and local and CI (hardened defaults) cannot show
it. Every future migration has to remember its explicit grants, and the append only tables of rule 5 need UPDATE and
DELETE revoked from service_role too.
**Why it matters**: RLS still protects rows, but TRUNCATE, TRIGGER and REFERENCES are not RLS governed, and ledger
immutability rests on privileges. A forgotten revoke passes CI and is open in production.
**Suggested fix**: consider `alter default privileges for role postgres in schema public revoke all on tables from
anon, authenticated, service_role` (and sequences) in a migration, so the cloud matches the local stack, and a pgTAP
meta test beside `02_function_grants` that lists any table granting privileges to anon. D77 stays valid for the two
tables; this is the systemic half of it.

## Nits

- `lib/observability/shared.ts:1-5`: `next.config.ts` imports it through Node's native TypeScript (a value import of
  `SENTRY_TUNNEL_ROUTE`), and it works only because `import type { AppEnv } from '@/lib/deployment'` is erased. Add the
  "erasable TypeScript only, no `@/` value imports" warning that `lib/deployment.ts` and `headers.ts` carry.
- `scripts/e2e.mjs:8`: the header still says "Analytics and error reporting stay off"; both now run with dummy keys.
- `AGENTS.md:29,38` and `context/build-plan.md:40`: stale status lines ("no migration pushed yet", "Open: preview proof,
  alert rules", "open: preview proof (7), alert rules (12)") contradict the tracker and `verify.md`.
- `lib/analytics/filter.ts:30-35`: `$set` and `$set_once` are dropped from `properties` only, but the capture result
  carries them at the top level (`posthog-js` `posthog-core.js:1244,1264`) and `{ ...event, properties }` keeps them.
  Nothing sets them today (`person_profiles: 'never'`), but the docblock promises more than the code does.
- `lib/observability/alert.ts:24`: `recordId` is a free string and the fingerprint is not scrubbed. A template literal
  type such as `${Region}:${MoneyFlag}` would make personal data in it unrepresentable.
- `instrumentation-client.ts:14-17`: the pageview fires at transition start, so a redirected or aborted navigation
  counts a page that never rendered.
- `app/api/health/route.ts:1-10`: a Route Handler without `requireRole()` is a documented exception in the spec and
  D71, but rule 11 (precedence 1) is not amended. Record the exemption in the rule text or D71 so the future action
  guard test and later reviewers find it.
- `supabase/tests/03_flags_and_health.test.sql:115-139`: proves a non admin cannot UPDATE a flag; a non admin INSERT
  or DELETE is not tested (the `for all` policy covers it).

## Strengths

- `lib/deployment.ts` is small, dependency free and fail closed: the environment matrix, "only exactly `1`", the
  Vercel plus `APP_LOCAL_ONLY` refusal, and a test that the refusal message never echoes a value.
- Flags fail closed in every shape (error, timeout, missing row, non boolean, a throwing client), backed by a database
  CHECK and pgTAP both ways, and the explicit grants are pinned exactly.
- The scrubber design is right: user data fields only, SDK fields untouched so grouping and trace joins survive, fail
  closed on a throw, one copy shared by Sentry, logs, replay and PostHog; a real SDK error is checked through the
  tunnel in e2e.
- The CSP nonce is proven at three levels: the forwarded request header at unit level, the nonce stamped on Next's
  scripts with zero violations in e2e, and a prerender manifest test that keeps locale pages dynamic.
- Source maps: uploaded then deleted, `errorHandler` rethrows so an upload failure fails the build, only deployment
  builds make any, and a post build `.map` check backs it.
- `/api/health`: one shared in flight ping, an identical 503 body for every failure, no error text.
- Decision hygiene: D74 to D81 recorded, pins exact and in the stack table, the vendored skill hashes match, and
  `.gitleaksignore` is narrow (two exact fingerprints, with the reason).

## Test coverage

Ten unit test files for this change ran green (200 tests); the author reports 338 unit tests, pgTAP 42/42 and e2e
23/23. Well covered: the deployment matrix, flags (all failure shapes, timeout abort), health (including the memo and
single flight), the CSP builder and its headers, the proxy nonce and header forwarding, the PostHog allow list and
filter, the server side doors with a mocked SDK, the scrubber on realistic events, the pgTAP grants and CHECK, and the
35 lint proofs. Gaps: the scrubber property tests assert too little (partial redaction passes) and never use cyclic
input, URLs in text, camelCase keys or non Latin digits; there is no test of `initServer`, `initClient` or the replay
options, of `reportClientError`, or of `GlobalError`; five lint exemptions have no proof; the proxy "never throws" row
runs against a mocked environment. AC-17 has neither an automated test nor a recorded manual proof, and the
`verify.md` checklist is still unticked. Not reviewed: cloud dashboard settings, the Vercel and Sentry state, and
`package-lock.json` beyond a version and install script cross check (only `fsevents`, already present, has an
unlisted install script).

---

## Outcomes (2026-10-29, same branch)

| Finding | Outcome |
| --- | --- |
| Major · URLs inside message text | Fixed |
| Major · no cycle or size guard | Fixed: visited set, 1000 entries per level, 50,000 nodes; a six way cyclic object scrubs in milliseconds (tested) |
| Minor · partial IP and phone redaction | Fixed; the property test demands exactly one marker with no residue |
| Minor · camelCase keys | Fixed (camelCase, `-` and `.` fold to `_`) |
| Minor · replay attributes | Fixed: `maskAttributes` adds href, src, value, alt, action; an e2e replay check is recorded for position 10 (R6) |
| Minor · "the proxy never throws" only under a mock | Fixed: tested against the real environment |
| Minor · ACs without automated proof | Fixed: init options, `reportClientError`, `GlobalError`, lint exemptions, the matcher |
| Minor · lint bypass by destructuring | Fixed (D86) |
| Minor · registry | Fixed |
| Minor · telemetry in the first load bundle | Recorded, measured not acted on (R6) |
| Minor · D77 fixes two tables, not the cause | In progress: default privileges migration (D86) |
| Nit · `shared.ts` erasable warning | No change needed: `next.config.ts` no longer imports it |
| Nit · `scripts/e2e.mjs` header | Fixed |
| Nit · stale status lines | Updated at merge by `/sync` |
| Nit · top level `$set` | Fixed |
| Nit · `recordId` free string | No change: an internal id by contract, `region:flag` today |
| Nit · pageview at navigation start | Recorded (R6) |
| Nit · `/api/health` and rule 11 | Recorded: the public machine endpoints row in `AGENTS.md` and D83 |
| Nit · non admin INSERT and DELETE | Fixed |

## After the reviews (2026-10-31, same branch)

No review caught this, and neither did CI. `/api/a/e/` answered 400 to every real posthog-js call: the
handler read a `compression` parameter that posthog-js 1.418 no longer sends. The unit tests assumed the
parameter and the e2e journeys stub the path, so a relay refusing all real traffic stayed green. It came
to light because the owner's preview visit left nothing in PostHog or Sentry. Fixed tests first in
`lib/analytics/capture-body.ts` (gzip recognised by its first two bytes, `api_key` read beside a `batch`),
with the e2e suite now running the SDK's real bytes through that parser. Both relays were then run against
the real services. For later positions: a handler behind a stub still needs one real call.
