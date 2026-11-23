/**
 * The stable codes the position 02 database functions raise, as `actions/onboarding.ts` maps them. A
 * mapped code is something a person can act on, so it reaches no Sentry report; anything else is
 * rethrown and reported by `guardedAction`.
 */

export const PROVIDER_DB_CODES = [
  'forbidden',
  'validation_failed',
  'contact_info_in_bio',
  'provider_suspended',
  'file_missing',
  'file_type_refused',
  'file_too_large',
  // Spec 0011-20b AC-5: the provider's address.
  'address_invalid',
  'pin_invalid',
  'contact_info_in_address',
] as const;

export const ADMIN_DB_CODES = [
  'forbidden',
  'not_found',
  'validation_failed',
  'not_under_review',
  'stale_document',
  'view_required',
  'valid_until_required',
  'valid_until_invalid',
  'reason_required',
  'documents_not_reviewed',
  'stale_profile',
  'file_missing',
  'not_approved',
  'not_suspended',
] as const;

/** The code in a PostgREST error raised by one of our functions, when it is one of `known`. */
export function databaseCode(error: unknown, known: readonly string[]): string | null {
  const message = typeof error === 'object' && error !== null && 'message' in error ? error.message : null;
  return typeof message === 'string' && known.includes(message) ? message : null;
}
