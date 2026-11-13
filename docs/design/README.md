# Design references

**Status: ✅ handoff received 2026-10-25** (owner step S13; closes blocker B4 with D48 to D51). The
source is the owner's Claude Design project (export of 2026-10-24, which the owner confirmed is final):
customer web, provider web, admin, and a case study. Drawn in Arabic, right to left, phone first.
**v1 is Turkish first (D57):** the Arabic screens are the layout reference for `tr` and `en`, mirrored
by logical properties; the mock data (Saudi) is replaced by Turkish data.

The values (colours, type, radius, spacing) live in [`context/ui-tokens.md`](../../context/ui-tokens.md),
the binding rules in [`context/ui-rules.md`](../../context/ui-rules.md), and the component inventory in
[`context/ui-registry.md`](../../context/ui-registry.md). This folder holds the pictures and the code.
Our rules win over any reference (accessibility, logical properties, PII, money display).

## What is here

| Path | What |
| --- | --- |
| `logo.jpg` | The Aldebyani logo, supplied by the owner (807 × 807 JPEG, white corners). Identical to the logo in the design export. Never edit it; add a new version beside it |
| `screens/` | **53 screenshots**, one per design screen, rendered from `source/` at 1× (`screens/index.json` lists file, label, size). See "How the screens were made" |
| `screens/customer/s1.jpg` … `s19.jpg` | Customer web (19 screens, each may hold several frames: desktop 1280 px, modals, 390 px phones) |
| `screens/provider/p1.jpg` … `p19.jpg` | Provider web (19) |
| `screens/admin/app-01.jpg` … `app-09.jpg` | The admin console, one shot per sidebar view (dashboard, requests, provider approvals, disputes, catalog, pricing rules, settings, reports, leakage monitoring) |
| `screens/admin/a1.jpg` … `a6.jpg` | Admin screens outside the console (provider file, provider actions, admin cancel or refund, errors, phone, alerts) |
| `source/*.dc.html` | The design files as exported, unchanged: `Nazzafly Web Mockups` (customer), `Nazzafly Provider Web`, `Nazzafly Admin`, `Aldebyani Case Study` ("Nazzafly" is the old working name of the design file only). Read the markup for exact spacing and structure |
| `source/support.js`, `image-slot.js`, `doc-page.js` | The design tool's runtime, needed to open the files in a browser. Never imported by the app |
| `source/critique/` | The design tool's own heuristic reviews of the three apps (2026-10-20) |
| `tools/` | The capture scripts: `render-screens.mjs` (screens), `measure.mjs` (values in use), `standins.mjs` (photo and avatar stand-ins) |

`source/` is excluded from Prettier (`.prettierignore`), ESLint (`docs/**`) and the RTL lint (HTML and JS
only), because it is a verbatim reference, not our code. Never import from it.

## How the screens were made

`source/` opened in headless Chromium (Playwright), each screen section captured as a JPEG (quality 82).
**Every photo and avatar was swapped at capture time:** the design's photos (`img/*.jpg`) are crops of
Airtasker and Taskrabbit marketing images and its avatars are real Airtasker users' profile photos
(tracker Q12), so they never enter this repo. Photos render as a light blue panel with a simple navy
line drawing; avatars render as the person's initial (Alexandria 700) on a ramp colour. The design's own
image placeholder (diagonal stripes) is shown where the design used it.

To regenerate after a new export: unzip it outside the repo, copy the four `.dc.html` files, the three
scripts and `critique/` into `source/`, then run, from the repo root:

```bash
node docs/design/tools/render-screens.mjs <unzipped export> docs/design/screens
node docs/design/tools/measure.mjs <unzipped export> <report.json>
```

`render-screens.mjs` replaces the screens and `index.json`; `measure.mjs` reports the type, colours,
radius, borders, spacing and inputs in use, to check `context/ui-tokens.md` against. `standins.mjs` holds
the photo and avatar stand-ins both use. Never copy the export's
`img/`, `cs/`, `uploads/` or `_ds/` folders here: `img/` and `cs/` carry the borrowed photos, `uploads/`
carries competitor screenshots and real people's photos, and `_ds/` is an unrelated default design system
("Modernist", red on white) that no screen uses.

Opening `source/*.dc.html` straight from this folder shows broken images (the photos are not here) and
needs network access for Google Fonts and the runtime's scripts; use `screens/` to look, `source/` to
measure.

## Brand masters

| File | What | Notes |
| --- | --- | --- |
| `logo.jpg` | The round logo: blue disc, yellow buildings and swoosh, white "ALDEBYANI / HOME CARE", a cleaner figure | Source for the favicons below. The navbar logo is the word **Aldebyani** in Archivo Black (D43), never this image |

Generated from `logo.jpg` on 2026-10-17 (D40) with `sharp`:

| Output | How |
| --- | --- |
| `app/favicon.ico` | Circle masked (radius 99% of half the width, so the JPEG's white rim does not show as a halo), PNG frames at 16, 32, 48 px in one ICO container |
| `app/icon.png` | Same circle mask, 512 × 512, transparent corners, palette PNG |
| `app/apple-icon.png` | The logo as supplied (white corners: iOS fills transparency with black), 180 × 180 |

## Mapping: design screen → page → position

Routes from `project-overview.md` §12; positions from `context/build-plan.md`. Each screen's label in
the design states its intent; it is quoted in `screens/index.json`. A position's spec still asks the
owner where its design comes from (`/architect`); this table is the default answer.

### Customer

| Screen | What (from the design) | Page | Position |
| --- | --- | --- | --- |
| `s1` | Landing: hero «خلّها علينا», four promises, how it works, prices, categories | `/` | none yet: the landing page has no position; decide in a spec |
| `s2` | OTP sign-in, phone by default (+ code entry; six boxes, not the drawn four, D55) | `/login` | 01 |
| `s3` | Signed-in home; search shows results only while typing; services | `/` (signed in) | 04 |
| `s4` | New request: questions, live server-computed fixed price, schedule, address | `/requests/new` | 04 |
| `s5` | Review and publish (no payment here; request becomes `OPEN`) | `/requests/new` (step 2) | 04 |
| `s6` | Offers on an `OPEN` request; open a card for message, answers, reviews; choose | `/requests/[id]` | 06 |
| `s7` | Payment after selection, held by the PSP, no cash on delivery | `/requests/[id]` (pay) | 09 |
| `s8` | Provider profile as the customer sees it: derived metrics, legacy split from platform counts | applicant full profile | 06, 19 |
| `s9` | Confirm and release, optional per-dimension rating, dispute entry (full release or refund at launch, D54), repeat request (in v1, D56) | `/requests/[id]` (confirm) | 11, 14, 17; repeat 04 |
| `s10` | My requests, canonical states as tabs | `/requests` | 04 |
| `s11` | Role choice on first sign-up | `/login` (first time) | 01 |
| `s12` | My account: personal info, language, notification channels, region | account | 01 |
| `s13` | Notifications page + bell dropdown; each item opens its request | notifications | 18 |
| `s14` | Cancel a request; the outcome depends on the state | `/requests/[id]` (cancel) | 12 |
| `s15` | Request details after unlock: provider revealed, timeline, deadlines | `/requests/[id]` | 10, 11 |
| `s16` | Single-use invitation for a past customer to rate earlier work | rating link | 19 |
| `s17` | Errors and empty states: 404, payment declined, expired code, empty notifications | various | each owning position |
| `s18` | Phone (390 px): home, new request, offers, request after unlock | the pages above | each owning position |
| `s19` | SMS and email, customer side | templates | 13 (01 for the OTP SMS) |

### Provider

| Screen | What | Page | Position |
| --- | --- | --- | --- |
| `p1` | Provider sign-up: phone OTP, «طلبات مسبقة الدفع!», what you will pay | provider sign-up | 01, 02 |
| `p2` | Complete the profile, step 1 of 2 (`p4` moved to 05, D111), the approval gate stated up front; no past work photos | `/provider/profile` | 02 |
| `p3` | Verification: ID, selfie, criminal record, optional certificate; upload states; no ID number shown | `/provider/profile/documents` | 02 |
| `p4` | Services, districts, availability (moved from 02, D111) | `/provider/profile` | 05 |
| `p5` | Under review: requests visible but locked | `/provider` | 02 |
| `p6` | Work dashboard: one list of what needs action, most urgent first | `/provider` | 05, 10, 11 |
| `p7` | My profile, with the customer-facing preview (02 builds photo, name, chips, status card; no bank card, D87) | `/provider/profile` | 02, 19 |
| `p8` | Apply on a request: free, no price field, live message scanning | `/provider/feed/[id]` | 05 |
| `p9` | Wallet: balances, withdrawal, ledger filters | `/provider/earnings` | 15 |
| `p10` | Available requests, short details only | `/provider/feed` | 05 |
| `p11` | Pay the unlock fee within the window | `/provider/jobs/[id]` | 10 |
| `p12` | Confirmed job: full customer details after unlock; start and finish | `/provider/jobs/[id]` | 11 |
| `p13` | Withdraw an application, cancel: what each step costs | `/provider/applications` | 12 |
| `p14` | Account states: rejected, suspended, document expired | `/provider` | 02 |
| `p15` | Notifications | notifications | 18 |
| `p16` | Account | account | 01 |
| `p17` | Errors and empty states: empty feed, unlock payment failed, request closed, 404 | various | each owning position |
| `p18` | Phone: feed, won job, wallet | the pages above | each owning position |
| `p19` | SMS and email, provider side | templates | 13 |

### Admin

| Screen | What | Page | Position |
| --- | --- | --- | --- |
| `app-01` | Console dashboard: needs action, counts, held amounts | `/admin` | 16 |
| `app-02` | Requests table with status and actions | `/admin/requests` | 16 |
| `app-03` | Provider approvals queue | `/admin/providers` | 02 |
| `app-04` | Disputes queue | `/admin/disputes` | 14 |
| `app-05` | Catalog: categories, services, addons | `/admin/catalog` | 03 |
| `app-06` | Pricing rules: structured formula rows with a live preview | `/admin/pricing` | 03 |
| `app-07` | Settings: fees, commission, windows | `/admin/settings` | 03, 16 |
| `app-08` | Reports | `/admin/reports` | 16 |
| `app-09` | Leakage watchlist: providers with many unlocks and few releases | in the brief (admin), no route in §12 yet | 16, 19 |
| `a1` | Provider file: lifecycle, derived metrics (read only), documents, admin actions (02 builds the documents and decide, suspend, lift; no bank row, D87) | `/admin/providers/[id]` | 02, 19 |
| `a2` | Provider actions: suspend, rating invitation, legacy import | `/admin/providers/[id]` | 02, 19 |
| `a3` | Admin cancel or refund: attribution, outcome, ledger preview | `/admin/requests/[id]` | 12, 16 |
| `a4` | Errors and empty states: 404, empty queue, PSP reconciliation error | various | each owning position |
| `a5` | Phone: dashboard and dispute decision (partial release hidden until P1, D54) | `/admin` | 16, 14 |
| `a6` | SMS and email admin alerts | templates | 13 |

## Screens to re-export for the cash model (S24, D95)

The export of 2026-10-24 still draws the escrow model. Until the new export lands, the screens below
are references for layout only, and their money copy is wrong. Positions 09, 10 and 11 build their
database and server layers meanwhile; their UI waits for this.

**The brief to give Claude Design:** the platform never holds the job price. After choosing a provider
the customer pays a commission online (part of the price: on ₺7,000 at 10%, ₺700 online and ₺6,300 in
cash). The chosen provider then pays a fee online. Only when both have paid does each see the other's
contact details. The customer pays the provider the rest in cash, in person, after the service. The
platform is not responsible for the cash. There is no escrow, no held amount, no release, no wallet, no
withdrawal and no dispute. A short reminder line with a link to the agreement statement sits above every
payment button, and sign up has a required tick for it.

| Screen | What must change |
| --- | --- |
| `s1` | Promises and how it works: pay the provider in cash after the job. Remove anything saying the money is held safely |
| `s2`, `s11`, `p1` | Add the required agreement tick at sign up. `p1`: remove «طلبات مسبقة الدفع!», customers no longer prepay the job; "what you will pay" is the provider fee |
| `s4`, `s5` | The price card shows the split: job price, commission online after choosing, cash to the provider after the service |
| `s6` | Choosing a provider says the commission is due next |
| `s7` | Pay the **commission** only: job price, commission now, cash due later, reminder line. Remove "held by the PSP" and "no cash on delivery" |
| `s9` | Confirm the job is done; no release, no held amount strip, no auto release countdown. A confirm window replaces it. Rating stays. The dispute entry becomes **report a problem**. Repeat request stays |
| `s10` | Tabs follow the new states (`project-overview.md` §21) |
| `s14` | Cancel: before the reveal the commission comes back; after it nothing comes back by itself (§36) |
| `s15` | After the reveal: both paid, provider's contact, the cash due as a reminder, timeline with the new states |
| `s17`, `p17` | Payment errors name the commission or the provider fee |
| `s18`, `p18` | Phone versions follow their pages. `p18`: the wallet becomes the history |
| `s19`, `p19`, `a6` | SMS and email follow the new notification list (§24) |
| `p6` | Dashboard: "pay your fee" as an action. Remove the earnings tile |
| `p8`, `p10` | Show the provider fee and the cash to collect. Remove net of commission at release |
| `p9` | Wallet becomes a read only **jobs and fees history**: jobs taken, fees paid, the cash each job was worth. No balance, no withdrawal |
| `p11` | Pay the **provider fee** within the window, with the fee, the cash to collect and the reminder line |
| `p12` | The confirmed job shows the cash to collect; start and done. No release wording |
| `p13` | What each step costs, per §36 |
| `app-01` | Dashboard: fee revenue instead of held amounts |
| `app-02` | Requests table uses the new states |
| `app-04`, `a5` | Disputes queue becomes a **problem report queue**: warn, suspend, refund a fee by hand |
| `app-07` | Settings: commission percent, provider fee (fixed or percent), the three windows |
| `app-08` | Reports show commission and provider fee revenue |
| `app-09` | Leakage watchlist: many unlocks and few completions |
| `a3` | Admin refund of a fee by hand with a recorded reason. No split of held money |

## Excluded from the references

| Pattern | Why |
| --- | --- |
| Every photo and avatar in the export (`img/`, `cs/`) | Borrowed from competitors and real users (Q12). Use stand-ins until owned, licensed or generated images exist |
| Riyadh addresses, Saudi phone format (05x), «مدى», Apple Pay and bank transfer among payment methods, the admin region switch «السعودية · ₺», the settings note "Saudi only" | The designer chose Saudi mock data while the region was undecided; v1 is Turkey (D57): Turkish data, `+90`, the iyzico card form (other methods wait for PSP facts, B3) |
| The four-box sign-in code (`s2`, `p1`) | Supabase Auth codes are 6 to 10 digits: six boxes (D55) |
| Raw keys as labels in the pricing editor (`app-06`: `has_pets`, `property_type`) | Labels come from the catalogue in the user's locale; the key may show as small secondary text |
| The figures in the mockups (prices, the 15% commission, the ₺250 fee) | Illustration only. Real values come from `platform_settings` and the pricing engine (B5); never copy a number from a screen |
| The mock browser bar (`aldebyani.com/...`) and the design notes around the frames (labels, English annotations) | Presentation of the design, not UI |
| The case study's "future plans" (native apps, notification centre) | Not v1 scope by themselves; the notification centre is position 18 (P2) |
| The `_ds` "Modernist" system | Unrelated default design system of the design tool; never used by any screen |
