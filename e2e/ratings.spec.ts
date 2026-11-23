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
 * Spec 0011-17 AC-13 on the real local stack, at 390px with axe, in every locale. The customer confirms a job, sees
 * "Your rating" (optional), skips it and posts a new request from Repeat; then rates the job and sees the scores read
 * only. The provider sees New with the count. With five more ratings written by SQL, the customer's offer card and
 * the provider's card show a score with the count; admin hides one and both change.
 *
 * The job is written as `postgres` in the shapes 06 to 11 leave (the choose, a commission of 0, the provider fee
 * applied as the relay would, Started and Done today). No API role can insert a rating, so the five other ratings
 * are inserted as `postgres` on five COMPLETED requests with unlocked picks (the seeding rule of AC-13). Every
 * figure is computed in Postgres; this test reads it from the page, because the region mean moves with the other
 * projects' ratings.
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

/** A catalogue string with ICU plurals, as the app renders it. */
function m(locale: string, key: string, values: Record<string, string | number> = {}): string {
  const t = createTranslator({ locale, messages: CATALOGUES[locale] as never });
  return (t as unknown as (k: string, v?: Record<string, string | number>) => string)(key, values);
}

function sql(query: string): Record<string, unknown>[] {
  const file = join(tmpdir(), `asma-e2e-ratings-${process.pid}-${Date.now()}-${randomUUID()}.sql`);
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

type Who = 'ratingCustomer' | 'ratingProvider' | 'ratingAdmin';
const profileId = (locale: string, who: Who) =>
  `(select id from public.profiles where phone = '${testE164(locale, who)}')`;

function ids(locale: string) {
  const d = { ar: '1', tr: '2', en: '3' }[locale] ?? '9';
  const id = (kind: string) => `00000000-0000-4000-8000-0017000${kind}00${d}`;
  return {
    rater: id('c0'),
    category: id('c1'),
    service: id('51'),
    zone: id('21'),
    formula: id('b1'),
    request: (n: number) => id(`e${n}`),
    offer: (n: number) => id(`f${n}`),
    names: { service: `Puan hizmet ${locale}`, zone: `Puan semt ${locale}`, category: `Puan ${locale}` },
  };
}

function snapshot(f: ReturnType<typeof ids>): string {
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

/** A request of customer `customer` with provider `provider`'s offer on it, starting in three days. */
function request(f: ReturnType<typeof ids>, n: number, customer: string, provider: string): string {
  return (
    ` insert into public.requests (id, region, customer_id, client_key, service_id, zone_id, answers, questions_snapshot, pricing_snapshot,` +
    ` fixed_price, commission_amount, cash_due, currency, scheduled_start_at, scheduled_end_at)` +
    ` select '${f.request(n)}', 'TR', ${customer}, gen_random_uuid(), '${f.service}', '${f.zone}', '{}', '[]', '${snapshot(f)}',` +
    ` 300000, 0, 300000, 'TRY', now() + interval '3 days', now() + interval '3 days 2 hours';` +
    ` insert into public.request_addresses (request_id, region, customer_id, line) select '${f.request(n)}', 'TR', ${customer}, 'Moda Cad. No ${n}';` +
    ` insert into public.applications (id, region, request_id, provider_id, message) values` +
    ` ('${f.offer(n)}', 'TR', '${f.request(n)}', ${provider}, 'I can start at ten with my own tools, two people.');`
  );
}

/**
 * The catalog (with a formula, so Repeat can post again); R1, the customer's job, chosen, both fees settled, started
 * and done today; R7, an OPEN request of the customer with the provider's offer on it.
 */
function seedJob(locale: string, f: ReturnType<typeof ids>) {
  const customer = profileId(locale, 'ratingCustomer');
  const provider = profileId(locale, 'ratingProvider');
  sql(
    `do $s$ declare v_attempt uuid; v_fee uuid; v_amount bigint; begin` +
      ` perform set_config('pricing.publishing', 'on', true);` +
      ` insert into public.service_categories (id, region, name, display_order, active) values ('${f.category}', 'TR', '{"tr": "${f.names.category}"}', 980, true) on conflict (id) do nothing;` +
      ` insert into public.services (id, category_id, region, name, hours_min, hours_max, display_order, active) values ('${f.service}', '${f.category}', 'TR', '{"tr": "${f.names.service}"}', 2, 3, 1, true) on conflict (id) do nothing;` +
      ` insert into public.zones (id, region, name, multiplier, display_order, active) values ('${f.zone}', 'TR', '{"tr": "${f.names.zone}"}', 1.00, 980, true) on conflict (id) do nothing;` +
      ` insert into public.pricing_formulas (id, service_id, region, version, base_price, active) values ('${f.formula}', '${f.service}', 'TR', 1, 300000, true) on conflict (id) do nothing;` +
      ` perform set_config('pricing.publishing', 'off', true);` +
      request(f, 1, customer, provider) +
      ` perform set_config('request.jwt.claims', json_build_object('sub', ${customer}, 'role', 'authenticated')::text, true);` +
      ` perform public.choose_provider('${f.request(1)}', '${f.offer(1)}', 'draft-1');` +
      ` perform public.pay_commission('${f.request(1)}', 'tr', null, 'draft-1');` +
      ` perform set_config('request.jwt.claims', json_build_object('sub', ${provider}, 'role', 'authenticated')::text, true);` +
      ` v_attempt := (public.pay_provider_fee('${f.offer(1)}', 'tr', null, 'draft-1') ->> 'attempt_id')::uuid;` +
      ` select id, amount into v_fee, v_amount from public.fee_payments where request_id = '${f.request(1)}' and kind = 'provider_fee';` +
      ` perform public.apply_fee_paid(v_fee, v_attempt, 'e2e-ratings-${locale}-1', v_amount, 'TRY', 0);` +
      ` alter table public.requests disable trigger requests_guard;` +
      ` update public.requests set selected_at = now() - interval '5 hours', payment_deadline = now() - interval '4 hours',` +
      ` fee_deadline = now() - interval '3 hours', scheduled_start_at = now() - interval '1 hour', scheduled_end_at = now() + interval '1 hour'` +
      ` where id = '${f.request(1)}';` +
      ` alter table public.requests enable trigger requests_guard;` +
      ` perform public.start_job('${f.request(1)}'); perform public.finish_job('${f.request(1)}');` +
      request(f, 7, customer, provider) +
      ` end $s$;`,
  );
}

/**
 * The seeding rule (AC-13): five COMPLETED requests of a customer written by SQL, each with the provider's unlocked
 * pick, then one rating each, inserted as postgres: four of 5 and, the oldest, one of 1.
 */
function seedRatings(locale: string, f: ReturnType<typeof ids>) {
  const provider = profileId(locale, 'ratingProvider');
  const phone = `+905559170${({ ar: '1', tr: '2', en: '3' } as Record<string, string>)[locale] ?? '9'}00`;
  const done = (n: number, hoursAgo: number) =>
    request(f, n, `'${f.rater}'`, provider) +
    ` alter table public.applications disable trigger applications_guard;` +
    ` update public.applications set status = 'CONFIRMED', unlocked_at = now() - interval '${hoursAgo + 4} hours',` +
    ` provider_fee_amount = 0, provider_fee_kind = 'fixed' where id = '${f.offer(n)}';` +
    ` alter table public.applications enable trigger applications_guard;` +
    ` alter table public.requests disable trigger requests_guard;` +
    ` update public.requests set status = 'COMPLETED', selected_application_id = '${f.offer(n)}',` +
    ` selected_at = now() - interval '${hoursAgo + 9} hours', payment_deadline = now() - interval '${hoursAgo + 8} hours',` +
    ` fee_deadline = now() - interval '${hoursAgo + 7} hours', scheduled_start_at = now() - interval '${hoursAgo + 3} hours',` +
    ` scheduled_end_at = now() - interval '${hoursAgo + 1} hours', actual_started_at = now() - interval '${hoursAgo + 3} hours',` +
    ` actual_completed_at = now() - interval '${hoursAgo + 2} hours', closed_at = now() - interval '${hoursAgo + 1} hours', closed_by = 'customer'` +
    ` where id = '${f.request(n)}';` +
    ` alter table public.requests enable trigger requests_guard;` +
    ` insert into public.ratings (region, request_id, application_id, provider_id, customer_id, punctuality, quality, professionalism, value, created_at)` +
    ` select 'TR', '${f.request(n)}', '${f.offer(n)}', ${provider}, '${f.rater}', s, s, s, s, now() - interval '${hoursAgo} hours'` +
    ` from (select ${n === 6 ? 1 : 5} as s) x;`;
  sql(
    `do $s$ begin` +
      ` insert into auth.users (id, aud, role, phone, phone_confirmed_at)` +
      ` values ('${f.rater}', 'authenticated', 'authenticated', '${phone.slice(1)}', now()) on conflict (id) do nothing;` +
      ` insert into public.profiles (id, role, region, phone, full_name, locale)` +
      ` values ('${f.rater}', 'customer', 'TR', '${phone}', 'Puan Müşteri', 'tr') on conflict (id) do nothing;` +
      done(2, 2) +
      done(3, 3) +
      done(4, 4) +
      done(5, 5) +
      done(6, 30) +
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

async function pickFirst(page: Page, group: string) {
  const label = page.getByRole('group', { name: group, exact: true }).locator('label').first();
  await label.click();
  await expect(label.getByRole('radio')).toBeChecked();
}

test('a customer skips or gives a rating, the provider and admin read it, and a hide changes the score', async ({
  page,
  browser,
  telemetry,
}, testInfo) => {
  test.setTimeout(420_000);
  const locale = testInfo.project.name;
  const f = ids(locale);

  const provider = await newPage(browser);
  await signIn(provider, locale, testPhone(locale, 'ratingProvider'), `/${locale}/login?as=provider`);
  await onboard(provider, `Puan Usta ${locale}`);
  await expect(provider).toHaveURL(new RegExp(`/${locale}/provider/profile$`), { timeout: 20_000 });
  sql(
    `update public.providers set status = 'approved', approved_at = now() - interval '60 days', approved_name = 'Puan Kaya'` +
      ` where id = ${profileId(locale, 'ratingProvider')};`,
  );
  await signIn(page, locale, testPhone(locale, 'ratingCustomer'));
  await onboard(page, 'Puan Müşteri');
  await expect(page).toHaveURL(new RegExp(`/${locale}/requests/new$`), { timeout: 20_000 });
  seedJob(locale, f);

  // The customer confirms; the job is COMPLETED and "Your rating" shows, optional, with its note (AC-6).
  await page.goto(`/${locale}/requests/${f.request(1)}`);
  await page
    .getByRole('button', { name: m(locale, 'Jobs.confirm') })
    .first()
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: m(locale, 'Jobs.confirm') })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const section = page.locator('section[aria-labelledby="rating-title"]');
  await expect(section.getByRole('heading', { name: m(locale, 'Ratings.form.title') })).toBeVisible({
    timeout: 20_000,
  });
  await expect(section).toContainText(m(locale, 'Ratings.form.optional'));
  await expect(section).toContainText(m(locale, 'Ratings.form.note'));
  await expect(section.getByRole('button', { name: m(locale, 'Ratings.form.send') })).toBeDisabled();
  await axe(page);

  // Skip: nothing waits on a rating; the customer posts a new request from Repeat (AC-3).
  await page.getByRole('link', { name: m(locale, 'Requests.detail.repeat') }).click();
  await expect(page).toHaveURL(new RegExp(`/${locale}/requests/new\\?from=${f.request(1)}$`));
  await expect(page.getByText(m(locale, 'Requests.form.repeated'))).toBeVisible();
  const line = page.locator('#line');
  if ((await line.inputValue()) === '') await line.fill('Moda Cad. No 9');
  await pickFirst(page, m(locale, 'Requests.form.date'));
  await pickFirst(page, m(locale, 'Requests.form.hour'));
  await page.getByRole('button', { name: m(locale, 'Requests.form.toReview') }).click();
  await page.getByRole('button', { name: m(locale, 'Requests.review.publish') }).click();
  await expect(page).toHaveURL(new RegExp(`/${locale}/requests/[0-9a-f-]{36}\\?posted=1$`), {
    timeout: 20_000,
  });

  // Rate: four rows of stars, Send once all four are picked, then the scores read only (AC-6, AC-11).
  await page.goto(`/${locale}/requests/${f.request(1)}`);
  for (const d of ['punctuality', 'quality', 'professionalism', 'value']) {
    await section
      .getByRole('group', { name: m(locale, `Ratings.dimensions.${d}`), exact: true })
      .getByRole('radio', { name: m(locale, 'Ratings.star', { score: 5 }), exact: true })
      .check();
  }
  await section.getByRole('button', { name: m(locale, 'Ratings.form.send') }).click();
  await expect(section.getByRole('radio')).toHaveCount(0, { timeout: 20_000 });
  await expect(section).toContainText(m(locale, 'Ratings.form.ratedOn', { date: '@@' }).split('@@')[0] ?? '');
  await expect(section.getByRole('img', { name: m(locale, 'Ratings.star', { score: 5 }) })).toHaveCount(4);
  await expect.poll(() => telemetry.posthog.filter((e) => e.event === 'rating_submitted').length).toBe(1);
  expect(
    Object.keys(telemetry.posthog.find((e) => e.event === 'rating_submitted')?.properties ?? {}),
  ).toEqual(expect.not.arrayContaining(['request_id', 'score']));
  await axe(page);
  expect(
    sql(`select count(*)::int as n from public.ratings where request_id = '${f.request(1)}';`)[0],
  ).toEqual({ n: 1 });

  // The provider: New with the count, never a single rating (AC-7).
  await provider.goto(`/${locale}/provider/profile`);
  const card = provider.locator('section[aria-labelledby="my-rating-title"]');
  await expect(card).toContainText(m(locale, 'Ratings.mine.new', { count: 1 }));
  await axe(provider);

  // Five more ratings: the offer card and the provider card show a score, always with the count (AC-4, AC-5).
  seedRatings(locale, f);
  const six = m(locale, 'Ratings.count', { count: 6 });
  await page.goto(`/${locale}/requests/${f.request(7)}`);
  const offer = page.locator('li', { hasText: 'Puan K.' });
  await expect(offer).toContainText(six);
  await expect(offer.getByText(m(locale, 'Requests.offers.new'), { exact: true })).toHaveCount(0);
  await offer.getByText(m(locale, 'Ratings.see')).click();
  await expect(offer).toContainText(m(locale, 'Ratings.dimensions.punctuality'));
  await expect(offer).toContainText(m(locale, 'Ratings.disclosure'));
  await axe(page);
  const offerBefore = (await offer.locator('p', { hasText: six }).first().textContent()) ?? '';

  await provider.reload();
  await expect(card).toContainText(m(locale, 'Ratings.mine.from', { count: 6 }));
  await expect(card).toContainText(m(locale, 'Ratings.dimensions.value'));
  const scoreBefore = (await card.locator('.font-display.text-title').textContent()) ?? '';
  await axe(provider);

  // Admin hides the 1 with a reason and a note; it stays listed, marked hidden (AC-8).
  const admin = await newPage(browser);
  await signIn(admin, locale, testPhone(locale, 'ratingAdmin'));
  await onboard(admin, `Puan Admin ${locale}`);
  await expect(admin).toHaveURL(new RegExp(`/${locale}/requests/new$`), { timeout: 20_000 });
  sql(`select public.promote_to_admin('${testE164(locale, 'ratingAdmin')}')`);
  await admin.context().clearCookies();
  await signIn(admin, locale, testPhone(locale, 'ratingAdmin'));
  await expect(admin).toHaveURL(new RegExp(`/${locale}/admin$`), { timeout: 20_000 });
  const providerId = String(sql(`select ${profileId(locale, 'ratingProvider')}::text as id;`)[0]?.id);
  await admin.goto(`/${locale}/admin/providers/${providerId}`);
  const ratings = admin.locator('section[aria-labelledby="ratings-title"]');
  await expect(ratings).toContainText(m(locale, 'AdminRatings.total', { count: 6 }));
  const low = ratings.locator('li', { hasText: f.request(6) });
  await low.getByRole('button', { name: m(locale, 'AdminRatings.hide') }).click();
  const dialog = admin.getByRole('dialog');
  await expect(dialog).toContainText(m(locale, 'Ratings.dimensions.quality'));
  await dialog
    .locator('label')
    .filter({ hasText: m(locale, 'AdminRatings.reasons.fake') })
    .click();
  await dialog.getByRole('textbox').fill('A test account rated its own provider.');
  await axe(admin);
  await dialog.getByRole('button', { name: m(locale, 'AdminRatings.confirm') }).click();
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
  await expect(low).toContainText(m(locale, 'AdminRatings.hidden'));
  await expect(low).toContainText(m(locale, 'AdminRatings.reasons.fake'));
  await expect(ratings).toContainText(m(locale, 'AdminRatings.total', { count: 6 }));
  await axe(admin);

  // Both figures change at once: five visible ratings now, and a higher score without the 1 (AC-4).
  const five = m(locale, 'Ratings.count', { count: 5 });
  await page.reload();
  await expect(offer).toContainText(five);
  const offerAfter = (await offer.locator('p', { hasText: five }).first().textContent()) ?? '';
  // The figure itself, not only the count (slice review 2026-11-22): the first "d.d" on the line.
  const figure = (text: string) => Number((/\d[.,٫]\d/.exec(text)?.[0] ?? 'NaN').replace(/[,٫]/, '.'));
  expect(figure(offerAfter)).toBeGreaterThan(figure(offerBefore));
  await provider.reload();
  await expect(card).toContainText(m(locale, 'Ratings.mine.from', { count: 5 }));
  const scoreAfter = (await card.locator('.font-display.text-title').textContent()) ?? '';
  expect(Number(scoreAfter.replace(/[,٫]/, '.'))).toBeGreaterThan(Number(scoreBefore.replace(/[,٫]/, '.')));
});
