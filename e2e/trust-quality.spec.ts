import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import type { Browser, Page } from '@playwright/test';
import { createTranslator } from 'next-intl';

import { expect, test } from './fixtures';
import { onboard, signIn } from './auth';
import { testE164, testPhone } from './numbers';

/**
 * Spec 0011-19a AC-18 on the real local stack, at 390px with axe, in every locale. An established provider with six
 * completed jobs shows "6 jobs on Aldebyani · 100% completed · 100% on time" on the customer's offer card and reads
 * the same on their profile; with eight approved applications on a request they find it full, while a provider on
 * probation still applies, taking slot 9, and reads their probation on their profile. Admin warns that provider from
 * the watchlist and the provider sees the banner; the funnel tab shows the stages and its admin only note.
 *
 * The jobs, the eight applicants and the flag are written as `postgres` in the shapes 06 to 11 leave (no API role can
 * write a flag; the hourly job raises them in pgTAP 38). Every figure is computed in Postgres.
 */

const ORIGIN = `http://localhost:${process.env.E2E_PORT || 3100}`;
test.use({ baseURL: ORIGIN, viewport: { width: 390, height: 844 } });

type Catalogue = Record<string, unknown>;
const CATALOGUES: Record<string, Catalogue> = Object.fromEntries(
  ['ar', 'tr', 'en'].map((l) => [
    l,
    JSON.parse(readFileSync(join(process.cwd(), 'messages', `${l}.json`), 'utf8')) as Catalogue,
  ]),
);

function m(locale: string, key: string, values: Record<string, string | number> = {}): string {
  const t = createTranslator({ locale, messages: CATALOGUES[locale] as never });
  return (t as unknown as (k: string, v?: Record<string, string | number>) => string)(key, values);
}

/** As the app words a whole percentage (`lib/quality/summary.ts`). */
function pct(value: number, locale: string): string {
  const tag = ({ ar: 'ar-u-nu-latn', tr: 'tr', en: 'en' } as Record<string, string>)[locale] ?? locale;
  return new Intl.NumberFormat(tag, { style: 'percent', maximumFractionDigits: 0 }).format(value / 100);
}

function sql(query: string): Record<string, unknown>[] {
  const file = join(tmpdir(), `asma-e2e-quality-${process.pid}-${Date.now()}-${randomUUID()}.sql`);
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

type Who = 'qualityCustomer' | 'qualityEstablished' | 'qualityNew' | 'qualityAdmin';
const profileId = (locale: string, who: Who) =>
  `(select id from public.profiles where phone = '${testE164(locale, who)}')`;

function ids(locale: string) {
  const d = { ar: '1', tr: '2', en: '3' }[locale] ?? '9';
  const id = (kind: string) => `00000000-0000-4000-8000-0019000${kind}00${d}`;
  return {
    d,
    rater: id('c0'),
    category: id('c1'),
    service: id('51'),
    zone: id('21'),
    request: (n: number) => id(`e${n}`),
    offer: (n: number) => id(`f${n}`),
    applicant: (n: number) => id(`a${n}`),
    applicantOffer: (n: number) => id(`b${n}`),
    names: {
      service: `Kalite hizmet ${locale}`,
      zone: `Kalite semt ${locale}`,
      category: `Kalite ${locale}`,
    },
  };
}

type Ids = ReturnType<typeof ids>;

function snapshot(f: Ids): string {
  return JSON.stringify({
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
}

/** An OPEN request of `customer` two days ahead at 10:00 local, optionally with `provider`'s offer on it. */
function request(f: Ids, n: number, customer: string, provider: string | null): string {
  return (
    ` insert into public.requests (id, region, customer_id, client_key, service_id, zone_id, answers, questions_snapshot, pricing_snapshot,` +
    ` fixed_price, commission_amount, cash_due, currency, scheduled_start_at, scheduled_end_at)` +
    ` select '${f.request(n)}', 'TR', ${customer}, gen_random_uuid(), '${f.service}', '${f.zone}', '{}', '[]', '${snapshot(f)}',` +
    ` 300000, 0, 300000, 'TRY', ((now() at time zone 'Europe/Istanbul')::date + 2 + time '10:00') at time zone 'Europe/Istanbul',` +
    ` ((now() at time zone 'Europe/Istanbul')::date + 2 + time '12:00') at time zone 'Europe/Istanbul';` +
    ` insert into public.request_addresses (request_id, region, customer_id, line) select '${f.request(n)}', 'TR', ${customer}, 'Moda Cad. No ${n}';` +
    (provider
      ? ` insert into public.applications (id, region, request_id, provider_id, message) values` +
        ` ('${f.offer(n)}', 'TR', '${f.request(n)}', ${provider}, 'I can start at ten with my own tools, two people.');`
      : '')
  );
}

/** A COMPLETED job of the SQL customer with `provider`'s unlocked pick, started on time, `daysAgo` days ago. */
function done(f: Ids, n: number, provider: string, daysAgo: number): string {
  return (
    request(f, n, `'${f.rater}'`, provider) +
    ` alter table public.applications disable trigger applications_guard;` +
    ` update public.applications set status = 'CONFIRMED', unlocked_at = now() - interval '${daysAgo} days 6 hours',` +
    ` provider_fee_amount = 0, provider_fee_kind = 'fixed' where id = '${f.offer(n)}';` +
    ` alter table public.applications enable trigger applications_guard;` +
    ` alter table public.requests disable trigger requests_guard;` +
    ` update public.requests set status = 'COMPLETED', selected_application_id = '${f.offer(n)}',` +
    ` selected_at = now() - interval '${daysAgo} days 9 hours', payment_deadline = now() - interval '${daysAgo} days 8 hours',` +
    ` fee_deadline = now() - interval '${daysAgo} days 7 hours', scheduled_start_at = now() - interval '${daysAgo} days 3 hours',` +
    ` scheduled_end_at = now() - interval '${daysAgo} days 1 hour', actual_started_at = now() - interval '${daysAgo} days 3 hours',` +
    ` actual_completed_at = now() - interval '${daysAgo} days 2 hours', closed_at = now() - interval '${daysAgo} days 1 hour', closed_by = 'customer'` +
    ` where id = '${f.request(n)}';` +
    ` alter table public.requests enable trigger requests_guard;`
  );
}

/** The provider's setup for this project's service and district, every day, all hours. */
function setup(f: Ids, provider: string): string {
  return (
    ` insert into public.provider_services (provider_id, service_id, region) select ${provider}, '${f.service}', 'TR';` +
    ` insert into public.provider_zones (provider_id, zone_id, region) select ${provider}, '${f.zone}', 'TR';` +
    ` insert into public.provider_availability (provider_id, region, work_days, start_hour, end_hour)` +
    ` select ${provider}, 'TR', '{0,1,2,3,4,5,6}', 0, 24;`
  );
}

/**
 * The catalog; six completed jobs of the established provider; R1, the customer's OPEN request with the established
 * provider's offer; R2, an OPEN request with eight approved applicants written by SQL (the slots not reserved).
 */
function seed(locale: string, f: Ids) {
  const customer = profileId(locale, 'qualityCustomer');
  const established = profileId(locale, 'qualityEstablished');
  const fresh = profileId(locale, 'qualityNew');
  const phone = (n: number) => `90555919${f.d}${String(n).padStart(3, '0')}`;
  const applicants = [1, 2, 3, 4, 5, 6, 7, 8];
  sql(
    `do $s$ begin` +
      ` perform set_config('pricing.publishing', 'on', true);` +
      ` insert into public.service_categories (id, region, name, display_order, active) values ('${f.category}', 'TR', '{"tr": "${f.names.category}"}', 990, true) on conflict (id) do nothing;` +
      ` insert into public.services (id, category_id, region, name, hours_min, hours_max, display_order, active) values ('${f.service}', '${f.category}', 'TR', '{"tr": "${f.names.service}"}', 2, 3, 1, true) on conflict (id) do nothing;` +
      ` insert into public.zones (id, region, name, multiplier, display_order, active) values ('${f.zone}', 'TR', '{"tr": "${f.names.zone}"}', 1.00, 990, true) on conflict (id) do nothing;` +
      ` perform set_config('pricing.publishing', 'off', true);` +
      ` update public.providers set status = 'approved', approved_at = now() - interval '200 days', approved_name = 'Kalite Usta' where id = ${established};` +
      ` update public.providers set status = 'approved', approved_at = now() - interval '3 days', approved_name = 'Yeni Usta' where id = ${fresh};` +
      setup(f, established) +
      setup(f, fresh) +
      ` insert into auth.users (id, aud, role, phone, phone_confirmed_at) values ('${f.rater}', 'authenticated', 'authenticated', '${phone(0)}', now());` +
      ` insert into public.profiles (id, role, region, phone, full_name, locale) values ('${f.rater}', 'customer', 'TR', '+${phone(0)}', 'Kalite Müşteri', 'tr');` +
      applicants
        .map(
          (n) =>
            ` insert into auth.users (id, aud, role, phone, phone_confirmed_at) values ('${f.applicant(n)}', 'authenticated', 'authenticated', '${phone(n)}', now());` +
            ` insert into public.profiles (id, role, region, phone, full_name, locale) values ('${f.applicant(n)}', 'provider', 'TR', '+${phone(n)}', 'Aday ${n}', 'tr');` +
            ` update public.providers set status = 'approved', approved_at = now() - interval '100 days', approved_name = 'Aday ${n}' where id = '${f.applicant(n)}';`,
        )
        .join('') +
      [3, 4, 5, 6, 7, 8].map((n, i) => done(f, n, established, i + 2)).join('') +
      request(f, 1, customer, established) +
      request(f, 2, `'${f.rater}'`, null) +
      applicants
        .map(
          (n) =>
            ` insert into public.applications (id, region, request_id, provider_id, message) values` +
            ` ('${f.applicantOffer(n)}', 'TR', '${f.request(2)}', '${f.applicant(n)}', 'An offer that fills one of the open slots.');`,
        )
        .join('') +
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

async function newPage(browser: Browser) {
  return (await browser.newContext({ viewport: { width: 390, height: 844 }, baseURL: ORIGIN })).newPage();
}

test('the offer card line, probation and reserved slots, the watchlist warn and the funnel', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(420_000);
  const locale = testInfo.project.name;
  const f = ids(locale);
  const settings = Object.fromEntries(
    sql(
      `select key, value::text as value from public.platform_settings where region = 'TR'` +
        ` and key in ('probation_jobs', 'probation_live_jobs');`,
    ).map((row) => [String(row.key), Number(String(row.value).replaceAll('"', ''))]),
  ) as { probation_jobs: number; probation_live_jobs: number };

  // Every actor exists first; the seed approves the two providers and writes the jobs.
  await signIn(page, locale, testPhone(locale, 'qualityCustomer'));
  await onboard(page, 'Kalite Müşteri');
  await expect(page).toHaveURL(new RegExp(`/${locale}/requests/new$`), { timeout: 20_000 });
  const established = await newPage(browser);
  await signIn(established, locale, testPhone(locale, 'qualityEstablished'), `/${locale}/login?as=provider`);
  await onboard(established, `Kalite Usta ${locale}`);
  await expect(established).toHaveURL(new RegExp(`/${locale}/provider/profile$`), { timeout: 20_000 });
  const fresh = await newPage(browser);
  await signIn(fresh, locale, testPhone(locale, 'qualityNew'), `/${locale}/login?as=provider`);
  await onboard(fresh, `Yeni Usta ${locale}`);
  await expect(fresh).toHaveURL(new RegExp(`/${locale}/provider/profile$`), { timeout: 20_000 });
  seed(locale, f);

  // The customer's offer card: jobs on Aldebyani and both rates, with how they are counted (AC-3).
  const jobs = m(locale, 'Quality.card.jobs', { count: 6 });
  const completed = m(locale, 'Quality.card.completed', { pct: pct(100, locale) });
  const onTime = m(locale, 'Quality.card.onTime', { pct: pct(100, locale) });
  await page.goto(`/${locale}/requests/${f.request(1)}`);
  const offer = page.locator('li', { hasText: 'Kalite U.' });
  await expect(offer).toContainText(`${jobs} · ${completed} · ${onTime}`, { timeout: 20_000 });
  await offer.getByText(m(locale, 'Quality.card.how')).click();
  await expect(offer).toContainText(m(locale, 'Quality.card.windowMonths', { count: 12 }));
  await expect(offer).not.toContainText(m(locale, 'Quality.admin.kind.high_cancellations'));
  await axe(page);

  // The established provider reads the same figures and finds the request with eight applicants full (AC-4, AC-7).
  await established.goto(`/${locale}/provider/profile`);
  const mine = established.locator('section[aria-labelledby="my-quality-title"]');
  await expect(mine).toContainText(m(locale, 'Quality.mine.title'));
  await expect(mine).toContainText(pct(100, locale));
  await expect(mine).not.toContainText(
    m(locale, 'Quality.mine.probationLimit', { limit: settings.probation_live_jobs }),
  );
  await axe(established);
  await established.goto(`/${locale}/provider/feed/${f.request(2)}`);
  await expect(established.getByText(m(locale, 'ProviderFeed.form.full'))).toBeVisible({ timeout: 20_000 });

  // The provider on probation reads it on their profile, and still applies, taking slot 9 (AC-4, AC-5, AC-7).
  await fresh.goto(`/${locale}/provider/profile`);
  const theirs = fresh.locator('section[aria-labelledby="my-quality-title"]');
  await expect(theirs).toContainText(
    m(locale, 'Quality.mine.probation', { needed: settings.probation_jobs, done: 0 }),
  );
  await expect(theirs).toContainText(
    m(locale, 'Quality.mine.probationLimit', { limit: settings.probation_live_jobs }),
  );
  await axe(fresh);
  await fresh.goto(`/${locale}/provider/feed/${f.request(2)}`);
  await fresh.locator('#application-message').fill('I can start at ten with two people and all the tools.');
  await fresh.getByRole('button', { name: m(locale, 'ProviderFeed.form.submit') }).click();
  const confirm = fresh.getByRole('alertdialog').or(fresh.getByRole('dialog'));
  await confirm.getByRole('button', { name: m(locale, 'ProviderFeed.form.confirmSend') }).click();
  await expect(fresh.getByText(m(locale, 'ProviderFeed.form.applied'))).toBeVisible({ timeout: 20_000 });
  expect(
    sql(
      `select count(*)::int as n from public.applications where request_id = '${f.request(2)}' and status = 'APPLIED';`,
    )[0],
  ).toEqual({ n: 9 });

  // Admin warns that provider from the watchlist (AC-9, AC-10); the flag is written as the hourly job writes one.
  sql(
    `insert into public.quality_flags (region, provider_id, kind, figure)` +
      ` select 'TR', ${profileId(locale, 'qualityNew')}, 'high_cancellations', '{"num": 1, "den": 4, "pct": 25, "threshold": 10}';`,
  );
  const admin = await newPage(browser);
  await signIn(admin, locale, testPhone(locale, 'qualityAdmin'));
  await onboard(admin, `Kalite Admin ${locale}`);
  await expect(admin).toHaveURL(new RegExp(`/${locale}/requests/new$`), { timeout: 20_000 });
  sql(`select public.promote_to_admin('${testE164(locale, 'qualityAdmin')}')`);
  await admin.context().clearCookies();
  await signIn(admin, locale, testPhone(locale, 'qualityAdmin'));
  await expect(admin).toHaveURL(new RegExp(`/${locale}/admin$`), { timeout: 20_000 });
  await admin.goto(`/${locale}/admin/quality`);
  const freshId = String(sql(`select ${profileId(locale, 'qualityNew')}::text as id;`)[0]?.id);
  const row = admin.locator('li').filter({ has: admin.locator(`a[href$="/admin/providers/${freshId}"]`) });
  await expect(row).toContainText(m(locale, 'Quality.admin.kind.high_cancellations'));
  await expect(row).toContainText(pct(25, locale));
  await axe(admin);
  await row.getByRole('button', { name: m(locale, 'Quality.admin.actions.warned.label') }).click();
  const dialog = admin.getByRole('alertdialog').or(admin.getByRole('dialog'));
  await expect(dialog).toContainText('Yeni Usta');
  await dialog.getByRole('textbox').fill('Two late cancels this month, spoke on the phone.');
  await axe(admin);
  await dialog.getByRole('button', { name: m(locale, 'Quality.admin.actions.warned.confirm') }).click();
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
  await expect(row).toHaveCount(0);

  // The provider sees the fixed sentence, never admin's note (AC-9).
  await fresh.goto(`/${locale}/provider`);
  const banner = fresh.getByRole('alert').filter({ hasText: m(locale, 'Reports.banner.title') });
  await expect(banner).toContainText(m(locale, 'Reports.warning.high_cancellations'));
  await expect(fresh.locator('body')).not.toContainText('spoke on the phone');
  await axe(fresh);

  // The funnel: the stages per region and the admin only note (AC-12, B7).
  await admin.goto(`/${locale}/admin/quality?tab=funnel`);
  await expect(admin.getByText(m(locale, 'Quality.admin.funnelNote'))).toBeVisible();
  const tr = admin.locator('section[aria-labelledby="funnel-TR"]');
  await expect(tr).toContainText(m(locale, 'Quality.admin.stage.probation'));
  await expect(tr).toContainText(m(locale, 'Quality.admin.rate'));
  await axe(admin);
});
