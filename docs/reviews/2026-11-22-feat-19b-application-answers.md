# Review, feat/19b-application-answers, 2026-11-22

**Reviewed by**: Sonnet 5.5 (author on a different model)
**Scope**: 44 files, branch vs master (PR #65)
**Verdict**: Approve with nits

## Summary
Position 19b adds admin-authored application questions (own table, RLS, column grants, guard trigger), a new `apply_to_request` signature that validates answers against the active set read once under the request row lock and stores a snapshot, scanner-protected rendering on the offer card, and the provider and admin UIs. I traced the migration end to end (lock order, version digest, replay, refusal-commits, snapshot, hidden answers, suspended chosen provider) and found no correctness, privacy or money problems. Only minor and nit items remain.

## Minor
### 🟡 Offer card renders nothing when every answer is optional and unanswered, `components/features/requests/OfferCard.tsx:68-89`
**Problem**: `answers` is `[]` (not null) when no question was answered. The card then shows neither answers nor the message branch, so the customer sees a blank block under the provider with no explanation.
**Why it matters**: A confusing empty offer; the customer cannot tell a provider chose not to answer from a bug.
**Suggested fix**: When `answers` is an empty array, show a short "No answers given" line (new `offers.*` string in all three locales), or make the apply path require at least one answer.

### 🟡 A stale-form refusal burns one hourly apply attempt, `supabase/migrations/20261203090000_application_answers.sql:589-599`
**Problem**: `count_application` (step 10) runs before the `questions_changed` check (step 12), so each stale-form refusal consumes an attempt. This is consistent with D153, but here the refusal is not the provider's fault (admin edited the set).
**Why it matters**: A provider near the hourly limit can be locked out by an admin edit plus one refresh cycle. Low likelihood.
**Suggested fix**: Accept as documented, or check the version before counting. Record the choice in the spec either way.

### 🟡 Text answer minimum of 10 applies to optional answers, `supabase/migrations/20261203090000_application_answers.sql:647`
**Problem**: An optional textarea answered with 1 to 9 characters is refused as `answers_invalid`, not treated as unanswered. A provider typing "Yes" must delete it or pad it.
**Why it matters**: Friction only; the field error names the question, so it is recoverable. Matches the stated limit floor.
**Suggested fix**: Optional: show the minimum in the counter or help line so the refusal is not a surprise.

## Nits
- ⚪ `components/features/provider-feed/ApplicationForm.tsx:329-343`, the textarea's `aria-describedby` only points at the error id; the help and required mark sit in the `note` and are not linked. The choice fields link help via `describedBy`, so this is inconsistent.
- ⚪ `lib/catalog/writes.ts:9`, the header comment line now exceeds the usual width and reads awkwardly after the appended parenthetical; reflow it.
- ⚪ Known and already noted by verify: Turkish fallback labels in `ar` RTL need `dir="auto"` on the label and answer lines.

## Strengths
- Apply reads the active set once under the request row lock, and the version, validation and snapshot all come from that one result; the digest covers labels and options so any admin edit invalidates an open form (`questions_changed`).
- The scanner runs at apply and again when the customer reads, and a chosen provider suspended after the pick loses answers and message together. Raw `applications` stays unreadable to customers (no read policy), so the scanner cannot be bypassed.
- `application_questions` ships RLS, admin-only policies, column grants (key, type, category, region insert-only), an all-roles guard (no delete, immutable identity, five active max under a category lock) and audit in one migration, with pgTAP including a race file.
- `applications_one_content` makes message and answers mutually exclusive with size caps; `applications_guard` freezes both new columns.
- Refusals are stable codes with the question key only; no answer text reaches errors, and `application_answers` / `p_answers` are scrubbed.

## Test coverage
Good: pgTAP `40_application_answers` and `41_application_answer_races` cover the table, guard, apply paths and races; unit tests (`tests/application-answers.test.ts`) cover schemas, answer rows and scrub; Playwright `e2e/application-answers.spec.ts` covers the flow. Untested or lightly tested: the empty-answers offer card case above, and the stale-form attempt-counting behaviour.
