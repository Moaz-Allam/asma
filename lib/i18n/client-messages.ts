import type { AbstractIntlMessages } from 'next-intl';

/**
 * What Client Components read from the catalogues. The rest stays on the server, so the long landing copy
 * is not repeated in the payload of every page (spec 0005 AC-31). A key missing here shows as a raw key in
 * a client component, and `tests/i18n.test.ts` guards the list.
 */
export const CLIENT_NAMESPACES = [
  'Nav',
  'Login',
  'Onboarding',
  'Account',
  'Error',
  // Spec 0006 AC-27: the forms and review of position 02, kept small; the long page copy stays on the server.
  'ProviderForm',
  'ProviderDocs',
  'ProviderErrors',
  'Rejection',
  'AdminReview',
] as const;

/** `PublicMenu` reads these two from the landing copy. */
export const CLIENT_LANDING_KEYS = ['cta', 'ctaProvider'] as const;

export function clientMessages(messages: AbstractIntlMessages): AbstractIntlMessages {
  const landing = messages.Landing;
  const picked: AbstractIntlMessages = {};
  for (const namespace of CLIENT_NAMESPACES) {
    const value = messages[namespace];
    if (value !== undefined) picked[namespace] = value;
  }
  if (typeof landing === 'object') {
    picked.Landing = Object.fromEntries(CLIENT_LANDING_KEYS.map((key) => [key, landing[key] ?? '']));
  }
  return picked;
}
