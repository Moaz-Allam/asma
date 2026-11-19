import { getSessionUser } from '@/lib/auth/session';
import { reportServerError } from '@/lib/observability/server';
import { myWarning } from '@/lib/reports';

import { WarningBanner } from './WarningBanner';

/**
 * The customer's and the provider's area show their oldest warning not acknowledged yet (spec 0011-14 AC-6). Read
 * once per render through `my_warning()`; a failed read shows nothing and is reported, never silent.
 */
export async function UserWarning() {
  const user = await getSessionUser();
  if (user?.role !== 'customer' && user?.role !== 'provider') return null;
  const warning = await myWarning().catch((error: unknown) => {
    reportServerError('userWarning', error);
    return null;
  });
  if (!warning) return null;
  return <WarningBanner warningId={warning.id} reason={warning.reason} />;
}
