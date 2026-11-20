import { landingFor, type Role } from './roles';

/**
 * Where `/{locale}/continue` sends a signed in user, without the locale (spec 0005 AC-10, spec 0012 AC-4), in
 * order: no role → onboarding; a role and no password → the password step; `reset=1` → the reset step; otherwise
 * the landing. The password step is a guide, not a boundary: `guardPage`, `requireRole` and `guardedAction` never
 * read `hasPassword`.
 */

export type ContinueInput = {
  role: Role | null;
  hasPassword: boolean;
  reset: boolean;
  next: string | null;
  as: string | null;
};

export function continueTarget({ role, hasPassword, reset, next, as }: ContinueInput): string {
  if (!role) return as === 'provider' ? '/onboarding?as=provider' : '/onboarding';
  const landing = landingFor(role, next);
  const carried = `next=${encodeURIComponent(landing)}`;
  if (!hasPassword) return `/account/password?${carried}`;
  if (reset) return `/account/password?reason=reset&${carried}`;
  return landing;
}
