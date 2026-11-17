import 'server-only';

import type { Db } from '@/lib/db/types';
import { pspDriver } from '@/lib/env';
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

export function relayPsp(db: Db): PspAdapter {
  const driver = pspDriver();
  return createPsp({ driver, origin: appOrigin(), fakeStore: driver === 'fake' ? fakeStore(db) : undefined });
}
