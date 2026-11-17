# Review: position 10, provider fee and mutual reveal

Branch `feat/10-provider-fee-reveal`, `git diff master...HEAD` (3 commits). Reviewer: fresh Sonnet pass with the slice
reviewer checklist. Read only: no tests or database commands were run; the author's local results (verify 1235, pgTAP
1964, e2e 10 and 09) are taken as given. Spec: `docs/specs/0011-choose-to-launch/0011-10-provider-fee-reveal.md`,
rules R-1 to R-15 win over ACs.

## Verdict

No Blocker, no Major. The reveal is enforced in the database twice (`contacts_visible` behind `request_contacts` and
the `request_addresses` policy), all lock orders start at the request row, the guards are widened exactly as R-5 and
R-6 say, and the three locale catalogues have the same keys. Findings below are Minor or Nit.

## Findings

| Id | Severity | File:line | Finding | Fix | Resolution |
| --- | --- | --- | --- | --- | --- |
| F-1 | Minor | `supabase/migrations/20261122090000_provider_fee_reveal.sql:402`, `lib/requests/checkout-page.ts` (provider branch of `canRetry`) | `pay_provider_fee` only refuses at `fee_deadline`. In the R-15 overrun (after `scheduled_start_at`, before `fee_deadline`) a direct action call opens an attempt and the card is charged, then `accept_provider_fee` (line 258) refunds it as late. The Chosen tab hides Pay there (`least(...)`), but the action and Try again on the pay page do not. AC-2 step 4 names `fee_deadline` literally, so this is a product call, not a spec breach. | Refuse `deadline_passed` when `now() >= least(fee_deadline, scheduled_start_at)` in step 4, and make `canRetry` use the same bound (add the capped value to `my_checkout`). Or record the overrun as accepted. | Fixed with S10-1: the database refuses at `least(fee_deadline, scheduled_start_at)` |
| F-2 | Minor | `context/progress-tracker.md:284` | AC-15: the R6 row still reads "planned". The spec says R6's reveal item closes as built, with the note that replay masking and a replay test are owed only if replay is ever enabled. The diff adds D178 but does not touch R6. | Edit the R6 row (reveal item done, `data-pii` marker only, note on replay) in the tracker update. | Fixed: R6 closed in the tracker with the replay note |
| F-3 | Minor | `app/[locale]/(customer)/requests/[id]/page.tsx` (timeline block for `revealed`) | AC-11 says "Provider fee" is done and "Contacts shared" is current. Both steps are pushed with `done: true`, so nothing is current. | Mark the contacts step as the current one (or done only after a later status), matching the other steps' convention. | Kept: the timeline has no "current" style; "Contacts shared" is shown done, which is true once revealed |
| F-4 | Minor | `app/[locale]/(provider)/provider/applications/page.tsx` (`tab === 'active'` block) | One `request_contacts` call per row, up to 20 per render. Each is volatile and takes the request row `for share`. Correct, and the audit row is once per side, but it is 20 round trips on a PII page. | Acceptable for launch volume. If it grows, add a set returning variant or cap Active at fewer rows. | Kept: at most 20 reads on the Active tab, each one indexed definer call; revisit if slow (R15) |
| F-5 | Minor | `tests` (pgTAP 23 and 24) | R-14 asks for "a provider replaced after a stale read gets nothing". I found no case with that intent in `23_provider_fee_reveal.test.sql`; `24_reveal_races.test.sql` covers two pays and apply against a suspend. | Add the stale read case, or confirm 24 covers it and name it. | Carried to 12, which builds the re-pick (R15) |
| F-6 | Minor | `e2e/provider-fee-reveal.spec.ts:23` | AC-14 lists "a provider fee of 0" in the e2e. The spec header says it is proven in pgTAP only. | Add a short zero fee journey, or amend AC-14 to say pgTAP. | Kept in pgTAP 23: a fee of 0 needs the region fee settings at 0, which a parallel e2e run must not change |
| F-7 | Nit | `supabase/migrations/20261122090000_provider_fee_reveal.sql:494-495` | `contacts_visible` runs inside an RLS policy. When `closed_at` is set (11, 12) and the `contact_visible_days` setting is bad, `contact_settings` raises and every `request_addresses` read by a party errors, not just the reveal. `closed_at is null or ...` relies on left to right evaluation. | Read the setting inside a `case when closed_at is null then true else ... end`, and decide whether a bad setting should hide (return false) in the policy path. | Fixed: `contacts_visible` hides on a missing setting; `request_contacts` names it to a party only |
| F-8 | Nit | `app/[locale]/(payments)/receipts/[feeId]/page.tsx` | The provider fee receipt links to `/provider/applications?tab=active` whatever the fee status. A refunded (late) fee leads to Active, where nothing is. | Link to `chosen` unless the fee is `paid`, as `CheckoutWaiter` does. | Fixed: a refunded provider fee receipt links to Done |

## AC coverage

| AC | Status | Evidence |
| --- | --- | --- |
| AC-0 | met | Migration builds on `open_fee`, `start_checkout`, `apply_fee_paid` hooks as described; pgTAP 23 header. |
| AC-1 | met | Columns, `requests_closed_at_terminal`, `applications_unlocked_at_*`, setting seeded for TR and KSA, row check, guard required key, `contact_settings` alerts via `contact_settings_invalid`. |
| AC-2 | met (see F-1) | `pay_provider_fee` steps 1 to 11 in order, zero path at step 5, one audit row for a new attempt, grant to `authenticated` only. |
| AC-3 | met | `accept_provider_fee` checks each listed condition, including R-15 and a missing hold setting raising. |
| AC-4 | met | `provider_fee_settled` called by both the hook and the zero move; R-8 and R-12 applied; guards widened. |
| AC-5 | met | `request_contacts` per side, `not_found` otherwise, window and unlocked_at in `contacts_visible`. |
| AC-6 | met | `request_addresses_read_unlocked` uses the same helper; pgTAP for before, after, window, stranger, anon. |
| AC-7 | met | Unique partial index plus `on conflict do nothing`; wa.me link built in SQL with digits only. |
| AC-8 | met | `payProviderFee`, `listJobs`, `loadContacts` with strict schemas; `payProviderFeeAction` is provider only; `checkoutStatusAction` takes both roles; R-13 unit tests. |
| AC-9 | met | `(payments)` group, `guardPage(['customer','provider'])`, retry by `fee_kind`, back links by role (F-8). |
| AC-10 | met | Four tabs on `/provider/applications`, `provider_jobs` with the R-11 sets and cursor, deadline in region time zone, agreement line, Pay or Continue, ended message. |
| AC-11 | partial | Offer card and waiting line kept; contact card shown in `UNLOCKED`; timeline steps added but "Contacts shared" is not current (F-3). |
| AC-12 | met | `ContactCard` in `data-pii`, `rel="noopener noreferrer"`, unconfirmed label, null email hides the row; `no-store` asserted in e2e (lines 274, 288). |
| AC-13 | met | `contacts_unlocked` typed with `side` only, once per session and request; `payment_started` carries the fee kind; scrubber test added. |
| AC-14 | partial | pgTAP 23 and 24, unit tests and e2e exist; missing the stale read case (F-5) and the zero fee e2e (F-6). |
| AC-15 | partial | Marker built; the tracker row is not closed (F-2). |
| AC-16 | met | e2e signs in on `localhost` like the commission spec. |
| AC-17 | met (deferred by design) | Joins 09's S37 window; no code owed. |

## Rules that never bend

Rules 1 to 11 hold on the diff: no price from the client, contacts gated in SQL by `unlocked_at` and standing, no
external call outside the relay, no float money, no update grants on `applications` or `requests` (meta test), RLS
policy and negative tests in the same migration and commit, three locales with matching keys, logical properties, and
the single doors (`lib/provider-feed`, `lib/requests`) are used for every new call. Not run by me: lint, RTL lint.
