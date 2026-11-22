import { createSupabaseBrowser } from '@/lib/db/client';
import { foldDigits, phoneRegion } from '@/lib/region/phone';

import {
  passwordSignInFailure,
  setPasswordFailure,
  type Failure,
  type PasswordSignInError,
  type SetPasswordError,
} from './auth-errors';
import { COMMON_PASSWORDS } from './common-passwords';

/**
 * Passwords, from the browser straight to Supabase Auth (spec 0012, D98). The password never reaches a Server Action,
 * a Route Handler, a log, an event or Sentry of ours: Auth checks it, and the database keeps it only on a phone a
 * code has proven (`password_guard`, AC-8).
 *
 * A password is sent exactly as typed after NFC normalization: never trimmed, its digits never folded (AC-1). The
 * checks here repeat Auth's length rules for their messages and add a weak check that runs in the browser only
 * (AC-5): the raw API can skip it, which the spec accepts.
 */

export const PASSWORD_MIN_CHARS = 10;
/** Auth's limit (bcrypt), in UTF 8 bytes: about 72 Latin letters or about 36 Arabic letters. */
export const PASSWORD_MAX_BYTES = 72;

export type PasswordProblem =
  'too_short' | 'too_long' | 'only_digits' | 'one_character' | 'has_phone' | 'common' | 'mismatch';

export type PasswordResult<E> = { ok: true } | ({ ok: false } & Failure<E>);

/** What is sent to Auth: NFC, nothing else. */
export function normalizePassword(text: string): string {
  return text.normalize('NFC');
}

/**
 * Unicode code points. The form asks for 10 of them. Auth is believed to count bytes (Go `len`), so the form is never
 * laxer than Auth; AC-13's real calls confirm Auth's own floor.
 */
export function passwordChars(text: string): number {
  return [...normalizePassword(text)].length;
}

export function passwordBytes(text: string): number {
  return new TextEncoder().encode(normalizePassword(text)).length;
}

/** The national digits of an E.164 mobile number (ten in TR, nine in KSA), or null. */
function nationalDigits(phone: string | null): string | null {
  if (!phone) return null;
  const region = phoneRegion(phone);
  if (region === 'TR') return phone.slice(-10);
  if (region === 'KSA') return phone.slice(-9);
  // Spec 0013: a listed test number has no pattern region; its last ten digits still count as the phone.
  if (/^\+[1-9][0-9]{7,14}$/.test(phone)) return phone.slice(-10);
  return null;
}

/**
 * Why a new password is refused before any Auth call, in the order the form shows them; empty when it may be sent.
 * The weak checks read a copy with Arabic digits folded, so `٥٥٥…` counts as the phone too; the password sent is
 * never folded.
 */
export function passwordProblems(text: string, phone: string | null, repeat?: string): PasswordProblem[] {
  const problems: PasswordProblem[] = [];
  const nfc = normalizePassword(text);
  const chars = [...nfc];
  if (chars.length < PASSWORD_MIN_CHARS) problems.push('too_short');
  if (passwordBytes(nfc) > PASSWORD_MAX_BYTES) problems.push('too_long');
  const folded = foldDigits(nfc);
  if (chars.length > 0 && /^[0-9]+$/.test(folded)) problems.push('only_digits');
  if (chars.length > 1 && chars.every((c) => c === chars[0])) problems.push('one_character');
  const national = nationalDigits(phone);
  if (national && folded.includes(national)) problems.push('has_phone');
  if (COMMON_PASSWORDS.has(nfc.toLowerCase())) problems.push('common');
  if (repeat !== undefined && normalizePassword(repeat) !== nfc) problems.push('mismatch');
  return problems;
}

/** AC-1: phone (E.164) and password, with a live bot check token. */
export async function signInWithPassword(
  phone: string,
  password: string,
  captchaToken: string,
): Promise<PasswordResult<PasswordSignInError>> {
  try {
    const { error } = await createSupabaseBrowser().auth.signInWithPassword({
      phone,
      password: normalizePassword(password),
      options: { captchaToken },
    });
    return error ? { ok: false, ...passwordSignInFailure(error) } : { ok: true };
  } catch (error) {
    return { ok: false, ...passwordSignInFailure(error instanceof Error ? error : {}) };
  }
}

/** AC-5, AC-6: a first password, or a reset one, on the session the code sign in created. */
export async function setPassword(password: string): Promise<PasswordResult<SetPasswordError>> {
  try {
    const { error } = await createSupabaseBrowser().auth.updateUser({
      password: normalizePassword(password),
    });
    return error ? { ok: false, ...setPasswordFailure(error) } : { ok: true };
  } catch (error) {
    return { ok: false, ...setPasswordFailure(error instanceof Error ? error : {}) };
  }
}

/**
 * AC-7: the current password first, through a sign in with the account's own phone (read on the server, never typed)
 * and the bot check token, then the new one on the session that sign in returned. A slip guard, not an attacker
 * guard: a session younger than 24 hours can call `updateUser` directly.
 */
export async function changePassword(
  phone: string,
  current: string,
  next: string,
  captchaToken: string,
): Promise<PasswordResult<PasswordSignInError | SetPasswordError>> {
  const signedIn = await signInWithPassword(phone, current, captchaToken);
  if (!signedIn.ok) return signedIn;
  return setPassword(next);
}

/** After any set or change: every other session ends. Retried once; false when both tries failed. */
export async function signOutOtherDevices(): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { error } = await createSupabaseBrowser().auth.signOut({ scope: 'others' });
      if (!error) return true;
    } catch {
      // Tried again below, then reported by the caller.
    }
  }
  return false;
}
