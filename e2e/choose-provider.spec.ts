import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import type { Browser, Page } from '@playwright/test';

import { formatMoney } from '../lib/format/money';
import type { Locale } from '../lib/i18n/direction';
import { expect, test } from './fixtures';
import { TEST_CODE, testE164, testPhone } from './numbers';

/**
 * Spec 0010 AC-20 at 390px with axe in every locale, on the real local database: a customer sees two offers on
 * their request with no full name or phone on the page, chooses one, and sees the next step (the commission,
 * the cash due, the deadline) and the timeline. The chosen provider reads "Chosen" with the deadline; the
 * other reads "Not chosen". A provider is sent away from the customer's request page.
 *
 * The request is written as `postgres` in the shape `create_request` leaves (its own e2e covers posting), and
 * the offers as `apply_to_request` leaves them. Each project has its own catalog, so nothing crosses.
 * Fixture figures only: 300000 with a 30000 commission and 270000 in cash.
 */

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

function sql(query: string): string {
  const file = join(tmpdir(), `asma-e2e-${process.pid}-${Date.now()}.sql`);
  writeFileSync(file, query);
  let last = '';
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const run = spawnSync('npx', ['supabase', 'db', 'query', '--local', '-f', file], {
      encoding: 'utf8',
      shell: true,
    });
    if (run.status === 0) return run.stdout;
    last = `${run.stdout}\n${run.stderr}`;
  }
  throw new Error(`db query failed: ${last}`);
}

/** Several statements in one call: the CLI runs one command per query, so they go in a block. */
function script(statements: string): string {
  return sql(`do $s$ begin ${statements} end $s$;`);
}

function ids(locale: string) {
  const d = { ar: '1', tr: '2', en: '3' }[locale] ?? '9';
  const id = (kind: string) => `00000000-0000-4000-8000-0006000${kind}00${d}`;
  return {
    category: id('c1'),
    service: id('51'),
    zone: id('21'),
    request: id('e1'),
    offerA: id('f1'),
    offerB: id('f2'),
    names: { service: `Seçim hizmet ${locale}`, zone: `Seçim semt ${locale}`, category: `Seçim ${locale}` },
  };
}

function seed(locale: string) {
  const f = ids(locale);
  script(
    `insert into public.service_categories (id, region, name, display_order, active) values ('${f.category}', 'TR', '{"tr": "${f.names.category}"}', 960, true) on conflict (id) do nothing;` +
      ` insert into public.services (id, category_id, region, name, hours_min, hours_max, display_order, active) values ('${f.service}', '${f.category}', 'TR', '{"tr": "${f.names.service}"}', 2, 3, 1, true) on conflict (id) do nothing;` +
      ` insert into public.zones (id, region, name, multiplier, display_order, active) values ('${f.zone}', 'TR', '{"tr": "${f.names.zone}"}', 1.00, 960, true) on conflict (id) do nothing;`,
  );
  return f;
}

const profileId = (locale: string, who: 'chooseCustomer' | 'chooseProvider' | 'chooseRival') =>
  `(select id from public.profiles where phone = '${testE164(locale, who)}')`;

/** The request as create_request leaves it, then two offers as apply_to_request leaves them. */
function postWithOffers(locale: string, f: ReturnType<typeof ids>) {
  const snapshot = JSON.stringify({
    price: 300000,
    currency: 'TRY',
    commission_percent: '10',
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
  script(
    `insert into public.requests (id, region, customer_id, client_key, service_id, zone_id, answers, questions_snapshot, pricing_snapshot,` +
      ` fixed_price, commission_amount, cash_due, currency, scheduled_start_at, scheduled_end_at)` +
      ` select '${f.request}', 'TR', ${profileId(locale, 'chooseCustomer')}, gen_random_uuid(), '${f.service}', '${f.zone}', '{}', '[]',` +
      ` '${snapshot}', 300000, 30000, 270000, 'TRY',` +
      ` ((now() at time zone 'Europe/Istanbul')::date + 3 + time '10:00') at time zone 'Europe/Istanbul',` +
      ` ((now() at time zone 'Europe/Istanbul')::date + 3 + time '13:00') at time zone 'Europe/Istanbul'` +
      ` on conflict (id) do nothing;` +
      ` insert into public.request_addresses (request_id, region, customer_id, line)` +
      ` select '${f.request}', 'TR', ${profileId(locale, 'chooseCustomer')}, 'Moda Cad. No 5' on conflict (request_id) do nothing;` +
      ` insert into public.applications (id, region, request_id, provider_id, message, created_at) values` +
      ` ('${f.offerA}', 'TR', '${f.request}', ${profileId(locale, 'chooseProvider')}, 'I can start at ten with my own tools, two people.', now() - interval '10 minutes'),` +
      ` ('${f.offerB}', 'TR', '${f.request}', ${profileId(locale, 'chooseRival')}, 'Free that day, I live close to your district.', now() - interval '5 minutes')` +
      ` on conflict (id) do nothing;`,
  );
}

function approve(locale: string, who: 'chooseProvider' | 'chooseRival', name: string) {
  sql(
    `update public.providers set status = 'approved', approved_at = now(), approved_name = '${name}'` +
      ` where id = ${profileId(locale, who)};`,
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
  return (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
}

async function provider(
  browser: Browser,
  locale: string,
  who: 'chooseProvider' | 'chooseRival',
  name: string,
) {
  const page = await newPage(browser);
  await signIn(page, locale, testPhone(locale, who), `/${locale}/login?as=provider`);
  await onboard(page, name);
  await expect(page).toHaveURL(new RegExp(`/${locale}/provider/profile$`), { timeout: 20_000 });
  return page;
}

const money = (amount: number, locale: string) => formatMoney(amount, 'TRY', locale as Locale);

test('a customer reads two offers and chooses one; each provider sees the outcome', async ({
  page,
  browser,
  telemetry,
}, testInfo) => {
  test.setTimeout(300_000);
  const locale = testInfo.project.name;
  const f = seed(locale);

  const chosen = await provider(browser, locale, 'chooseProvider', `Seçim Usta ${locale}`);
  const rival = await provider(browser, locale, 'chooseRival', `Rakip Usta ${locale}`);
  approve(locale, 'chooseProvider', 'Seçim Kaya');
  approve(locale, 'chooseRival', 'Rakip Demir');

  await signIn(page, locale, testPhone(locale, 'chooseCustomer'));
  await onboard(page, 'Seçim müşteri');
  await expect(page).toHaveURL(new RegExp(`/${locale}/requests/new$`), { timeout: 20_000 });
  postWithOffers(locale, f);

  // The offers (AC-1 to AC-3): name and initial, chips, messages; no full name or phone.
  await page.goto(`/${locale}/requests/${f.request}`);
  await expect(page.locator('#offers-title')).toBeVisible();
  await expect(page.locator('section[aria-labelledby="offers-title"] > ul > li')).toHaveCount(2);
  await expect(page.getByText('Seçim K.', { exact: true })).toBeVisible();
  await expect(page.getByText('Rakip D.', { exact: true })).toBeVisible();
  await expect(page.getByText('I can start at ten with my own tools, two people.')).toBeVisible();
  for (const hidden of ['Usta', 'Kaya', 'Demir', '+90', testPhone(locale, 'chooseProvider')]) {
    await expect(page.locator('main')).not.toContainText(hidden);
  }
  await axe(page);

  // Choose (AC-6, AC-7): the dialog restates the deal.
  await page.getByRole('button', { name: m(locale, 'Requests.offers.choose', { name: 'Seçim' }) }).click();
  const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'));
  await expect(dialog).toContainText(money(30000, locale));
  await expect(dialog).toContainText(money(270000, locale));
  await axe(page);
  await dialog.getByRole('button', { name: m(locale, 'Requests.offers.confirm') }).click();

  // After the choose (AC-9, AC-10): the chosen card, the next step, the timeline.
  const next = page.getByRole('region', { name: m(locale, 'Requests.next.title') });
  await expect(next).toBeVisible({ timeout: 20_000 });
  await expect(next).toContainText(money(30000, locale));
  // Spec 0011-09 AC-10: the pay button stands where 06's "Payment opens here soon" stood.
  await expect(
    next.getByRole('button', { name: m(locale, 'Requests.next.pay', { amount: money(30000, locale) }) }),
  ).toBeVisible();
  await expect(page.getByRole('region', { name: m(locale, 'Requests.timeline.title') })).toContainText(
    m(locale, 'Requests.timeline.chosen'),
  );
  await expect(page.getByText('Rakip D.', { exact: true })).toHaveCount(0);
  await expect.poll(() => telemetry.posthog.filter((e) => e.event === 'provider_chosen').length).toBe(1);
  expect(
    JSON.stringify(telemetry.posthog.find((e) => e.event === 'provider_chosen')?.properties ?? {}),
  ).not.toContain(f.request);
  await axe(page);

  // The providers (AC-12).
  await chosen.goto(`/${locale}/provider/applications`);
  await expect(chosen.getByRole('link', { name: new RegExp(f.names.service) })).toContainText(
    m(locale, 'ProviderFeed.status.SELECTED'),
  );
  await expect(chosen.getByRole('link', { name: new RegExp(f.names.service) })).toContainText(
    m(locale, 'ProviderFeed.chosen.line', { date: 'DATE' }).split('DATE')[0]?.trim() ?? '',
  );
  await axe(chosen);
  await rival.goto(`/${locale}/provider/applications`);
  await expect(rival.getByRole('link', { name: new RegExp(f.names.service) })).toContainText(
    m(locale, 'ProviderFeed.chosen.notChosen'),
  );

  // A provider is sent away from the customer's request page (AC-15).
  await chosen.goto(`/${locale}/requests/${f.request}`);
  await expect(chosen).not.toHaveURL(new RegExp(`/requests/${f.request}`), { timeout: 20_000 });

  await chosen.context().close();
  await rival.context().close();
});
