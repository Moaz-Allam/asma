# Security review: feat/16-admin-operations (PR #54)

Reviewer: `security-reviewer` agent (Opus), 2026-11-20, on `2b3c792`. Verdict: **ship**. Nothing exploitable: no PII
before the reveal, no double money movement, no non admin path into any new function.

| id | severity | finding | resolution |
| --- | --- | --- | --- |
| M-1 | Minor | `cancel_by_rule`'s `p_meta` merged after the computed keys could overwrite `status`, `fee_refund_id` and the outcomes in the append only audit row (no caller does today) | Fixed: `p_meta` merges under the computed keys; pgTAP 33 proves it adds keys but never changes the outcome |
| M-2 | Minor | The guard carve outs required the allowance unused, not spent, so "once per pick" was enforced only by the function; the confirm allowance had no 48 hour band | Fixed: the allowance is spent first and the guards require it spent in the same transaction (`= now()`); the confirm move is held to the band; pgTAP 33 covers an allowance spent earlier and a 49 hour confirm move |
| I-1 | Info | The street line has no time window and no bulk view alert | Carry over (R21): an alert on many `request.address_viewed` rows per admin per hour; the time window is the owner approved X-13 path |
| I-2 | Info | `dayFrom` accepted year 0; a huge `page` overflowed int4 | Fixed: years from 2000; pages clamped to 10000 in the door |
| I-3 | Info | `admin_revenue` and `admin_requests` scan their tables | Carry over (R21): prefilter `created_at` in UTC, an index on `ledger_entries(created_at)` |
| I-4 | Info | More fixed test OTPs in `supabase/config.toml` | Carry over (R21): a guard refusing `supabase config push` while test OTPs exist (existing pattern since 01) |
| I-5 | Info | An admin cancel after the reveal leaves an open report open | Carry over (R21): show the cancel on the report, or close it with the cancel |
