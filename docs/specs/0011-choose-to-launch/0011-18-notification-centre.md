# 0011-18. In app notification centre and live status (position 18, P2)

Child of [0011](index.md). Follows the cross child contract there. **Touches 13's mail map (a trigger on the money
paths), a new table of notices, Supabase Realtime authorization, and every signed in header: a migration (one table, one
derivation function, four replaced mail functions, three triggers, four reader and writer functions, a policy on
`realtime.messages`, one cron job), one door, two surfaces.**

> **Accepted by the owner 2026-11-22 (D209)**, written against what 01 to 17 and 01b built (spec 0010, 0011-07 to
> 0011-17, 0012; D168 to D208). Built now, before 21, by the owner's override of the build order (D203). For this
> position the owner approved the whole loop in one go (spec, build, tests, reviews, PR, cloud migration after a dry run,
> merge) with no further prompts, and asked for `/develop` in the same session (D209 overrides D204's fresh session and
> per step waits for 18 only). Every choice below is the recommended one. What 18 reads as built: every lifecycle move
> writes one `audit_log` row (`id` bigint identity, `action`, `entity_type`, `entity_id` text, `region`, `old_value`,
> `new_value`) in its own transaction (13, D191). 13's `audit_log_email` trigger calls `queue_audit_email(audit_id)`,
> which returns at once while `emails_enabled(region)` is off and otherwise derives each recipient inline and calls
> `queue_audit_mail(audit_id, region, recipient, template, request, entity, send_until, topic)` per recipient; a new
> offer has no audit row and goes through `applications_offer_email` → `queue_offer_email(application_id)`; the three
> reminders come from `queue_reminders()` (cron `emails-reminders`, every 15 minutes), only where mail is on. The latest
> bodies: `queue_audit_email`, `email_context`, `queue_email` and the trigger's `when` list in
> `20261130090000_ratings.sql`; `queue_reminders` in `20261126090000_report_problem.sql`; `queue_audit_mail`,
> `queue_offer_email`, `audit_log_email`, `applications_offer_email` in `20261125090000_transactional_email.sql`. Mail is
> off in the cloud (S43) and sign in is by phone, so most users have no confirmed address: today most users get no
> notice at all. `notification_preferences` has one column, `email_enabled`, per topic, and the account page's
> `NotificationTable` says "email only, no in site column". `platform_settings` already has `notifications_enabled`
> (`TR` true, `KSA` false, 00b) that nothing reads. No table named `notifications` exists. `lib/notifications/` holds
> `topics.ts` and `preferences.ts`. The header (`components/layout/SiteHeader.tsx`) says "no bell before 18"; the
> design has `s13` (customer page and bell dropdown) and `p15` (provider page). The CSP already allows the Supabase
> `wss:` origin (`lib/security/csp.ts`). The browser client (`lib/db/client.ts`) reads the session from cookies that are
> not `httpOnly`. Nothing uses Realtime yet; `supabase/config.toml` has `[realtime] enabled = true`. The local database
> has `realtime.messages`, `realtime.send(jsonb, text, text, boolean)` and `realtime.topic()` (created by the Realtime
> service's own migrations, not by the Postgres image).

## Amendment rules

- **R-1, one recipient map, two channels.** 13's inline recipient logic moves, unchanged in effect, into one derivation
  function `audit_notices(p_audit_id bigint)` returning `table (recipient_id uuid, kind text, request_id uuid, entity_id
  uuid, send_until timestamptz, deadline_at timestamptz, topic text)`: one row per recipient and template, exactly the
  rows `queue_audit_email` writes mail for today, branch for branch (the rating invite's `rating_settings_invalid`
  handling included). It writes nothing. `queue_audit_email` is replaced to keep its early checks (`emails_enabled`,
  `email_settings`, the `profile.email_changed` confirmation) and then call `queue_audit_mail` once per row of
  `audit_notices`. pgTAP 29, 30, 33, 34 and 35 must pass unchanged: they are the proof that mail did not move. Rejected:
  writing the notice inside `queue_audit_mail` (a mail failure would roll the notice back with it, and the early
  `emails_enabled` return would have to move); a second, copied map (two maps drift).
- **R-2, notices have their own trigger and fail on their own.** A new `after insert` trigger `audit_log_notice` on
  `audit_log`, with its own `when` list, calls `queue_audit_notices(audit_id)`, which inserts one notice per
  `audit_notices` row whose kind is an in app kind (R-3). Its wrapper copies 13's R-2: an exception block; on any error
  one `email.send` outbox row already `failed`, key `notice:<audit_id>:queue_failed`, payload `{ audit_id, sqlstate }`,
  which 08's heartbeat alerts as `outbox_failed` (the `notice:` prefix says which channel failed); if that insert fails
  too, `raise warning` and swallow. The move always commits, and a notice failure never touches the mail rows (they are
  written by the other trigger). Same for the new offer: trigger `applications_offer_notice` → `queue_offer_notice`,
  failure key `notice:offer:<application_id>:queue_failed`.
- **R-3, which events become notices.** Every mail template of 13 to 17 except the two that only make sense by mail:
  `confirm_email` (a link to an inbox) and `password_changed` (an alarm for someone who may have lost the session). So 24
  kinds: `new_offer`, `chosen`, `pay_your_fee`, `commission_received`, `contacts_ready`, `job_started`,
  `please_confirm`, `job_completed`, `request_cancelled`, `pick_again`, `pick_ended`, `window_missed`,
  `payment_too_late`, `fee_refunded`, `account_approved`, `account_rejected`, `account_suspended`,
  `pay_window_closing`, `closes_soon`, `report_received`, `report_new_admin`, `report_handled`, `rate_provider`,
  `rating_received`. The notice trigger's `when` list is the mail trigger's list minus `profile.email_changed`,
  `auth.password_set` and `auth.password_changed`; a pgTAP meta test proves it. The brief's row 1 (a new request matches
  your zones) is still not built for either channel (13's follow up) and stays out.
- **R-4, a notice is written whatever the mail does.** Notices do not depend on `emails_enabled`, a confirmed address,
  or the email switches in `notification_preferences` (the account page says those switches are for email; in app is
  the record of what happened, always on). They depend only on the region's `notifications_enabled` (00b's existing row,
  read by a new `notices_enabled(region)` that returns false for a missing or non boolean value): while it is off, the
  notice writers write nothing. The migration does not change its values (`TR` on, `KSA` off).
- **R-5, a notice stores ids, never words.** Columns are ids, the kind, the region, the time, the read time and one
  optional `deadline_at`. The title and the line are rendered when read, in the reader's current language, from
  catalogue strings under `Notices.<kind>` and the values `my_notices` returns (R-8). So a language switch re-renders
  every notice, and no personal data, amount or admin text is ever stored in a notice. A notice says what happened and
  opens the page that shows it; like 13's R-6, it never shows a phone, street line, notes, answers, reason text, or the
  other party's name.
- **R-6, notices are history.** A notice is never hidden or rewritten when the state moves on: its line says what
  happened ("Your chosen provider did not pay in time"), and the page it opens shows the current state. 13's send time
  "only if" checks do not apply in app. `deadline_at` is the deadline the event named, kept as it was.
- **R-7, keys and replays.** `notifications.dedupe_key` is unique; every writer inserts `on conflict do nothing`. Keys:
  `notice:<audit_id>:<recipient_id>:<kind>`, `notice:offer:<application_id>`, and the reminders
  `notice:<application_id>:commission:pay_window_closing`, `notice:<application_id>:provider_fee:pay_window_closing`,
  `notice:<request_id>:closes_soon:<deadline epoch>` (13's mail keys with `notice:` for `email:`). A replay writes
  nothing twice.
- **R-8, reads and writes only through definer functions.** `notifications` has RLS on and one select policy (own rows,
  `recipient_id = (select auth.uid())`), and no table grant to any API role: the door calls four `security definer`
  functions with `search_path = ''`, granted to `authenticated` only, each scoped to `auth.uid()` (Section *API
  surface*). No path takes a recipient id from the client.
- **R-9, live updates are pings, not data.** An `after insert` trigger on `notifications` calls
  `realtime.send('{}'::jsonb, 'notice', 'notices:' || recipient_id, true)` inside an exception block (`raise warning`
  and swallow on any error, so Realtime can never break a move). The payload is empty: the ping says only "something
  happened to you", and the browser asks the server for the rest through the normal doors. Realtime delivers it only
  after the move commits, so an undone move pings nobody. Authorization is an RLS policy on `realtime.messages`: select
  for `authenticated` where `realtime.messages.extension = 'broadcast'` and `(select realtime.topic()) = 'notices:' ||
  (select auth.uid())::text`. No insert policy, so no browser can send on any topic. The browser joins the private
  channel `notices:<own id>` (`config: { private: true }`) after `supabase.realtime.setAuth()`. Rejected: Postgres
  Changes on the table (a row per subscriber check, and the row itself on the wire); polling (a function call a minute
  per open tab on Vercel); a topic per request (an RLS check per request and per party, for no gain over one topic per
  person).
- **R-10, live status rides the same ping.** On a ping the signed in shell debounces 500 ms, refetches the unread count,
  and calls `router.refresh()`, which renders the current page again on the server. So the customer's request page, the
  provider's applications page and the admin's report queue show the new state without a reload whenever the move sent
  that person a notice (every move another party or a job makes on their request does, by 13's map). Moves the person
  made themselves already show. A move that sends the viewer no notice (a rival offer withdrawn) shows on the next
  navigation, as today.
- **R-11, Realtime in each environment** (X-1). Hosted Supabase and the full local stack have `realtime.messages`
  (proved 2026-11-22: `postgres` creates the policy and `realtime.send` writes a row on the local stack); CI's
  `database` job (`supabase db start`, Postgres only) and the e2e stack started with `-x realtime` may not. So the
  policy sits in a `do` block that creates it only when `to_regclass('realtime.messages')` is not null, and pgTAP fails
  when the table exists without the policy (and passes with a note when the table is absent). `realtime.send` is called
  only inside R-9's swallowing block, so where it is missing the notice still commits. `scripts/e2e.mjs` stops
  excluding `realtime` when it starts the stack, and refuses to run (as it does for Storage) when the running stack has
  no Realtime, telling you to restart it. After the cloud push, the policy is read back through the connector.
- **R-12, housekeeping.** A daily job `notices-housekeeping` (pg_cron as `postgres`, `23 3 * * *`) deletes notices older
  than 180 days, read or not, in batches of 5,000. 180 days covers a job's whole life (the longest window is the 14 day
  rating window) with room to spare, and keeps the table small.
- **R-13, the reminders.** `queue_reminders()` is replaced so that, per region, it reads `email_settings` once (a bad
  value skips the region with a warning, as today), writes the three reminder notices to the same people at the same
  moments wherever `notices_enabled` is on, and writes the three reminder mails exactly as before only where
  `emails_enabled` is on. pgTAP 29's reminder cases pass unchanged.

## Summary

Every step that already sends an email now also leaves a notice in the person's notification centre, whether or not
they have a confirmed email, which most phone sign ins do not. A bell in the header shows how many are unread; it opens
the latest five, and a full page lists the rest by day. Opening a notice marks it read and takes you to the request it
is about. When something happens to you, your open page updates by itself: the database sends your browser an empty
ping on a private channel only you can join, and the page fetches the new state through the usual doors. Notices hold
only ids, so they render in whatever language you use and carry no personal data.

## Requirements

**User stories**:
- As a customer or provider without a confirmed email, I want to see every step that needs me in the site, so that I
  do not miss a pay window or a confirmation.
- As anyone signed in, I want my open page to change when the other side moves, so that I do not reload to find out.
- As the owner, I want notices to fail on their own, so that a notice bug never blocks a payment or a mail.

**Prerequisites**: 17 merged (PR #58) and its migration in the cloud. Branch `feat/18-notification-centre` from
`master`. Nothing from an owner step blocks the build; S45 (Realtime public access off) is a hardening step after the
merge.

**Acceptance criteria**:
- **AC-1** (the map): `audit_notices(audit_id)` returns, for every action in 13 to 17's map, the recipients, templates,
  request and entity ids and `send_until` that `queue_audit_email` mails today, plus `deadline_at` (R-1, AC-3). pgTAP
  29, 30, 33, 34, 35 and 36 pass unchanged.
- **AC-2** (notices written): with `notifications_enabled` on, each mapped audit row writes one notice per in app
  recipient (R-3), keyed by R-7, whatever `emails_enabled`, the address or the email switches say (R-4); a new offer
  writes `new_offer` to the customer; the three reminders write their notices when due (R-13). With it off, nothing is
  written. A replay writes nothing twice. A parity case proves that, with mail on and every recipient confirmed, the
  notice set equals the mail set for the in app kinds.
- **AC-3** (safety): a forced error in the notice path commits the move, writes the `notice:` failed outbox row, and
  leaves the mail rows as they would be (R-2); a failing `realtime.send` commits the notice (R-9).
- **AC-4** (the record): `notifications` (`id` uuid, `region`, `recipient_id`, `kind`, `request_id` null, `entity_id`
  null, `deadline_at` null, `dedupe_key` unique, `created_at`, `read_at` null) with RLS and the own row select policy,
  no grant to `anon` or `authenticated` (R-8). A notice changes only by `read_at` going from null to a time, through the
  functions; a guard trigger refuses any other update.
- **AC-5** (reads): `my_notices(p_before uuid, p_limit int)` returns the caller's own notices newest first (keyset on
  `created_at`, `id`; `p_limit` 1 to 50, default 20; a `p_before` that is not the caller's raises `not_found`), each
  with `id`, `kind`, `created_at`, `read_at`, `request_id`, `entity_id`, `deadline_at`, the request's service name map
  (`requests.pricing_snapshot -> 'service' -> 'name'`), and the notice region's `timezone` and default locale.
  `my_notice_count()` returns the caller's unread count, capped at 100.
- **AC-6** (open and mark): `open_notice(p_id)` marks the caller's notice read (once; a second open keeps the first time)
  and returns its `kind`, `request_id` and `entity_id`; another person's id raises `not_found`. `mark_all_notices_read()`
  marks every unread notice of the caller and returns how many.
- **AC-7** (where a notice leads; X-11, X-12): the door computes the link on the server from the kind, the ids and
  the caller's role, never from the client: a customer goes to `/requests/<request_id>`, and for `report_received` and
  `report_handled` to `/requests/<request_id>/report`; a provider to `/provider/applications` (there is no page per
  request after the pick), for `report_received` and `report_handled` to
  `/provider/applications/<request_id>/report`, for `rating_received` to `/provider/profile` (where the score shows, as
  the mail does), and for `account_approved`, `account_rejected`, `account_suspended` to `/provider` (which shows every
  account state, 02); an admin's `report_new_admin` to `/admin/reports/<entity_id>`, only when the caller's role is
  admin. Any other combination (a missing id, a kind the role cannot have) goes to `/notifications`.
- **AC-8** (the bell): every signed in header (customer, provider, admin, account pages) shows a bell (a 40px circle
  `bg-surface-secondary`, `lucide-react` `Bell`) with an 18px count badge while the unread count is above 0, showing
  `99+` from 100. Its accessible name says the count ("Notifications, 3 unread"). It opens a popover (Radix, added
  through the pinned shadcn CLI as `components/ui/popover.tsx`) with the latest five notices and "View all"; each is a
  button that opens it (AC-6, AC-7). `BellMenu` is a client component (X-3): the shell passes the count it read on the
  server as a prop, and the bell refetches it through the `refreshNoticeCount` action when the path changes
  (`usePathname`), on every ping (R-10), and after an open or a mark, because layouts do not render again on client
  navigation. A failed count read shows the bell with no badge (the server logs `notice_count_failed` with no id); it
  never breaks the header. `AdminShell` gets the same bell beside its avatar.
- **AC-9** (the page): `/[locale]/notifications` (`guardPage`, any signed in role) lists the caller's notices, 20 at a
  time with "Show older" (`?before=<id>`), grouped "Today" and "Earlier" by the day in each notice's region time zone.
  Each row shows the unread dot (never colour alone: unread rows are also `font-bold` on the title and named in the
  accessible text), the title, the line, and the time ago (`Intl.RelativeTimeFormat` in the locale, Western digits). A
  side card shows the unread count and "Mark all as read" (a form, so it works without script); a second card says email
  switches live on the account page and links there. An empty list shows the `s17` empty state. Phone first at 390px;
  from `lg` the list is the main column and the cards the side column (ui-rules §13).
- **AC-10** (live; X-4): the shell of every signed in page subscribes to `notices:<own id>` (R-9) once per tab, the
  id passed as a prop from `getSessionUser()` (never `getSession()`, banned). `supabase.realtime.setAuth()` with no
  argument reads the cookie session inside supabase-js, so no `supabase.auth` call is made outside `lib/auth`. The
  subscriber is keyed by the user id, so a different user in the same tab tears the old channel down; it unsubscribes
  on unmount and on sign out. On a ping it refreshes the count and the page (R-10). If Realtime cannot connect, nothing
  is shown and nothing breaks: the count stays right on each navigation.
- **AC-11** (the policy): an authenticated user can join `notices:<own id>` and receives its pings; the same user cannot
  receive another user's pings, and no browser can send a message on any `notices:` topic (no insert policy). pgTAP
  checks the policy's text; e2e proves a ping arrives live.
- **AC-12** (copy): titles and lines for the 24 kinds under `Notices.<kind>.title` and `.line` in `ar`, `tr`, `en`
  (the `tr` strings carry the `[draft]` marker until S21 reviews them, D100), phrased as what happened (R-6). A line may
  use only `{service}` (through `localized()`) and `{deadline}` (through `instantLabel()` in the notice's region time
  zone, only where `deadline_at` is set). The account page's email table gains one line under its intro: "Every notice
  also appears in your notifications."
- **AC-13** (housekeeping): R-12's job deletes notices older than 180 days and nothing newer.
- **AC-14** (tests): pgTAP `37_notices`: the parity and the map rows (AC-1, AC-2), the switch, R-4's independence from
  mail, the reminders with mail off, the replay, R-2's forced error and R-9's swallowed failure, RLS (a user reads only
  their own notices through every function; a direct select is refused for `anon` and `authenticated`), the update
  guard, `open_notice` and `mark_all_notices_read` on someone else's id, the keyset and the cap, the housekeeping
  boundary, the two `when` lists (the meta test), the policy on `realtime.messages`, and no grant to `anon`,
  `authenticated` or `service_role` on the internal functions. Unit tests: the link mapping for every kind and role,
  the day grouping across a time zone midnight, the count label (`99+`), the line rendering with and without
  `{deadline}`, and a test that every kind has a title and line in all three catalogues. e2e `notices.spec.ts` in `ar`,
  `tr` and `en` at 390px with axe: a provider on `/provider/applications` sees the bell count rise without a reload
  when the customer chooses them (driven through the database functions as the customer, as 05's e2e does), opens the
  notice from the popover, lands on `/provider/applications` with the count gone; the customer's `/notifications` page
  shows the new offer, opens it to `/requests/<id>`, and "Mark all as read" clears the count.

## Decision

Notices are a second channel on 13's map, not a second map: one function derives who needs to know about each audit
row, mail and notices each read it in their own trigger, and each fails without touching the other. A notice stores ids
and is rendered when read, so it is always in the reader's language and never holds personal data. Live updates are
empty pings from the database on a private Realtime channel per person, authorized by RLS on `realtime.messages`; the
browser then asks the server for the truth, so nothing on the socket can leak or be trusted.

**Implementation skills**: `supabase` (`supabase/agent-skills`, `.claude/skills/supabase/`) for Realtime authorization
and the browser client · `supabase-postgres-best-practices` (`.agents/skills/supabase-postgres-best-practices/`) for the
triggers, the indexes, the keyset read and the RLS · `shadcn` (`.claude/skills/shadcn/`) for adding the popover with the
pinned CLI.

## Feature design

**Data model**:

| Table | Column | Type | Notes |
| --- | --- | --- | --- |
| `notifications` | `id` | uuid PK, `gen_random_uuid()` | |
| | `region` | text not null → `regions(code)` | from the audit row, the application or the request |
| | `recipient_id` | uuid not null → `profiles(id)` on delete restrict | |
| | `kind` | text not null, check in R-3's 24 kinds | |
| | `request_id` | uuid null → `requests(id)` on delete restrict | null for account notices |
| | `entity_id` | uuid null | the application, fee, refund or report, as 13's map names it; no foreign key (it points at several tables) |
| | `deadline_at` | timestamptz null | only for `pay_your_fee`, `please_confirm` (when auto close is on), `pay_window_closing`, `closes_soon`, `rate_provider` |
| | `dedupe_key` | text not null unique, 1 to 300 chars | R-7 |
| | `created_at` | timestamptz not null default `now()` | |
| | `read_at` | timestamptz null | set once |

Indexes: `(recipient_id, created_at desc, id desc)` for the list; partial `(recipient_id) where read_at is null` for the
count; `(created_at)` for housekeeping; `(request_id)` and `(region)` for the foreign keys. RLS on; policy
`notifications_read_own` (select, `authenticated`, own rows); no grants to API roles. Guard trigger
`notifications_guard` (`before update`): only `read_at` may change, and only from null. Realtime: policy
`notices_read_own` on `realtime.messages` (R-9).

**State transitions**: a notice is unread, then read (once). Deleted only by housekeeping after 180 days.

**API surface**:

| Function or route | Grant or guard | Errors |
| --- | --- | --- |
| `audit_notices(p_audit_id)` | none (internal, `security invoker`) | never raises (the rating setting is caught as today) |
| `queue_audit_notices(p_audit_id)`, `queue_offer_notice(p_application_id)` | none (trigger bodies, definer) | never raise (R-2 wrappers) |
| `insert_notice(p_key, p_region, p_recipient, p_kind, p_request, p_entity, p_deadline)` | none (internal) | `validation_failed` on a bad kind or key |
| `notices_enabled(p_region)` | none (internal) | |
| `queue_audit_email`, `queue_reminders` (replaced, same signatures) | as 13 | as 13 |
| Triggers `audit_log_notice`, `applications_offer_notice`, `notifications_ping`, `notifications_guard` | none | the guard raises `invalid_update` |
| `notices_housekeeping()` (cron `notices-housekeeping`) | none | |
| `my_notices(p_before uuid default null, p_limit integer default 20)` | authenticated, definer, own rows | `validation_failed`, `not_found` |
| `my_notice_count()` | authenticated, definer | |
| `open_notice(p_id uuid)` | authenticated, definer, own row | `not_found` |
| `mark_all_notices_read()` | authenticated, definer | |
| Door `lib/notifications/centre.ts` (`server-only`): `loadNotices`, `noticeCount`, `openNotice`, `markAllRead`, `noticeHref` | the caller's session client | the codes above |
| Door `lib/notifications/live.ts` (`'use client'`): `useNoticePings(userId, onPing)` | the browser client and its session | none surfaced |
| Server Actions `openNotice`, `markAllNoticesRead`, `refreshNoticeCount`, `recentNotices` (`actions/notifications.ts`) | `guardedAction`, any signed in role | the codes above |
| Page `/[locale]/notifications` | `guardPage`, any signed in role | |

**Value sourcing**:

| Value | Source |
| --- | --- |
| Recipients, kind, ids | `audit_notices` (13's map), `queue_offer_notice`, the reminder queries (R-13) |
| `region` | the audit row's `region`; the application's for an offer; the request's for a reminder |
| `deadline_at` | `audit_notices.deadline_at`: `requests.fee_deadline` (pay your fee), `requests.confirm_deadline` when `auto_close_enabled` (please confirm), the reminder's deadline, the rating window's end (`closed_at` + `rating_window_days`) |
| Title and line | `messages/<locale>.json` `Notices.<kind>` in the reader's current locale (next-intl) |
| Service name | `requests.pricing_snapshot -> 'service' -> 'name'` through `localized(value, locale, regionDefault)` |
| Time zone and default locale | `regions.timezone`, `regions.default_locale` of the notice's region |
| Time ago | `created_at` against the server's `now()` at render, `Intl.RelativeTimeFormat(locale)` |
| Day group | `created_at` in the notice region's time zone, compared with today in that zone |
| Unread count | `my_notice_count()` |
| Link | `noticeHref(kind, ids, role)` on the server (AC-7); role from the session |
| Channel topic | `'notices:' || auth.uid()` (server side policy); the browser's own id from the session the shell already reads |
| Debounce | 500 ms, a constant in `live.ts` |
| Retention | 180 days, a constant in `notices_housekeeping` (R-12) |
| Page size, popover size | 20 and 5, constants in the door |

**Security model**: a notice is readable and changeable only by its recipient, and only through four definer functions
that read `auth.uid()`; no client value names a recipient, a link or a region. Notices hold no personal data or text
(R-5), so a leak of the table shows only that something happened to an id. The socket carries an empty payload on a
private topic that only its owner can join (RLS on `realtime.messages`), and no browser can send; the page then reads
through the same doors as before, so Realtime adds no read path. The notice triggers are `security definer` with
`search_path = ''` and no grant, and fail closed without blocking a move. S45 turns off public channels for the project,
so a client that forgets `private: true` is refused rather than joining an unchecked topic.

**Configuration required**: none new in env. `notifications_enabled` (existing row per region). S45 in the Supabase
dashboard (Realtime settings: "Allow public access" off) after the merge.

**Critical test scenarios**: mail off and no confirmed address still leaves every notice (R-4); a mail bug never loses a
notice and a notice bug never loses a mail or a move (R-2); the mail rows are unchanged by the refactor (pgTAP 29 and
the rest); someone else's notice id refuses everywhere; a replay never doubles; the bell rises without a reload; the
page renders in the language you switch to, not the one the notice was written in.

## Build plan

Tracer Bullet: one thin thread first (the `chosen` notice, from the audit row through the table, the ping and the bell
count, live in the provider's browser), then the rest of the map, then the page.

1. Prove R-11 on the local stack: the policy on `realtime.messages` survives `npx supabase db reset` and a private
   channel receives a `realtime.send` ping in a scratch script. Satisfies **AC-11** (environment).
2. Tests first: pgTAP `37_notices` (map parity, writers, switch, safety, RLS, functions, guard, housekeeping, meta
   tests, policy); unit tests for the link map, grouping, count label and catalogues. Satisfies **AC-1** to **AC-6**,
   **AC-13**, **AC-14**.
3. The migration `20261201090000_notification_centre`: the table, indexes, RLS and guard; `notices_enabled`;
   `audit_notices` and the replaced `queue_audit_email`; the notice writers, triggers and wrappers; the replaced
   `queue_reminders`; the four reader and writer functions; the ping trigger and the `realtime.messages` policy; the
   housekeeping job; the database types regenerated. Satisfies **AC-1** to **AC-6**, **AC-11**, **AC-13**.
4. `lib/notifications/centre.ts` and `live.ts`, the actions, the catalogue strings in three locales. Satisfies **AC-7**,
   **AC-10**, **AC-12**.
5. The popover primitive, `BellMenu` in the header, `NotificationList` and the page, the account page line; registry
   rows. Satisfies **AC-8**, **AC-9**, **AC-12**.
6. e2e `notices.spec.ts`; the local gate (`npm run verify`, `npm run db:test`, the e2e in batches with `--workers=1`).
   Satisfies **AC-14**.
7. Reviews: `slice-reviewer`, `security-reviewer`, `/check review` on Sonnet; fixes; PR; the migration pushed after a
   dry run; merge (D209).

## Consequences

- Positive: every user gets every step, mail or not; open pages update by themselves; one map serves both channels, so
  a later action added to the map reaches both; a notice bug cannot reach a payment or a mail.
- Negative: one more trigger on every mapped audit row and one on each notice; 13's map function is refactored (guarded
  by its existing tests); a Realtime connection per open signed in tab (Supabase Free allows 200 at once, R3); a server
  render of the current page on each ping.
- Neutral: `notifications_enabled` finally has a reader; the account page's switches stay email only, now said out loud.

## Follow-up

- [ ] S45 (new owner step, after the merge): Supabase dashboard, Realtime settings, turn "Allow public access" off.
  Nothing uses public channels.
- [ ] The brief's row 1 (a new request matches your zones), for both channels, with its matching fan out (13's follow
  up still open).
- [ ] The provider page's "needs action" card from `p15`: the dashboard (`/provider`) already lists what needs action;
  revisit with the design pass.
- [ ] A lint rule making `lib/notifications/live.ts` the only caller of `.channel(` and `realtime.setAuth`, if a second
  Realtime use appears.
- [ ] Partition or archive `notifications` if it grows past the housekeeping window's comfort (architecture §39).

## Rationale

The audit rows and 13's recipient map already say who must hear about each move, in the move's own transaction; reusing
the map keeps both channels in step, and a trigger of its own keeps the notice independent of mail in both directions.
Storing ids and rendering on read avoids stale language and keeps personal data out of a table every user reads from.
Empty pings on a private, RLS checked topic give live updates without putting any data on the socket or adding a read
path, and `router.refresh()` reuses every page's existing server render instead of teaching each page to patch itself.

## Cross check

Sonnet, read only, 2026-11-22: 14 findings (6 Major, 8 Minor, no Critical); every claim above about what exists held.
Each is resolved by its recommended fix:

- **X-1** (Major): CI and the e2e stack may lack `realtime.messages` → R-11 rewritten (guarded policy, e2e wrapper).
- **X-2** (Major): the page's route group → `app/[locale]/(account)/notifications/page.tsx`, the `(account)` layout
  (`AppShell`, private metadata); an admin sees `AppShell` there, not `AdminShell`. `/notifications` is not added to
  `SECTIONS` or `NEXT_SECTIONS` (no sign in `next` needs it).
- **X-3** (Major): layouts do not render again on navigation → AC-8 (`BellMenu` is a client component, its refetch
  rule and its failure rule).
- **X-4** (Major): the user id and session in the browser → AC-10.
- **X-5** (Major): how the forced errors are made, with no test hook in any function. R-2: inside the pgTAP
  transaction, `alter function public.insert_notice(...) rename to insert_notice_off`, then a move; rolled back with
  the test. R-9: a body check that `notifications_ping` wraps the send in `exception when others`, plus the real case
  where `realtime.send` is absent (CI), in which the notice commits.
- **X-6** (Major): R-1 details. (a) `queue_audit_email` keeps returning the mail count, and keeps the
  `profile.email_changed` branch (confirmation, `relay_kick`, returns 1) in its own body; (b) `audit_notices` drops a
  null recipient, as `queue_audit_mail` does; (c) every branch is copied exactly, including the provider re-read from
  `selected_application_id` in the cancel branches and `new_value ->> 'application_id'` elsewhere, and the rating
  window with its `rating_settings_invalid` catch.
- **X-7** (Minor): `queue_reminders` keeps returning the count of mails only; a bad `email_settings` value skips both
  channels for that region, with the existing warning (the lead hours are mail settings).
- **X-8** (Minor): a reminder key per application drops a second reminder if the same application were picked twice;
  an expired application cannot be picked again, and the mail key behaves the same, so it is accepted.
- **X-9** (Minor): one subtransaction per notice for the ping's exception block; accepted.
- **X-10** (Minor): a `?before=` that is not the caller's → the page ignores it and shows the first page.
- **X-11** (Minor): report and rating links → AC-7.
- **X-12** (Minor): the admin link only for an admin → AC-7.
- **X-13** (Minor): every new function, trigger bodies included, revokes `execute` from `public`, `anon`,
  `authenticated` and `service_role` explicitly and pins `search_path = ''` (test 02); only the four reader and writer
  functions are then granted to `authenticated`.
- **X-14** (Minor): the heartbeat's alert for a `notice:` failed row says `outbox_failed`; the key prefix tells the
  channel. Accepted.

Privacy note from the check: after `request_cancelled` or `pick_ended` the provider no longer reads the request in the
feed, and the notice still shows its service name. They saw it when they applied; accepted. `my_notices` reads only
`pricing_snapshot -> 'service' -> 'name'`, never the rest of the snapshot.
