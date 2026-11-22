# Review, feat/18-notification-centre, 2026-11-22

**Reviewed by**: Sonnet 5.5 (author on Opus)
**Scope**: 33 files, branch vs master (merge base 0775157), plus the untracked `tests/notifications-render.test.ts` and the slice review file
**Verdict**: Approve with nits

## Summary

Position 18 moves 13's recipient logic into a write free `audit_notices` map that now feeds both the mail and the new
notices, adds the `notifications` table with definer only reads and writes, an isolated notice trigger, live pings on a
private Realtime topic, and the bell, popover and page. I compared `audit_notices` with `queue_audit_email` of
20261130090000 branch by branch (recipients, kinds, ids, send_until, order, null drops, the rating invite guard) and found
parity. The R-2 isolation holds in both directions (two triggers, each with its own subtransaction and failure row). The
one real defect is a concurrency hole in `open_notice` (below); the rest is minor.

## Major

None.

## Minor

### 🟡 `open_notice` raises `invalid_update` under a concurrent open or mark all, `supabase/migrations/20261201090000_notification_centre.sql:783`
**Problem**: `open_notice` reads the row, sees `read_at is null` in its own snapshot, then runs
`update ... set read_at = now() where x.id = v_n.id` with no `read_at is null` predicate. If another transaction
(a second open of the same notice from the bell and the page, a second tab, or `mark_all_notices_read`) commits between the
read and the update, READ COMMITTED re-fetches the latest row version and fires `notifications_guard` with
`old.read_at` already set and `new.read_at = now()`. The guard's `old.read_at is not null and new.read_at is distinct
from old.read_at` branch then raises `invalid_update`. `mark_all_notices_read` is safe, because its predicate
`read_at is null` makes the recheck skip the row.
**Why it matters**: The spec says a second open keeps the first time; that holds only sequentially. Concurrently the user
gets a failed action (the client falls back to `notice.href`, so the link still works) and `guardedAction` reports a
server error, which is noise in Sentry. pgTAP 37 has race tests through dblink but none for this pair.
**Suggested fix**: Add `and x.read_at is null` to the update in `open_notice` (a no op update is then simply skipped, and
the first time is kept), and add a dblink race case for open versus open and open versus mark all.

### 🟡 `NoticeItem` leaves a dead link when the action call rejects, `components/features/notifications/NoticeItem.tsx:33`
**Problem**: `onClick` calls `preventDefault()` and then awaits `openNoticeAction`. `guardedAction` turns handler errors into
a result, but a network failure or a deployment skew rejects the promise. Then `onOpened`, `router.push` and
`setBusy(false)` never run: the item stays `aria-busy` and the click does nothing. The new `Notices.openFailed` string is
defined in all three locales and used nowhere.
**Why it matters**: One tap on a flaky connection disables that row until the page reloads, and without the fallback the
user cannot reach the request.
**Suggested fix**: Wrap the call in try/finally (or catch) so that on rejection it still navigates to `notice.href`, and
reset `busy` in the finally. Either use `openFailed` or drop it from the three catalogues.

### 🟡 Unhandled rejections in the bell's `void` calls, `components/features/notifications/BellMenu.tsx:42`
**Problem**: `refreshCount` and `loadItems` await server actions with no catch and are called as `void ...` from effects,
the ping handler and `onOpenChange`. A rejected action (offline, a deployment skew) is an unhandled promise rejection, and
`loadItems` never sets `failed`, so the popover shows the skeleton forever instead of `loadFailed`.
**Why it matters**: Silent infinite skeleton in the failure case the component already plans for (`failed` state).
**Suggested fix**: try/catch inside both callbacks; `loadItems` sets `failed` on a throw, `refreshCount` keeps the old count.

### 🟡 Out of order count responses, `components/features/notifications/BellMenu.tsx:42`
**Problem**: Path change, ping and open each start `refreshCount` with no ordering. Two calls in flight can resolve in
reverse, leaving an older count on screen until the next trigger.
**Why it matters**: A stale badge (cosmetic, self healing on the next navigation or ping).
**Suggested fix**: A request counter ref, applying only the latest result.

### 🟡 Pagination cursor is a row id, so a deleted cursor restarts at page one, `supabase/migrations/20261201090000_notification_centre.sql:722`
**Problem**: `my_notices` resolves `p_before` through the notices table; if housekeeping deletes that row between "Show
older" renders, the page falls back to the first page (documented in X-10 for foreign ids, but it also covers this case).
The keyset comparison `(created_at, id) < (v_at, v_id)` itself is correct and matches the index.
**Why it matters**: Rare (180 day deletes of the oldest rows, not page boundaries a user is at), so cosmetic.
**Suggested fix**: Accept and note it, or carry `created_at` with the cursor.

## Nits

- ⚪ `app/[locale]/(account)/notifications/page.tsx:34`, `older` and the `> PAGE_SIZE` test run on the filtered rows (`loadNotices` drops unknown kinds after the limit); the check constraint makes this unreachable, but filtering after `limit` would shorten a page if a kind were ever added to the database and not to `NOTICE_KINDS`.
- ⚪ `supabase/migrations/20261201090000_notification_centre.sql:41`, `read_at >= created_at` compares a `now()` (transaction start) to a `now()`; a transaction that started before a notice was inserted and reads it later in a long transaction could violate it. Not reachable through the one statement RPCs.
- ⚪ `lib/notifications/live.ts:34`, `.channel(...)` direct call has no lint door rule (already accepted in the slice review, item 12).
- ⚪ `components/layout/AppShell.tsx:25`, the notices page reads `noticeCount()` again after the layout did; one extra RPC per render of that page.

## Strengths

- Parity refactor done carefully: one write free recipient map, `queue_audit_email` keeps its return value and the confirmation branch, and R-3's mail only kinds (`confirm_email`, `password_changed`) are filtered in one place with the kind check failing loudly for any new mail template.
- R-2 isolation is symmetric and consistent with 13's pattern: separate triggers and subtransactions, a failed outbox row carrying only ids and the SQLSTATE, and a last resort warning. The reminders keep per channel inner blocks so one channel cannot starve the other.
- No OUT parameter clash: in `my_notices` and `open_notice` every column reference is table qualified, and `RETURNS TABLE` names do not collide with locals.
- Privacy by construction: no table grant at all, own row policy, every function reads `auth.uid()`, no recipient id input, links computed on the server from kind, ids and role, and a private ping topic with a select only Realtime policy.
- Client teardown in `live.ts` is correct (closed flag before the late `subscribe`, timer cleared, channel removed); the debounce and the latest callback ref avoid resubscribing on every render. The during render state adjustment in `BellMenu` is the supported pattern and terminates.
- Notice text is rendered when read, from ids, in the reader's locale; en, tr and ar catalogues are key complete (24 kinds, `title`, `line`, optional `lineDeadline`) and logical properties are used throughout.

## Test coverage

pgTAP 37 (89 assertions) covers the table guard, grants, the map per kind, the 100 cap, the policy, the housekeeping and the
reminder parity; `tests/notifications-kinds.test.ts` ties the TypeScript kinds to the migration check; the render test
covers `renderNotices`; the e2e covers the three locales. Not covered: `open_notice` against a concurrent `open_notice` or
`mark_all_notices_read` (the Minor above), and the bell's failure states (`failed`, rejected actions), which have no
component or e2e test.

## Resolutions (author, 2026-11-22)

- `open_notice` race: fixed, the update runs only `where read_at is null`; pgTAP checks the predicate (the security review found the same).
- `NoticeItem` dead link: fixed, the call sits in try/finally and a dropped request still follows the server rendered link.
- Unhandled rejections in the bell: fixed, both callbacks catch; a failed list shows the error line, a failed count keeps the old one.
- Out of order counts: fixed, a request counter lets only the latest answer set the badge.
- A deleted cursor restarts at page one: accepted (rare, housekeeping deletes only rows older than 180 days).
- Nits: the filtered rows after the limit and the `read_at >= created_at` check are unreachable today and left; the `.channel(` lint rule now exists (security review); the page's second count read is accepted.
