import { createPostHogForwarder } from '@/lib/analytics/forward';
import { posthogKey } from '@/lib/env';

/**
 * POST /api/a/*: posthog-js's capture calls (spec 0004 AC-6, D83). Our project key only, the capture
 * endpoints only, to EU Cloud, with no cookie, referer or visitor IP. Public on purpose: browsers send
 * here without a session, so there is no requireRole() (D71, D83; position 01's action guard meta test
 * exempts this route by name). Under /api, so proxy.ts never localises it.
 */

const forward = createPostHogForwarder({ key: posthogKey });

export async function POST(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  return forward(request, (await params).path);
}
