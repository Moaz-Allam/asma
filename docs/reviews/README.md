# Reviews

Dated review and verify reports. One file per run, never rewritten afterwards; when findings are fixed,
append an outcome table (finding, outcome: fixed, skipped with reason, or no change needed).

| Kind | Written by | File name |
| --- | --- | --- |
| Verify (runtime proof against every acceptance criterion) | `/check verify` | `YYYY-MM-DD-<position>-verify.md` |
| Code review on a different model | `/check review` | `YYYY-MM-DD-<branch>.md` (branches are named after the position, e.g. `feat-01-sign-in`) |
| Slice review | `slice-reviewer` agent (the main thread saves its output) | `YYYY-MM-DD-<position>-slice.md` |
| Security review | `security-reviewer` agent, at gates and on money, auth, PII, storage | `YYYY-MM-DD-<position or gate>-security.md` |
| Spec cross check | a read only subagent on a different model | `YYYY-MM-DD-spec-NNNN-crosscheck.md` |

Severity levels, agreed in advance: **Critical** (money lost, data leaked, a rule that never bends
broken), **Major** (wrong behaviour against an acceptance criterion, a missing guard or test on a risky
path), **Minor** (everything else worth fixing). The owner decides what gets fixed.
