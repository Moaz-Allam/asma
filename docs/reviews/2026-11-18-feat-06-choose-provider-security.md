# Security review, feat/06-choose-provider, 2026-11-18

**Reviewed by**: `security-reviewer` agent on Opus (read only)
**Scope**: branch vs `feat/05-feed-apply`: migration `20261118090000_choose_provider`, pgTAP 16 and 17, `lib/requests/`, `actions/requests.ts`, the request page and its components, the provider pages
**Verdict**: fix then ship. One Major (S1), fixed in this branch.

| id | sev | where | finding | fix | kind | resolution |
| --- | --- | --- | --- | --- | --- | --- |
| S1 | Major | `message_has_contact_info` | 9 figures plus 2 spelled digits, split by words, passed both rules, so a phone could reach the customer before the fees | Count spelled digit words toward the 10 | Abuse, reveal | fixed: figures and spelled digit words count together (the everyday words for "one" excluded); the mixed message is in the pgTAP 16 corpus |
| S2 | Minor | `request_offers` chosen card | A chosen offer keeps its message after the provider is suspended | Hide it when suspended | Reveal | fixed: hidden once the chosen provider is not approved (pgTAP 16) |
| S3 | Minor | `offer_display_name` | Split only on spaces; an invisible mark kept a full name whole; a phone in the name showed | Split on the blank class; null on a scanner hit | Reveal | fixed, two pgTAP 16 cases |
| S4 | Minor | `contact_normalise` | Only Arabic Indic and Persian digits fold to 0 to 9; other decimal scripts slip past | Map every decimal digit block | Abuse | deferred, R12 (low risk for TR and KSA readers) |
| G1 | Guardrail | `applications` | Nothing in the database holds one `SELECTED` per request | Partial unique index | DB constraint | fixed: `applications_one_selected_idx` (pgTAP 16) |
| G2 | Guardrail | `requests` | `payment_deadline` not held after `selected_at` | A check | DB constraint | fixed: `requests_payment_deadline_after_choose` |
| G3 | Guardrail | `tests/requests-helpers.test.ts` | Read a fixed migration file | Read the newest definition | Meta test | fixed: reads the newest migration that defines `blank_class()` |
| G4 | Guardrail | none yet | No admin redaction of a message, no metric of refusals | Count refusals, alert | Monitoring | deferred, R12 (leakage monitoring, old feature 24) |
| I1 to I6 | Info | migration, doors, pages | `catalog_text_ok` as definer is safe; F2 and G1 of 05 closed; ownership, lock order, grants, key sets, scrubbing checked | none | Sound | none |
