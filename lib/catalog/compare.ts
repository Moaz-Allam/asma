/**
 * Does a draft differ from the published formula? (spec 0007 AC-20). Compared as numbers written in text,
 * so `1.3` equals `1.30` and `1200` equals `1200.00`, by string steps only: the browser does no money
 * arithmetic (rule 4). The database decides again on publish (`no_changes`).
 */

import { foldDigits } from './digits';

/** A decimal as canonical text (`-1.3`, `0`, `1200`), or the trimmed input when it is not one. */
export function canonicalDecimal(text: string | null): string | null {
  if (text === null) return null;
  const folded = foldDigits(text.trim()).replace(/[,٫]/g, '.').replace('−', '-');
  const match = /^(-?)([0-9]+)(?:\.([0-9]+))?$/.exec(folded);
  if (!match) return folded;
  const whole = (match[2] ?? '').replace(/^0+(?=[0-9])/, '');
  const frac = (match[3] ?? '').replace(/0+$/, '');
  const body = frac === '' ? whole : `${whole}.${frac}`;
  return match[1] === '-' && body !== '0' ? `-${body}` : body;
}

export type ComparableModifier = {
  questionKey: string | null;
  matchType: string;
  matchValue: unknown;
  effectType: string;
  amount: string | null;
  factor: string | null;
};

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export function sameFormula(
  a: { base: string; modifiers: readonly ComparableModifier[] },
  b: { base: string; modifiers: readonly ComparableModifier[] },
): boolean {
  if (canonicalDecimal(a.base) !== canonicalDecimal(b.base)) return false;
  if (a.modifiers.length !== b.modifiers.length) return false;
  return a.modifiers.every((m, i) => {
    const n = b.modifiers[i];
    return (
      n !== undefined &&
      m.questionKey === n.questionKey &&
      m.matchType === n.matchType &&
      m.effectType === n.effectType &&
      sameValue(m.matchValue, n.matchValue) &&
      canonicalDecimal(m.amount) === canonicalDecimal(n.amount) &&
      canonicalDecimal(m.factor) === canonicalDecimal(n.factor)
    );
  });
}
