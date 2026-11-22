# Slice review: position 18 (notification centre), `feat/18-notification-centre`

**Reviewer**: `slice-reviewer` on Sonnet, read only, 2026-11-22. **Spec**: [0011-18](../specs/0011-choose-to-launch/0011-18-notification-centre.md).
**Verdict**: fix then merge. No Critical. No rule that never bends broken; the mail parity refactor and the isolation
design read as correct.

## Findings and resolutions

| # | Severity | Finding | Resolution |
| --- | --- | --- | --- |
| 1 | Major | AC-5's cap (100) untested | Fixed: pgTAP 37 inserts 101 unread notices and asserts `my_notice_count() = 100` |
| 2 | Major | AC-2 map coverage thin: only the real flow kinds, `deadline_at` only for `pay_your_fee` | Fixed: synthetic rows for `job.done` (auto close on, the confirm deadline), `job.auto_closed` (`job_completed` and `rate_provider` until the window's end), `request.admin_cancelled` (both parties), `fee.late` (the payer), `report.opened` (the reporter and two admins; the reported party gets nothing), plus a check that every audit row of the file left exactly its map rows |
| 3 | Major | AC-11 proved by policy text only | Fixed: a behavioural case as `authenticated` with `realtime.topic` set: a user reads their own topic's pings, and reads none of another user's. The send failure stays proved by the body check and by the database only start where `realtime.send` is missing (X-5); the policy is read back after the cloud push (S45) |
| 4 | Major | No unit test of `renderNotices` (the deadline line, the service fallback) | Fixed: `tests/notifications-render.test.ts` (six cases: line, link, group, time ago; the deadline line in the region time zone; a deadline kind with none stored; a kind with no deadline line; the region default name then "your request"; read and Earlier) |
| 5 | Minor | Cascade foreign keys differ from the spec | Spec amended (As built, D210) |
| 6 | Minor | Policy name differs | Spec amended |
| 7 | Minor | `o_` column names differ from R-1 | Spec amended |
| 8 | Minor | Popover written by hand | Spec amended (D210 item 2) |
| 9 | Minor | Mark all discards a failure | Accepted and written in the spec: the count stays as it was, and the bell and page show the truth |
| 10 | Minor | Mark all hides at 0 | Accepted (cosmetic) |
| 11 | Minor | `AGENTS.md` door row, `architecture.md` notifications section | `architecture.md` gains a v5 note pointing to the spec; the `AGENTS.md` door row and Status line come with `/sync` at the merge |
| 12 | Minor | `live.ts` calls `.channel(` with no lint rule | Accepted; follow up in the spec |
| 13 | Minor | `[tr]` instead of `[draft]` | Spec amended |
| 14 | Minor | No bell on the public landing page for a signed in visitor | As specified (signed in shells only) |

## Verification gaps named by the reviewer, and where they closed

- pgTAP and e2e not run by the reviewer: `npm run db:test` passes (38 files), `37_notices` 89 assertions; e2e below.
- `audit_notices` is `stable` inside volatile trigger bodies: proved on a real database by pgTAP 29, 30, 33, 34, 35, 36
  (unchanged) and 37, which read rows written earlier in the same transaction.
- Popover `align="end"` in Arabic at 390px: covered by the e2e popover open with axe in `ar`.
- CI's database only start skips the Realtime assertions with a pass (R-11, X-1); the local gate runs them.
