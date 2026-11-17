/**
 * The one check on a card page URL (spec 0011-08 AC-21, R-5, R13 S8). Pure, and not a door: the relay calls it
 * before it stores a URL, and 09's redirect calls it again before it sends a browser there. The host list is
 * an argument (`lib/payments/checkout-hosts.ts` builds it), so no user path imports `lib/psp`.
 *
 * Allowed only when the URL parses, carries no user info, is https (or http on `localhost`), is at most 2,000
 * characters, and its host (with its port) is in the list by exact match.
 */

export const MAX_CHECKOUT_URL_LENGTH = 2000;

export function isAllowedCheckoutUrl(url: string, hosts: readonly string[]): boolean {
  if (typeof url !== 'string' || url.length === 0 || url.length > MAX_CHECKOUT_URL_LENGTH) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.username !== '' || parsed.password !== '') return false;
  const secure = parsed.protocol === 'https:';
  const localHttp = parsed.protocol === 'http:' && parsed.hostname === 'localhost';
  if (!secure && !localHttp) return false;
  return hosts.includes(parsed.host);
}
