import 'server-only';

import { createFakeAdapter, type FakeStore } from './fake';
import { createIyzicoAdapter } from './iyzico';
import { createOffAdapter } from './off';
import { PspError, type PspAdapter } from './types';

/**
 * The PSP door (spec 0011-08 AC-1 to AC-4). Only the relay imports it (rule 3, lint: `lib/**\/relay/**`).
 * `createPsp` picks the driver and gives every call a 15 second timeout (`psp_timeout`), whatever the driver.
 */

export * from './types';
export {
  FAKE_OUTCOMES,
  FAKE_SIGNATURE_HEADER,
  FAKE_TOKEN_LIFETIME_SECONDS,
  fakeSignature,
  parseFakeToken,
  type FakeOutcome,
  type FakeState,
  type FakeStore,
} from './fake';

export const PSP_CALL_TIMEOUT_MS = 15_000;

export type PspOptions = {
  driver: 'off' | 'fake' | 'iyzico';
  /** `appOrigin()`: the fake's card page host. */
  origin: string;
  /** The fake's store; required with `fake`. */
  fakeStore?: FakeStore;
  /** The fake's webhook secret for this deployment (security review S2); the test default when absent. */
  fakeWebhookSecret?: string;
  timeoutMs?: number;
};

function withTimeout<T>(call: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new PspError('psp_timeout')), ms);
  });
  return Promise.race([call, timeout]).finally(() => clearTimeout(timer));
}

/** Every adapter call bounded by the timeout (AC-1). */
function bounded(adapter: PspAdapter, ms: number): PspAdapter {
  return {
    name: adapter.name,
    homeRegion: adapter.homeRegion,
    checkoutHosts: adapter.checkoutHosts,
    initializeCheckout: (request) => withTimeout(adapter.initializeCheckout(request), ms),
    retrieveCheckout: (token) => withTimeout(adapter.retrieveCheckout(token), ms),
    retrievePayment: (id) => withTimeout(adapter.retrievePayment(id), ms),
    refundPayment: (request) => withTimeout(adapter.refundPayment(request), ms),
    verifyWebhook: (input) => withTimeout(adapter.verifyWebhook(input), ms),
  };
}

export function createPsp(options: PspOptions): PspAdapter {
  const ms = options.timeoutMs ?? PSP_CALL_TIMEOUT_MS;
  if (options.driver === 'fake') {
    if (options.fakeStore === undefined) throw new Error('the fake PSP needs its store');
    return bounded(
      createFakeAdapter({
        store: options.fakeStore,
        origin: options.origin,
        webhookSecret: options.fakeWebhookSecret,
      }),
      ms,
    );
  }
  if (options.driver === 'iyzico') return bounded(createIyzicoAdapter(), ms);
  return bounded(createOffAdapter(), ms);
}
