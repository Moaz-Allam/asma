# Known contradictions in the context docs

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

## What was already excellent

Worth naming, so it does not get "simplified" away in a future pass:

- The **v5 review fixes are genuinely senior work** — the transactional outbox, DB-level `REVOKE` on history tables, commission as its own posting leg, idempotency storing and replaying the response, RLS-as-performance-liability, and the transaction-pooler constraint list are all things most teams learn from an incident instead.
- **Custody is treated as a licensing question, not a technical one.** Deferring escrow to a licensed PSP and keeping the ledger as a mirror is the correct call, and the `FEATURE_STORED_BALANCE_WALLET` flag with a legal-sign-off gate is the right way to hold the line.
- **Stop-and-ask triggers** (`project-overview.md` §8) and the **human review gate** (`code-standards.md` §35) exist and are specific. Most projects have neither.
- **Legacy reputation is kept structurally separate** from platform-earned reputation, with blending named as fabrication. That is an integrity decision made before it was convenient.
- The **drift check** every ~5 tasks, and *"unpaid debt in this codebase is security debt"*.
