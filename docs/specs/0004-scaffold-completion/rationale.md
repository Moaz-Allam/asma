# 0004. Scaffold completion: rationale

The decision record behind [index.md](index.md). Read by people and by `/architect` on an update;
`/develop` skips it.

## Context

> ⚠️ Premise note: this position bundles six decisions (error tracking, analytics privacy, logs and
> alerts, the content security policy, money flags, the deployment guard). They stay in one spec
> because gate G0 checks them together and they share two contracts: the scrubber and
> `isDeployment()`. If one of them changes on its own later (for example a consent banner after S16),
> split it into a child spec rather than growing this one.

Position 00 left the app able to boot, route three locales and talk to Supabase, but blind: no error
reaches anyone, nothing counts usage, any page may be framed or run injected script, the five money
switches are environment variables that need a redeploy to flip (architecture §38 requires flipping
without one), and KSA is still active in the data although launch is Turkey only (D22). The playbook
(§5.3, §16, §12.2, §14.8) expects the scaffold to fix all of this before feature work starts, and gate
G0 checks it.

The forces: the app will hold customer PII (personal data) and money, so a leak through an error report
or an analytics event is a KVKK problem, and injected script is the worst case. The owner is one
person, so alerts must reach a phone, and everything must run on free plans until launch (D63, R3).
Data stays in the EU (D62). The owner ran the PostHog setup wizard on 2026-10-27 outside any spec; its
code is stashed and shows the default path: autocapture on, events without types, a separate log
pipeline, and env names the write guard rejects.

Two hard edges shaped the options. A strict content security policy with nonces forces every page to
render per request (Next 16.4 CSP guide). PostHog without cookies cannot record sessions and should not
identify users (PostHog's cookieless documentation). Not deciding means every later position would add
its own logging, events and switches, the pattern the single doors (architecture §42) exist to stop.

## Options considered

### Error tracking, logs and alerts

**Sentry for errors, traces, logs and alerts (chosen).** One EU backend; a log line, an error and a
trace share one trace id. Pros: one place to look, one SDK, alerts reach a phone through Sentry's app.
Cons: one vendor's quotas cap all four signals; logs are a newer Sentry product.

**Sentry for errors, PostHog Logs through OpenTelemetry for logs.** The playbook's reference setup and
what the wizard built. Pros: proven on the reference build; logs sit next to product analytics. Cons:
two pipelines and two scrubbing paths; logs and errors joined only by hand.

**Structured JSON to stdout (Vercel runtime logs).** Pros: no new service. Cons: Vercel Hobby keeps
runtime logs only briefly, too short for an incident.

### Analytics privacy under KVKK

**Cookieless PostHog, no banner (chosen).** Nothing stored on the device; unique visitors counted by a
privacy preserving hash on PostHog's servers. Pros: no banner, no consent state to build or translate.
Cons: no session replay, no identification, approximate unique counts.

**Consent banner, cookies after opt in.** Pros: full analytics and replay for consenting visitors.
Cons: a banner in three locales, copy for S21 and legal text for S16, all before G0.

**Cookies without a banner.** Pros: richest data. Cons: needs a legal sign off under KVKK that does not
exist.

### Session replay

**Sentry replay on errors only (chosen, after the cookieless decision ruled out PostHog replay).** Pros:
the least recorded personal data; crashes stay debuggable. Cons: no replay of sessions that did not
fail. The owner first picked both tools; PostHog replay cannot run cookieless, so it stays off until a
consent decision.

### Content security policy

**Strict nonce policy, enforced now (chosen).** Pros: no inline script runs without the per request
nonce; violations reported to Sentry; fixed while the app is small. Cons: pages render per request, no
static pages or CDN caching for pages.

**Static policy with `'unsafe-inline'` scripts.** Pros: keeps static pages. Cons: injected inline
script still runs, which defeats the main purpose.

**Hash based policy with Subresource Integrity.** Pros: static pages and a strict policy. Cons: Next
marks it experimental and it may change or disappear.

### Money flags

**Database rows per region in `platform_settings`, read live, fail closed (chosen).** Pros: flips
instantly without a deploy; per region; covered by the existing admin write policy. Cons: one database
read per money action; the admin UI and audit come later (16, 21).

**PostHog feature flags.** Pros: a ready UI. Cons: a money kill switch would depend on an outside
service and on cookies we chose not to use.

**Environment variables (today).** Pros: simplest. Cons: a flip needs a redeploy, which §38 rules out.

### Alert deduplication

**Sentry grouping with a per record fingerprint (chosen).** Pros: no table; repeats of the same record
join one issue and the alert fires once. Cons: depends on Sentry's grouping; a resolved issue that
recurs alerts again.

**A database marker table.** Pros: independent of Sentry. Cons: a migration, RLS and tests now for
alerts no position raises yet.

## Rationale

One EU backend for errors, traces, logs and alerts follows from a one person operation: an incident at
night needs one place to look, and the trace id joins the pieces without extra work. The playbook's
separate PostHog log pipeline was built for a reference project with different needs; here it would
double the scrubbing surface the KVKK risk makes expensive.

Cookieless analytics trades insight for not having to build, translate and legally clear a consent
banner before G0, on a schedule already 11 days behind (D65). The cost (no per user funnels, no PostHog
replay) is real but reversible: a later consent spec can switch PostHog to cookies after opt in without
touching the door's callers.

A strict nonce policy costs static rendering, but almost every page after 01 is signed in and dynamic
anyway, and an app holding PII and payments is exactly the case Next's guide names for nonces.
Enforcing now, while there are three pages, is cheaper than enforcing at launch over thirty.

Flags as database rows are the only option that meets §38 and keeps a money kill switch inside our own
database. Failing closed matches the cut list's rule that P0 reliability is never cut: a broken switch
must stop money, not let it through.

Requiring both keys on every deployment (the owner's call over making analytics optional) means a
missing PostHog key blocks a deploy. That is strict, but it makes "analytics silently off in
production" impossible, and S8 is due before G0 anyway.

The smaller calls, made in the spec with their runner up: the tunnel and proxy live under `/api/`
because `proxy.ts` already skips that prefix and neutral names avoid ad blocker lists (runner up:
Sentry's random route, which the proxy matcher could not exclude). The flag value is checked by a
database CHECK as well as by the helper, because a rule bearing invariant belongs in the database. The
health check reaches the database through a dedicated `health_ping()` granted to `anon`, because both
existing tables are readable only by signed in users and the admin client is reserved for webhooks and
cron (runner up: reading a table and treating a permission error as "up", which cannot tell a refusal
from an outage).

## Cross check (2026-10-28)

An independent pass on a different model (Sonnet) found 22 decision gaps and 13 soundness issues; the
owner accepted every recommended fix. The ones that changed the design rather than filling in detail:

- The scrubber walks user data fields only. A key or digit rule applied everywhere would have broken
  SDK owned fields, PostHog's own project token, and the trace ids and uuids that correlation depends
  on.
- Each deployment key becomes required in the task that adds its door, because requiring the PostHog
  key from task 4 would have blocked the tracer bullet preview in task 7.
- Grouping alone alerts once per issue forever, so an escalating rule (more than 10 events in 10
  minutes) alerts again on a persistent failure, and sends are flushed with `after()` so a freezing
  function does not lose them.
- Sentry Replay keeps nothing in `sessionStorage`, to match the "nothing on the device" premise the
  cookieless decision rests on.
- The e2e build runs both SDKs against dummy keys and stubbed endpoints; with the SDKs off, the CSP and
  storage checks would have proven nothing.
- next-intl rebuilds request headers, so the nonce must enter through the request, not only the
  response.
- Owner choices taken as recommended: keep Vercel's Sentry integration (its release name is the same
  full SHA), turn the Vercel toolbar off on previews (one policy everywhere), one PostHog project with
  an `app_env` property instead of a second project, HSTS at one day until the domain exists, and the
  public route allow list moved to 01, its first reader.
