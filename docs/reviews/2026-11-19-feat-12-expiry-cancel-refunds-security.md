# Security review: feat/12-expiry-cancel-refunds

- Date: 2026-11-19
- Reviewer: `security-reviewer` on Opus, read through git against `f2716de`
- Scope: the migration `20261124090000_expiry_cancel_refunds`, pgTAP 27 and 28, the doors, actions and pages of 12
- Verdict: fix then ship

## Findings and outcomes

| # | Severity | Finding | Outcome |
| --- | --- | --- | --- |
| S12-1 | Major (confirmed) | A commission of 0 can never be cancelled by the failed pick limit (`after_reopen` → `cancel_by_rule` asks `(OPEN, platform)`, unseeded): the request stays past its deadline, the provider's withdraw fails, and stuck rows can stall the expiry batch | Fixed: the matrix row, pgTAP cases, and a meta case (see the code review, finding 1) |
| S12-2 | Major (likely) | A refund marked `failed` may have reached the card (the relay gives up on timeouts or an apply error after a PSP success); the copy told admin to refund by hand, so the customer could be paid twice | Copy fixed: admin first looks for an existing refund of the payment in the PSP panel, and refunds by hand only if there is none; the dialog states the amount. **Carried before G1 (R17):** an admin "retry refund" that re-queues the outbox row, "done by hand" only after that retry, and a refund state that tells "PSP refused" from "outcome unknown" |
| S12-3 | Minor | `expire_windows` keeps held, none or failing rows at the front of its 200 row batch | Carried (R17): order by the effective deadline, skip recent failures, alert on run errors |
| S12-4 | Minor | `cancelPreview` throws on any refusal but `not_found`, which takes down the request page | Fixed: both previews log `cancel_preview_refused` and return null; unit tests |

## Checked and sound (summary)

Refund at most once (unique index, `queue_fee_refund` replay), the amount never an input, outbox key `refund:<id>`,
lock order request → fee → refund, the by hand journal identical to `apply_fee_refunded`'s, no automatic refund after
the reveal (table check and the only path), the carried commission and the earlier pick's card page refused, races
(cancel against payment, expiry against an attempt, suspend in id order), the guards, RLS and grants on
`cancellation_rules` and `deadline_flags`, `search_path` and PUBLIC revoked on every function, `is_admin()` first in
the admin functions, no address in `admin_request_detail`, every action through `guardedAction` with ids and a reason
only.
