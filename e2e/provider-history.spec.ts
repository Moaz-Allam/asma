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
 * Spec 0011-15 AC-5 on the real local stack, at 390px with axe, in every locale. The provider reaches Jobs and fees
 * from the links on `/provider` (R-12), reads this month (a paid fee with its receipt, a fee of 0 with none) and the
 * month before (a cancelled job whose fee was refunded), finds an empty month, and a month outside the window falls
 * back to the current one (R-10).
 *
 * The jobs are written as `postgres` in the shapes 10 to 12 leave (unlocked picks, fee rows, a refund row), each
 * scheduled on the fifteenth of its month in the region's time zone, so the test does not depend on today's date.
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
  const file = join(tmpdir(), `asma-e2e-history-${process.pid}-${Date.now()}-${randomUUID()}.sql`);
  writeFileSync(file, query);
  let last = '';
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const run = spawnSync('npx', ['supabase', 'db', 'query', '--local', '-o', 'json', '-f', file], {
      encoding: 'utf8',
      shell: true,
    });
    if (run.status === 0) {
      // `-o json` (D189): an array or `{ rows }`.
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
  const id = (kind: string) => `00000000-0000-4000-8000-0015000${kind}00${d}`;
  return {
    customer: id('c0'),
    category: id('c1'),
    service: id('51'),
    zone: id('21'),
    request: (n: number) => id(`e${n}`),
    offer: (n: number) => id(`f${n}`),
    fee: (n: number) => id(`a${n}`),
    service_name: `Geçmiş hizmet ${locale}`,
  };
}

const TZ = `(select timezone from public.regions where code = 'TR')`;
/** The fifteenth at 10:00, region time, of the month k months from now. */
const fifteenth = (k: number) =>
  `((date_trunc('month', now() at time zone ${TZ}) + interval '${k} months' + interval '14 days 10 hours') at time zone ${TZ})`;

/** Moves a request to its month past the guard, keeping its deadlines in order. */
function moveTo(f: ReturnType<typeof ids>, n: number, at: string, extra = ''): string {
  return (
    ` alter table public.requests disable trigger requests_guard;` +
    ` update public.requests set selected_at = ${at} - interval '5 hours', payment_deadline = ${at} - interval '4 hours',` +
    ` fee_deadline = ${at} - interval '3 hours', scheduled_start_at = ${at}, scheduled_end_at = ${at} + interval '2 hours'${extra}` +
    ` where id = '${f.request(n)}';` +
    ` alter table public.requests enable trigger requests_guard;`
  );
}

function request(f: ReturnType<typeof ids>, n: number, cash: number, commission: number, at: string): string {
  const snapshot = JSON.stringify({
    price: cash + commission,
    currency: 'TRY',
    commission_percent: '0',
    rounding_minor: 100,
    service: { id: f.service, name: { tr: f.service_name } },
  });
  return (
    ` insert into public.requests (id, region, customer_id, client_key, service_id, zone_id, answers, questions_snapshot,` +
    ` pricing_snapshot, fixed_price, commission_amount, cash_due, currency, scheduled_start_at, scheduled_end_at)` +
    ` values ('${f.request(n)}', 'TR', '${f.customer}', gen_random_uuid(), '${f.service}', '${f.zone}', '{}', '[]',` +
    ` '${snapshot}', ${cash + commission}, ${commission}, ${cash}, 'TRY', ${at}, ${at} + interval '2 hours');` +
    ` insert into public.applications (id, region, request_id, provider_id, message)` +
    ` values ('${f.offer(n)}', 'TR', '${f.request(n)}', v_p, 'I can start at ten with my own tools, two people.');`
  );
}

/**
 * A job whose provider fee is paid as the relay applies it (choose, a commission of 0, the fee, apply_fee_paid), so
 * every fee row has its ledger journal (other specs check the whole ledger), then moved to the fifteenth of month k.
 */
function paidJob(f: ReturnType<typeof ids>, locale: string, n: number, k: number, cash: number): string {
  return (
    request(f, n, cash, 0, `now() + interval '3 days'`) +
    ` perform set_config('request.jwt.claims', json_build_object('sub', '${f.customer}', 'role', 'authenticated')::text, true);` +
    ` perform public.choose_provider('${f.request(n)}', '${f.offer(n)}');` +
    ` perform public.pay_commission('${f.request(n)}', 'tr', null);` +
    ` perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);` +
    ` v_attempt := (public.pay_provider_fee('${f.offer(n)}', 'tr', null) ->> 'attempt_id')::uuid;` +
    ` select id, amount into v_fee, v_amount from public.fee_payments where request_id = '${f.request(n)}' and kind = 'provider_fee';` +
    ` perform public.apply_fee_paid(v_fee, v_attempt, 'e2e-history-${locale}-${n}', v_amount, 'TRY', 0);` +
    moveTo(f, n, fifteenth(k))
  );
}

function seed(locale: string, f: ReturnType<typeof ids>) {
  const provider = `(select id from public.profiles where phone = '${testE164(locale, 'historyProvider')}')`;
  const phone = testE164(locale, 'historyCustomer');
  const at2 = fifteenth(0);
  const at3 = fifteenth(-1);
  sql(
    `do $s$ declare v_p uuid := ${provider}; v_attempt uuid; v_fee uuid; v_amount bigint; v_ref uuid; begin` +
      ` if exists (select 1 from public.requests where id = '${f.request(1)}') then return; end if;` +
      ` insert into auth.users (id, aud, role, phone, phone_confirmed_at)` +
      ` values ('${f.customer}', 'authenticated', 'authenticated', '${phone.slice(1)}', now()) on conflict (id) do nothing;` +
      ` insert into public.profiles (id, role, region, phone, full_name, locale)` +
      ` values ('${f.customer}', 'customer', 'TR', '${phone}', 'Geçmiş Müşteri', 'tr') on conflict (id) do nothing;` +
      ` insert into public.service_categories (id, region, name, display_order, active)` +
      ` values ('${f.category}', 'TR', '{"tr": "Geçmiş ${locale}"}', 975, true) on conflict (id) do nothing;` +
      ` insert into public.services (id, category_id, region, name, hours_min, hours_max, display_order, active)` +
      ` values ('${f.service}', '${f.category}', 'TR', '{"tr": "${f.service_name}"}', 2, 3, 1, true) on conflict (id) do nothing;` +
      ` insert into public.zones (id, region, name, multiplier, display_order, active)` +
      ` values ('${f.zone}', 'TR', '{"tr": "Geçmiş semt ${locale}"}', 1.00, 975, true) on conflict (id) do nothing;` +
      // 1: this month, a paid fee with its receipt.
      paidJob(f, locale, 1, 0, 90000) +
      // 3: the month before, paid, refunded as the relay applies it, then cancelled by the customer.
      paidJob(f, locale, 3, -1, 70000) +
      ` insert into public.fee_refunds (region, request_id, kind, fee_payment_id, psp_payment_id, amount, currency, reason, status)` +
      ` values ('TR', '${f.request(3)}', 'fee', v_fee, 'e2e-history-${locale}-3', v_amount, 'TRY', 'admin_refund', 'queued')` +
      ` returning id into v_ref;` +
      ` perform public.apply_fee_refunded(v_ref, 'e2e-history-refund-${locale}-3');` +
      ` alter table public.applications disable trigger applications_guard;` +
      ` update public.applications set status = 'CANCELLED' where id = '${f.offer(3)}';` +
      ` alter table public.applications enable trigger applications_guard;` +
      moveTo(
        f,
        3,
        at3,
        `, status = 'CANCELLED', cancelled_at = ${at3} + interval '3 hours', cancelled_by = 'customer',` +
          ` closed_at = ${at3} + interval '3 hours', closed_by = 'customer'`,
      ) +
      // 2: this month, a fee of 0 (no fee row, D171), closed by the customer.
      request(f, 2, 50000, 10000, at2) +
      ` alter table public.applications disable trigger applications_guard;` +
      ` update public.applications set status = 'CONFIRMED', unlocked_at = ${at2} - interval '2 hours',` +
      ` provider_fee_amount = 0, provider_fee_kind = 'fixed' where id = '${f.offer(2)}';` +
      ` alter table public.applications enable trigger applications_guard;` +
      moveTo(
        f,
        2,
        at2,
        `, status = 'COMPLETED', selected_application_id = '${f.offer(2)}', actual_started_at = ${at2},` +
          ` actual_completed_at = ${at2} + interval '1 hour', closed_at = ${at2} + interval '3 hours', closed_by = 'customer'`,
      ) +
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

async function signIn(page: Page, locale: string, phone: string, path: string) {
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

test('the provider reads each month of jobs and fees, with receipts, a refund and a cancelled job', async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  const locale = testInfo.project.name;
  const f = ids(locale);

  await signIn(page, locale, testPhone(locale, 'historyProvider'), `/${locale}/login?as=provider`);
  await onboard(page, `Geçmiş Usta ${locale}`);
  await expect(page).toHaveURL(new RegExp(`/${locale}/provider/profile$`), { timeout: 20_000 });
  sql(
    `update public.providers set status = 'approved', approved_at = now(), approved_name = 'Geçmiş Kaya'` +
      ` where id = (select id from public.profiles where phone = '${testE164(locale, 'historyProvider')}');`,
  );
  seed(locale, f);
  const [months] = sql(
    `select to_char(date_trunc('month', now() at time zone ${TZ}) - interval '1 month', 'YYYY-MM') as previous,` +
      ` to_char(date_trunc('month', now() at time zone ${TZ}) - interval '2 months', 'YYYY-MM') as empty;`,
  );

  // R-12: below lg the provider home links the page.
  await page.goto(`/${locale}/provider`);
  await page.getByRole('link', { name: m(locale, 'History.nav') }).click();
  await expect(page).toHaveURL(new RegExp(`/${locale}/provider/history$`));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(m(locale, 'History.title'));
  await expect(page.getByText(m(locale, 'History.byJobDate'))).toBeVisible();

  // This month: a paid fee with its receipt, a fee of 0 without one (AC-2, R-11).
  const picker = page.getByRole('navigation', { name: m(locale, 'History.months') });
  await expect(picker.locator('a[aria-current="page"]')).toHaveCount(1);
  const rows = page.locator('li', { hasText: f.service_name });
  await expect(rows).toHaveCount(2);
  const paid = page.locator('li', { has: page.locator(`a[href$="/receipts/${f.fee(1)}"]`) });
  await expect(paid).toHaveCount(1);
  await expect(paid.getByRole('link', { name: m(locale, 'History.openJob') })).toHaveAttribute(
    'href',
    /tab=active/,
  );
  await expect(page.getByRole('link', { name: m(locale, 'History.receipt') })).toHaveCount(1);
  await expect(page.getByText(m(locale, 'History.cashClosedNote'))).toBeVisible();
  await axe(page);

  // The month before: the cancelled job, its cash struck through, its fee refunded (R-4, X-3).
  await picker.getByRole('link').nth(1).click();
  await expect(page).toHaveURL(new RegExp(`month=${String(months?.previous)}$`));
  const cancelled = page.locator('li', { hasText: f.service_name });
  await expect(cancelled).toHaveCount(1);
  await expect(cancelled).toContainText(m(locale, 'History.cancelled'));
  await expect(cancelled).toContainText(m(locale, 'History.refundDone'));
  await expect(cancelled.locator('.line-through')).toHaveCount(1);
  await expect(cancelled.getByRole('link', { name: m(locale, 'History.openJob') })).toHaveAttribute(
    'href',
    /tab=done/,
  );
  await axe(page);

  // An empty month shows EmptyState; a month outside the window falls back to the current one (R-10).
  await page.goto(`/${locale}/provider/history?month=${String(months?.empty)}`);
  await expect(page.getByRole('heading', { name: m(locale, 'History.empty.title') })).toBeVisible();
  await axe(page);
  await page.goto(`/${locale}/provider/history?month=2000-01`);
  await expect(page.locator('li', { hasText: f.service_name })).toHaveCount(2);
});
