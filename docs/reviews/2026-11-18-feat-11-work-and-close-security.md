# Security review: feat/11-work-and-close

2026-11-18 · `security-reviewer` on Opus, read only, on `feat/10-provider-fee-reveal...HEAD` at `5c337cf`. Spec 0011-11
(D180). The agent had no write tool; its findings were saved here by the author session, in substance as given.

**Counts:** Critical 0 · Major 1 · Minor 4 · Info 5. **Recommendation: fix then ship** (S11-1; S11-2 and S11-4 in the
same migration).

## Findings

| id | sev | where | finding | fix | resolution |
|---|---|---|---|---|---|
| S11-1 | Major | `provider_jobs` | The request's state and work times went to every application row of the caller, so a losing or past pick learned the winner's progress (rule 2: no provider reads another provider's data). No PII | Gate the fields on the caller's own selected, unlocked application | Fixed: `request_status`, `actual_started_at`, `confirm_deadline`, `closed_at` and `can_start` only when the row is the caller's own unlocked pick; pgTAP 25 proves a losing provider sees nulls |
| S11-2 | Minor | `job_for_provider` | The request row was locked before the caller was checked: any signed in user could hold a lock on a known id | The authorization in the locking query | Fixed: `for update of r` only where the caller is the selected, unlocked provider |
| S11-3 | Minor | `auto_close_jobs` | Every failure swallowed with no trace | Report it | Fixed: `raise warning` with the request id and SQLSTATE only; a counter and alert go with the heartbeat in 21 (R16) |
| S11-4 | Minor | `requests` checks | Nothing tied a state to its columns | Two checks | Fixed: `AWAITING_CONFIRMATION` needs `confirm_deadline` and `actual_completed_at`; `IN_PROGRESS` and later need `actual_started_at`; pgTAP |
| S11-5 | Minor | pgTAP 25, 26 | Row counts only; `status_changed_at` on one function; no suspended-after-Started case; locked row taken next run untested; S11-1 untested | Add | Fixed in part: an md5 checksum of the four money tables; `status_changed_at` on Done; a provider suspended after Started cannot finish; S11-1's case. "Taken next run" stays covered by `skip locked` semantics in 26's first order (carried, R16) |
| S11-6 | Info | `contacts_visible` | Contacts last while a job sits in `UNLOCKED`/`IN_PROGRESS` | 12 flags, 16 closes | Carried: 12's deadline flags (AC-11) and 16's admin close |
| S11-7 | Info | `finish_job` | Started and Done at once could fabricate a finished job once the auto close is on | 14 | Carried to 14 (the auto close stays off until then, R-2) |
| S11-8 | Info | request page timeline | A customer close from `IN_PROGRESS` read "Confirmed" | Use `confirm_deadline` | Fixed (code review F-3) |
| S11-9 | Info | `job_confirmed` | `by` sends `confirm`/`mark_done`, AC-10 says `customer` | Align | Kept the more useful value; AC-10 amended |
| S11-10 | Info | `config.toml`, e2e temp files | Test OTP numbers would turn on in the cloud by a `supabase config push`; temp SQL files not deleted | A check; cleanup | Carried (R16): an existing pattern for every position |

## Missing guardrails (carried, R16)

A meta pgTAP for provider facing definer reads (any `requests` field gated on the caller being the selected provider);
the money checksum as a shared helper for later positions.
