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
  // Spec 0007 AC-23: the catalog and pricing editors of position 03.
  'AdminCatalog',
  'AdminPricing',
  'CatalogErrors',
  // Spec 0008 AC-24: the request form, its price card and the cancel dialog of position 04.
  'Requests',
  // Spec 0009 AC-22: the setup form and the apply form of position 05.
  'ProviderFeed',
  // Spec 0011-09 AC-11, AC-12: the pay and return pages poll in the browser.
  'Payment',
  // Spec 0011-11 AC-7, AC-8: the work and close buttons and their dialogs.
  'Jobs',
  // Spec 0011-12 AC-14, AC-12: Withdraw, the provider's cancel, and admin's refund dialogs.
  'Cancel',
  'AdminRequests',
  // Spec 0011-14 AC-4 to AC-7: the report form, the warning banner, admin's handle form and photo button.
  'Reports',
  'AdminReports',
  // Spec 0011-15 X-12: the header reads the history's menu label from `History.nav`.
  'History',
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
