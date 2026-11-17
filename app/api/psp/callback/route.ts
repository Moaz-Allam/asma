import { readCapped } from '@/lib/http/body';
import { CALLBACK_LIMIT_BYTES, formFields, handleCallback } from '@/lib/relay/callback';
import { relayDb } from '@/lib/relay/db';

/**
 * POST /api/psp/callback (spec 0011-08 AC-8, R-1): the browser coming back from the card page, a form post. No
 * session, so no requireRole() (position 01's action guard meta test exempts it by name). It stores the form
 * and queues a check, never trusting it: only the relay's retrieve from the PSP changes money. It answers 303
 * to the attempt's pay page, or home for an unknown token. The body is at most 8 KiB.
 */

const seeOther = (location: string) => new Response(null, { status: 303, headers: { location } });

export async function POST(request: Request) {
  const body = await readCapped(request, CALLBACK_LIMIT_BYTES);
  if (body === null) return seeOther('/');
  return seeOther(await handleCallback(relayDb(), formFields(body)));
}
