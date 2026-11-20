import { LOGIN_STEP_KEY, LOGIN_STEP_MS } from './limits';

/**
 * The phone and send time, kept across a reload on the code step (spec 0005 AC-6): phones often reload
 * after a trip to the SMS app. Holds nothing a caller could trust. It can come back empty in a private
 * window, so every touch is wrapped.
 */

/** `reset`: the code is for a password reset (spec 0012 AC-3), kept so a reload on the code step keeps it. */
export type LoginStep = { phone: string; sentAt: number; reset?: boolean };

/** The raw value, for `useSyncExternalStore`: a string stays equal between reads, an object would not. */
export function rawLoginStep(): string | null {
  try {
    return sessionStorage.getItem(LOGIN_STEP_KEY);
  } catch {
    return null;
  }
}

export function parseLoginStep(raw: string | null, now = Date.now()): LoginStep | null {
  try {
    const stored: unknown = JSON.parse(raw ?? 'null');
    if (typeof stored !== 'object' || stored === null) return null;
    const { phone, sentAt, reset } = stored as Partial<LoginStep>;
    if (typeof phone !== 'string' || typeof sentAt !== 'number') return null;
    if (now - sentAt >= LOGIN_STEP_MS) return null;
    return reset === true ? { phone, sentAt, reset } : { phone, sentAt };
  } catch {
    return null;
  }
}

export function saveLoginStep(step: LoginStep): void {
  try {
    sessionStorage.setItem(LOGIN_STEP_KEY, JSON.stringify(step));
  } catch {
    // A reload loses the step. The form still works.
  }
}

export function clearLoginStep(): void {
  try {
    sessionStorage.removeItem(LOGIN_STEP_KEY);
  } catch {
    // Nothing to clear.
  }
}
