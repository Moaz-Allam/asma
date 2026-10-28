⚠️ DEGRADED: single-context (no separate reviewers or detector available here; you chose to skip the detector)

# Critique: Nazzafly Provider Web, 2026-10-20
Score: 27/40 (Acceptable). P0: 0 · P1: 2 · P2: 3

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of status | 4 | P5 gate, unlock countdown, P12 job stages |
| 2 | Match real world | 3 | Unlock fee explained where it appears |
| 3 | User control | 3 | P13 explains each withdrawal step |
| 4 | Consistency | 2 | Nav lacks المحفظة on P6; bell only from P10; Latin digits on P11 |
| 5 | Error prevention | 2 | P13 destructive actions styled as primary |
| 6 | Recognition | 3 | Request summary beside unlock payment |
| 7 | Flexibility | 2 | Feed filters, no sort; no bulk actions |
| 8 | Minimalism |2 | P6 repeats nav items as tabs |
| 9 | Error recovery | 3 | P17 states with next steps |
| 10 | Help | 3 | Contextual rules cards |

## Specificity
Authored: net-of-commission in P8, the locked feed in P5 and the unlock countdown answer real provider questions. Same two-column template as the customer canvas.
Source pass: #888 ×66, #666 ×62, #999 ×13, #bbb ×4; 208 runs at 11–12px; 0 aria.

## Working
- P8 price card shows the net amount and says applying is free.
- P5 shows the locked feed and the reason it is locked.
- P12 shows one primary action per stage.

## Priority issues
1. [P1] Navigation drifts: P6 nav has 4 items (P8+ have 5 with المحفظة); bell from P10 only; P6 repeats "الطلبات المتاحة / تقدّماتي / أعمالي" as tabs under the nav. Fix: one 5-item nav with the bell on every screen; drop the P6 tabs. /impeccable layout
2. [P1] Contrast and size, as in the customer canvas; commission lines and deadline notes are affected. /impeccable typeset
3. [P2] Feed actions differ: P6 card has two buttons (اقرأ التفاصيل + blue تقدّم); P10 has one black "التفاصيل والتقدم". /impeccable polish
4. [P2] P11 countdown "19:24:08" uses Latin digits; elsewhere Arabic-Indic ("١٩ ساعة و٢٤ دقيقة" on P6). /impeccable polish
5. [P2] P13 "اسحب تقدّمي / انسحب من الطلب / ألغِ العمل" are black primary pills, the same weight as "تقدّم على الطلب". Fix: outlined, red ink, keep confirmation. /impeccable harden

## Personas
- Casey: P18 mobile covers feed, won job and wallet but not the unlock payment, the most time-critical step (24h window).
- Alex: no sort in the feed, no saved filters.
- Sam: 0 aria; countdown changes are not announced.

## Minor
- The P6 metric tiles (rating, jobs, commitment, monthly earnings) repeat P7 and P9 content.
