import { sentryDsn } from '@/lib/env';
import { createEnvelopeForwarder } from '@/lib/observability/forward';

/**
 * POST /api/e: the browser Sentry SDK's tunnel (spec 0004 AC-2, D83). Envelopes for our own DSN only, to
 * its fixed EU ingest URL, with no cookie, referer or visitor IP. Public on purpose, like /api/health:
 * browsers send here without a session, so there is no requireRole() (D71, D83; position 01's action
 * guard meta test exempts this route by name). Under /api, so proxy.ts never localises it.
 */

const forward = createEnvelopeForwarder({ dsn: sentryDsn });

export function POST(request: Request) {
  return forward(request);
}
