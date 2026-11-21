import { describe, expect, it } from 'vitest';

import { continueTarget, type ContinueInput } from '@/lib/auth/continue';

/** Spec 0012 AC-4, AC-6: where `continue` sends a signed in user, in order. */

const base: ContinueInput = { role: 'customer', hasPassword: true, reset: false, next: null, as: null };

describe('continueTarget', () => {
  it('sends a user with no role to onboarding, keeping as=provider only', () => {
    expect(continueTarget({ ...base, role: null, hasPassword: false })).toBe('/onboarding');
    expect(continueTarget({ ...base, role: null, as: 'provider' })).toBe('/onboarding?as=provider');
    expect(continueTarget({ ...base, role: null, as: 'admin' })).toBe('/onboarding');
  });

  it('sends a role with no password to the password step, carrying the landing', () => {
    expect(continueTarget({ ...base, hasPassword: false })).toBe('/account/password?next=%2Frequests');
    expect(continueTarget({ ...base, hasPassword: false, next: '/requests/new' })).toBe(
      '/account/password?next=%2Frequests%2Fnew',
    );
  });

  it('asks for a first password before a reset', () => {
    expect(continueTarget({ ...base, hasPassword: false, reset: true })).toBe(
      '/account/password?next=%2Frequests',
    );
  });

  it('sends reset=1 to the reset step', () => {
    expect(continueTarget({ ...base, reset: true, role: 'provider' })).toBe(
      '/account/password?reason=reset&next=%2Fprovider',
    );
  });

  it('otherwise lands as before, with a safe next only', () => {
    expect(continueTarget(base)).toBe('/requests');
    expect(continueTarget({ ...base, next: '/requests/abc' })).toBe('/requests/abc');
    expect(continueTarget({ ...base, next: '//evil.example' })).toBe('/requests');
    expect(continueTarget({ ...base, next: '/admin' })).toBe('/requests');
  });

  it('never carries an unsafe next into the password step', () => {
    expect(continueTarget({ ...base, hasPassword: false, next: 'https://evil.example' })).toBe(
      '/account/password?next=%2Frequests',
    );
  });
});
