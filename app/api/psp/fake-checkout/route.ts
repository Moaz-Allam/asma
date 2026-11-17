import { readCapped } from '@/lib/http/body';
import { formFields } from '@/lib/relay/callback';
import { chooseFakeOutcome, fakeCheckoutAvailable, isFakeOutcome } from '@/lib/relay/fake-checkout';

/**
 * POST /api/psp/fake-checkout (spec 0011-08 AC-15): the fake card page's choice. Dev only: a 404 unless
 * PSP_DRIVER=fake and the deployment is not production (position 01's action guard meta test checks it in its
 * dev only list). It stores the outcome and sends the browser back to the card page, which then posts the real
 * callback form.
 */

const notFound = () => new Response(null, { status: 404 });

export async function POST(request: Request) {
  if (!fakeCheckoutAvailable()) return notFound();
  const body = await readCapped(request, 2048);
  if (body === null) return notFound();
  const { token, outcome, locale } = formFields(body);
  if (typeof token !== 'string' || !isFakeOutcome(outcome) || !['ar', 'tr', 'en'].includes(locale ?? '')) {
    return notFound();
  }
  if (!(await chooseFakeOutcome(token, outcome))) return notFound();
  const back = `/${locale}/dev/fake-checkout/${encodeURIComponent(token)}?chosen=${outcome}`;
  return new Response(null, { status: 303, headers: { location: back } });
}
