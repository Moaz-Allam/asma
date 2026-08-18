---
name: remember
description: Carry project state across sessions and across context compaction. Use `/remember save` at the end of a session or before context runs out, to compress what matters into progress-tracker.md and NOTES.md. Use `/remember restore` at the start of a session, or after a compaction, to rebuild working context and confirm the state before continuing. Use whenever a feature spans more than one session.
---

# /remember

Context does not survive. A new session starts blank, and compaction discards detail mid-session.
The filesystem is the memory; this skill is the discipline of writing to it.

Two durable stores, with different jobs:

- **`context/progress-tracker.md`** — committed, shared, permanent. Phase, decisions, blockers, handoff. This is the project's memory.
- **`NOTES.md`** — repo root, gitignored, scratch. Working state for the task in flight: what you tried, what you ruled out, the exact command that reproduces the bug.

---

## `/remember save`

Run at session end, when a feature will span sessions, or when context is filling. Do not wait for
the context to run out — compaction chooses what to keep, and it will not choose the way you would.

### Write to `progress-tracker.md`

Update, do not append duplicates:

1. **§3 phase progress** — status per phase, and whether the gate passed. A gate is passed only when its named tests are green.
2. **§12 feature checklist** — tick only what meets the Definition of Done in `build-plan.md`. An untested RLS policy is not done.
3. **§5 / §13 decisions** — every non-obvious choice, with the reason and whether it is reversible. This is what stops the next session re-litigating a settled question.
4. **§4 blockers** — anything waiting on the human. State what it blocks.
5. **§6 PSP facts** — any capability confirmed from real documentation, not assumption.
6. **§7 design questions** — visual decisions genuinely needed from the human.
7. **§10 test health** — which suites ran, and their result. "Not run" is a valid, useful entry.
8. **§8 handoff notes** — see below.
9. **`Last updated`** — the actual date.

### Handoff notes — the part that actually matters

Write for someone with zero context, because that is literally the next reader. Be concrete.

```
SESSION <n> — <date>

DID           <what is now true that was not before>
IN FLIGHT     <what is half-finished, and exactly where — file:line>
NEXT          <the single next action, specific enough to start cold>
SURPRISES     <anything that contradicted the docs, or cost time>
DO NOT        <traps discovered this session>
```

`SURPRISES` is the highest-value field. If a `context/` doc was wrong or ambiguous, say which section
— and if it is clearly wrong, propose the correction rather than working around it silently.

### Then verify

Re-read what you wrote and ask: **could a session with no memory of this conversation pick it up from
these notes alone?** If not, the notes are not finished. Vague handoffs are why work gets redone.

---

## `/remember restore`

Run at session start, or immediately after a compaction.

1. **Read `context/progress-tracker.md`** — current phase, §4 blockers, §5 decisions, §8 handoff.
2. **Read `NOTES.md`** if it exists — the previous session's working state.
3. **Read only the `context/` rows the next task needs** — the map is in `CLAUDE.md`. Do not reload the whole directory; that is what caused the compaction.
4. **Verify reality against the notes** — `git log --oneline -5` and `git status`. Notes describe intent; the repo describes fact. When they disagree, the repo wins and the notes are stale.
5. **Check the blockers** — is the next task blocked? If so, say so instead of starting it.

Then **summarise back before doing anything**:

```
RESTORED
Phase:        <phase, and whether its gate has passed>
Last done:    <from handoff>
In flight:    <what is half-finished, if anything>
Blockers:     <open ones affecting this task>
Next action:  <what I am about to do>
Divergence:   <where the repo disagrees with the notes, or "none">
```

**Wait for confirmation before continuing.** The most expensive failure mode is confidently resuming
work that was already abandoned, superseded, or done differently.

---

## Compacting mid-session

When context is filling and the work is not done:

- **Recall first, precision second.** Capture everything relevant, then tighten. Losing a detail is worse than being verbose.
- **Keep:** architectural decisions, unresolved bugs with reproduction steps, the exact next step, anything that contradicted a doc.
- **Discard:** tool output already acted on, file contents you can re-read, exploration that led nowhere (but keep *that it led nowhere* — that is a finding).
- **Never keep in context what belongs in a file.** Write it to `NOTES.md`, then let it go.
