import { appRelease, type DeploymentEnv } from '@/lib/deployment';

/**
 * The health answer behind GET /api/health (spec 0004 AC-10, D71): "app up" versus "database down",
 * for the uptime monitor (Q3, S10). Its regular pings also keep the Free Supabase project awake (D63).
 *
 * 200 only when the ping answers `true` within the time limit. A timeout, an error, `false`, anything
 * else, or an abort all give the same 503: the body never says why, so it never leaks error text.
 * One result is reused for 5 seconds per server instance, a degraded one included.
 */

export type HealthBody = {
  status: 'ok' | 'degraded';
  db: 'ok' | 'down';
  /** The full commit SHA of this deployment, else `local`. */
  commit: string;
  /** The function region (such as `fra1`), never the business region; else `local`. */
  region: string;
  /** When the (possibly reused) ping was taken, ISO 8601 UTC. */
  checkedAt: string;
};
export type HealthResult = { status: 200 | 503; body: HealthBody };

/** Asks the database whether it answers. Must honour the signal; anything but `true` counts as down. */
export type Ping = (signal: AbortSignal) => Promise<boolean>;

export const PING_TIMEOUT_MS = 2000;
export const MEMO_MS = 5000;

async function pingWithin(ping: Ping, timeoutMs: number): Promise<boolean> {
  const signal = AbortSignal.timeout(timeoutMs);
  const timedOut = new Promise<false>((resolve) =>
    signal.addEventListener('abort', () => resolve(false), { once: true }),
  );
  try {
    const answer = await Promise.race([ping(signal), timedOut]);
    return answer === true && !signal.aborted;
  } catch {
    return false;
  }
}

export function createHealthCheck({
  ping,
  timeoutMs = PING_TIMEOUT_MS,
  now = Date.now,
  env = process.env,
}: {
  ping: Ping;
  timeoutMs?: number;
  now?: () => number;
  env?: DeploymentEnv;
}): () => Promise<HealthResult> {
  let memo: { at: number; result: Promise<HealthResult> } | undefined;

  async function run(at: number): Promise<HealthResult> {
    const up = await pingWithin(ping, timeoutMs);
    return {
      status: up ? 200 : 503,
      body: {
        status: up ? 'ok' : 'degraded',
        db: up ? 'ok' : 'down',
        commit: appRelease(env),
        region: env.VERCEL_REGION || 'local',
        checkedAt: new Date(at).toISOString(),
      },
    };
  }

  return () => {
    const at = now();
    // Requests that arrive together share one in flight ping, and a result is reused for MEMO_MS.
    if (memo === undefined || at - memo.at >= MEMO_MS) memo = { at, result: run(at) };
    return memo.result;
  };
}

/** No session, no cache anywhere but the memo above, and nothing in the body but the fixed fields. */
export function healthResponse({ status, body }: HealthResult): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}
