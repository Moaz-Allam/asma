import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';

import { expect, test } from './fixtures';
import { TEST_CODE, testE164, testPhone } from './numbers';

/**
 * Spec 0009 AC-24 at 390px with axe in every locale, on the real local database: an approved provider with no
 * setup sees the setup prompt, saves `p4`, sees the fixture request in the feed with no name, phone, address,
 * notes or typed answer anywhere on the page, is refused for an Arabic Indic phone in the message (kept in the
 * field), applies, sees "You applied" and the row in My applications. A rival sees "1 of 10 offers" and never
 * the first provider's message. The customer cancels and the application reads Cancelled. A customer is sent
 * away from the four provider pages.
 *
 * The fixture request is written as `postgres`, with a typed answer, notes and an address, so the test can
 * prove none of them reaches a provider. Each project has its own catalog, so the feeds never cross.
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
    const run = spawnSync('npx', ['supabase', 'db', 'query', '--local', '-o', 'json', '-f', file], {
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

/** One category, service and district per project: the projects share region TR and run in parallel. */
function seed(locale: string) {
  const d = { ar: '1', tr: '2', en: '3' }[locale] ?? '9';
  const id = (kind: string) => `00000000-0000-4000-8000-0005000${kind}00${d}`;
  const names = { service: `Akış hizmet ${locale}`, zone: `Akış semt ${locale}` };
  script(
    `insert into public.service_categories (id, region, name, display_order, active) values ('${id('c1')}', 'TR', '{"tr": "Akış ${locale}"}', 950, true) on conflict (id) do nothing;` +
      ` insert into public.services (id, category_id, region, name, hours_min, hours_max, display_order, active) values ('${id('51')}', '${id('c1')}', 'TR', '{"tr": "${names.service}"}', 2, 3, 1, true) on conflict (id) do nothing;` +
      ` insert into public.zones (id, region, name, multiplier, display_order, active) values ('${id('21')}', 'TR', '{"tr": "${names.zone}"}', 1.00, 950, true) on conflict (id) do nothing;`,
  );
  return { names, service: id('51'), zone: id('21'), request: id('e1') };
}

/** The fixture request, as create_request leaves it, with a typed answer, notes and an address to hide. */
function postFixture(locale: string, f: ReturnType<typeof seed>) {
  const customer = `(select id from public.profiles where phone = '${testE164(locale, 'feedCustomer')}')`;
  script(
    `insert into public.requests (id, region, customer_id, client_key, service_id, zone_id, answers, questions_snapshot, pricing_snapshot,` +
      ` fixed_price, commission_amount, cash_due, currency, scheduled_start_at, scheduled_end_at, notes)` +
      ` select '${f.request}', 'TR', ${customer}, gen_random_uuid(), '${f.service}', '${f.zone}',` +
      ` '{"e2e_rooms": 3, "e2e_details": "FIXTURE_TEXT_ANSWER"}',` +
      ` '[{"key": "e2e_rooms", "type": "number", "label": {"tr": "Oda"}, "options": null, "required": true},` +
      `   {"key": "e2e_details", "type": "textarea", "label": {"tr": "Ayrıntı"}, "options": null, "required": false}]',` +
      ` '{"service": {"id": "${f.service}", "name": {"tr": "${f.names.service}"}}, "rounding_minor": 100,` +
      `   "breakdown": {"addons": [], "zone": {"id": "${f.zone}", "name": {"tr": "${f.names.zone}"}}, "rounding_minor": 100}}',` +
      ` 300000, 30000, 270000, 'TRY', ((now() at time zone 'Europe/Istanbul')::date + 2 + time '10:00') at time zone 'Europe/Istanbul',` +
      ` ((now() at time zone 'Europe/Istanbul')::date + 2 + time '13:00') at time zone 'Europe/Istanbul', 'FIXTURE_NOTES'` +
      ` on conflict (id) do nothing;` +
      ` insert into public.request_addresses (request_id, region, customer_id, line)` +
      ` select '${f.request}', 'TR', ${customer}, 'FIXTURE_ADDRESS 5' on conflict (request_id) do nothing;`,
  );
}

function approve(locale: string, who: 'feedProvider' | 'feedRival') {
  sql(
    `update public.providers set status = 'approved', approved_at = now()` +
      ` where id = (select id from public.profiles where phone = '${testE164(locale, who)}');`,
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

async function tick(scope: Page | Locator, group: string, option: string) {
  const label = scope
    .getByRole('group', { name: group, exact: true })
    .locator('label')
    .filter({ hasText: option });
  await label.click();
  await expect(label.getByRole('checkbox')).toBeChecked();
}

async function newPage(browser: import('@playwright/test').Browser) {
  return (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
}

const HIDDEN = ['FIXTURE_TEXT_ANSWER', 'FIXTURE_NOTES', 'FIXTURE_ADDRESS', 'Akış müşteri'];

test('a provider sets up, sees the feed, applies; a rival sees only the count; a cancel reaches both', async ({
  page,
  browser,
  telemetry,
}, testInfo) => {
  test.setTimeout(300_000);
  const locale = testInfo.project.name;
  const f = seed(locale);

  // The customer exists first; the fixture request is theirs.
  const customer = await newPage(browser);
  await signIn(customer, locale, testPhone(locale, 'feedCustomer'));
  await onboard(customer, 'Akış müşteri');
  await expect(customer).toHaveURL(new RegExp(`/${locale}/requests/new$`), { timeout: 20_000 });
  postFixture(locale, f);

  // An approved provider with no setup sees the prompt (AC-4, AC-14).
  await signIn(page, locale, testPhone(locale, 'feedProvider'), `/${locale}/login?as=provider`);
  await onboard(page, `Akış usta ${locale}`);
  await expect(page).toHaveURL(new RegExp(`/${locale}/provider/profile$`), { timeout: 20_000 });
  approve(locale, 'feedProvider');
  await page.goto(`/${locale}/provider/feed`);
  await expect(
    page.getByRole('heading', { name: m(locale, 'ProviderFeed.feed.setupPrompt.title') }),
  ).toBeVisible();
  await page.goto(`/${locale}/provider`);
  await expect(
    page.getByRole('heading', { name: m(locale, 'ProviderFeed.feed.setupPrompt.title') }),
  ).toBeVisible();
  await axe(page);

  // p4 (AC-2, AC-3).
  await page.getByRole('link', { name: m(locale, 'ProviderFeed.feed.setupPrompt.action') }).click();
  await expect(page).toHaveURL(new RegExp(`/${locale}/provider/setup$`));
  await tick(page, `Akış ${locale}`, f.names.service);
  await tick(page, m(locale, 'ProviderFeed.setup.zones'), f.names.zone);
  for (const day of ['0', '1', '2', '3', '4', '5', '6']) {
    await tick(page, m(locale, 'ProviderFeed.setup.days'), m(locale, `ProviderFeed.days.${day}`));
  }
  await axe(page);
  await page.getByRole('button', { name: m(locale, 'ProviderFeed.setup.save') }).click();
  await expect(
    page.getByRole('status').filter({ hasText: m(locale, 'ProviderFeed.setup.saved') }),
  ).toBeVisible({
    timeout: 20_000,
  });
  await expect.poll(() => telemetry.posthog.filter((e) => e.event === 'provider_setup_saved').length).toBe(1);

  // The feed (AC-5 to AC-7): the fixture, with no personal data anywhere on the page.
  await page.goto(`/${locale}/provider/feed`);
  const card = page
    .getByRole('listitem')
    .filter({ hasText: f.names.service })
    .filter({ hasText: f.names.zone });
  await expect(card).toContainText(m(locale, 'ProviderFeed.feed.offers', { count: 0, cap: 10 }));
  await expect(card).toContainText(f.names.zone);
  for (const text of HIDDEN) await expect(page.locator('body')).not.toContainText(text);
  await axe(page);

  // p8 (AC-8, AC-9, AC-12).
  await card.getByRole('link', { name: m(locale, 'ProviderFeed.feed.details') }).click();
  await expect(page).toHaveURL(new RegExp(`/${locale}/provider/feed/${f.request}$`));
  await expect(page.getByText(m(locale, 'ProviderFeed.price.cash'))).toBeVisible();
  await expect(page.getByText(m(locale, 'ProviderFeed.detail.addressHidden'))).toBeVisible();
  await expect(page.getByText('Oda')).toBeVisible();
  for (const text of HIDDEN) await expect(page.locator('body')).not.toContainText(text);
  await axe(page);

  // A message with an Arabic Indic phone is refused and kept (AC-10, AC-11).
  const field = page.locator('#application-message');
  const dirty = 'أستطيع البدء يوم السبت، اتصل على ٠٥٥٥١٢٣٤٥٦٧ للتفاصيل';
  await field.fill(dirty);
  await page.getByRole('button', { name: m(locale, 'ProviderFeed.form.submit') }).click();
  const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'));
  await expect(dialog).toContainText(m(locale, 'ProviderFeed.form.confirmFee'));
  await dialog.getByRole('button', { name: m(locale, 'ProviderFeed.form.confirmSend') }).click();
  await expect(page.getByText(m(locale, 'ProviderFeed.errors.contact_info_in_message'))).toBeVisible({
    timeout: 20_000,
  });
  await expect(field).toHaveValue(dirty);

  // A clean message applies (AC-10, AC-11, AC-21).
  await field.fill('I can start at ten with two people and all the tools.');
  await page.getByRole('button', { name: m(locale, 'ProviderFeed.form.submit') }).click();
  await dialog.getByRole('button', { name: m(locale, 'ProviderFeed.form.confirmSend') }).click();
  await expect(page.getByText(m(locale, 'ProviderFeed.form.applied'))).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(() => telemetry.posthog.filter((e) => e.event === 'application_submitted').length)
    .toBe(1);
  const event = telemetry.posthog.find((e) => e.event === 'application_submitted');
  expect(JSON.stringify(event?.properties ?? {})).not.toContain('tools');
  await axe(page);

  // My applications (AC-13).
  await page.goto(`/${locale}/provider/applications`);
  const row = page.getByRole('link', { name: new RegExp(f.names.service) });
  await expect(row).toContainText(m(locale, 'ProviderFeed.status.APPLIED'));
  await axe(page);

  // A rival sees the count, never the message (AC-6, AC-18).
  const rival = await newPage(browser);
  await signIn(rival, locale, testPhone(locale, 'feedRival'), `/${locale}/login?as=provider`);
  await onboard(rival, `Akış rakip ${locale}`);
  await expect(rival).toHaveURL(new RegExp(`/${locale}/provider/profile$`), { timeout: 20_000 });
  approve(locale, 'feedRival');
  // The rival's setup through the same function, as that provider.
  sql(
    `do $s$ begin perform set_config('request.jwt.claims', json_build_object('sub',` +
      ` (select id from public.profiles where phone = '${testE164(locale, 'feedRival')}'), 'role', 'authenticated')::text, true);` +
      ` perform public.save_provider_setup(array['${f.service}']::uuid[], array['${f.zone}']::uuid[], '{0,1,2,3,4,5,6}', 0, 24);` +
      ` end $s$;`,
  );
  await rival.goto(`/${locale}/provider/feed`);
  await expect(
    rival.getByRole('listitem').filter({ hasText: f.names.service }).filter({ hasText: f.names.zone }),
  ).toContainText(m(locale, 'ProviderFeed.feed.offers', { count: 1, cap: 10 }));
  await rival.goto(`/${locale}/provider/feed/${f.request}`);
  await expect(rival.locator('body')).not.toContainText('two people and all the tools');
  await expect(rival.locator('body')).not.toContainText(`Akış usta ${locale}`);
  await rival.context().close();

  // The customer cancels; the application reads Cancelled (AC-16). The fixture's snapshot is the minimum the
  // provider reads need, not 04's whole page, so the cancel runs through `cancel_request` as that customer;
  // 04's own e2e covers the cancel button.
  script(
    `perform set_config('request.jwt.claims', json_build_object('sub',` +
      ` (select id from public.profiles where phone = '${testE164(locale, 'feedCustomer')}'), 'role', 'authenticated')::text, true);` +
      ` perform public.cancel_request('${f.request}', 'plans_changed');`,
  );
  // Since 10 a row that is no longer live sits in Done (spec 0011-10 AC-10).
  await page.goto(`/${locale}/provider/applications?tab=done`);
  await expect(page.getByRole('link', { name: new RegExp(f.names.service) })).toContainText(
    m(locale, 'ProviderFeed.status.CANCELLED'),
  );

  // A customer is sent away from the four provider pages (AC-15).
  for (const path of [
    '/provider/setup',
    '/provider/feed',
    `/provider/feed/${f.request}`,
    '/provider/applications',
  ]) {
    await customer.goto(`/${locale}${path}`);
    await expect(customer).not.toHaveURL(/\/provider/, { timeout: 20_000 });
  }
  await customer.context().close();
});
