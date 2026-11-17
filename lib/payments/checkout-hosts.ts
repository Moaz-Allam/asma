import 'server-only';

import { pspDriver } from '@/lib/env';
import { appOrigin } from '@/lib/http/origin';

/**
 * The card page hosts of each PSP driver (spec 0011-08 AC-21, R-5), with no `lib/psp` import, so 09's redirect
 * can check a URL too. The adapters read their `checkoutHosts` from here, and a test asserts they match.
 *
 * iyzico's list is empty until S1 names the card page host per environment (AC-4 (d)), so every iyzico URL is
 * refused until 08b fills it.
 */

export const iyzicoCheckoutHosts: readonly string[] = [];

export type PspDriverName = 'off' | 'fake' | 'iyzico';

export function checkoutHostsFor(driver: PspDriverName, origin: string): readonly string[] {
  if (driver === 'fake') return [new URL(origin).host];
  if (driver === 'iyzico') return iyzicoCheckoutHosts;
  return [];
}

/** The hosts of the driver this deployment runs. */
export function activeCheckoutHosts(): readonly string[] {
  return checkoutHostsFor(pspDriver(), appOrigin());
}
