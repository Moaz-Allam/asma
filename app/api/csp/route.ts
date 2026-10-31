import { appEnv, appRelease } from '@/lib/deployment';
import { sentryDsn } from '@/lib/env';
import { createCspReportForwarder } from '@/lib/observability/forward';

/**
 * POST /api/csp: Content Security Policy violation reports (spec 0004 AC-13, D83). Each report is
 * scrubbed, then sent to our Sentry project's security endpoint. Public on purpose: browsers send
 * reports without a session, so there is no requireRole() (D71, D83; position 01's action guard meta
 * test exempts this route by name). Under /api, so proxy.ts never localises it.
 */

const forward = createCspReportForwarder({
  dsn: sentryDsn,
  environment: () => appEnv(process.env),
  release: () => appRelease(process.env),
});

export function POST(request: Request) {
  return forward(request);
}
