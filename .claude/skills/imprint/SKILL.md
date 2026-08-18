---
name: imprint
description: Capture the visual patterns of a UI component into context/ui-registry.md so later components match it instead of inventing a parallel style. Use immediately after building or significantly changing any component, layout, or shared UI primitive. `/imprint [file]` captures a specific file; `/imprint audit` scans the whole codebase, finds conflicting patterns, and establishes a baseline. Registration is part of the Definition of Done, not an optional extra.
---

# /imprint

The registry exists to stop the same component being rebuilt under a different name on a different
screen. Its value depends entirely on recording **what the code actually does**, not what the design
intended. An unregistered component is an incomplete task (`build-plan.md`, Definition of Done).

Modes: no argument → the component just built · `[file]` → that file · `audit` → whole codebase.

---

## Capture

For each component, read the file and record it exactly.

1. **Identity** — name, path, and every route or parent that uses it.
2. **Actual classes**, copied from the source, not paraphrased. Container, title, body, muted text, badge, interactive states. If a variant changes classes, list each variant separately.
3. **Props** — the real signature, summarised.
4. **RTL** — `✅` only if you have genuinely viewed it in RTL. "Should be fine" is `⚠️ needs RTL check`. Do not upgrade a status you did not verify; the Playwright MCP server is configured for exactly this.
5. **Constraints that matter downstream** — flag anything a future component must not break. Examples that already exist in this project: *PII-free, must not query restricted fields* · *never computes money* · *must not gate payment* · *`key` immutable after create* · *idempotent action; confirm dialog states the amount*.

Append using the entry format in `ui-registry.md` §7, and update the summary tables in §1–§4 so the
status columns stay true.

---

## Check for drift while capturing

This is the point of the exercise. Compare what you just built against what is already registered.

- **Same need, different name?** A second `RequestCard`-shaped thing means the hierarchy in `ui-rules.md` §1 was skipped. Reuse or extend with a variant instead of forking.
- **Same role, different classes?** Two card paddings, two badge radii, two muted greys. Pick the registered one and correct the newcomer.
- **A token that does not exist?** Add it to `ui-tokens.md` first, or flag it as a design question in `progress-tracker.md` §7 — never inline the value.
- **A rule breached?** Raw hex, a Tailwind palette class, an arbitrary value, a physical direction utility. The guard hook blocks these at write time, so finding one here means it entered through a path the hook does not cover — say so.
- **A custom component?** It belongs in §5 with a written justification for why no shadcn primitive fit. A growing §5 means the hierarchy is being bypassed.

Report drift; do not silently normalise a component the human may have wanted different.

---

## `/imprint audit`

For establishing or re-establishing the baseline across the codebase.

1. Enumerate everything under `components/` and `app/**/layout.tsx`.
2. Registry rows with no file → move to §6 Deprecated, never delete. Deleting invites resurrection.
3. Files with no registry row → capture them.
4. Build a frequency table per visual role — padding, radius, border, muted text, badge shape, focus ring. **The most common value is the de facto standard**; anything else is drift. List the outliers with their `file:line`.
5. Report conflicts grouped by role, with a recommended canonical value each. Recommend — the human chooses.
6. Only after the human confirms: normalise the outliers, one commit per role, and record the canonical values in `ui-tokens.md`.

---

## While the theme is still pending

`ui-tokens.md` is marked 🟡 awaiting theme — brand colours, the Arabic-capable font, and dark-mode
scope are open questions. So:

- Register **structure, semantics, states, and RTL**. These are real and will survive.
- Do not invent brand values to fill a gap. Flag it in `progress-tracker.md` §7 instead.
- When the theme lands, only **values** in `ui-tokens.md` change. Token **names** are stable, and
  registered components should not need editing. If a component would need editing, it hardcoded
  something — that is the drift this skill exists to catch.
