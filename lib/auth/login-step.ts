import { LOGIN_STEP_KEY, LOGIN_STEP_MS } from './limits';

/**
 * The phone and send time, kept across a reload on the code step (spec 0005 AC-6): phones often reload
 * after a trip to the SMS app. Holds nothing a caller could trust. It can come back empty in a private
 * window, so every touch is wrapped.
 */

export type LoginStep = { phone: string; sentAt: number };

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
    const { phone, sentAt } = stored as Partial<LoginStep>;
    if (typeof phone !== 'string' || typeof sentAt !== 'number') return null;
    return now - sentAt < LOGIN_STEP_MS ? { phone, sentAt } : null;
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
