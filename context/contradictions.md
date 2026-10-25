# Known contradictions in the context docs

> **Note, 2026-10-17:** `CLAUDE.md` is now a one line pointer to `AGENTS.md`, which holds the routing
> table and rules summary, and the precedence order is the playbook's eight levels (`AGENTS.md`,
> `project-overview.md` §0). Mentions of `CLAUDE.md` below are part of the historical record.

> **Read this before trusting any single section.** The docs grew in layers — v2 → v3 → v4 → v5 —
> and earlier sections were left in place rather than corrected. That is defensible as a history,
> but it means an agent reading top-to-bottom **reads the wrong answer first** and only later meets
> the correction. A superseded section is not low-signal; it is *negative* signal.
>
> Precedence: a later `v5` section overrides `v4` overrides `v3` overrides the original text **in the
> same file**. Across files: `project-overview.md` §5–6 → a recorded decision in `progress-tracker.md`
> → `architecture.md` → `code-standards.md` / `ui-rules.md` → `build-plan.md`.
>
> **Status: all 13 are now FIXED in the source documents** (2026-08-17). 🔧 = resolved.
> Each entry is kept as a record of *what* was wrong and *why* it mattered, because the failure modes
> recur — a superseded section left standing, an enum whose casing silently disables an index, a
> pointer to a file that cannot be read. The "Proposed fix" text describes what was applied.
>
> Corrections are marked inline in the source files (`⚠️ Corrected in v3` / `v5` callouts) rather than
> deleted, so the history stays visible. The three that produced wrong code — C1, C2, C3 — are also
> injected at session start by `.claude/hooks/session-context.mjs`, because an agent that does not
> already know a section is wrong has no reason to come looking here.
>
> **Add new entries here when you find the next one.** Status: 🔧 = fixed · ⚠️ = live.

---

## 🔴 Critical — will produce wrong code

### C1 🔧 The Server Action template still contains the forbidden inline PSP call

`code-standards.md` §19, inside the copy-paste template:

> `// charge via PSP adapter, then post ledger in one transaction`

This is the exact anti-pattern that §26 of the same file declares impossible and forbidden
(*"you cannot atomically perform an external HTTP call and a database commit"*). Templates get
copied verbatim — this one teaches the bug it later bans.

**Proposed fix:** replace that comment with the outbox sequence — write the domain change, write the
balanced ledger entries, write the `outbox_events` row, commit; the relay performs the PSP call.
Same for `architecture.md` §12 "Money Operations", which still reads *"PSP call → on success: post
ledger + update projection IN ONE TRANSACTION"*.

### C2 🔧 `applications.status` is defined twice, incompatibly — and one index cannot ever match

- `architecture.md` §13 defines four lowercase values: `applied | chosen | not_chosen | withdrawn`.
- `architecture.md` §20 and `project-overview.md` §22 define twelve UPPERCASE values: `APPLIED … CANCELLED`.
- `architecture.md` §4 creates `CREATE UNIQUE INDEX one_chosen_per_request ON applications (request_id) WHERE status = 'CHOSEN'`.

If the column stores lowercase `chosen`, that partial index **matches zero rows** and the
"exactly one chosen application per request" invariant is silently unenforced. Postgres raises no
error. This is precisely the class of failure the docs warn about elsewhere.

**Proposed fix:** state one canonical casing (UPPERCASE, matching `requests.status` and the v3
lifecycle), correct §13, and add a `CHECK` constraint listing the twelve permitted values so a
mismatch fails loudly at write time instead of quietly at index time.

### C3 🔧 Payment order and state machine both appear in two incompatible versions

| Location | Order |
| --- | --- |
| `project-overview.md` §3, §4 | provider unlocks → **then** customer pays. `OPEN → SELECTED → UNLOCKED → FUNDED` |
| `project-overview.md` §21 (v3) | customer pays → **then** provider unlocks. `OPEN → SELECTED → FUNDED → UNLOCKED` |

§21 is correct and says so. But §3 is what a reader meets first, it is labelled *"memorise this"*,
and it carries a "do not improve these" table that lends it false authority.

**Proposed fix:** replace §3 and §4 with the v3 content and keep the old version in a clearly marked
`## Superseded — historical` appendix, or delete it. The canonical lifecycle is now also stated in
`CLAUDE.md` and injected at session start by `.claude/hooks/session-context.mjs`, so an agent that
reads neither still gets it.

---

## 🟠 Major — dead pointers and stale conventions

### C4 🔧 `middleware.ts` still appears as the route-protection mechanism in three places

`architecture.md` §15 (*"Middleware protects `/requests`, `/provider`, `/admin`"*), `build-plan.md`
feature 02 (*"Middleware protecting…"*), against `architecture.md` §34 and `code-standards.md` §27,
which correctly require `proxy.ts`.

This one is unusually dangerous: Next.js 16 **silently ignores** a `middleware.ts` file. No error,
no warning, route protection simply absent. The guard hook now blocks creating the file, but the
docs still instruct it.

### C5 🔧 `AGENTS.md` was referenced but did not exist

`library-docs.md` "Before Using Any Library" step 1 sends the agent to `AGENTS.md` for the skill
list, and `architecture.md` §11 shows it at the root of the folder tree. It had never been created,
so step 1 of the library-authority chain was a dead end. **Created**, pointing at `CLAUDE.md`.

### C6 🔧 `ARCHITECTURE-REVIEW.md` does not exist — only a `.docx` does

`progress-tracker.md` §11 opens with 🔴 **READ `ARCHITECTURE-REVIEW.md` FIRST**, and
`architecture.md` §27, `build-plan.md` §"v5 review fixes" and `library-docs.md` all cite it as the
source of the v5 corrections. The file on disk is `context/docs/ARCHITECTURE-REVIEW.docx` — an agent
cannot read a `.docx` with its file tools, so the most emphatic instruction in the tracker is
unfollowable.

**Proposed fix:** convert it to `context/architecture-review.md`. The same applies to the other
eleven `.docx`/`.xlsx` files in `context/docs/` — they are invisible to the agent as things stand.

### C7 🔧 Two different "current phase" values, and two different first phases

- `progress-tracker.md` header + §3: `Phase 0 — Foundations`.
- `progress-tracker.md` §11: `Phase: Phase 1 — Foundation`.
- `build-plan.md` has **both** a `Phase 0 — Foundations` (checklist form) and a `Phase 1 — Foundation` (numbered-feature form, features 01–04) covering overlapping work with different task lists.

An agent asking "what do I do next" gets two answers. The SessionStart hook currently reports
Phase 0 because it reads the header.

**Proposed fix:** keep the numbered-feature phases (they map 1:1 to the tracker checklist) and delete
the Phase 0 duplicate, or explicitly label Phase 0 as a subset of feature 01.

### C8 🔧 Feature count disagrees: 28 vs 47

`build-plan.md` §"Feature Count" says *"28 features across 7 phases"*, stated **after** the document
has already added 07a–07c, 29–31, 32–37 and 38–44. `progress-tracker.md` §12 correctly says
*"47 features total"*.

---

## 🟡 Minor — inconsistencies worth closing

### C9 🔧 Unlock fee timing contradicts the corrected order

`project-overview.md` §6 describes option A as charging the provider's card *"at the moment of
selection"*, and §9 decision 8 keeps "A" as the default. After the v3 correction the fee is charged
at **unlock**, which happens only once the request is `FUNDED` — strictly after selection. §6 also
predates the rule that the charge must go through the outbox rather than inline.

### C10 🔧 `scheduled_at` vs `scheduled_start_at` / `scheduled_end_at`

`architecture.md` §4 and §13 both list `scheduled_at`; §20 replaces it with the two explicit
columns. `architecture.md` §7 and `build-plan.md` features 09–10 still reference the single column.

### C11 🔧 `unlock_deadline` is set at two different moments

`architecture.md` §7 and `build-plan.md` feature 12 set `unlock_deadline` on selection.
`architecture.md` §21 correctly sets `payment_deadline` on selection and `unlock_deadline` when the
request becomes `FUNDED`. Getting this wrong reopens requests while the customer is still paying.

### C12 🔧 The escrow release example assumes full release only

`code-standards.md` §5 shows `.update({ status: 'RELEASED', released_amount: heldAmount })`. That is
correct for a full release but wrong for the `PARTIALLY_RELEASED` dispute outcome, which the state
machine requires. As the canonical example it will be copied into the partial path.

### C13 🔧 `project-overview.md` jumps from §9 to §11

No §10. Harmless alone, but cross-references to numbered sections are used throughout, so the gap
suggests a section was removed without updating references to it.

---

## 🎨 The design handoff vs the docs (2026-10-25)

Found while importing the owner's Claude Design export into `docs/design/` (D48). The design is the
visual source of truth; on rules, money and scope the docs and the decision log win, and the design's
deviations are listed here so nobody copies them. Status: 🔧 = settled · ⚠️ = live.

### C14 🔧 Commission timing: the screens contradict the docs and the case study

`project-overview.md` says the commission is "deducted when the customer pays", and the design's own
case study agrees («تُقتطع عند دفع العميل»). But `s7`, `p1`, `p8` and `p12` tell users it is deducted
«عند تحرير المبلغ» (on release). Copied as is, the UI would describe a different money flow from the
ledger. **Settled by D53:** taken at payment; UI copy says the provider receives the net at release.

### C15 🔧 Partial dispute release is drawn, but it is not in the launch scope

`s9` says the admin decides «تحرير المبلغ كاملًا أو جزئيًا أو استرداده» and `a5` offers a partial
release. Position 14 is "full release or full refund (partial is P1)". **Settled by D54:** full only at
launch; the partial option and copy stay hidden until P1.

### C16 🔧 Sign-in: a four-digit SMS code, while the channel was undecided

The design signs in by phone with a four-box code. Q4 was still open (email recommended for cost), and
Supabase Auth codes are 6 to 10 digits, so four boxes cannot work. **Settled by D55:** phone SMS, six
digits; SMS provider is owner step S20.

### C17 🔧 "Repeat this request" is not in the brief

`s9` has «كرّر الطلب». The scope rule says ask before building anything outside the brief.
**Settled by D56:** in v1, position 04, recorded as a scope override.

### C18 🔧 The mock region is Saudi Arabia, but v1 launches in Turkey

Riyadh districts, 05x phones, «مدى» first among payment methods, «السعودية · ₺» in the admin region
switch, a settings note "Saudi only". The designer's own note explains it chose Saudi data because "the
region decision is still open", which stopped being true on 2026-10-17 (D22). The mix also pairs Saudi
data with `₺`. **Settled by D57:** v1 is Turkish first; build with Turkish data and the iyzico card
form (closes Q14).

### C19 ⚠️ The design is Arabic only; v1 is Turkish first

There is no Turkish (or English) screen in the handoff, yet `tr` is the primary launch language (D57).
Turkish runs longer than Arabic and reads left to right. Mitigation in place: layouts mirror through
logical properties, the fonts cover Turkish (verified), `tr` is the first locale checked
(`ui-rules.md` §3, `i18n.md` §7). Live until the Turkish copy exists and the first screens pass in `tr`.

### C20 🔧 Dialect: the designer's note says Modern Standard Arabic, the landing hero is Egyptian

The customer file ends with «نُقلت النصوص إلى العربية الفصحى المبسّطة», but the `s1` subtitle still reads
«شوف السعر … المزودين بيتقدموا وإنت تختار». Settled by the rule that `messages/ar.json` is written in
simple Modern Standard Arabic.

### C21 ⚠️ The criminal record is drawn as always required; the brief makes it configurable

`p3` asks every provider for ID, a liveness selfie and a criminal record. `project-overview.md` lists the
criminal record certificate as "configurable by admin". Build it configurable, on by default as drawn.
Live because the criminal record and the selfie are special categories of personal data under KVKK:
the legal basis, consent wording and retention go to the owner's legal track (S16).

### C22 🔧 The notification centre is drawn for launch, but planned for later

`s13` and `p15` draw full notification pages and a bell menu; the case study itself lists the in-app
notification centre under future plans, and the build plan puts it at position 18 (P2). Settled: P2 as
planned; SMS and email notifications (position 13) are the launch channel.

### C23 🔧 Payment methods the PSP may not support

`s7` offers «مدى», a credit card, Apple Pay and instant bank transfer. Which methods iyzico's
marketplace hold supports is a PSP fact (B3). Settled with D57: the iyzico card form only in v1; more
methods only after B3 confirms them.

### C24 🔧 Raw keys shown as labels in the admin pricing editor

`app-06` shows `has_pets`, `property_type`, `rooms` as labels. `i18n.md` §5: labels come from localised
columns. Settled: the label in the user's locale, the key at most as small secondary text.

### C25 🔧 Status chips disagree with themselves

"Cancelled" appears as «ملغى» on primary 50 and «ملغي» on primary 100; approved («معتمد») and rejected
(«مرفوض») look identical. **Settled by D59:** «ملغى» on `success-light`; «مرفوض» on `error-light`.

### C26 🔧 Field borders fail our contrast rule

The design's field border (`#DFE7F3`) is 1.25:1 against white; `ui-rules.md` §8 requires WCAG AA, which
wants 3:1 for a control's boundary. **Settled by D59:** field borders use ink 500 (4.34:1).

### C27 🔧 The design tool's critiques describe an earlier version

`docs/design/source/critique/` (2026-10-20) mentions yellow money cards, black buttons, grey `#888`
text, Arabic-Indic digits on `p6` and no admin search. The exported design has none of these (verified:
no Arabic-Indic digit in any screen, a navy palette, a requests view in the console). Kept as history;
do not act on them without checking the screen.

### C28 🔧 The provider wallet is not a custody breach

Q13 (2026-10-24) claimed the design's wallet and «سحب الرصيد» break rule 9. Wrong:
`project-overview.md` §6 and §12 define the wallet as a read only mirror of PSP balances with payout
requests via the PSP, which is exactly what `p9` draws. Withdrawn.

Also settled by the rewrite itself (D48): the old placeholder `ui-rules.md` forbade tinted card
backgrounds and a sidebar and assumed 1px borders and small radii. The design uses tinted and navy panels,
an admin rail, 2px borders and pill buttons; the rules now follow it.

---

## What was already excellent

Worth naming, so it does not get "simplified" away in a future pass:

- The **v5 review fixes are genuinely senior work** — the transactional outbox, DB-level `REVOKE` on history tables, commission as its own posting leg, idempotency storing and replaying the response, RLS-as-performance-liability, and the transaction-pooler constraint list are all things most teams learn from an incident instead.
- **Custody is treated as a licensing question, not a technical one.** Deferring escrow to a licensed PSP and keeping the ledger as a mirror is the correct call, and the `FEATURE_STORED_BALANCE_WALLET` flag with a legal-sign-off gate is the right way to hold the line.
- **Stop-and-ask triggers** (`project-overview.md` §8) and the **human review gate** (`code-standards.md` §35) exist and are specific. Most projects have neither.
- **Legacy reputation is kept structurally separate** from platform-earned reputation, with blending named as fabrication. That is an integrity decision made before it was convenient.
- The **drift check** every ~5 tasks, and *"unpaid debt in this codebase is security debt"*.
