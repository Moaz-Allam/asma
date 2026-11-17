# Verify: Choose a provider (06) · spec 0010

_Steps derived from the spec's acceptance criteria and its Value sourcing table. `/check verify` runs these; `/test` locks
the durable ones. Test data only; never paste a real phone number, address, token or message here._

## Message corpus, the whole message digit rule (AC-12)

Everything in 0009 `verify.md` (and through it 0006) still holds through `apply_to_request`. Added:

**Must catch (added)**

| Kind | Text |
| --- | --- |
| Phone split by words | `call 0555 when you can, I am free on 123 most days, then 45 and 67 is fine` |
| Phone split by long words | `Numaram sıfır beş beş beş, sonra uzun bir ara 1234567 tamam` |
| Phone padded with invisible marks | `0555` + U+2800 × 25 + `123` + U+3164 × 25 + `4567` |
| Ten digits across a sentence | `0 5 5 5 hello there my friend 1 2 3 4 5 6 and more` |

**Must pass (added)**

| Language | Text |
| --- | --- |
| English | `I can start at 10:30 on the 21st with 2 people; about 3 hours.` (7 digits) |
| Turkish | `25 Kasım 09:00'da başlarım, 3 oda 2 banyo için 4 saat yeter.` (9 digits) |
| Arabic | `أبدأ يوم 25 الساعة 9 مع 2 من الفريق، والعمل 3 ساعات.` (5 digits) |

**Known false positives, accepted:** 10 or more digits refuse even when honest, such as `since 2015, 40 villas, 120 m2, 3 floors`
or a full date and time like `25.11.2026 saat 09:00`.
The refusal copy already asks to remove numbers that look like a phone.

## On the local stack

Fixture: one customer with two `OPEN` requests (R1 with three offers: A and B approved, D suspended; R2 with none),
another customer, a provider token, admin.

- [ ] `npm run db:test`: files 16 and 17 green, every earlier file still green → AC-5, AC-7, AC-11, AC-13 to AC-15, AC-18, AC-19
- [ ] As the customer: R1 shows "2 offers", A and B with first name and initial, "Verified", "On Aldebyani since", the
      message; D's offer is absent; no full name, phone or photo in the page source → AC-1 to AC-3, AC-5
- [ ] As the customer: R2 shows the no offers state → AC-4
- [ ] An offer stored before 06 with 10 or more digits shows "Message hidden" → AC-13
- [ ] Choose A: the dialog shows the commission, the cash due and the window in hours; after confirm the page shows
      `SELECTED`, A's card, the next step panel with the stored deadline in `Europe/Istanbul`, and the timeline → AC-6, AC-9, AC-10
- [ ] A request starting in 5 hours: the stored deadline equals the start, not now + 24 hours → AC-7 (Value sourcing)
- [ ] As A: `p8` and My applications read "Chosen" with the deadline; the home shows the third card. As B: "Not chosen" → AC-12
- [ ] As the customer: cancel R1 in `SELECTED`; A's application reads "The customer cancelled" → AC-11
- [ ] As another customer: `/requests/<R1>` is 404 → AC-2
- [ ] As a provider: `/requests/<R1>` sends you away → AC-15
- [ ] Network tab during choose: the body carries only the two ids; PostHog gets `provider_chosen` with no property → AC-16
- [ ] 360, 390, 430 and 1280 px in `ar`, `tr`, `en`: no overflow, RTL mirrored, `npm run lint:rtl` clean → AC-17
- [ ] e2e `choose-provider.spec.ts` green in three locales → AC-20

## Real calls (a preview on the shared cloud project, after the migration push)

- [ ] Cloud lists the migration; security advisors show only the intended definer RPCs → AC-15
- [ ] With a real provider token: `POST /rest/v1/rpc/request_offers` and `/rpc/choose_provider` are refused → AC-21
- [ ] With a real customer token: `GET /rest/v1/applications` returns zero rows; `choose_provider` on another customer's
      request returns `not_found` → AC-21
