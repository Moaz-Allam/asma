# Security review: position 18 (notification centre), `feat/18-notification-centre`

**Reviewer**: `security-reviewer` on Opus, read only, adversarial, 2026-11-22. **Spec**:
[0011-18](../specs/0011-choose-to-launch/0011-18-notification-centre.md). **Verdict**: fix then ship.

Checked and sound (summary of the reviewer's list): the table (RLS, one own row policy, every API role revoked, the
read once guard); every function pins `search_path` and revokes all roles, only the four readers and writers are granted,
each scoped to `auth.uid()`; `audit_notices` matches 17's mail map branch for branch; failure rows carry ids and the
SQLSTATE only; no deadlock cycle with the report and email functions; the ping carries `{}` on a topic built from the
server's `recipient_id`; the policy compares exact text, refuses a null uid, reads broadcast only, and has no insert
policy; private database broadcasts never reach a public channel of the same name; links are relative paths built on
the server from checked uuids; no telemetry carries notice data; the CSP already allows the Supabase `wss:` origin.

## Findings and resolutions

| # | Severity | Finding | Resolution |
| --- | --- | --- | --- |
| 1 | Major (privacy) | `rating_received` stored the request and application ids and its line named the service, undoing 17's M-1 (D207): with the summary delta, a provider could tie a score to a named customer | Fixed: `queue_audit_notices` writes `rating_received` with null request and entity (mail parity untouched, the mail blanks them at send time); the line has no placeholder in ar, tr, en; pgTAP asserts the null ids; a unit test lists the kinds that may never name the service |
| 2 | Low to Medium | Another permissive policy on `realtime.messages` would add up with ours | Fixed: pgTAP asserts ours is the only policy where the table exists; after the cloud push the policy list is read back (S45) |
| 3 | Low | A lock wait in the ping (Realtime's partition work) could run into a statement timeout, which no exception block catches, and cancel the move | Fixed: `set lock_timeout = '250ms'` on `audit_log_notice`, `applications_offer_notice` and `notifications_ping`, so a wait raises 55P03, which their blocks catch; pgTAP checks the three `proconfig` entries |
| 4 | Low | Two opens at once: the second update hit the guard (`invalid_update`) | Fixed: `open_notice` updates only `where read_at is null` (also the code review's top Minor) |
| 5 | Low | Every signed in tab now runs the browser client's token refresh beside the proxy | Accepted and watched: the browser client already refreshes on the pages that used it, Supabase tolerates concurrent refreshes inside its reuse interval, and a long open channel needs the refreshed token. Carried in R24: watch the Auth logs for `refresh_token_already_used` |
| 6 | Low | A refused join retried every 10 s forever, each retry a policy check | Fixed: `live.ts` removes the channel after 3 `CHANNEL_ERROR` replies |
| 7 | Info | Cascade foreign keys and the policy name differ from the spec | Spec amended (As built, D210) |
| 8 | Info | The rating invite now reaches every customer in app, mail or not, including after a report the provider filed (R23 I-2) | Carried: the owner's open R23 decision now covers both channels |

## Missing guardrails and resolutions

- The policy as the only one: added (item 2).
- The policy did not check the row's `topic`: added `and realtime.messages.topic = 'notices:' || auth.uid()` (Realtime's
  join check inserts a row with the joined topic, so joins still work; the e2e proves it).
- A `{service}` allowlist: added (item 1).
- A lock timeout meta test: added (item 3).
- The Realtime door lint rule: added now, not later. Only `lib/notifications/live.ts` may use `.realtime`, `.channel(` or
  `.removeChannel(`; five proofs in `tests/lint/eslint-rules.test.ts`.
- `FormInput = z.unknown()`: now `z.instanceof(FormData).or(z.undefined())`. A meta test that every `guardedAction`
  schema is strict is out of 18's scope: carried in R24.
- S45 at the merge: the owner step says "at the merge" (it is a dashboard switch; no tool here can flip it).
- Six more fixed test codes in `supabase/config.toml`: the guard refusing `supabase config push` while test numbers
  exist is still owed (R21 I-4).
