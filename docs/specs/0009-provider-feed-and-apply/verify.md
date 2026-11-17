# Verify: Provider feed and apply (05) · spec 0009

_Steps derived from the spec's acceptance criteria and its Value sourcing table. `/check verify` runs these; `/test` locks
the durable ones. A stub proves the SDK, never the handler, so the real call section stays manual on purpose. Never paste a
phone number, an address, a token or a real person's message into this file. Test data only; every number below is made up._

## Message corpus (AC-10, AC-23): read this before the build

`has_contact_info` is 02's function, unchanged. The whole must catch and must pass table of
[0006 verify.md](../0006-provider-onboarding/verify.md) runs again through `apply_to_request` (the pgTAP corpus), padded
where needed to reach 20 code points. The rows below are added for messages, which are longer and more casual than bios.
Anything that should move, moves here first.

**Must catch (added)**

| Kind | Text |
| --- | --- |
| Phone mid sentence | `Merhaba, işi yaparım, beni 0555 123 45 67 numarasından arayın lütfen` |
| Arabic Indic digits in Arabic | `أستطيع البدء يوم السبت، اتصل على ٠٥٥٥١٢٣٤٥٦٧ للتفاصيل` |
| Spelled, mixed with digits | `call me on five five five 123 45 67 tomorrow` |
| Split across lines | `I can start Saturday.` newline `0555` newline `123 4567` |
| Spelled email in a sentence | `send photos to ali at example dot com and I will reply` |
| Handle in a sentence | `see my work on @ali_temizlik before you choose` |
| Brand in Turkish | `fotoğrafları whatsapp'tan atarım, iş kolay` |
| Brand in Arabic | `أرسل لك الصور على واتساب قبل البدء بالعمل` |

**Must pass (added)**

| Language | Text |
| --- | --- |
| English | `I can start at 13:00 on Saturday and finish in about 7 hours with two people.` |
| English | `I have cleaned 40 villas after renovation, I bring all tools and safe products.` |
| Turkish | `Cumartesi 13:00'te başlayabilirim, iki kişiyle yaklaşık 7 saatte biter.` |
| Turkish | `Tadilat sonrası temizlikte 8 yıllık deneyimim var, malzemeleri ben getiririm.` |
| Arabic | `أستطيع البدء السبت الساعة 1 ظهرا مع فريق من شخصين، والعمل يستغرق 7 ساعات تقريبا.` |
| Arabic | `خبرة 8 سنوات في تنظيف الفلل بعد التشطيب، وأحضر أدواتي ومنظفاتي.` |

**Length (AC-10 step 11):** 19 code points after trim refuse `message_invalid`; 20 pass; 600 pass; 601 refuse; a message of
spaces, NBSP and zero width characters only refuses `message_invalid`.

## On the local stack

Restart a stack started before 04 (`npx supabase stop`). Fixture: one region `TR`, one category, two active services, two
active zones, one inactive service, one fixture request `OPEN` with a future start, a `text` answer `FIXTURE_TEXT_ANSWER`
and notes `FIXTURE_NOTES`, and four providers: A approved with setup covering the request, B approved covering the same,
C approved covering another zone only, D suspended.

- [x] `npm run db:test`: file 14 green, every earlier file still green → AC-1, AC-17 to AC-19, AC-23 · *proof: 2026-11-17, 16 files, all green (14 and 15 new)*
- [ ] As A: `/provider/setup` saves; a save with the inactive service, an empty zone list, `end_hour` equal to
      `start_hour` each show its field error → AC-2, AC-3
- [x] As A before setup (fresh approved provider): `/provider/feed` and `/provider` show the setup prompt → AC-4, AC-14 · *proof: e2e `provider-feed.spec.ts`*
- [ ] As A: the feed shows the fixture request with service, district, start in `Europe/Istanbul`, price, "0 of 10 offers";
      the page text contains neither `FIXTURE_TEXT_ANSWER` nor `FIXTURE_NOTES` nor any address → AC-5 to AC-7
- [ ] As A: `/provider/feed/[id]` shows the structured answers, job price, cash to collect, the free line, the form → AC-8,
      AC-9, AC-12
- [ ] As A: a message with `٠٥٥٥١٢٣٤٥٦٧` is refused, the text stays; a clean message applies; "You applied" shows; a reload
      and a second submit return the same application → AC-10, AC-11
- [ ] As A: `/provider/applications` lists it with `APPLIED` → AC-13
- [ ] As B: the card shows "1 of 10 offers"; nothing of A's message or identity appears anywhere → AC-6, AC-18
- [x] As C: the fixture id on `/provider/feed/[id]` shows 404 → AC-8 · *proof: pgTAP 14 (`provider_request` null for C); the page calls `notFound()` on null*
- [ ] As D: setup is read only; the feed shows 02's suspended page → AC-3, AC-4
- [ ] As a pending provider with a saved setup: `POST /rest/v1/rpc/provider_feed` with the local key returns no row →
      AC-5, AC-15
- [ ] Admin turns off A's second service: `p4` shows it greyed, the next save drops it, the fixture request (first service)
      stays in A's feed → AC-3, AC-4
- [x] With 25 fixture requests, some outside A's hours: "show more" across the divider lists each exactly once → AC-5 · *proof: pgTAP 14, paging section*
- [ ] As the customer: cancel the fixture request; A's application shows `CANCELLED`; the request leaves B's feed → AC-16
- [ ] As a customer and as admin: each provider page sends you away → AC-15
- [ ] Network tab during apply: the request body field is `applicationMessage`; the Sentry and PostHog payloads (local relay
      logs) carry no message text → AC-20, AC-21
- [ ] 360, 390, 430 and 1280 px in `ar`, `tr`, `en`: no overflow, RTL mirrored, `npm run lint:rtl` clean → AC-22
- [x] `npm run test:e2e` green → AC-24 · *proof: 2026-11-17, `provider-feed.spec.ts` 3/3 and the touched specs; no full run (known 1.7 hour suite, owner rule)*

## Real calls (a preview on the shared cloud project, after the migration push)

- [ ] Cloud lists the migration; security advisors show only the intended definer RPCs → AC-18, AC-19
- [ ] With a real provider token and the public key only, each gets zero rows or a refusal → AC-18, AC-25:
      - `GET /rest/v1/requests`
      - `GET /rest/v1/request_addresses`
      - `GET /rest/v1/applications` (only own rows come back)
      - `POST /rest/v1/applications`
      - `PATCH /rest/v1/applications` to set `status`
      - `POST /rest/v1/rpc/has_contact_info`
      - `POST /rest/v1/rpc/count_application`
- [ ] `POST /rest/v1/rpc/provider_request` with a request outside the token's setup returns null → AC-8, AC-25
- [ ] `applyToRequest` with a contact detail message on the preview is refused; the Sentry event (if any) and the PostHog
      capture of that page carry no message text → AC-20, AC-25
