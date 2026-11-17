import { after } from 'next/server';

import { readCapped } from '@/lib/http/body';
import { log } from '@/lib/observability/log';
import {
  parseTask,
  RELAY_BODY_LIMIT_BYTES,
  RELAY_SECRET_HEADER,
  relaySecretMatches,
  runTask,
} from '@/lib/relay/task';

/**
 * POST /api/relay (spec 0011-08 AC-5, R-7): pg_cron (every minute, through pg_net) and `start_checkout`'s kick
 * wake the outbox relay here. No session, so no requireRole(): the `x-relay-secret` header (timing safe) is the
 * only way in; without the secret configured, or with anything else, the answer is a 404. The body is at most
 * 1 KiB, `{ task }`. It answers 202 at once and runs the task after the response, within maxDuration; a run cut
 * at any point is safe. Position 01's action guard meta test exempts this route by name. This file only parses
 * the request: the work is in lib/relay (AC-3).
 */

export const maxDuration = 60;

const notFound = () => new Response(null, { status: 404 });

/** AC-5: every other method is a 404 too, so the route never shows it exists (security review S10). */
export function GET() {
  return notFound();
}
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
export const OPTIONS = GET;
export const HEAD = GET;

export async function POST(request: Request) {
  if (!relaySecretMatches(request.headers.get(RELAY_SECRET_HEADER))) {
    log.warn('relay_refused');
    return notFound();
  }
  const body = await readCapped(request, RELAY_BODY_LIMIT_BYTES);
  const task = body === null ? null : parseTask(body);
  if (task === null) return Response.json({ error: 'unknown_task' }, { status: 400 });
  after(() => runTask(task));
  return Response.json({ accepted: task }, { status: 202 });
}
