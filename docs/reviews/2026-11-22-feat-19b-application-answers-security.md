# Security review: 19b structured application answers (`feat/19b-application-answers`, PR #65)

Reviewed 2026-11-22 by the `security-reviewer` agent over `git diff master...HEAD` at `098c82b`. Verdict: **fix then ship**. Fixed in `93f0474` (D219); carry overs in R26.

## Findings

| ID | Severity | Finding | Outcome |
| --- | --- | --- | --- |
| M-1 | Medium | The contact scanner read each text answer alone, at apply and on the card. Its digit limit is per text (10), so a phone number split across two text answers reached the customer's card before either fee was paid. | Fixed: `answers_joined_text` joins the text answers in snapshot order; apply refuses `contact_info_in_answer` (no key) and `offer_answers` hides every text answer when the joined text matches. pgTAP 40 covers both. |
| L-1 | Low | `application_questions_guard` is a definer BEFORE trigger, which runs ahead of the RLS write check: a signed in non admin inserting `active = true` could learn whether a category holds 5 active questions and briefly lock its row. | Fixed: `application_questions_access` (invoker, fires first) refuses an API caller who is not admin with 42501; the guard locks `for no key update`. pgTAP 40 covers it. |
| L-2 | Low | `offer_answers` relies on answer keys being a subset of the snapshot keys, which only `apply_to_request` guarantees (no write grant on `applications` today). | Accepted: the no insert grant meta test in 14 holds it. |

## Checked and sound

RLS and column grants on `application_questions`; no read of another provider's answers; `applications_guard` freezes answers and snapshot; every hostile input to apply is refused before the scanner; the snapshot comes only from the one server read; refusals are returned so the hourly attempt commits; the card never returns a raw choice value and rescans text on read; `request_offers` hides a suspended chosen provider's answers; no grant to `anon` or `service_role`; the scrubber covers `application_answers` and `p_answers`; no raise carries an answer; the door's schemas are strict.
