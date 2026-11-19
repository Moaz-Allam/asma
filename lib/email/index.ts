import 'server-only';

import { getEnv } from '@/lib/env';

import { createFakeDriver, createOffDriver, createResendDriver } from './drivers';
import type { EmailDriver } from './types';

/**
 * The email door (spec 0011-13 AC-1, R-4). The only module that reads EMAIL_API_KEY, EMAIL_FROM, EMAIL_DRIVER and
 * EMAIL_FAKE_FILE, or calls Resend (REST over fetch, 15 seconds, no SDK). Only lib/relay imports it (lint and a
 * source test): mail is sent by the relay's `email` task, never in a request path (rule 3).
 */

export * from './types';
export { EmailRenderError, renderEmail } from './templates';
export { EMAIL_CALL_TIMEOUT_MS, RESEND_URL, resendOutcome } from './drivers';

/** Which driver runs. `off` unless set. */
export function emailDriver(): 'off' | 'fake' | 'resend' {
  return getEnv().EMAIL_DRIVER;
}

/** The driver this deployment sends through. */
export function createEmailDriver(): EmailDriver {
  const env = getEnv();
  const driver = env.EMAIL_DRIVER;
  if (driver === 'fake') return createFakeDriver(env.EMAIL_FAKE_FILE);
  if (driver === 'resend') return createResendDriver({ apiKey: env.EMAIL_API_KEY, from: env.EMAIL_FROM });
  return createOffDriver();
}
