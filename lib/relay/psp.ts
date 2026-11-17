import 'server-only';

import { createHash } from 'node:crypto';

import type { Db } from '@/lib/db/types';
import { getEnv, pspDriver } from '@/lib/env';
import { appOrigin } from '@/lib/http/origin';
import { createPsp, type FakeState, type FakeStore, type PspAdapter } from '@/lib/psp';

import { call } from './db';

/**
 * The PSP the relay talks to (spec 0011-08 AC-2), and the fake's store over `fake_psp_get` and `fake_psp_set`
 * (AC-15): `lib/psp` never imports `lib/db`, so the relay hands it these two functions.
 */

export function fakeStore(db: Db): FakeStore {
  return {
    get: (token: string) => call<unknown>(db, 'fake_psp_get', { p_token: token }),
    set: async (token: string, state: FakeState) => {
      await call<null>(db, 'fake_psp_set', { p_token: token, p_outcome: state });
    },
  };
}

/**
 * The fake's webhook secret on this deployment (security review S2): derived from RELAY_SECRET, so it differs per
 * deployment and nobody outside can sign a webhook for a fake preview. Without RELAY_SECRET (local development)
 * the fake's test default.
 */
export function fakeWebhookSecret(): string | undefined {
  const secret = getEnv().RELAY_SECRET;
  return secret === undefined
    ? undefined
    : createHash('sha256').update(`fake-psp-webhook:${secret}`).digest('hex');
}

export function relayPsp(db: Db): PspAdapter {
  const driver = pspDriver();
  return driver === 'fake'
    ? createPsp({
        driver,
        origin: appOrigin(),
        fakeStore: fakeStore(db),
        fakeWebhookSecret: fakeWebhookSecret(),
      })
    : createPsp({ driver, origin: appOrigin() });
}
