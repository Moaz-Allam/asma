# Security review: feat/19a-trust-quality (spec 0011-19a)

Reviewer: `security-reviewer` (Opus), 2026-11-22, commit `ecae71c`. Written to this file by the author (the agent is read only).

**Verdict: ship.** No Critical or Major. Grants, `search_path`, RLS and deny policies, the replaced bodies (diffed against their last versions), customer exposure through `request_offers`, the provider's own view, admin notes, the suspend path, races and the document reminder were checked and held. No money path changes.

| id | severity | file:line | problem | recommended fix | resolution (D215) |
| --- | --- | --- | --- | --- | --- |
| S-1 | Minor | `supabase/migrations/20261202090000_trust_quality.sql:1103` | The hourly job's per provider `for update` on open flags runs inside a subtransaction, so its row locks last until the whole cron statement ends: an admin handle waits for the run | Accept while AC-16 holds the run under 5 s; else one short transaction per region or batch | Accepted (559 ms at 10,000 jobs); carried in R25 |
| S-2 | Minor (owner decision) | `...trust_quality.sql:1139-1141`, `:1209-1213` | A probation warning after one report lets a provider with under 5 jobs infer which customer reported (as R23 MJ-1; 14's report warning already allows it) | Owner decision: wording that names no job or time, or a delay | Carried in R25 as an owner decision |
| G-1 | Minor | `...trust_quality.sql:16-17` | The lock order (flag, then requests ascending, then provider) is a comment only | pgTAP meta test over function bodies | Carried in R25 |
| G-2 | Minor | `...trust_quality.sql:1004`, `:480` | Deny policies are select only and rely on `revoke all`; a later grant would expose writes | pgTAP privilege check | Fixed: pgTAP 38 asserts no API role holds any privilege on either table |
