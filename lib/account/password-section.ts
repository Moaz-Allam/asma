import { instantLabel } from '@/lib/requests/view';

/**
 * What the account page's Password section shows (spec 0012 AC-4, AC-7): a reminder with a link while no password
 * is set, else when it last changed, in the region's time zone. No `server-only`: pure, and unit tested.
 */

export type PasswordSectionState = { kind: 'reminder' } | { kind: 'set'; changedLabel: string | null };

export function passwordSectionState(input: {
  hasPassword: boolean;
  passwordChangedAt: string | null;
  timezone: string | null;
  locale: string;
}): PasswordSectionState {
  if (!input.hasPassword) return { kind: 'reminder' };
  const at = input.passwordChangedAt;
  if (!at || !input.timezone || Number.isNaN(Date.parse(at))) return { kind: 'set', changedLabel: null };
  return { kind: 'set', changedLabel: instantLabel(at, input.timezone, input.locale) };
}
