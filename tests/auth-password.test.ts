import { beforeEach, describe, expect, it, vi } from 'vitest';

import { passwordSignInFailure, setPasswordFailure } from '@/lib/auth/auth-errors';
import { COMMON_PASSWORDS } from '@/lib/auth/common-passwords';

/**
 * Spec 0012 AC-1, AC-2, AC-5, AC-7: the password checks, the NFC and 72 byte counts, the error maps, and the calls
 * to Auth through a stubbed browser client (a stub proves the SDK call shape, never Auth's settings: AC-13 does).
 */

const auth = {
  signInWithPassword: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
};
vi.mock('@/lib/db/client', () => ({ createSupabaseBrowser: () => ({ auth }) }));

const {
  changePassword,
  normalizePassword,
  passwordBytes,
  passwordChars,
  passwordProblems,
  setPassword,
  signInWithPassword,
  signOutOtherDevices,
} = await import('@/lib/auth/password');

const PHONE = '+905551234567';
const failure = (status: number, code: string, message = 'x') => ({ status, code, message });

beforeEach(() => {
  vi.resetAllMocks();
});

describe('the counts (AC-5)', () => {
  it('counts code points after NFC, not UTF 16 units', () => {
    expect(passwordChars('😀😀😀😀😀😀😀😀😀😀')).toBe(10);
    // "ş" written as s + a combining cedilla is one character after NFC.
    expect(passwordChars('ş'.repeat(10))).toBe(10);
    expect(normalizePassword('ş')).toBe('ş');
  });

  it('counts UTF 8 bytes: Arabic letters take two, Turkish ones two, Latin one', () => {
    expect(passwordBytes('a'.repeat(72))).toBe(72);
    expect(passwordBytes('س'.repeat(36))).toBe(72);
    expect(passwordBytes('ğ'.repeat(36))).toBe(72);
  });

  it('never trims or folds what is sent', () => {
    expect(normalizePassword('  ١٢٣ abc  ')).toBe('  ١٢٣ abc  ');
  });
});

describe('passwordProblems (AC-5)', () => {
  it('accepts a long, uncommon password', () => {
    expect(passwordProblems('kırmızı-elma-2026', PHONE)).toEqual([]);
  });

  it('accepts a 10 letter Arabic password', () => {
    expect(passwordProblems('كلمةسرطويل', PHONE)).toEqual([]);
  });

  it('refuses fewer than 10 characters', () => {
    expect(passwordProblems('kısa-şey', PHONE)).toContain('too_short');
  });

  it('refuses more than 72 bytes: 37 Arabic letters', () => {
    expect(passwordProblems('ب'.repeat(36), PHONE)).not.toContain('too_long');
    expect(passwordProblems('ب'.repeat(37), PHONE)).toContain('too_long');
  });

  it('refuses only digits, Western or Arabic Indic', () => {
    expect(passwordProblems('8264019375', PHONE)).toContain('only_digits');
    expect(passwordProblems('٨٢٦٤٠١٩٣٧٥', PHONE)).toContain('only_digits');
  });

  it('refuses one repeated character', () => {
    expect(passwordProblems('zzzzzzzzzzzz', PHONE)).toContain('one_character');
  });

  it("refuses the account's own national digits, in either script", () => {
    expect(passwordProblems('ben5551234567!', PHONE)).toContain('has_phone');
    expect(passwordProblems('ben٥٥٥١٢٣٤٥٦٧!', PHONE)).toContain('has_phone');
    expect(passwordProblems('ben551234567!x', '+966551234567')).toContain('has_phone');
    expect(passwordProblems('ben5551234567!', null)).not.toContain('has_phone');
  });

  it('refuses a common password, in any case', () => {
    expect(COMMON_PASSWORDS.size).toBe(999);
    expect(passwordProblems('qwertyuiop', PHONE)).toContain('common');
    expect(passwordProblems('QwertyUIOP', PHONE)).toContain('common');
  });

  it('refuses two fields that differ, compared after NFC', () => {
    expect(passwordProblems('kırmızı-elma-2026', PHONE, 'kırmızı-elma-2025')).toContain('mismatch');
    expect(passwordProblems('ş'.repeat(5) + 'abcde', PHONE, 'ş'.repeat(5) + 'abcde')).not.toContain(
      'mismatch',
    );
  });
});

describe('passwordSignInFailure (AC-2)', () => {
  it.each([
    ['a wrong password or an unknown phone', failure(400, 'invalid_credentials'), 'bad_credentials', false],
    [
      'an account whose phone is not confirmed',
      failure(400, 'phone_not_confirmed'),
      'bad_credentials',
      false,
    ],
    ['the bot check', failure(400, 'captcha_failed'), 'bot_check_failed', false],
    ['the per IP limit', failure(429, 'over_request_rate_limit'), 'limit_ip', false],
    ['anything else', failure(500, 'unexpected_failure'), 'network', true],
  ])('%s', (_name, error, code, report) => {
    expect(passwordSignInFailure(error)).toEqual({ error: code, report });
  });

  it('a dropped request is network, not reported', () => {
    expect(passwordSignInFailure({ name: 'AuthRetryableFetchError' })).toEqual({
      error: 'network',
      report: false,
    });
  });

  it('an unknown code is never bad_credentials', () => {
    expect(passwordSignInFailure(failure(400, 'user_not_found')).error).toBe('network');
  });
});

describe('setPasswordFailure (AC-5)', () => {
  it.each([
    ['weak', failure(422, 'weak_password'), 'weak_password', false],
    ['the same password', failure(422, 'same_password'), 'same_password', false],
    ['an old session', failure(400, 'reauthentication_needed'), 'reauth_needed', false],
    ['anything else', failure(500, 'unexpected_failure'), 'network', true],
  ])('%s', (_name, error, code, report) => {
    expect(setPasswordFailure(error)).toEqual({ error: code, report });
  });

  it('a dropped request is network, not reported', () => {
    expect(setPasswordFailure({ name: 'TypeError' })).toEqual({ error: 'network', report: false });
  });
});

describe('the calls to Auth', () => {
  it('signs in with the phone, the NFC password and the token', async () => {
    auth.signInWithPassword.mockResolvedValue({ error: null });
    await expect(signInWithPassword(PHONE, ' şifre ', 'tok')).resolves.toEqual({ ok: true });
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      phone: PHONE,
      password: ' şifre ',
      options: { captchaToken: 'tok' },
    });
  });

  it('maps a refused sign in, and a thrown one', async () => {
    auth.signInWithPassword.mockResolvedValue({ error: failure(400, 'invalid_credentials') });
    await expect(signInWithPassword(PHONE, 'x', 'tok')).resolves.toEqual({
      ok: false,
      error: 'bad_credentials',
      report: false,
    });
    auth.signInWithPassword.mockRejectedValue(new TypeError('fetch failed'));
    await expect(signInWithPassword(PHONE, 'x', 'tok')).resolves.toEqual({
      ok: false,
      error: 'network',
      report: false,
    });
  });

  it('sets the NFC password', async () => {
    auth.updateUser.mockResolvedValue({ error: null });
    await expect(setPassword('ş'.repeat(10))).resolves.toEqual({ ok: true });
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'ş'.repeat(10) });
  });

  it('changes: a wrong current password stops before updateUser', async () => {
    auth.signInWithPassword.mockResolvedValue({ error: failure(400, 'invalid_credentials') });
    await expect(changePassword(PHONE, 'old', 'new-password-1', 'tok')).resolves.toMatchObject({
      ok: false,
      error: 'bad_credentials',
    });
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it('changes: the sign in, then the new password', async () => {
    auth.signInWithPassword.mockResolvedValue({ error: null });
    auth.updateUser.mockResolvedValue({ error: null });
    await expect(changePassword(PHONE, 'old', 'new-password-1', 'tok')).resolves.toEqual({ ok: true });
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      phone: PHONE,
      password: 'old',
      options: { captchaToken: 'tok' },
    });
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'new-password-1' });
  });

  it('signs out other devices, retried once', async () => {
    auth.signOut.mockResolvedValueOnce({ error: failure(500, 'x') }).mockResolvedValueOnce({ error: null });
    await expect(signOutOtherDevices()).resolves.toBe(true);
    expect(auth.signOut).toHaveBeenCalledTimes(2);
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'others' });
  });

  it('reports false when both sign outs fail', async () => {
    auth.signOut.mockRejectedValue(new Error('down'));
    await expect(signOutOtherDevices()).resolves.toBe(false);
    expect(auth.signOut).toHaveBeenCalledTimes(2);
  });
});
