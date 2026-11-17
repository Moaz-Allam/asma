import { readCapped } from '@/lib/http/body';
import { relayDb } from '@/lib/relay/db';
import { relayPsp } from '@/lib/relay/psp';
import { handleWebhook, WEBHOOK_LIMIT_BYTES } from '@/lib/relay/webhook';

/**
 * POST /api/psp/webhook (spec 0011-08 AC-9): the PSP's server message. No session, so no requireRole(): the PSP's
 * signature over the raw body is the check (401 when it fails, 503 when no PSP is configured). Position 01's
 * action guard meta test exempts it by name. A body over 64 KiB is a 413. It stores and queues; it never changes
 * money state.
 */

export async function POST(request: Request) {
  const body = await readCapped(request, WEBHOOK_LIMIT_BYTES);
  if (body === null) return new Response(null, { status: 413 });
  const db = relayDb();
  const status = await handleWebhook(db, relayPsp(db), new TextDecoder().decode(body), request.headers);
  return new Response(null, { status });
}
