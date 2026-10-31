import { createAnonClient } from '@/lib/db/anon';
import { createHealthCheck, healthResponse } from '@/lib/health/check';

/**
 * GET /api/health: "app up" versus "database down", for the uptime monitor (spec 0004 AC-10, D71).
 *
 * Public on purpose and needs no session, so there is no requireRole() here: it reads nothing but the
 * answer of health_ping(), which anon may call (position 01's action guard meta test exempts this route
 * by name). Under /api, so proxy.ts never localises it.
 */

const check = createHealthCheck({
  ping: async (signal) => {
    const { data, error } = await createAnonClient().rpc('health_ping').abortSignal(signal);
    return error === null && data === true;
  },
});

export async function GET() {
  return healthResponse(await check());
}
