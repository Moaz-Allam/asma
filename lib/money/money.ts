import 'server-only';

import type { Currency } from '@/lib/region';

/**
 * Money. See code-standards.md §5 — the strictest rules in the codebase.
 *
 * Rule 4: integer MINOR UNITS only (kuruş, halalas). No float, ever. A float in a
 * ledger is not a rounding inconvenience, it is a slow corruption that reconciles
 * to nothing.
 *
 * This feature ships the TYPE only. Arithmetic, rounding, and ledger posting
 * arrive with feature 14, behind the human review gate.
 */

export type Money = {
  /** Integer minor units. Never a decimal. */
  readonly amount: number;
  readonly currency: Currency;
};

export function money(amount: number, currency: Currency): Money {
  if (!Number.isInteger(amount)) {
    throw new Error(
      `Money must be an integer in minor units, got ${amount}. ` +
        'A fractional amount here means a float entered the pipeline. See code-standards.md §5.',
    );
  }
  return { amount, currency };
}

/**
 * Currencies never mix in one calculation. Under D14 both live in one database,
 * so this is a runtime guard rather than a deployment guarantee — an account
 * belongs to one region, so a mixed pair means the rows were joined wrongly.
 */
export function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new Error(
      `Refusing to combine ${a.currency} with ${b.currency}. ` +
        'Every posting group is single-currency by construction. See architecture.md §18.',
    );
  }
}
