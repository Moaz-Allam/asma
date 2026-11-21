import { afterEach, describe, expect, it, vi } from 'vitest';

import { passwordSectionState } from '@/lib/account/password-section';
import { parseLoginStep } from '@/lib/auth/login-step';

/** Spec 0012 AC-3, AC-4, AC-7: the account page's Password section, and `reset` kept in `login_step`. */

describe('passwordSectionState', () => {
  it('shows the reminder while no password is set', () => {
    expect(
      passwordSectionState({
        hasPassword: false,
        passwordChangedAt: '2026-11-20T09:30:00+00:00',
        timezone: 'Europe/Istanbul',
        locale: 'en',
      }),
    ).toEqual({ kind: 'reminder' });
  });

  it('shows when it last changed, in the region time zone', () => {
    const state = passwordSectionState({
      hasPassword: true,
      passwordChangedAt: '2026-11-20T09:30:00+00:00',
      timezone: 'Europe/Istanbul',
      locale: 'en',
    });
    expect(state.kind).toBe('set');
    expect(state.kind === 'set' ? state.changedLabel : null).toContain('12:30');
  });

  it('has no time when it is missing, unreadable or the zone is unknown', () => {
    const base = { hasPassword: true, timezone: 'Europe/Istanbul', locale: 'tr' };
    expect(passwordSectionState({ ...base, passwordChangedAt: null })).toEqual({
      kind: 'set',
      changedLabel: null,
    });
    expect(passwordSectionState({ ...base, passwordChangedAt: 'soon' })).toEqual({
      kind: 'set',
      changedLabel: null,
    });
    expect(
      passwordSectionState({ ...base, timezone: null, passwordChangedAt: '2026-11-20T09:30:00Z' }),
    ).toEqual({
      kind: 'set',
      changedLabel: null,
    });
  });
});

describe('parseLoginStep keeps reset (AC-3)', () => {
  afterEach(() => vi.useRealTimers());
  const now = 1_800_000_000_000;

  it('keeps reset only when it is true', () => {
    expect(parseLoginStep(JSON.stringify({ phone: '+905551234567', sentAt: now, reset: true }), now)).toEqual(
      {
        phone: '+905551234567',
        sentAt: now,
        reset: true,
      },
    );
    expect(
      parseLoginStep(JSON.stringify({ phone: '+905551234567', sentAt: now, reset: 'yes' }), now),
    ).toEqual({
      phone: '+905551234567',
      sentAt: now,
    });
  });
});
