/**
 * Static security headers on every response (spec 0004 AC-12, D69), set by `headers()` in
 * next.config.ts. The Content Security Policy is per request, in proxy.ts (lib/security/csp.ts).
 *
 * ⚠️ next.config.ts imports this file through Node's native TypeScript resolver: no dependencies, no
 * `@/` imports, erasable TypeScript only.
 */
export const SECURITY_HEADERS: ReadonlyArray<{ key: string; value: string }> = [
  // One day until the final domain exists (S4); then two years with includeSubDomains, and a decision
  // on preload. A short max-age keeps a mistake on a preview host from sticking.
  { key: 'Strict-Transport-Security', value: 'max-age=86400' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // No framing at all; `frame-ancestors 'none'` in the CSP says the same to modern browsers.
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  // Position 02 opens camera=(self) if the liveness selfie runs in the browser.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
];
