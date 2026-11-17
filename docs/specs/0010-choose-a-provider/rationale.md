# 0010. Choose a provider: rationale

## Context

Position 05 lets approved providers apply to open requests with a message. The customer cannot see those
offers yet: no customer read of `applications` exists, by design (0009 AC-18). Position 06 is the first
time a customer reads provider written text and the first transition out of `OPEN` other than a cancel.

Fixed inputs from the brief and the decision log, not reopened here:
- Lifecycle `OPEN → SELECTED`, the chosen application `SELECTED`, the rest `NOT_SELECTED`, a
  `payment_deadline` that starts at the choose (default 24 hours), and applicants restored if the request
  reopens (project-overview §8, §21, §22).
- `SELECTED → CANCELLED` by the customer, nothing paid, nothing refunded (§36 row 2).
- Contact details open only when both fees are paid (rule 2), so a choose opens nothing.
- Lock order: request, provider (shared), counters, applications (D155, D156).
- The 05 security review owes two fixes before a customer reads messages (R11): the scanner can be beaten
  by spacing a phone number's digit groups apart with words, and by invisible marks the normaliser keeps;
  and a suspended provider's offer still holds a cap slot.

The owner asked (2026-11-17) that the design follow the existing documents without a new survey. The two
answers given in chat before that: the offer card shows the first name, the family initial, chips and the
message (no photo); the customer may choose until the start, and the deadline is capped by the start.
Suspended providers' offers are hidden, not choosable, and freed from the cap.

## Options considered

### How the customer reads offers

1. **A definer function with a fixed field list** (chosen). Pros: names and fields are picked on purpose; a
   new column on `applications` or `providers` stays hidden; the standing filter lives in one place. Cons:
   one more function to keep in step with the page.
2. **An RLS policy on `applications` for the request's customer.** Pros: no function, PostgREST reads it.
   Cons: the provider's name lives in `providers`, which customers must never read whole, so a second policy
   or a view would leak more columns; the standing filter would sit in a policy, run per row.
3. **A view with `security_invoker` off.** Pros: simple select. Cons: Supabase flags definer views; the
   advisor gate in CI fails on it.

### What happens to the other offers

1. **`NOT_SELECTED` at the choose** (chosen, from §8 and §22). Pros: every provider sees the truth at
   once; the feed and the cap are simple. Cons: 12 must restore them when the request reopens.
2. **Keep them `APPLIED` until the commission is paid.** Pros: no restore step. Cons: rivals see "waiting"
   on a request that is taken; contradicts §22.

### The scanner gap

1. **A whole message digit rule, messages only** (chosen): 10 or more digits anywhere refuses. Pros: a
   phone number needs 10 digits however it is split; bios, notes and answers keep today's rule, so no new
   false positive there. Cons: some honest messages with many numbers are refused; spelled digit runs
   split by words still pass.
2. **Count spelled digits too.** Pros: closes the spelled gap. Cons: "bir" (one, also "a") and "one" are
   everyday words; Turkish messages would be refused constantly.
3. **Show messages only after the reveal.** Pros: no channel at all. Cons: the customer chooses blind; the
   message is the main way a provider wins work (D152).

### The deadline

1. **`least(now + window, start)`** (chosen in chat). Pros: never past the job. Cons: a late choose leaves a
   short window.
2. **A cutoff before the start.** Pros: always time to pay. Cons: a new setting and lost late jobs.

## Rationale

Definer functions keep the rule that every provider and customer read of the other side passes a fixed
field list, as 05 did for requests; the advisor gate and the lock order both stay intact. `NOT_SELECTED`
at the choose follows §22 word for word. The digit rule is the smallest change that closes the split
phone path the review found, and scoping it to messages keeps the bios, notes and answers corpus of 0006
and 0008 untouched. One `blank_class()` removes the drift the review called the root cause (G1). The
deadline cap means the commission is always due before the job's start, so 09's provider window and 11's
start deadline never have to handle a payment that falls after the work began.

## Cross check (Sonnet, 2026-11-17)

Seventeen findings, all applied on the owner's pick: the full return shape of `request_offers` (with the chosen offer
kept after a suspension); the confirm dialog shows the window in hours, not an estimated time; the 04 and 05 pgTAP
cases 06 changes are named (AC-19); 05's strict schemas gain the two keys; `contact_normalise` strips the marks of the
blank class but keeps whitespace, so word gaps and the old corpora hold; the unlocked read of the application before
the provider lock is stated safe; the three request columns are written once, on the choose; both choose paths return
one shape; older messages a new rule would refuse are hidden from the customer; one cap helper; the display name edge
cases; `approved_since` in the region's time zone; the setting in both regions; the real old status in the cancel
audit row; the suspended chosen provider stated as a tradeoff; the migration name; and a note on `provider_standing`.
