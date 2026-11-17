import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import type { APIRequestContext } from '@playwright/test';

import { expect, test } from './fixtures';

/**
 * Spec 0011-08 on the real local stack with the fake PSP, at 390px, in every locale (A-4: until 09 and 10 replace
 * 07's accept checks, every payment goes the late path and is refunded):
 *  - ar: a checkout is queued, the relay opens a fake card page on this server, the buyer pays and comes back
 *    through the callback, the relay retrieves the payment, books it late and refunds it, once; the books balance.
 *  - tr: the same payment arrives by a signed webhook only, with no callback.
 *  - en: the buyer's payment fails; the attempt fails with psp_failed and nothing is refunded.
 * Also: a wrong relay secret is a 404, and no client bundle holds the server only DSN (AC-14).
 *
 * The fee and its checkout are written as `postgres` the way 09's pay action will (start_checkout); the relay is
 * woken by posting to /api/relay with the e2e secret, as pg_net does on a deployment.
 */

const SECRET = 'e2e-relay-secret-0000000000000000000000';
const SERVER_DSN_MARK = 'e2eserver0000000000000000000000';

const CATALOGUES: Record<string, unknown> = Object.fromEntries(
  ['ar', 'tr', 'en'].map((l) => [
    l,
    JSON.parse(readFileSync(join(process.cwd(), 'messages', `${l}.json`), 'utf8')),
  ]),
);

function m(locale: string, path: string): string {
  let node: unknown = CATALOGUES[locale];
  for (const part of path.split('.')) node = (node as Record<string, unknown>)[part];
  if (typeof node !== 'string') throw new Error(`no message ${path}`);
  return node;
}

function sql(query: string): Record<string, unknown>[] {
  const file = join(tmpdir(), `asma-e2e-relay-${process.pid}-${Date.now()}-${randomUUID()}.sql`);
  writeFileSync(file, query);
  let last = '';
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const run = spawnSync('npx', ['supabase', 'db', 'query', '--local', '-f', file], {
      encoding: 'utf8',
      shell: true,
    });
    if (run.status === 0) {
      const start = run.stdout.indexOf('{');
      if (start < 0) return [];
      return (JSON.parse(run.stdout.slice(start)) as { rows?: Record<string, unknown>[] }).rows ?? [];
    }
    last = `${run.stdout}\n${run.stderr}`;
  }
  throw new Error(`db query failed: ${last}`);
}

function ids(locale: string) {
  const d = { ar: '1', tr: '2', en: '3' }[locale] ?? '9';
  const id = (kind: string) => `00000000-0000-4000-8000-0008000${kind}00${d}`;
  return {
    customer: id('c1'),
    category: id('ca'),
    service: id('51'),
    zone: id('21'),
    phone: `90555920800${d}`,
  };
}

/** A pending commission and its queued checkout, as 09's pay action will leave them. Returns the ids. */
function startCheckout(locale: string): { fee: string; attempt: string } {
  const f = ids(locale);
  const request = randomUUID();
  const fee = randomUUID();
  sql(
    `do $s$ declare v_attempt uuid; begin
       insert into auth.users (id, aud, role, phone, phone_confirmed_at, raw_app_meta_data)
       values ('${f.customer}', 'authenticated', 'authenticated', '${f.phone}', now(),
               '{"role": "customer", "region": "TR"}') on conflict (id) do nothing;
       insert into public.profiles (id, role, region, phone, full_name, locale)
       values ('${f.customer}', 'customer', 'TR', '+${f.phone}', 'Röle Müşteri', '${locale}') on conflict (id) do nothing;
       insert into public.service_categories (id, region, name, display_order, active)
       values ('${f.category}', 'TR', '{"tr": "Röle ${locale}"}', 970, true) on conflict (id) do nothing;
       insert into public.services (id, category_id, region, name, hours_min, hours_max, display_order, active)
       values ('${f.service}', '${f.category}', 'TR', '{"tr": "Röle hizmet ${locale}"}', 1, 2, 1, true) on conflict (id) do nothing;
       insert into public.zones (id, region, name, multiplier, active)
       values ('${f.zone}', 'TR', '{"tr": "Röle semt ${locale}"}', 1.00, true) on conflict (id) do nothing;
       insert into public.requests (id, region, customer_id, client_key, service_id, zone_id, answers, questions_snapshot,
         pricing_snapshot, fixed_price, commission_amount, cash_due, currency, scheduled_start_at, scheduled_end_at)
       values ('${request}', 'TR', '${f.customer}', gen_random_uuid(), '${f.service}', '${f.zone}', '{}', '[]',
         '{"rounding_minor": 100}', 100000, 10000, 90000, 'TRY', now() + interval '3 days', now() + interval '3 days 2 hours');
       insert into public.fee_payments (id, region, request_id, kind, payer_id, amount, currency)
       values ('${fee}', 'TR', '${request}', 'commission', '${f.customer}', 10000, 'TRY');
       v_attempt := public.start_checkout('${fee}');
       update public.checkout_attempts set locale = '${locale}' where id = v_attempt;
     end $s$;`,
  );
  const [row] = sql(`select id from public.checkout_attempts where fee_payment_id = '${fee}';`);
  return { fee, attempt: String(row?.id) };
}

async function kick(request: APIRequestContext, task = 'drain', secret = SECRET) {
  return request.post('/api/relay', { headers: { 'x-relay-secret': secret }, data: { task } });
}

/** Wakes the relay until the query answers what is expected (the task runs after the 202). */
async function untilRelay(request: APIRequestContext, query: string, expected: unknown) {
  await expect
    .poll(
      async () => {
        await kick(request);
        return sql(query)[0] ?? null;
      },
      { timeout: 60_000, intervals: [1000, 2000, 3000] },
    )
    .toEqual(expected);
}

test('a fake payment goes the late path end to end, once (AC-0, AC-7 to AC-11, AC-15, AC-21, A-4)', async ({
  page,
  request,
}, testInfo) => {
  // Each database step is an `npx supabase db query` call, slow under a full parallel run.
  test.setTimeout(240_000);
  const locale = testInfo.project.name;
  const outcome = { ar: 'success', tr: 'webhook_only', en: 'failure' }[locale] ?? 'success';
  const { fee, attempt } = startCheckout(locale);

  // The relay opens the card page on this server (AC-7, AC-21).
  await untilRelay(
    request,
    `select status, url like 'http://localhost:%/${locale}/dev/fake-checkout/fk1_%' as on_host from public.checkout_attempts where id = '${attempt}';`,
    {
      status: 'ready',
      on_host: true,
    },
  );
  const [ready] = sql(`select url from public.checkout_attempts where id = '${attempt}';`);
  await page.goto(String(ready?.url));
  const scan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(scan.violations).toEqual([]);

  await page.getByRole('button', { name: m(locale, `DevFakeCheckout.outcomes.${outcome}`) }).click();
  await expect(page.getByRole('status')).toBeVisible();

  if (outcome === 'webhook_only') {
    await expect(page.getByText(m(locale, 'DevFakeCheckout.webhookSent'))).toBeVisible();
    await expect(page.getByRole('button', { name: m(locale, 'DevFakeCheckout.returnToShop') })).toHaveCount(
      0,
    );
  } else {
    // The callback stores and queues; it answers 303 to the pay page (09 builds it) and moves no money (AC-8).
    await page.getByRole('button', { name: m(locale, 'DevFakeCheckout.returnToShop') }).click();
    await page.waitForURL(new RegExp(`/${locale}/pay/${attempt}$`));
    expect(
      sql(
        `select count(*)::int as n from public.psp_events where source = 'callback' and event_key like 'callback:${attempt}:%';`,
      )[0],
    ).toEqual({ n: 1 });
  }

  if (outcome === 'failure') {
    await untilRelay(
      request,
      `select status, failure_reason from public.checkout_attempts where id = '${attempt}';`,
      {
        status: 'failed',
        failure_reason: 'psp_failed',
      },
    );
    expect(
      sql(
        `select count(*)::int as n from public.fee_refunds x join public.fee_payments f on f.request_id = x.request_id where f.id = '${fee}';`,
      )[0],
    ).toEqual({ n: 0 });
    return;
  }

  // Retrieved, booked late (07's stub accept checks), refunded once (AC-10, AC-11, A-4).
  await untilRelay(
    request,
    `select f.status as fee, x.kind, x.status as refund, x.psp_refund_id like 'fr_fp1_%' as refund_id
       from public.fee_payments f join public.fee_refunds x on x.request_id = f.request_id where f.id = '${fee}';`,
    { fee: 'pending', kind: 'late', refund: 'done', refund_id: true },
  );
  expect(
    sql(`select count(*)::int as n from public.ledger_journals j join public.fee_refunds x on j.idempotency_key in
           ('late:' || x.psp_payment_id || ':received', 'late:' || x.psp_payment_id || ':refund')
         join public.fee_payments f on f.request_id = x.request_id where f.id = '${fee}';`)[0],
  ).toEqual({ n: 2 });
  if (outcome === 'webhook_only') {
    expect(
      sql(
        `select count(*)::int as n from public.outbox_events where idempotency_key like 'checkout:${attempt}:verify:webhook:%';`,
      )[0],
    ).toEqual({ n: 1 });
  }
  // No stored PSP event keeps a token or card page field (R-6). (The fake's payment ids embed its token, which is
  // not a secret; an iyzico payment id never does.)
  expect(
    sql(`select count(*)::int as n from public.psp_events
          where payload::text ~* '"(token|psp_token|paymentPageUrl|checkoutFormContent)"';`)[0],
  ).toEqual({ n: 0 });
  // The books balance (07's check, as the service role).
  const [books] = sql(
    `select public.ledger_check('TR') -> 'imbalances' as imbalances from (select set_config('request.jwt.claims', '{"role": "service_role"}', false)) s;`,
  );
  expect(books?.imbalances).toEqual([]);
});

test('a wrong relay secret is a 404, and an unknown task a 400 (AC-5)', async ({ request }) => {
  expect((await kick(request, 'drain', 'wrong-secret-wrong-secret-wrong-secret')).status()).toBe(404);
  expect((await kick(request, 'payout')).status()).toBe(400);
});

test('no client bundle holds the server only DSN (AC-14)', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'en', 'one scan of the build is enough');
  const root = join(process.cwd(), '.next', 'static');
  expect(existsSync(root)).toBe(true);
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else files.push(path);
    }
  };
  walk(root);
  expect(files.length).toBeGreaterThan(0);
  expect(files.filter((file) => readFileSync(file, 'utf8').includes(SERVER_DSN_MARK))).toEqual([]);
});
