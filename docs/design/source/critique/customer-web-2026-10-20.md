⚠️ DEGRADED: single-context (no separate reviewers or detector available here; you chose to skip the detector)

# Critique: Nazzafly Web Mockups (customer), 2026-10-20
Score: 28/40 (Good, low end). P0: 0 · P1: 2 · P2: 3

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of status | 4 | Stepper, live price, held amount, auto-release countdown, S15 timeline |
| 2 | Match real world | 3 | S1 hero is Egyptian dialect and says "احجز" (book) |
| 3 | User control | 3 | S14 cancel shows the outcome first; edit request is available |
| 4 | Consistency | 2 | Bell only on S11–S19; "أكّد الإتمام" is black and blue on the same S10 screen |
| 5 | Error prevention | 3 | Fixed price before posting; cancellation outcome preview |
| 6 | Recognition | 3 | Request summary repeated beside each decision |
| 7 | Flexibility | 2 | Repeat request only; no saved addresses visible |
| 8 | Minimalism | 2 | Navy rules cards on most screens compete with the action |
| 9 | Error recovery | 3 | S17 states each give a next step |
| 10 | Help | 3 | Contextual rules cards; FAQ in landing nav |

## Specificity
Authored for this product: the escrow lifecycle drives every screen. Structural sameness: almost every screen has the same two columns (content right, yellow money card and navy rules card left).
Source pass: text colours #666 ×77, #888 ×59, #999 ×20, #bbb ×7; 184 text runs at 10–12px; 0 aria attributes.

## Working
- The price is fixed and follows the user from S4 to S6, S7 and S9.
- S14 shows refund outcome per state before confirming.
- S15 timeline makes the lifecycle legible.

## Priority issues
1. [P1] S1 hero copy: Egyptian dialect while the rest is MSA; "احجز" implies instant booking, but the flow is post → applications → choose → pay. Fix: rewrite in MSA around posting free and choosing. /impeccable clarify
2. [P1] Small low-contrast secondary text: #888 on white ≈3.5:1, on #f4f4f4 ≈3.2:1, #999 ≈2.8:1, #bbb ≈1.9:1, mostly 11–12px. Deadline and escrow notes use it. Fix: #666 minimum, 13px minimum for deadlines and amounts. /impeccable typeset
3. [P2] S10 primary action in two colours (black in the yellow card, blue in the list). Fix: one primary treatment. /impeccable polish
4. [P2] Header drift: bell missing on S1–S10. /impeccable polish
5. [P2] Navy rules cards restate 4–5 policy bullets on most screens. Fix: keep only the rule for the current decision, one line, link to the full policy. /impeccable distill

## Personas
- Jordan: told "احجز" on S1, then meets a post-and-wait flow.
- Sam: 0 aria attributes; S12 notification switches have no per-switch label; 2.8:1 grey notes.
- Riley: S14 and S17 cover the main edge cases well.

## Minor
- S1 trust tile "١٤٠٥ عميل" reads as a real stat; mark it as sample data or remove it.
- Index chip "S10 طلباتي" wraps onto two lines.
