#!/usr/bin/env node
/**
 * SessionStart hook — just-in-time project state.
 *
 * AGENTS.md says to read the progress tracker first. This hands over what gates the next decision —
 * status, open blockers and risks, open questions, and the next unchecked position — for a few
 * hundred tokens, instead of a full read. The agent still reads the files when it needs the
 * decision log, owner steps, or PSP facts.
 *
 * Project authored, reads local files only, no network. Fails open and silent: a broken hook must
 * never block a session from starting.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const tracker = join(root, 'context', 'progress-tracker.md');
const plan = join(root, 'context', 'build-plan.md');

function emit(context) {
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } }),
  );
}

const cells = (line) => line.split('|').map((c) => c.trim());
const plain = (s, n) => s.replace(/\*\*|~~/g, '').slice(0, n);

try {
  if (!existsSync(tracker)) process.exit(0);
  const lines = readFileSync(tracker, 'utf8').split(/\r?\n/);
  const out = [];

  for (const key of ['Phase', 'Status', 'Next']) {
    const line = lines.find((l) => l.startsWith(`**${key}:**`));
    if (line) out.push(plain(line, 220));
  }

  const open = (l) => !/✅|RESOLVED|~~B/i.test(l);
  const blockers = lines.filter((l) => /^\|\s*B\d+\s*\|/.test(l) && open(l));
  if (blockers.length) {
    out.push(
      `\nOpen blockers (${blockers.length}) — stay open until the owner answers; do not guess past them:`,
    );
    for (const l of blockers) out.push(`  - ${cells(l)[1]}: ${plain(cells(l)[2] ?? '', 100)}`);
  }

  const risks = lines.filter((l) => /^\|\s*R\d+\s*\|/.test(l) && open(l));
  if (risks.length) {
    out.push(`\nOpen risks (${risks.length}):`);
    for (const l of risks) out.push(`  - ${cells(l)[1]}: ${plain(cells(l)[2] ?? '', 100)}`);
  }

  const questions = lines.filter((l) => /^\|\s*Q\d+\s*\|/.test(l) && !/~~Q/.test(l));
  if (questions.length) {
    out.push(
      `\nOpen questions (${questions.length}): ${questions.map((l) => cells(l)[1]).join(', ')} — see tracker §4.`,
    );
  }

  if (existsSync(plan)) {
    const row = readFileSync(plan, 'utf8')
      .split(/\r?\n/)
      .find((l) => /^\|\s*\d{2}[a-z]?\s*\|/.test(l) && l.includes('☐'));
    if (row)
      out.push(`\nNext position (build-plan.md): ${cells(row)[1]} — ${plain(cells(row)[2] ?? '', 140)}`);
  }

  if (!out.length) process.exit(0);

  emit(
    'Project state from context/progress-tracker.md and context/build-plan.md (authoritative; read them ' +
      'for the decision log, owner steps, and gates):\n\n' +
      out.join('\n') +
      // Injected because these are the facts most likely to be wrong in training data or a stale memory
      // of this project, and each one silently produces incorrect code rather than an error.
      '\n\nStanding facts:\n' +
      '  • Lifecycle: OPEN → SELECTED → FUNDED → UNLOCKED → IN_PROGRESS → AWAITING_CONFIRMATION → RELEASED.\n' +
      '    The customer pays BEFORE the provider unlocks.\n' +
      '  • Money path is DB transaction → outbox_events → relay worker → PSP. Never an inline PSP call.\n' +
      '  • Launch 2026-11-07, Turkey only, on iyzico Marketplace. KSA stays in the schema, switched off.\n' +
      '  • Three locales — ar (RTL), tr, en. Direction is derived from the locale at runtime. Regions live in\n' +
      '    a `region` COLUMN read from the owning row, never an env var; one account belongs to one region.\n' +
      '  • Never case-fold an identifier under a Turkish locale: "I".toLocaleLowerCase("tr") is "ı".\n' +
      '  • The per position loop, skills, and gates are in AGENTS.md. Specs live in docs/specs/.',
  );
} catch {
  process.exit(0);
}
