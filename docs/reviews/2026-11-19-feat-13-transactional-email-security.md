# Security review: position 13, transactional email

- **Branch:** `feat/13-transactional-email` (PR #45), at commit `40020c4`
- **Reviewer:** the `security-reviewer` agent (Opus), read only
- **Date:** 2026-11-19
- **Spec:** `docs/specs/0011-choose-to-launch/0011-13-transactional-email.md`, with D191 and D192

## Verdict

**Ship.** No confirmed vulnerability. The reviewer found no path that reveals personal data before both fees are paid, no way to cross between providers, no double money posting, and no way for a caller to queue mail for someone else. All seven findings are Minor.

## Findings and what happened to them

| # | Finding | Outcome |
| --- | --- | --- |
| 1 | `lib/relay/email.ts` checks the 25 second deadline only before each claim. A batch of 10 slow sends could outlive the route's 60 seconds and the 2 minute lease, which would burn attempts and could end in `lease_expired`. | **Fixed.** One claim now takes only the rows that can finish inside a 50 second budget at the worst case of 15.5 seconds a row: 3 at most at the start, at least 1. Covered by the unit test of `claimLimit`. |
| 2 | `exception when others` does not catch `query_canceled`, so a statement timeout during the trigger cancels the move. | **Accepted** (R18). A statement timeout cancels the move whether or not the trigger is there. |
| 3 | A pending `confirm_email` row keeps its token while the relay is never kicked. | **Carried** to R18, due before S43. The token is useless after its 24 hour expiry anyway. |
| 4 | 01's check on `profiles.email` accepts characters that Resend refuses. Each refusal is a rejected row and an alert. | **Carried** to R18, due before S43. |
| 5 | The confirmation limit is per profile, in an hourly window. | **Carried** to R18 (later). |
| 6 | The fake driver was refused only on production, so another deployment could write addresses and tokens to a file. | **Fixed.** `lib/deployment.ts` now refuses `fake` on every deployment. The e2e wrapper is a local build, never a deployment. |
| 7 | The sender checks in `lib/deployment.ts` and `lib/env.ts` disagreed. | **Fixed.** Both use the same rule, and a test proves they agree. |

## Missing guardrails

- **The payload shape meta test: added.** pgTAP 29 now proves that every `email.send` payload holds only ids, the template, `send_until` and a token, or a queue failure's id and SQLSTATE. It also proves that only `confirm_email` carries a token.
- **Carried to R18:**
  - an alert when `emails_enabled` is on but the driver is `off`;
  - `email_confirmations` in the anonymisation checklist.

## Checked and sound (summary)

- **Grants:** every new function revokes the defaults and pins `search_path`. Only the two confirmation functions are granted to `authenticated`; only the three relay functions and `claim_outbox` to `service_role`. `email_confirmations` is closed to every API role.
- **The token:** it is generated in Postgres, only its digest is stored, and there is one live confirmation per profile. It is removed on every ending path, an expired lease included. Only the signed in owner can confirm, through a POST; opening the link confirms nothing.
- **The triggers:** a trigger error never undoes a move. Recipients come only from audit rows the server writes.
- **`claim_outbox`:** byte for byte 07's version, apart from leaving out the email kind.
- **What a mail can carry:** `email_context` returns only the recipient's own address, and only once it is confirmed (except for `confirm_email`). It returns no other party's data.
- **HTML and links:** values are cleaned, clamped and escaped. Every link is the origin, a locale and ids.
- **Resend:** only the status and the error name are kept. Logs and telemetry carry ids and codes only, and the `t` parameter is scrubbed from every URL.
