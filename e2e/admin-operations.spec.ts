import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';
import { TEST_CODE, testE164, testPhone } from './numbers';

/**
 * Spec 0011-16 AC-9 on the real local stack, at 390px with axe, in every locale. Admin filters the request list, extends
 * a pick's payment window, cancels an open request attributed to the provider, shows the street line of a revealed
 * job, clears its late start flag from the queue, reads revenue and downloads the CSV; an anonymous CSV request is
 * refused.
 *
 * The customer, the provider and the requests are written as `postgres` in the shapes 04 to 12 leave: the pick through
 * `choose_provider`, a commission of 0 settled by `pay_commission` (D171), the provider fee applied as the relay
 * would (`apply_fee_paid`, so the ledger stays whole), and the flag raised by `raise_deadline_flags`.
 */

const ORIGIN = `http://localhost:${process.env.E2E_PORT || 3100}`;
test.use({ baseURL: ORIGIN, viewport: { width: 390, height: 844 } });

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
  const file = join(tmpdir(), `asma-e2e-ops-${process.pid}-${Date.now()}-${randomUUID()}.sql`);
  writeFileSync(file, query);
  let last = '';
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const run = spawnSync('npx', ['supabase', 'db', 'query', '--local', '-o', 'json', '-f', file], {
      encoding: 'utf8',
      shell: true,
    });
    if (run.status === 0) {
      const start = run.stdout.search(/[[{]/);
      if (start < 0) return [];
      const parsed = JSON.parse(run.stdout.slice(start)) as
        Record<string, unknown>[] | { rows?: Record<string, unknown>[] };
      return Array.isArray(parsed) ? parsed : (parsed.rows ?? []);
    }
    last = `${run.stdout}\n${run.stderr}`;
  }
  throw new Error(`db query failed: ${last}`);
}

function ids(locale: string) {
  const d = { ar: '1', tr: '2', en: '3' }[locale] ?? '9';
  const id = (kind: string) => `00000000-0000-4000-8000-0016000${kind}00${d}`;
  return {
    customer: id('c0'),
    provider: id('b0'),
    category: id('c1'),
    service: id('51'),
    zone: id('21'),
    request: (n: number) => id(`e${n}`),
    offer: (n: number) => id(`f${n}`),
    service_name: `Yönetim hizmet ${locale}`,
    line: `Moda Cad. No 16 ${locale}`,
  };
}

function request(f: ReturnType<typeof ids>, n: number, commission: number): string {
  const snapshot = JSON.stringify({
    price: 90000 + commission,
    currency: 'TRY',
    commission_percent: '0',
    rounding_minor: 100,
    service: { id: f.service, name: { tr: f.service_name } },
  });
  return (
    ` insert into public.requests (id, region, customer_id, client_key, service_id, zone_id, answers, questions_snapshot,` +
    ` pricing_snapshot, fixed_price, commission_amount, cash_due, currency, scheduled_start_at, scheduled_end_at)` +
    ` values ('${f.request(n)}', 'TR', '${f.customer}', gen_random_uuid(), '${f.service}', '${f.zone}', '{}', '[]',` +
    ` '${snapshot}', ${90000 + commission}, ${commission}, 90000, 'TRY', now() + interval '3 days', now() + interval '3 days 2 hours');` +
    ` insert into public.request_addresses (request_id, region, customer_id, line)` +
    ` values ('${f.request(n)}', 'TR', '${f.customer}', '${f.line}');` +
    ` insert into public.applications (id, region, request_id, provider_id, message)` +
    ` values ('${f.offer(n)}', 'TR', '${f.request(n)}', '${f.provider}', 'I can start at ten with my own tools, two people.');`
  );
}

const asUser = (id: string) =>
  ` perform set_config('request.jwt.claims', json_build_object('sub', '${id}', 'role', 'authenticated')::text, true);`;

function seed(locale: string, f: ReturnType<typeof ids>) {
  const customerPhone = testE164(locale, 'opsCustomer');
  const providerPhone = testE164(locale, 'opsProvider');
  sql(
    `do $s$ declare v_attempt uuid; v_fee uuid; v_amount bigint; begin` +
      ` if exists (select 1 from public.requests where id = '${f.request(1)}') then return; end if;` +
      ` insert into auth.users (id, aud, role, phone, phone_confirmed_at) values` +
      ` ('${f.customer}', 'authenticated', 'authenticated', '${customerPhone.slice(1)}', now()),` +
      ` ('${f.provider}', 'authenticated', 'authenticated', '${providerPhone.slice(1)}', now()) on conflict (id) do nothing;` +
      ` insert into public.profiles (id, role, region, phone, full_name, locale) values` +
      ` ('${f.customer}', 'customer', 'TR', '${customerPhone}', 'Yönetim Müşteri', 'tr'),` +
      ` ('${f.provider}', 'provider', 'TR', '${providerPhone}', 'Yönetim Usta', 'tr') on conflict (id) do nothing;` +
      ` update public.providers set status = 'approved', approved_at = now() - interval '30 days', decided_at = now() - interval '30 days',` +
      ` approved_name = 'Yönetim Kaya' where id = '${f.provider}';` +
      ` insert into public.service_categories (id, region, name, display_order, active)` +
      ` values ('${f.category}', 'TR', '{"tr": "Yönetim ${locale}"}', 976, true) on conflict (id) do nothing;` +
      ` insert into public.services (id, category_id, region, name, hours_min, hours_max, display_order, active)` +
      ` values ('${f.service}', '${f.category}', 'TR', '{"tr": "${f.service_name}"}', 2, 3, 1, true) on conflict (id) do nothing;` +
      ` insert into public.zones (id, region, name, multiplier, display_order, active)` +
      ` values ('${f.zone}', 'TR', '{"tr": "Yönetim semt ${locale}"}', 1.00, 976, true) on conflict (id) do nothing;` +
      // 1: SELECTED, waiting for the commission (extend).
      request(f, 1, 10000) +
      asUser(f.customer) +
      ` perform public.choose_provider('${f.request(1)}', '${f.offer(1)}');` +
      // 2: OPEN (cancel).
      request(f, 2, 10000) +
      // 3: revealed, its start passed: a late start flag (address, clear).
      request(f, 3, 0) +
      asUser(f.customer) +
      ` perform public.choose_provider('${f.request(3)}', '${f.offer(3)}');` +
      ` perform public.pay_commission('${f.request(3)}', 'tr', null);` +
      asUser(f.provider) +
      ` v_attempt := (public.pay_provider_fee('${f.offer(3)}', 'tr', null) ->> 'attempt_id')::uuid;` +
      ` select id, amount into v_fee, v_amount from public.fee_payments where request_id = '${f.request(3)}' and kind = 'provider_fee';` +
      ` perform public.apply_fee_paid(v_fee, v_attempt, 'e2e-ops-${locale}-3', v_amount, 'TRY', 0);` +
      ` alter table public.requests disable trigger requests_guard;` +
      ` update public.requests set selected_at = now() - interval '40 hours', payment_deadline = null,` +
      ` fee_deadline = now() - interval '38 hours', scheduled_start_at = now() - interval '27 hours',` +
      ` scheduled_end_at = now() - interval '25 hours' where id = '${f.request(3)}';` +
      ` alter table public.requests enable trigger requests_guard;` +
      ` perform public.raise_deadline_flags();` +
      ` end $s$;`,
  );
}

async function axe(page: Page) {
  await page.evaluate(() => Promise.allSettled(document.getAnimations().map((a) => a.finished)));
  const scan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(scan.violations).toEqual([]);
}

async function signIn(page: Page, phone: string, path: string) {
  await page.goto(path);
  await page.locator('#login-phone').fill(phone);
  const send = page.locator('form button[type="submit"]');
  await expect(async () => {
    await expect(send).toBeEnabled();
    await send.click();
    await expect(page.locator('#login-code')).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 60_000 });
  await page.locator('#login-code').pressSequentially(TEST_CODE);
}

async function onboard(page: Page, name: string) {
  await page.locator('#full-name').fill(name);
  const tick = page.locator('#agreement');
  await expect(async () => {
    if ((await tick.getAttribute('data-state')) !== 'checked') await tick.click();
    await expect(tick).toHaveAttribute('data-state', 'checked', { timeout: 500 });
  }).toPass();
  await page.locator('form button[type="submit"]').click();
}

const one = (query: string) => sql(query)[0] ?? {};

test('admin lists, extends, cancels, shows an address, clears a flag and exports revenue', async ({
  page,
  request: anonymous,
}, testInfo) => {
  test.setTimeout(300_000);
  const locale = testInfo.project.name;
  const f = ids(locale);

  // The admin: signed up as a customer, promoted, signed in again (as 14 does).
  await signIn(page, testPhone(locale, 'opsAdmin'), `/${locale}/login`);
  await onboard(page, `Admin ${locale}`);
  await expect(page).toHaveURL(new RegExp(`/${locale}/requests/new$`), { timeout: 20_000 });
  sql(`select public.promote_to_admin('${testE164(locale, 'opsAdmin')}')`);
  await page.context().clearCookies();
  await signIn(page, testPhone(locale, 'opsAdmin'), `/${locale}/login`);
  await expect(page).toHaveURL(new RegExp(`/${locale}/admin$`), { timeout: 20_000 });
  seed(locale, f);

  // AC-1, AC-8: the list from the admin home's links, filtered to revealed jobs with an open flag.
  await page.getByRole('link', { name: m(locale, 'Nav.requests'), exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/${locale}/admin/requests$`));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(m(locale, 'AdminRequests.listTitle'));
  await page.locator('#filter-status').selectOption('UNLOCKED');
  await page.getByLabel(m(locale, 'AdminRequests.hasFlag')).check();
  await page.getByRole('button', { name: m(locale, 'AdminRequests.apply') }).click();
  await expect(page).toHaveURL(/status=UNLOCKED/);
  await expect(page.locator(`a[href$="/admin/requests/${f.request(3)}"]`)).toBeVisible();
  await expect(page.getByText(f.line)).toHaveCount(0);
  await axe(page);

  // AC-3: extend the payment window of request 1, once.
  await page.goto(`/${locale}/admin/requests/${f.request(1)}`);
  await page.getByRole('button', { name: m(locale, 'AdminRequests.extend'), exact: true }).click();
  const extend = page.getByRole('dialog');
  await extend.getByLabel(m(locale, 'AdminRequests.hours')).fill('2');
  await extend.getByLabel(m(locale, 'AdminRequests.reason')).fill('The customer asked for two more hours.');
  await axe(page);
  await extend.getByRole('button', { name: m(locale, 'AdminRequests.extendConfirm'), exact: true }).click();
  await expect(extend).toBeHidden();
  await expect
    .poll(
      () =>
        one(
          `select (payment_extended_at is not null) as done from public.applications where id = '${f.offer(1)}'`,
        ).done,
    )
    .toBe(true);

  // AC-2: cancel request 2, attributed to the provider.
  await page.goto(`/${locale}/admin/requests/${f.request(2)}`);
  await page.getByRole('button', { name: m(locale, 'AdminRequests.cancel'), exact: true }).click();
  const cancel = page.getByRole('dialog');
  await expect(cancel.getByText(m(locale, 'AdminRequests.cancelNoPaid'))).toBeVisible();
  await cancel.getByText(m(locale, 'AdminRequests.attribution.provider'), { exact: true }).click();
  await cancel
    .getByLabel(m(locale, 'AdminRequests.reason'))
    .fill('The customer found someone else, by phone.');
  await axe(page);
  await cancel.getByRole('button', { name: m(locale, 'AdminRequests.cancelConfirm'), exact: true }).click();
  await expect(cancel).toBeHidden();
  await expect
    .poll(
      () =>
        one(
          `select r.status || ' ' || r.cancelled_by || ' ' || (l.new_value ->> 'attributed_to') as s from public.requests r` +
            ` join public.audit_log l on l.entity_id = r.id::text and l.action = 'request.admin_cancelled' where r.id = '${f.request(2)}'`,
        ).s,
    )
    .toBe('CANCELLED admin provider');

  // AC-5: the street line of request 3, on click, with a reason.
  await page.goto(`/${locale}/admin/requests/${f.request(3)}`);
  await expect(page.getByText(f.line)).toHaveCount(0);
  await page.getByRole('button', { name: m(locale, 'AdminRequests.address'), exact: true }).click();
  const address = page.getByRole('dialog');
  await address.getByLabel(m(locale, 'AdminRequests.reason')).fill('The provider cannot find the building.');
  await address.getByRole('button', { name: m(locale, 'AdminRequests.addressConfirm'), exact: true }).click();
  await expect(page.getByText(f.line)).toBeVisible();
  await axe(page);

  // AC-4: the flag queue; clear request 3's flag.
  await page.goto(`/${locale}/admin/flags`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(m(locale, 'AdminFlags.title'));
  const flag = page.locator('li', { has: page.locator(`a[href$="/admin/requests/${f.request(3)}"]`) });
  await expect(flag).toHaveCount(1);
  await axe(page);
  await flag.getByRole('button', { name: m(locale, 'AdminRequests.flagClear'), exact: true }).click();
  const clear = page.getByRole('dialog');
  await clear.getByLabel(m(locale, 'AdminFlags.note')).fill('Called the provider, already on the way.');
  await clear.getByRole('button', { name: m(locale, 'AdminFlags.clearConfirm'), exact: true }).click();
  await expect(clear).toBeHidden();
  await expect(page.locator(`a[href$="/admin/requests/${f.request(3)}"]`)).toHaveCount(0);
  await expect
    .poll(
      () =>
        one(
          `select count(*)::int as n from public.deadline_flags where request_id = '${f.request(3)}' and cleared_by is not null`,
        ).n,
    )
    .toBe(1);

  // AC-6, AC-7: revenue and its CSV; anonymous is refused.
  await page.goto(`/${locale}/admin/revenue`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(m(locale, 'AdminRevenue.title'));
  await expect(page.getByText(m(locale, 'AdminRevenue.columns.net'), { exact: true }).first()).toBeVisible();
  await axe(page);
  const href = await page
    .getByRole('link', { name: m(locale, 'AdminRevenue.download') })
    .getAttribute('href');
  expect(href).toMatch(/^\/api\/admin\/revenue\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}&grain=day$/);
  const csv = await page.request.get(String(href));
  expect(csv.status()).toBe(200);
  expect(csv.headers()['content-type']).toContain('text/csv');
  expect(csv.headers()['cache-control']).toBe('no-store');
  expect((await csv.text()).split('\r\n')[0]).toBe(
    'region,currency,period,commission_revenue,provider_fee_revenue,commission_refunds,provider_fee_refunds,psp_fees,net,late_received,late_refunded',
  );
  expect((await anonymous.get(`${ORIGIN}${String(href)}`)).status()).toBe(401);
});
