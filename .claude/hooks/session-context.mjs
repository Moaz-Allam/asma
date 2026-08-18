#!/usr/bin/env node
/**
 * SessionStart hook — just-in-time project state.
 *
 * CLAUDE.md tells the agent to read progress-tracker.md first. This delivers the
 * three things that actually gate the next decision — phase, open blockers, and
 * the next unchecked feature — for zero tool calls and a few hundred tokens,
 * instead of a 282-line read. The agent still reads the full file when it needs
 * the decision log or PSP facts.
 *
 * Fails open and silent: a broken hook must never block a session from starting.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const tracker = join(root, 'context', 'progress-tracker.md');

function emit(context) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context },
    }),
  );
}

try {
  if (!existsSync(tracker)) process.exit(0);
  const md = readFileSync(tracker, 'utf8');
  const lines = md.split(/\r?\n/);
  const out = [];

  const phase = lines.find((l) => /^\*\*Current phase:\*\*/.test(l));
  const status = lines.find((l) => /^\*\*Overall status:\*\*/.test(l));
  const next = lines.find((l) => /^\*\*Next:\*\*/.test(l));
  if (phase) out.push(phase.replace(/\*\*/g, ''));
  if (status) out.push(status.replace(/\*\*/g, ''));
  if (next) out.push(next.replace(/\*\*/g, ''));

  // Open blockers: table rows in §4 whose status cell is not resolved.
  const blockers = lines
    .filter((l) => /^\|\s*B\d+\s*\|/.test(l) && !/✅|resolved|closed/i.test(l))
    .map((l) => {
      const cells = l.split('|').map((c) => c.trim());
      return `  - ${cells[1]}: ${cells[2].replace(/\*\*/g, '').slice(0, 110)}`;
    });
  if (blockers.length) {
    out.push(`\nOpen blockers (${blockers.length}) — do not guess past these:`);
    out.push(...blockers);
  }

  // First unchecked feature in the §12 progress checklist.
  const todo = lines.find((l) => /^- \[ \]\s+\d/.test(l));
  if (todo) out.push(`\nFirst unchecked feature: ${todo.replace(/^- \[ \]\s*/, '')}`);

  if (!out.length) process.exit(0);

  emit(
    'Project state from context/progress-tracker.md (authoritative; re-read the file for the ' +
      'decision log, PSP facts, or design questions):\n\n' +
      out.join('\n') +
      // Injected rather than left in the docs because these are the facts most
      // likely to be wrong in training data or in a stale memory of this project,
      // and each one silently produces incorrect code rather than an error.
      '\n\nStanding facts (all 13 known doc contradictions are fixed — see context/contradictions.md):\n' +
      '  • Lifecycle: OPEN → SELECTED → FUNDED → UNLOCKED → IN_PROGRESS → AWAITING_CONFIRMATION → RELEASED.\n' +
      '    The customer pays BEFORE the provider unlocks.\n' +
      '  • Money path is DB transaction → outbox_events → relay worker → PSP. Never an inline PSP call.\n' +
      '  • Three locales — ar (RTL), tr (LTR), en (LTR). Direction is derived from locale at runtime, never\n' +
      '    hardcoded. Two regions (TR, KSA) run from ONE deployment, separated by a `region` COLUMN read\n' +
      '    from the owning row — never an env var. An account belongs to exactly one region, so one account\n' +
      '    means one currency. Locale and region are independent axes. See context/i18n.md.\n' +
      '  • Never case-fold an identifier under a Turkish locale: "I".toLocaleLowerCase("tr") is "ı", not "i".\n' +
      '  • Open gaps and unstated assumptions are catalogued in context/open-questions.md — check it before\n' +
      '    designing a feature it names.',
  );
} catch {
  process.exit(0);
}
