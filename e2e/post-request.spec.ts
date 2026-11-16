import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';

import { formatMoney } from '../lib/format/money';
import type { Locale } from '../lib/i18n/direction';
import { expect, test } from './fixtures';
import { TEST_CODE, testPhone } from './numbers';

/**
 * Spec 0008 AC-26 at 390px with axe in every locale, on the real local database with a fixture catalog
 * seeded as `postgres`: a customer opens `/requests/new`, answers, sees the fixture price and split, picks a
 * district, a day and an hour, reviews, publishes, sees the request in the list and on its page, repeats it
 * and sees the answers prefilled, then cancels the first one. A second journey keeps a provider out of all
 * three pages and shows another customer's request id as 404.
 *
 * Fixture figures only: base 1200, rooms × 400, pets + 200, addon 400, zone × 1.00. Rooms 3 with pets and
 * the addon: 120000 + 3 × 40000 + 20000 + 40000 = 300000; at the seeded 10% the split is 30000 and 270000.
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

/** One fixture catalog per project, with its own ids and names, because the projects share region TR. */
function seedCatalog(locale: string): { category: string; service: string; zone: string; addon: string } {
  const d = { ar: '1', tr: '2', en: '3' }[locale] ?? '9';
  const id = (kind: string) => `00000000-0000-4000-8000-0004000${kind}00${d}`;
  const names = {
    category: `Talep kategori ${locale}`,
    service: `Talep hizmet ${locale}`,
    zone: `Talep semt ${locale}`,
    addon: `Talep cam ${locale}`,
  };
  sql(
    `do $seed$ begin perform set_config('pricing.publishing', 'on', true);` +
      ` insert into public.service_categories (id, region, name, display_order, active) values ('${id('c1')}', 'TR', '{"tr": "${names.category}"}', 900, true) on conflict (id) do nothing;` +
      ` insert into public.services (id, category_id, region, name, hours_min, hours_max, display_order, active) values ('${id('51')}', '${id('c1')}', 'TR', '{"tr": "${names.service}"}', 3, 5, 1, true) on conflict (id) do nothing;` +
      ` insert into public.zones (id, region, name, multiplier, display_order, active) values ('${id('21')}', 'TR', '{"tr": "${names.zone}"}', 1.00, 900, true) on conflict (id) do nothing;` +
      ` insert into public.addons (id, service_id, region, name, price, display_order, active) values ('${id('a1')}', '${id('51')}', 'TR', '{"tr": "${names.addon}"}', 40000, 1, true) on conflict (id) do nothing;` +
      ` insert into public.questions (category_id, region, key, label, type, required, affects_pricing, validation, display_order, active) values` +
      ` ('${id('c1')}', 'TR', 'e2e_rooms', '{"tr": "Oda"}', 'number', true, true, '{"min": 1, "max": 4, "step": 1}', 1, true),` +
      ` ('${id('c1')}', 'TR', 'e2e_pets', '{"tr": "Evcil hayvan"}', 'boolean', true, true, null, 2, true) on conflict (category_id, key) do nothing;` +
      ` insert into public.pricing_formulas (id, service_id, region, version, base_price, active) values ('${id('f1')}', '${id('51')}', 'TR', 1, 120000, true) on conflict (id) do nothing;` +
      ` insert into public.pricing_modifiers (formula_id, region, apply_order, question_key, match_type, match_value, effect_type, amount, factor) values` +
      ` ('${id('f1')}', 'TR', 1, 'e2e_rooms', 'always', null, 'PER_UNIT', 40000, null),` +
      ` ('${id('f1')}', 'TR', 2, 'e2e_pets', 'is_true', null, 'FIXED', 20000, null) on conflict (formula_id, apply_order) do nothing;` +
      ` perform set_config('pricing.publishing', 'off', true); end $seed$;`,
  );
  return names;
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

/** A radio chip: the input is visually hidden, so the pill a person taps is its label. */
async function pick(scope: Page | Locator, group: string, option: string | 'first') {
  const fieldset = scope.getByRole('group', { name: group, exact: true });
  const exact = (text: string) => new RegExp(`^\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);
  const label =
    option === 'first'
      ? fieldset.locator('label').first()
      : fieldset.locator('label').filter({ hasText: exact(option) });
  await label.click();
  await expect(label.getByRole('radio')).toBeChecked();
}

const money = (amount: number, locale: string) => formatMoney(amount, 'TRY', locale as Locale);

test('a customer posts a request, sees it, repeats it and cancels it', async ({
  page,
  browser,
  telemetry,
}, testInfo) => {
  test.setTimeout(240_000);
  const locale = testInfo.project.name;
  const names = seedCatalog(locale);

  await signIn(page, locale, testPhone(locale, 'requestCustomer'));
  await onboard(page, `Talep ${locale}`);
  await expect(page).toHaveURL(new RegExp(`/${locale}/requests/new$`), { timeout: 20_000 });

  // The form, step one (AC-6, AC-19): the card says what is missing until the inputs are set.
  const card = page.getByRole('region', { name: m(locale, 'Requests.price.eyebrow') });
  // Category chips show only when more than one category is bookable; the projects seed in parallel.
  const categories = page.getByRole('group', { name: m(locale, 'Requests.form.category'), exact: true });
  if ((await categories.count()) > 0) await pick(page, m(locale, 'Requests.form.category'), names.category);
  await expect(card).toContainText(m(locale, 'Requests.price.needService'));
  await page.locator('label').filter({ hasText: names.service }).click();
  await expect(card).toContainText(m(locale, 'Requests.price.needAnswers'));
  await pick(page, 'Oda', '3');
  await pick(page, 'Evcil hayvan', m(locale, 'Requests.answers.yes'));
  await expect(card).toContainText(m(locale, 'Requests.price.needDistrict'));
  await page.locator('label').filter({ hasText: names.addon }).click();
  await pick(page, m(locale, 'Requests.form.district'), names.zone);

  // The server's figures and the split (AC-20).
  await expect(card).toContainText(money(300000, locale), { timeout: 20_000 });
  await expect(card).toContainText(money(30000, locale));
  await expect(card).toContainText(money(270000, locale));
  await expect(card).toContainText(m(locale, 'Requests.price.online'));
  await expect(card).toContainText(m(locale, 'Requests.price.cash'));

  await page.locator('#line').fill('Moda Cad. No 5, Daire 3');
  await pick(page, m(locale, 'Requests.form.date'), 'first');
  await pick(page, m(locale, 'Requests.form.hour'), 'first');
  await page.locator('#notes').fill('Zil çalışmıyor, kapıyı çalın');
  await axe(page);

  // Step two, then publish (AC-19, AC-22).
  await page.getByRole('button', { name: m(locale, 'Requests.form.toReview') }).click();
  await expect(page.getByRole('heading', { name: m(locale, 'Requests.review.title') })).toBeVisible();
  await expect(page.getByText('Moda Cad. No 5, Daire 3')).toBeVisible();
  await axe(page);
  await page.getByRole('button', { name: m(locale, 'Requests.review.publish') }).click();
  await expect(page).toHaveURL(new RegExp(`/${locale}/requests/[0-9a-f-]{36}\\?posted=1$`), {
    timeout: 20_000,
  });
  await expect(
    page.getByRole('status').filter({ hasText: m(locale, 'Requests.detail.posted') }),
  ).toBeVisible();
  const firstId = /requests\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? '';
  await expect(page.getByText(m(locale, 'Requests.status.OPEN'), { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: m(locale, 'Requests.price.eyebrow') })).toContainText(
    money(300000, locale),
  );
  await axe(page);

  // AC-25: one event, with whether it was a repeat and nothing else.
  await expect.poll(() => telemetry.posthog.filter((e) => e.event === 'request_posted').length).toBe(1);
  const event = telemetry.posthog.find((e) => e.event === 'request_posted');
  expect(event?.properties.repeated).toBe(false);
  expect(JSON.stringify(event?.properties)).not.toContain(firstId);

  // The list (AC-13).
  await page.goto(`/${locale}/requests`);
  await expect(page.getByRole('link', { name: new RegExp(names.service) }).first()).toBeVisible();
  await axe(page);

  // Repeat (AC-16): everything but the date prefilled, and a fresh price.
  // A live OPEN request offers no Repeat button (AC-14), so the form opens from its address.
  await page.goto(`/${locale}/requests/${firstId}`);
  await expect(page.getByRole('link', { name: m(locale, 'Requests.detail.repeat') })).toHaveCount(0);
  await page.goto(`/${locale}/requests/new?from=${firstId}`);
  await expect(page).toHaveURL(new RegExp(`/${locale}/requests/new\\?from=${firstId}$`));
  await expect(page.getByText(m(locale, 'Requests.form.repeated'))).toBeVisible();
  await expect(
    page.getByRole('group', { name: 'Oda', exact: true }).getByRole('radio', { name: '3', exact: true }),
  ).toBeChecked();
  await expect(page.locator('#line')).toHaveValue('Moda Cad. No 5, Daire 3');
  await expect(
    page
      .getByRole('group', { name: m(locale, 'Requests.form.date'), exact: true })
      .getByRole('radio', { checked: true }),
  ).toHaveCount(0);
  await expect(page.getByRole('region', { name: m(locale, 'Requests.price.eyebrow') })).toContainText(
    money(300000, locale),
    {
      timeout: 20_000,
    },
  );

  // Cancel the first one (AC-15).
  await page.goto(`/${locale}/requests/${firstId}`);
  await page.getByRole('button', { name: m(locale, 'Requests.detail.cancel') }).click();
  const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'));
  await expect(dialog).toContainText(m(locale, 'Requests.cancel.body'));
  await pick(dialog, m(locale, 'Requests.cancel.reason'), m(locale, 'Requests.cancel.reasons.plans_changed'));
  await dialog.getByRole('button', { name: m(locale, 'Requests.cancel.confirm') }).click();
  await expect(page.getByText(m(locale, 'Requests.status.CANCELLED'), { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole('link', { name: m(locale, 'Requests.detail.repeat') })).toBeVisible();
  await page.goto(`/${locale}/requests?tab=closed`);
  await expect(page.getByRole('link', { name: new RegExp(names.service) }).first()).toBeVisible();

  // The second journey (AC-14, AC-23): another customer gets a 404; a provider is sent home from all three pages.
  const other = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await signIn(other, locale, testPhone(locale, 'requestOther'));
  await onboard(other, `Başka ${locale}`);
  await expect(other).toHaveURL(new RegExp(`/${locale}/requests/new$`), { timeout: 20_000 });
  expect((await other.goto(`/${locale}/requests/${firstId}`))?.status()).toBe(404);
  expect((await other.goto(`/${locale}/requests/not-a-uuid`))?.status()).toBe(404);
  await other.context().close();

  const provider = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await signIn(provider, locale, testPhone(locale, 'requestProvider'), `/${locale}/login?as=provider`);
  await onboard(provider, `Usta ${locale}`);
  await expect(provider).toHaveURL(new RegExp(`/${locale}/provider/profile$`), { timeout: 20_000 });
  for (const path of ['/requests', '/requests/new', `/requests/${firstId}`]) {
    await provider.goto(`/${locale}${path}`);
    await expect(provider).toHaveURL(new RegExp(`/${locale}/provider$`), { timeout: 20_000 });
  }
  await provider.context().close();
});
