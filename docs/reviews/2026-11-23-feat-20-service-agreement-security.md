# Security review, position 20 (service agreement), 2026-11-23

**Reviewer**: `security-reviewer` agent (Opus), read only, on `git diff 5940778 f7bcb4e` (merged as PR #73).
**Recommendation**: fix then ship. S20-1 and S20-2 with negative tests before 21 builds on this; S20-3 in the same follow up migration.

## Findings

| Id | Severity | Where | Issue | Fix | Resolution |
| --- | --- | --- | --- | --- | --- |
| S20-1 | Major | `20261204090000_service_agreement.sql` policy `service_agreements_admin_read` and the `select` grant | Any admin reads every agreement's `content` (street line, both phones) through PostgREST with no audit row; the street line reaches admin only through the audited `admin_request_address` (D197) | Drop the table policy and the grant; admin reads only through `admin_agreements` and `admin_agreement_link` | Fixed in `20261205090000_service_agreement_fixes` (deny policy, no grant), pgTAP negative test |
| S20-2 | Major | `agreement_visible`, `open_service_agreement`, `agreement_read_allowed`, `email_context` | A provider suspended after the reveal keeps the card, the link and the mail; position 10 revokes contacts from a suspended provider (A-5, A-6) | The provider side only while approved, as `contacts_visible` | Fixed: `agreement_side` requires approved standing; the party reads also require `contacts_visible`; `email_context` uses `agreement_side`; pgTAP cases |
| S20-3 | Minor | `provider_fee_settled` calls `queue_agreement` with no exception block | An error there (content over 16 KiB, the sequence past 999999) rolls back the verified payment and the reveal, against AC-5 | A subtransaction; the heartbeat's gap alert covers it | Fixed: `begin … exception when others` around the call; pgTAP proves the unlock survives |
| S20-4 | Minor | `record_acceptance … do nothing` with `pay_commission` demanding the active version | A template change between two attempts strands the customer (the retry offers v1, pay refuses it) | Bind a retry to the stored acceptance | Fixed: once an acceptance exists, `pay_commission` takes exactly that version; pgTAP rotates the template |
| S20-5 | Minor | `admin_rerender_agreement` | A leased slow `-r1` upload can land after `-r2` is queued, leaving an orphan file that can never be deleted | Refuse a re-render while a render row is pending or leased | Fixed: `invalid_state` while an `agreement.render` row is `pending` or `claimed` |
| S20-6 | Minor | `agreement_visible` (7 days from the render) | If admin lowers `contact_visible_days` below 7, the PDF outlives the contacts window | Also require `contacts_visible` | Fixed with S20-2 |
| S20-7 | Minor | `app/[locale]/(account)/agreement/[version]/page.tsx` | `decodeURIComponent` throws `URIError`: a 500 and a Sentry event per hit | try/catch and `notFound()` | Fixed |

## Missing guardrails

| Item | Resolution |
| --- | --- |
| Lint fence: `lib/storage/agreements` and `lib/agreements/render` imported only from `lib/relay/**` | Added to `eslint.config.mjs` with proofs in `tests/lint/eslint-rules.test.ts` |
| pgTAP: no plain admin SELECT on a table holding the street line | Covered by the S20-1 negative test |
| pgTAP: `queue_agreement` failing still unlocks | Added (S20-3) |
| `storage.objects` has no truncate guard; owner bypass through `session_replication_role` is inherent | Recorded: "owner included" means short of a superuser override |
| Logs carry the agreement id under `request_id` | Left as is (the log door has no free id field); noted for a later log door change |

## Checked and sound

Rule 2 at the reveal; no other provider reaches an agreement; the acceptance inside the pay transaction and the provider bound to the customer's template; append only guards; storage reads (party after its open, admin after its audit row); every definer function's `search_path`, revokes and caller checks; rule 8 (one pass substitution, unknown fields throw); no personal data in outbox payloads, logs, alerts or PDF metadata; idempotent finish, mail keys and hash checked uploads; pdfkit pinned without install scripts.
