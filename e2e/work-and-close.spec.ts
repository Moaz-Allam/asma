import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import type { Browser, Page } from '@playwright/test';

import { expect, test } from './fixtures';
import { TEST_CODE, testE164, testPhone } from './numbers';

/**
 * Spec 0011-11 AC-11 on the real local stack, at 390px with axe, in every locale. On a job whose contacts are shared:
 * the provider presses Started and Done from My jobs, the customer confirms, and the provider still sees the contact
 * card in Done during the window. A second job: the customer closes it without the provider ("Job done"). A third: the
 * provider's Done, the deadline moved into the past, and the auto close run once with its switch on inside one
 * transaction, so the parallel projects never see the switch on.
 *
 * The request, the offer, the choose, a commission of 0 and the provider fee (applied as the relay would) are written
 * as `postgres` in the shapes their own positions leave; the start is moved to today, as the clock would.
 */

const ORIGIN = `http://localhost:${process.env.E2E_PORT || 3100}`;
test.use({ baseURL: ORIGIN });

const CATALOGUES: Record<string, unknown> = Object.fromEntries(
  ['ar', 'tr', 'en'].map((l) => [
    l,
    JSON.parse(readFileSync(join(process.cwd(), 'messages', `${l}.json`), 'utf8')),
  ]),
);

function m(locale: string, path: string, vars: Record<string, string | number> = {}): string {
  let node: unknown = CATALOGUES[locale];
  for (const part of path.split('.')) node = (node as Record<string, unknown>)[part];
  if (typeof node !== 'string') throw new Error(`no message ${path}`);
  return node.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? `{${key}}`));
}

function sql(query: string): Record<string, unknown>[] {
  const file = join(tmpdir(), `asma-e2e-work-${process.pid}-${Date.now()}-${randomUUID()}.sql`);
  writeFileSync(file, query);
  let last = '';
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const run = spawnSync('npx', ['supabase', 'db', 'query', '--local', '-o', 'json', '-f', file], {
      encoding: 'utf8',
      shell: true,
    });
    if (run.status === 0) {
      // `-o json` (D189): without it the CLI prints a table outside an agent session, as in CI. An array or `{ rows }`.
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

type Who = 'workCustomer' | 'workProvider';
const profileId = (locale: string, who: Who) =>
  `(select id from public.profiles where phone = '${testE164(locale, who)}')`;

function ids(locale: string) {
  const d = { ar: '1', tr: '2', en: '3' }[locale] ?? '9';
  const id = (kind: string) => `00000000-0000-4000-8000-0011000${kind}00${d}`;
  return {
    category: id('c1'),
    service: id('51'),
    zone: id('21'),
    request: (n: number) => id(`e${n}`),
    offer: (n: number) => id(`f${n}`),
    names: { service: `İş hizmet ${locale}`, zone: `İş semt ${locale}`, category: `İş ${locale}` },
  };
}

/** Three requests, each chosen, both fees settled (the provider fee as the relay applies it), started today. */
function unlockedToday(locale: string, f: ReturnType<typeof ids>) {
  const customer = profileId(locale, 'workCustomer');
  const provider = profileId(locale, 'workProvider');
  const snapshot = JSON.stringify({
    price: 300000,
    currency: 'TRY',
    commission_percent: '0',
    rounding_minor: 100,
    breakdown: {
      base: 300000,
      modifiers: [],
      addons: [],
      zone: { id: f.zone, name: { tr: f.names.zone }, multiplier: '1.00' },
      unrounded: '300000',
      rounding_minor: 100,
    },
    service: { id: f.service, name: { tr: f.names.service }, category_name: { tr: f.names.category } },
  });
  const one = (n: number) =>
    ` insert into public.requests (id, region, customer_id, client_key, service_id, zone_id, answers, questions_snapshot, pricing_snapshot,` +
    ` fixed_price, commission_amount, cash_due, currency, scheduled_start_at, scheduled_end_at)` +
    ` select '${f.request(n)}', 'TR', ${customer}, gen_random_uuid(), '${f.service}', '${f.zone}', '{}', '[]', '${snapshot}',` +
    ` 300000, 0, 300000, 'TRY', now() + interval '3 days', now() + interval '3 days 2 hours';` +
    ` insert into public.request_addresses (request_id, region, customer_id, line) select '${f.request(n)}', 'TR', ${customer}, 'Moda Cad. No ${n}';` +
    ` insert into public.applications (id, region, request_id, provider_id, message) values` +
    ` ('${f.offer(n)}', 'TR', '${f.request(n)}', ${provider}, 'I can start at ten with my own tools, two people.');` +
    ` perform set_config('request.jwt.claims', json_build_object('sub', ${customer}, 'role', 'authenticated')::text, true);` +
    ` perform public.choose_provider('${f.request(n)}', '${f.offer(n)}');` +
    ` perform public.pay_commission('${f.request(n)}', 'tr', null);` +
    ` perform set_config('request.jwt.claims', json_build_object('sub', ${provider}, 'role', 'authenticated')::text, true);` +
    ` v_attempt := (public.pay_provider_fee('${f.offer(n)}', 'tr', null) ->> 'attempt_id')::uuid;` +
    ` select id, amount into v_fee, v_amount from public.fee_payments where request_id = '${f.request(n)}' and kind = 'provider_fee';` +
    ` perform public.apply_fee_paid(v_fee, v_attempt, 'e2e-work-${locale}-${n}', v_amount, 'TRY', 0);`;
  sql(
    `do $s$ declare v_attempt uuid; v_fee uuid; v_amount bigint; begin` +
      ` insert into public.service_categories (id, region, name, display_order, active) values ('${f.category}', 'TR', '{"tr": "${f.names.category}"}', 970, true) on conflict (id) do nothing;` +
      ` insert into public.services (id, category_id, region, name, hours_min, hours_max, display_order, active) values ('${f.service}', '${f.category}', 'TR', '{"tr": "${f.names.service}"}', 2, 3, 1, true) on conflict (id) do nothing;` +
      ` insert into public.zones (id, region, name, multiplier, display_order, active) values ('${f.zone}', 'TR', '{"tr": "${f.names.zone}"}', 1.00, 970, true) on conflict (id) do nothing;` +
      one(1) +
      one(2) +
      one(3) +
      ` alter table public.requests disable trigger requests_guard;` +
      ` update public.requests set selected_at = now() - interval '5 hours', payment_deadline = now() - interval '4 hours',` +
      ` fee_deadline = now() - interval '3 hours', scheduled_start_at = now() - interval '1 hour', scheduled_end_at = now() + interval '1 hour'` +
      ` where id in ('${f.request(1)}', '${f.request(2)}', '${f.request(3)}');` +
      ` alter table public.requests enable trigger requests_guard;` +
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

async function signIn(page: Page, locale: string, phone: string, path = `/${locale}/login`) {
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

async function newPage(browser: Browser) {
  return (await browser.newContext({ viewport: { width: 390, height: 844 }, baseURL: ORIGIN })).newPage();
}

/** Press a job button, then its confirm in the dialog, and wait for the page to refresh past it. */
async function press(page: Page, label: string) {
  await page.getByRole('button', { name: label }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: label }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test('the provider starts and finishes, the customer confirms or closes, and a job closes by itself', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(420_000);
  const locale = testInfo.project.name;
  const f = ids(locale);

  const provider = await newPage(browser);
  await signIn(provider, locale, testPhone(locale, 'workProvider'), `/${locale}/login?as=provider`);
  await onboard(provider, `İş Usta ${locale}`);
  await expect(provider).toHaveURL(new RegExp(`/${locale}/provider/profile$`), { timeout: 20_000 });
  sql(
    `update public.providers set status = 'approved', approved_at = now(), approved_name = 'İş Kaya'` +
      ` where id = ${profileId(locale, 'workProvider')};`,
  );
  await signIn(page, locale, testPhone(locale, 'workCustomer'));
  await onboard(page, 'İş Müşteri');
  await expect(page).toHaveURL(new RegExp(`/${locale}/requests/new$`), { timeout: 20_000 });
  unlockedToday(locale, f);

  // The provider: Started, then Done, from Active (AC-7).
  await provider.goto(`/${locale}/provider/applications?tab=active`);
  await axe(provider);
  const job1 = provider.locator('li', { hasText: 'Moda Cad. No 1' }).first();
  await job1.getByRole('button', { name: m(locale, 'Jobs.start') }).click();
  await provider
    .getByRole('dialog')
    .getByRole('button', { name: m(locale, 'Jobs.start') })
    .click();
  await expect(job1.getByRole('button', { name: m(locale, 'Jobs.finish') })).toBeVisible({ timeout: 20_000 });
  await job1.getByRole('button', { name: m(locale, 'Jobs.finish') }).click();
  await provider
    .getByRole('dialog')
    .getByRole('button', { name: m(locale, 'Jobs.finish') })
    .click();
  await expect(provider.locator('li', { hasText: 'Moda Cad. No 1' }).first()).toContainText(
    (m(locale, 'Jobs.waitingCustomer', { date: '@@' }).split('@@')[0] ?? '').trim(),
    { timeout: 20_000 },
  );

  // The customer confirms (AC-8): the deadline is worded "Confirm by" while the auto close is off.
  await page.goto(`/${locale}/requests/${f.request(1)}`);
  await expect(page.locator('#confirm-title')).toHaveText(m(locale, 'Jobs.confirmTitle'));
  await axe(page);
  await press(page, m(locale, 'Jobs.confirm'));
  await expect(page.getByText(m(locale, 'Requests.timeline.confirmed'))).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-pii]')).toContainText('İş Kaya');
  expect(sql(`select status, closed_by from public.requests where id = '${f.request(1)}';`)[0]).toEqual({
    status: 'COMPLETED',
    closed_by: 'customer',
  });

  // The provider still sees the customer's contacts in Done during the window (A-3).
  await provider.goto(`/${locale}/provider/applications?tab=done`);
  await expect(provider.locator('[data-pii]', { hasText: 'Moda Cad. No 1' })).toBeVisible();
  await axe(provider);

  // A second job: the customer closes it without the provider (AC-5).
  await page.goto(`/${locale}/requests/${f.request(2)}`);
  await press(page, m(locale, 'Jobs.markDone'));
  await expect(page.getByText(m(locale, 'Requests.timeline.closedByCustomer'))).toBeVisible({
    timeout: 20_000,
  });
  await axe(page);

  // A third job: Done, the deadline moved into the past, the auto close run once with its switch on (AC-6, R-2).
  sql(
    `do $s$ begin` +
      ` perform set_config('request.jwt.claims', json_build_object('sub', ${profileId(locale, 'workProvider')}, 'role', 'authenticated')::text, true);` +
      ` perform public.start_job('${f.request(3)}'); perform public.finish_job('${f.request(3)}');` +
      ` alter table public.requests disable trigger requests_guard;` +
      ` update public.requests set actual_completed_at = now() - interval '4 days', confirm_deadline = now() - interval '1 day' where id = '${f.request(3)}';` +
      ` alter table public.requests enable trigger requests_guard;` +
      ` update public.platform_settings set value = 'true' where region = 'TR' and key = 'auto_close_enabled';` +
      ` perform public.auto_close_jobs();` +
      ` update public.platform_settings set value = 'false' where region = 'TR' and key = 'auto_close_enabled';` +
      ` end $s$;`,
  );
  await page.goto(`/${locale}/requests/${f.request(3)}`);
  await expect(page.getByText(m(locale, 'Requests.timeline.closedAuto'))).toBeVisible();
  expect(sql(`select closed_by from public.requests where id = '${f.request(3)}';`)[0]).toEqual({
    closed_by: 'auto',
  });
});
