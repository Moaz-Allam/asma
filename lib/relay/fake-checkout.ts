import 'server-only';

import { pspDriver } from '@/lib/env';
import { appOrigin } from '@/lib/http/origin';
import {
  FAKE_OUTCOMES,
  FAKE_SIGNATURE_HEADER,
  fakeSignature,
  parseFakeToken,
  type FakeOutcome,
} from '@/lib/psp';
import type { Currency } from '@/lib/region';

import { relayDb } from './db';
import { fakeStore, fakeWebhookSecret } from './psp';

/**
 * The fake card page (spec 0011-08 AC-15). It exists only when `PSP_DRIVER=fake` and the deployment is not
 * production; everywhere else it is a 404. A choice is stored through `fake_psp_set`; the page then posts the
 * real callback form, and the webhook only case posts a webhook signed with the fake's fixed test secret.
 */

/** Fails closed: an environment that does not validate has no fake card page either. */
export function fakeCheckoutAvailable(): boolean {
  try {
    return pspDriver() === 'fake' && process.env.VERCEL_ENV !== 'production';
  } catch {
    return false;
  }
}

export type FakeCheckout = { token: string; amount: number; currency: Currency };

export function readFakeCheckout(token: string): FakeCheckout | null {
  if (!fakeCheckoutAvailable()) return null;
  const parsed = parseFakeToken(token);
  return parsed === null ? null : { token, amount: parsed.amount, currency: parsed.currency };
}

export const FAKE_CHOICES = FAKE_OUTCOMES;

export function isFakeOutcome(value: unknown): value is FakeOutcome {
  return (FAKE_OUTCOMES as readonly unknown[]).includes(value);
}

/**
 * Stores the choice for the token, once: a token that already has an outcome refuses a second choice, so the
 * fake never forgets a refund it made (security review S4). For `webhook_only` it posts the signed webhook to our
 * own endpoint. Returns false when the page is not available, the token belongs to no attempt, or a choice exists.
 */
export async function chooseFakeOutcome(token: string, outcome: FakeOutcome): Promise<boolean> {
  if (readFakeCheckout(token) === null) return false;
  try {
    const store = fakeStore(relayDb());
    if ((await store.get(token)) !== null) return false;
    await store.set(token, { outcome, retrieves: 0, refunds: {} });
  } catch {
    return false;
  }
  if (outcome === 'webhook_only') {
    const body = JSON.stringify({ eventId: `fake-${token}`.slice(0, 200), token, status: 'SUCCESS' });
    await fetch(`${appOrigin()}/api/psp/webhook`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [FAKE_SIGNATURE_HEADER]: fakeSignature(body, fakeWebhookSecret()),
      },
      body,
      signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined);
  }
  return true;
}
