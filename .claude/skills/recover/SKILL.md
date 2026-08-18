---
name: recover
description: Diagnose what kind of failure you are actually dealing with before responding to it. Use when a fix did not hold after one corrective attempt, when the same error keeps reappearing in a different shape, when a test was made to pass without understanding why it failed, or when the session has accumulated so many partial changes that the state is unclear. Chooses between a targeted fix, a hard reset, and a rethink.
---

# /recover

Not every problem is a bug. Not every bug needs debugging. Responding to the wrong failure type is
what turns one bad hour into a corrupted branch.

**Stop editing code before running this.** The instinct to try one more thing is the thing to resist.

---

## 1. Say what is actually happening

In plain language, no theory yet:

- What did you expect, and what happened instead? Quote the error exactly.
- How many corrective attempts so far? What did each change?
- Did any attempt make it *different* rather than *better*? Different-but-still-broken usually means the diagnosis is wrong.
- Is the code currently in a known state, or is it a pile of half-reverted edits?

---

## 2. Check the four cheap explanations first

Most "mysterious" failures in this stack are one of these. Rule them out before theorising.

| Symptom | Likely cause |
| --- | --- |
| Route protection silently absent | `middleware.ts` instead of `proxy.ts` — Next 16 ignores the old name with no error |
| A query returns rows it should not, or none at all | RLS missing, or a policy filtering rows when the leak is a **column** |
| Intermittent failure under load, prepared-statement errors, session state lost | Transaction-mode pooler — prepared statements must be disabled; no persistent `SET`, no `LISTEN`/`NOTIFY` |
| API shape does not match what you wrote | Next.js 16 / React 19 / Tailwind v4 changed. Read the installed docs, not memory |
| Money off by a rounding unit | Rounded more than once, or a float entered the pipeline |
| A hook blocked the write | Not a bug. Read the rule it named and fix the code |

---

## 3. Classify the failure

Pick one. The choice determines everything after it.

### A — Targeted fix
*The problem is isolated, understood, and the surrounding code is sound.*

Signals: one clear symptom · reproducible on demand · you can state the root cause in a sentence · earlier work is unaffected.

Do: reproduce it deliberably · state the root cause before touching anything · make the **smallest** change that addresses the cause, not the symptom · add the test that would have caught it · verify the original reproduction now passes.

Never: adjust a value until the error disappears · add a `try/catch` that swallows it · loosen a type · weaken an RLS policy or a constraint to make a test green. That last one is a data-breach vector, not a fix.

### B — Hard reset
*The session is polluted. The code no longer reflects any single coherent intention.*

Signals: three or more attempts, each partially reverted · you cannot say what the current diff is meant to do · fixing one thing breaks another that used to work · you are debugging your own earlier patches rather than the feature.

Do: `git diff` and read it honestly · identify the last known-good commit · save anything genuinely worth keeping as notes (not code) in `NOTES.md` · discard the working changes — **ask the human first, and show them the diff you propose to throw away** · re-read the relevant `context/` section · re-implement in one pass with the understanding you now have.

The second attempt is usually much faster. The knowledge survives; the code does not need to.

### C — Rethink
*The foundation is wrong. No amount of debugging reaches it.*

Signals: every fix creates a new problem elsewhere · the design fights a rule in `CLAUDE.md` · you keep wanting to bypass a guardrail to make it work · the feature needs data or a capability the architecture does not provide · you are reimplementing something the platform, Supabase, or shadcn already does.

Do: stop. Write down what the design assumes and which assumption is false. Take it to the human with `/architect` — a plan, not a patch. If a `context/` doc is what is wrong, say which section and propose the correction.

**Wanting to weaken a guardrail is the clearest signal that you are in C, not A.** Escalate instead.

---

## 4. Report before acting

```
FAILURE      <what breaks, quoted exactly>
ATTEMPTS     <how many, what each changed>
ROOT CAUSE   <one sentence, or "unknown — here is what I ruled out">
CLASS        A targeted fix | B hard reset | C rethink
WHY          <the signals that decided it>
PROPOSAL     <the specific next action>
NEEDS HUMAN  <yes/no — always yes for B and C>
```

B and C require the human to agree before you act. A can proceed.

---

## 5. Afterwards

Record it in `progress-tracker.md` §14 — what broke, the real root cause, and what now prevents it.
If the same class of failure has now happened twice, that is not bad luck: propose the mechanical
guard that would stop the third one, whether a hook, a test, or a database constraint.
