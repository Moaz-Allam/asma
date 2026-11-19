# Review: feat/12-expiry-cancel-refunds (code and slice)

- Date: 2026-11-19
- Reviewer: `slice-reviewer` on Sonnet (the `/check review` pass; author Opus), read through git against `f2716de`
- Spec: `docs/specs/0011-choose-to-launch/0011-12-expiry-cancel-refunds.md` (D181)
- Verdict: fix then merge

## Findings and outcomes

| # | Severity | Finding | Outcome |
| --- | --- | --- | --- |
| 1 | Major | The failed pick limit with a commission of 0: no fee row, so `cancel_state` reads `OPEN`, the `(OPEN, platform)` matrix row is missing and `cancel_by_rule` raises `not_cancellable`; the expiry, the last withdraw and the suspend fail, and stuck rows hold places in the expiry batch | Fixed: row `(OPEN, platform, allowed, not_paid, not_paid, nobody)` seeded in both regions; pgTAP 27 cases for the expiry and the withdraw at the limit, and a meta case that every `(state, actor)` the functions read is seeded |
| 2 | Major | AC-14's e2e not written | Fixed: `e2e/expiry-cancel.spec.ts` (expiry, carry and a new pick in the browser, withdraw from Chosen, three failed picks refunded, a cancel with the refund shown, a provider late cancel and "Post again"), 390px, axe, three locales |
| 3 | Major | The admin refund dialog does not state the amount | Fixed: `AdminReasonAction` takes the fee's or refund's amount and shows it in the dialog body (never sent) |
| 4 | Minor | `expire_windows` rescans OPEN requests past their start every minute | Carried (R17) |
| 5 | Minor | Automatic cancels audit with a null actor and no cause key | Carried (R17) |
| 6 | Minor | No hint when Cancel is hidden by `checkout_open` | Carried (R17) |
| 7 | Minor | Admin page shows raw status, kind, reason, account and action codes | Recorded: an admin, data page; codes are the data (D186). Translated chips carried (R17) |
| 8 | Minor | Admin timeline shows action and time only | Carried (R17) |
| 9 | Minor | `lib/admin-requests/` and the new door functions missing from the AGENTS.md doors table; no tracker entry | Fixed in this change |
| 10 | Minor | `jobCancelPreview` once per Active row (N+1) | Carried (R17) |
| 11 | Minor | Strict `CancelResult` after a committed write | Carried (R17) |

## AC coverage after the fixes

AC-0 to AC-14 met. AC-13: pgTAP 27 (193) and 28, unit tests `tests/expiry-cancel.test.ts`. AC-14: e2e above.
