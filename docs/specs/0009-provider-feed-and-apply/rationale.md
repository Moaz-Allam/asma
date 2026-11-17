# 0009. Provider feed and apply: rationale

Decision record for [index.md](index.md). `/develop` skips this file.

## Context

Position 04 lets a customer post a request: a service, a district (zone), a start time, a fixed price computed on the
server, structured and typed answers, optional notes, and an exact address in its own table. After 04 nobody but the
customer and admin can read a request. Position 05 is the first time another party, a provider, reads part of it, so it is
the first real test of the rule that contact details stay hidden until both fees are paid (rule 2) and that no provider
reads another provider's data.

The threat is not the provider page. It is a provider with a real token calling `/rest/v1` directly, reading a table, or
calling any granted function with crafted inputs. Anything a row policy exposes, a provider can select column by column.
Free text is the hard part: the notes and the `text` and `textarea` answers can carry a street, a landmark or a name the
contact scanner cannot recognise, and the apply message can carry a phone number written in ways the scanner has to catch.

02 left one answer for 05 (`provider_can_apply`) and moved the services, districts and work days step (`p4`) here because
zones and services did not exist until 03 (D111). The build plan asks for a zone filter, a cap on offers per request, a per
provider rate limit, and rivals blind to each other. The launch is 2026-11-20 with no buffer (R2), so every extra field
on the design costs schedule.

Nothing in 05 moves money. The provider fee settings arrive in 07, `outbox_events` in 07, email in 13, the in app centre
in 18.

## Options considered

### How a provider reads a request

**Option 1: a row policy on `requests` for covered providers, with column grants.** Pros: plain selects, little SQL.
Cons: column grants are per role, not per row, so a provider would hold the same column set as the customer's own read
path, or the customer path would need its own function; a future column is visible by default; filtering `answers` by
question type cannot be done with a grant.

**Option 2: a view with `security_invoker = false` exposing named columns.** Pros: a fixed column list, queryable.
Cons: a definer view bypasses RLS for every caller, so the coverage filter must be written into the view and kept equal
to the apply check; Supabase advisors flag definer views; filtering answers by type is awkward in a view.

**Option 3 (chosen): two definer functions, `provider_feed` and `provider_request`.** Pros: a fixed, reviewed column list;
coverage, state and answer filtering in one place the apply function can share; no grant on `requests` changes; 04's
AC-17 is honoured as written. Cons: pagination and filters are hand written in SQL; some reading logic overlaps 04.

### What the short details contain

**Option 1 (chosen): structured only.** Choice, number, yes or no, date and time answers by label; never typed answers,
notes or address. Pros: nothing free form leaves the database before the reveal. Cons: a provider loses detail that notes
would give ("there is a cat"); the brief's "plus service notes" is read as the catalog `services.note`, which 05 shows on
`p4` only.

**Option 2: structured plus notes.** Pros: matches design `p8`; 04 already refuses notes the scanner flags. Cons: the
scanner cannot catch a street or landmark; notes are personal data under KVKK.

**Option 3: minimal.** Service, district, dates, price. Pros: least exposure. Cons: providers cannot judge the size of a
job; more wasted applications.

### How an application is written

**Option 1 (chosen): `apply_to_request`, a definer function, is the only write.** Pros: the scanner keeps no API grant
(02 AC-3); every check runs in one transaction under one row lock, which also gives the cap its race safety; matches 02
and 04 where all writes go through definer functions. Cons: departs from the build plan wording ("`provider_can_apply()`
in the insert policy"); the policy survives only as defence in depth on a table no role may insert into.

**Option 2: direct insert with RLS `with check` and a before insert trigger.** Pros: the build plan's wording, literally.
Cons: the trigger has to run the scanner, the cap and the rate limit, and return errors through exceptions, which roll
back the rate count, so scanner probing would be free; the cap needs its own lock in the trigger; two places to keep equal.

### What gates applying

**Option 1 (chosen): standing plus coverage plus region.** Work days and hours only sort the feed. Pros: providers can
stretch for a job; the feed stays honest about fit. Cons: a provider may apply outside the hours they listed.

**Option 2: work days and hours as a hard gate.** Pros: stricter fit. Cons: a provider who could come at 8 instead of 9
loses the job; a time zone edge becomes a refusal.

**Option 3: standing only.** Pros: simplest. Cons: a direct link lets a provider apply to any service and district,
which makes the setup step meaningless.

### How the setup step relates to approval

**Option 1 (chosen): setup gates applying only.** Pros: no change to 02's merged flows; editing services never sends the
file back to review, as the design says. Cons: admin approves without seeing services and districts.

**Option 2: setup as step 3 before review.** Pros: admin sees the full picture. Cons: reopens 02's submit and its tests;
providers already approved need a migration path.

**Option 3: required before approval only.** Pros: middle ground. Cons: same reopening of 02's approve check.

### Rate limit store

**Option 1 (chosen): an own `apply_counters` table copying 04's `quote_counters`.** Pros: proven pattern, no change to
04's schema. Cons: two near identical tables.

**Option 2: one shared `rate_counters (user_id, action)` table.** Pros: one table. Cons: changes 04's schema before it
has merged; a wider key on every quote.

## Rationale

Correct private data comes before the journey (D42), so the read path is the one place 05 refuses to be clever: two
functions with a column list that a reviewer can read in one screen, and the jsonb key set asserted in pgTAP. Structured
only short details follow from the same priority. The scanner is defence in depth, not a guarantee (old feature 11), so
free text waits for the reveal. Providers still get what they need to decide: service, district, the dates, the price,
the cash they collect and the choice answers that drive the price.

The write path follows the project's own precedent: 02 made `has_contact_info` callable only from definer functions so it
cannot be probed, and 04 put every write behind a definer function. One locked transaction makes the cap race free and
lets the scanner refusal return data instead of raising, so the rate count commits and probing costs the prober. The
build plan's policy wording is kept as a policy, but the real gate is the function; this deviation is recorded as D148.

Setup gating applying only keeps 02 closed, which matters four days before launch. The design's extras (application
questions, a proposed start, an offer preview, a tools tick, "from" prices) are not in the brief, so the scope rule says
leave them out and log them (D152).

The cancel change belongs here because 05 creates `applications`: without it a cancelled request would keep `APPLIED`
offers forever. Taking the same row lock in apply, cancel and (later) choose is the simplest correct ordering.

`/provider/setup` as its own page is a call made while writing (runner up: a section of `/provider/profile` as the
design's URL suggests). The profile's edits send the file back to review and the setup's never do; one page per rule keeps
that clear to the provider and to the code.

## Calls made while writing

Owner answers, 2026-11-16, in four rounds:

| # | Question | Answer |
| --- | --- | --- |
| D146 | What leaves the database before applying | Structured only: service, district, dates, price, addons, choice answers; never typed answers, notes or address |
| D147 | Money on `p8` and `p10` | Job price and the cash to collect; "provider fee due only if chosen" with no figure until 07 and 10 |
| D148 | Write path | `apply_to_request` definer function only; insert policy kept as defence in depth with no insert grant |
| D149 | What blocks an apply | Standing (`provider_can_apply`), service and zone in setup, same region; work days and hours only sort the feed |
| D150 | Cap and rate limit | `max_applicants_per_request` start 10 (1 to 50), full requests greyed; own `apply_counters`, `applications_per_hour` start 20 (1 to 1000) |
| D151 | Setup and approval | Setup gates applying only; edits never send back to review; suspended reads only |
| D152 | Design extras and message | Extras left out (application questions, proposed start, offer preview, tools tick, "from" prices); message required, 20 to 600 |
| D153 | Scanner on the message | Refuse on submit with `contact_info_in_message`; no live check |
| D154 | My applications | Read only list in 05; `/provider` gets counts; withdraw stays in 12 |
| D155 | Replay, cancel, notification, feed order | A repeat returns the stored application; `cancel_request` cancels `APPLIED` rows under the shared row lock; no event in 05; feed soonest first with an "outside your hours" divider |

Data model confirmed by the owner in round 4.

Recommended and settled while writing (runner up in brackets): `/provider/setup` as its own page (a section of
`/provider/profile`); a refused message counts against the rate limit (count only successes); `not_found` for an
uncovered request so ids cannot be probed (a distinct `not_covered` code); the `APPLIED` count, not all rows, against the
cap (every row ever); a pick admin turns off stays until the next save (delete it at once); week start by locale in the
date chips (always Monday); the scrubber key `application_message` (a bare `message`, which would erase error messages).

## Cross check

2026-11-16, Sonnet, fresh context, read only: 20 findings (4 Major, 16 Minor), every recommended fix applied on the
owner's pick. Majors: (1) the two read functions had no standing check, so a provider under review could read jobs by
direct call; now `approved` with a complete setup, plus own applications in any standing; (2) the outside hours divider
broke keyset paging; the key is now `(outside_hours, scheduled_start_at, id)`; (3) AC-3 and the failure list disagreed on
inactive picks; stored picks now keep covering, and "setup complete" counts active picks only; (4) a Server Action body
has no keys, so AC-20 now forbids any request body on Sentry events and proves it with a test. Minors: timezone returned
by the feed and `[p_from, p_to)` dates; the answer shape; stale picks left out by the form; a lock on `providers` in the
setup save; filters intersected with the setup; replay copy by status; a standing by page table; home count rules; start
only hours test; the lock order written down; AC-19 reworded and explicit revokes from `anon`; alerts from page reads;
04's cancel tests pinned and the re-pick rule handed to 06 and 12; no minimum lead time recorded.
