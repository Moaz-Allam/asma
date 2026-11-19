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
 * Spec 0011-14 AC-10 on the real local stack, at 390px with axe, in every locale. On a job whose contacts are shared,
 * the customer reports a problem with a photo; admin opens the report, shows the photo and warns the provider; the
 * provider sees the warning banner and acknowledges it. On a second job waiting for confirmation, the customer
 * presses "Not done", the auto close runs once with its switch on (inside one transaction, so the parallel projects
 * never see it on) and leaves the job open; admin sends the job back to work and the provider can press Done again.
 *
 * The requests, the offers, the choose, a commission of 0 and the provider fee (applied as the relay would) are
 * written as `postgres` in the shapes their own positions leave; the start is moved to today, as the clock would.
 */

const ORIGIN = `http://localhost:${process.env.E2E_PORT || 3100}`;
test.use({ baseURL: ORIGIN });

const PHOTO = join(process.cwd(), 'e2e', 'files', 'photo.jpg');

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
  const file = join(tmpdir(), `asma-e2e-report-${process.pid}-${Date.now()}-${randomUUID()}.sql`);
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

type Who = 'reportCustomer' | 'reportProvider';
const profileId = (locale: string, who: Who) =>
  `(select id from public.profiles where phone = '${testE164(locale, who)}')`;

function ids(locale: string) {
  const d = { ar: '1', tr: '2', en: '3' }[locale] ?? '9';
  const id = (kind: string) => `00000000-0000-4000-8000-0014000${kind}00${d}`;
  return {
    category: id('c1'),
    service: id('51'),
    zone: id('21'),
    request: (n: number) => id(`e${n}`),
    offer: (n: number) => id(`f${n}`),
    names: {
      service: `Şikayet hizmet ${locale}`,
      zone: `Şikayet semt ${locale}`,
      category: `Şikayet ${locale}`,
    },
  };
}

/** Two requests, each chosen, both fees settled, started today; the second also Done by the provider. */
function twoJobs(locale: string, f: ReturnType<typeof ids>) {
  const customer = profileId(locale, 'reportCustomer');
  const provider = profileId(locale, 'reportProvider');
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
    ` insert into public.request_addresses (request_id, region, customer_id, line) select '${f.request(n)}', 'TR', ${customer}, 'Şikayet Cad. No ${n}';` +
    ` insert into public.applications (id, region, request_id, provider_id, message) values` +
    ` ('${f.offer(n)}', 'TR', '${f.request(n)}', ${provider}, 'I can start at ten with my own tools, two people.');` +
    ` perform set_config('request.jwt.claims', json_build_object('sub', ${customer}, 'role', 'authenticated')::text, true);` +
    ` perform public.choose_provider('${f.request(n)}', '${f.offer(n)}');` +
    ` perform public.pay_commission('${f.request(n)}', 'tr', null);` +
    ` perform set_config('request.jwt.claims', json_build_object('sub', ${provider}, 'role', 'authenticated')::text, true);` +
    ` v_attempt := (public.pay_provider_fee('${f.offer(n)}', 'tr', null) ->> 'attempt_id')::uuid;` +
    ` select id, amount into v_fee, v_amount from public.fee_payments where request_id = '${f.request(n)}' and kind = 'provider_fee';` +
    ` perform public.apply_fee_paid(v_fee, v_attempt, 'e2e-report-${locale}-${n}', v_amount, 'TRY', 0);`;
  sql(
    `do $s$ declare v_attempt uuid; v_fee uuid; v_amount bigint; begin` +
      ` insert into public.service_categories (id, region, name, display_order, active) values ('${f.category}', 'TR', '{"tr": "${f.names.category}"}', 971, true) on conflict (id) do nothing;` +
      ` insert into public.services (id, category_id, region, name, hours_min, hours_max, display_order, active) values ('${f.service}', '${f.category}', 'TR', '{"tr": "${f.names.service}"}', 2, 3, 1, true) on conflict (id) do nothing;` +
      ` insert into public.zones (id, region, name, multiplier, display_order, active) values ('${f.zone}', 'TR', '{"tr": "${f.names.zone}"}', 1.00, 971, true) on conflict (id) do nothing;` +
      one(1) +
      one(2) +
      ` alter table public.requests disable trigger requests_guard;` +
      ` update public.requests set selected_at = now() - interval '5 hours', payment_deadline = now() - interval '4 hours',` +
      ` fee_deadline = now() - interval '3 hours', scheduled_start_at = now() - interval '1 hour', scheduled_end_at = now() + interval '1 hour'` +
      ` where id in ('${f.request(1)}', '${f.request(2)}');` +
      ` alter table public.requests enable trigger requests_guard;` +
      ` perform set_config('request.jwt.claims', json_build_object('sub', ${provider}, 'role', 'authenticated')::text, true);` +
      ` perform public.start_job('${f.request(2)}'); perform public.finish_job('${f.request(2)}');` +
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

/** Pick a chip of a ChoiceChips group by its label. */
async function chip(page: Page, label: string) {
  await page.locator('label', { hasText: label }).first().click();
}

async function handle(admin: Page, locale: string, requestId: string, outcome: string, note: string) {
  const [row] = sql(
    `select id from public.problem_reports where request_id = '${requestId}' and status = 'open' order by created_at desc limit 1;`,
  );
  await admin.goto(`/${locale}/admin/reports/${String(row?.id)}`);
  await chip(admin, m(locale, `AdminReports.outcomes.${outcome}`));
  await admin.getByLabel(m(locale, 'AdminReports.noteLabel')).fill(note);
  await admin.getByRole('button', { name: m(locale, 'AdminReports.submit') }).click();
  await admin
    .getByRole('dialog')
    .getByRole('button', { name: m(locale, 'AdminReports.confirm') })
    .click();
  await expect(admin.locator('#report-outcome')).toContainText(
    m(locale, `AdminReports.outcomes.${outcome}`),
    {
      timeout: 20_000,
    },
  );
}

test('a report with a photo, a warning acknowledged, a paused close and a return to work', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(480_000);
  const locale = testInfo.project.name;
  const f = ids(locale);

  const provider = await newPage(browser);
  await signIn(provider, locale, testPhone(locale, 'reportProvider'), `/${locale}/login?as=provider`);
  await onboard(provider, `Şikayet Usta ${locale}`);
  await expect(provider).toHaveURL(new RegExp(`/${locale}/provider/profile$`), { timeout: 20_000 });
  sql(
    `update public.providers set status = 'approved', approved_at = now(), approved_name = 'Şikayet Kaya'` +
      ` where id = ${profileId(locale, 'reportProvider')};`,
  );
  await signIn(page, locale, testPhone(locale, 'reportCustomer'));
  await onboard(page, 'Şikayet Müşteri');
  await expect(page).toHaveURL(new RegExp(`/${locale}/requests/new$`), { timeout: 20_000 });

  const admin = await newPage(browser);
  await signIn(admin, locale, testPhone(locale, 'reportAdmin'));
  await onboard(admin, `Admin ${locale}`);
  await expect(admin).toHaveURL(new RegExp(`/${locale}/requests/new$`), { timeout: 20_000 });
  sql(`select public.promote_to_admin('${testE164(locale, 'reportAdmin')}')`);
  await admin.context().clearCookies();
  await signIn(admin, locale, testPhone(locale, 'reportAdmin'));
  await expect(admin).toHaveURL(new RegExp(`/${locale}/admin$`), { timeout: 20_000 });

  twoJobs(locale, f);

  // The customer reports a problem with a photo (AC-1, AC-2, AC-7).
  await page.goto(`/${locale}/requests/${f.request(1)}`);
  await page.getByRole('link', { name: m(locale, 'Reports.cta') }).click();
  await expect(page).toHaveURL(new RegExp(`/${locale}/requests/${f.request(1)}/report$`));
  await chip(page, m(locale, 'Reports.reasons.safety_or_behaviour'));
  await page
    .getByLabel(m(locale, 'Reports.form.text'))
    .fill('He shouted at my mother and left the door open.');
  await page.locator('input[type="file"]').setInputFiles(PHOTO);
  await expect(
    page.getByRole('img', { name: m(locale, 'Reports.form.photoAlt', { number: 1 }) }),
  ).toBeVisible();
  await axe(page);
  await page.getByRole('button', { name: m(locale, 'Reports.form.submit') }).click();
  await expect(page.locator('#report-sent')).toHaveText(m(locale, 'Reports.form.sentTitle'), {
    timeout: 30_000,
  });
  await axe(page);
  expect(
    sql(
      `select r.status, r.reason, (select count(*)::int from public.report_photos p where p.report_id = r.id) as photos` +
        ` from public.problem_reports r where r.request_id = '${f.request(1)}';`,
    )[0],
  ).toEqual({ status: 'open', reason: 'safety_or_behaviour', photos: 1 });

  // Admin: the queue, the detail, the photo behind Show, then a warning (AC-4, AC-5).
  await admin.goto(`/${locale}/admin/reports`);
  await expect(admin.getByRole('heading', { level: 1 })).toHaveText(m(locale, 'AdminReports.title'));
  await axe(admin);
  const [report] = sql(`select id from public.problem_reports where request_id = '${f.request(1)}';`);
  await admin.goto(`/${locale}/admin/reports/${String(report?.id)}`);
  await expect(admin.getByText('He shouted at my mother and left the door open.')).toBeVisible();
  await admin.getByRole('button', { name: m(locale, 'AdminReports.show', { number: 1 }) }).click();
  await expect(admin.getByRole('img', { name: m(locale, 'AdminReports.show', { number: 1 }) })).toBeVisible({
    timeout: 20_000,
  });
  await axe(admin);
  await handle(admin, locale, f.request(1), 'warned', 'He was rude to the family, a first warning.');

  // The provider sees the warning on every page of their area and acknowledges it (AC-6).
  await provider.goto(`/${locale}/provider/applications?tab=active`);
  const banner = provider.getByRole('alert').filter({ hasText: m(locale, 'Reports.banner.title') });
  await expect(banner).toContainText(m(locale, 'Reports.warning.safety_or_behaviour'));
  await axe(provider);
  await banner.getByRole('button', { name: m(locale, 'Reports.banner.acknowledge') }).click();
  await expect(banner).toHaveCount(0, { timeout: 20_000 });

  // A job waiting for confirmation: Not done (AC-3); an open report keeps it open past its deadline (R-6).
  await page.goto(`/${locale}/requests/${f.request(2)}`);
  await page.getByRole('link', { name: m(locale, 'Reports.notDone') }).click();
  await expect(page.locator('input[type="radio"][value="poor_work"]')).toBeChecked();
  await page
    .getByLabel(m(locale, 'Reports.form.text'))
    .fill('The kitchen tiles are still missing on one wall.');
  await page.getByRole('button', { name: m(locale, 'Reports.form.submit') }).click();
  await expect(page.locator('#report-sent')).toBeVisible({ timeout: 30_000 });
  sql(
    `do $s$ begin` +
      ` alter table public.requests disable trigger requests_guard;` +
      ` update public.requests set confirm_deadline = now() - interval '1 hour' where id = '${f.request(2)}';` +
      ` alter table public.requests enable trigger requests_guard;` +
      ` update public.platform_settings set value = 'true' where region = 'TR' and key = 'auto_close_enabled';` +
      ` perform public.auto_close_jobs();` +
      ` update public.platform_settings set value = 'false' where region = 'TR' and key = 'auto_close_enabled';` +
      ` end $s$;`,
  );
  expect(sql(`select status from public.requests where id = '${f.request(2)}';`)[0]).toEqual({
    status: 'AWAITING_CONFIRMATION',
  });
  await page.goto(`/${locale}/requests/${f.request(2)}`);
  await expect(page.getByText(m(locale, 'Reports.closeWaits'))).toBeVisible();

  // Admin sends it back to work; the provider can press Done again (AC-5).
  await handle(admin, locale, f.request(2), 'returned_to_work', 'The tiles are missing, back to work.');
  expect(sql(`select status from public.requests where id = '${f.request(2)}';`)[0]).toEqual({
    status: 'IN_PROGRESS',
  });
  await provider.goto(`/${locale}/provider/applications?tab=active`);
  const job2 = provider.locator('li', { hasText: 'Şikayet Cad. No 2' }).first();
  await expect(job2.getByRole('button', { name: m(locale, 'Jobs.finish') })).toBeVisible({ timeout: 20_000 });
});
