import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';

import { expect, mapTilerCalls, test } from './fixtures';
import { onboard, signIn } from './auth';
import { testPhone } from './numbers';

/**
 * Spec 0011-20b AC-4, AC-6, AC-10, AC-11, AC-12, X-22 at 390px with axe, in every locale. A customer posts with the map:
 * the district gives il and ilçe, a search picks a place, the pin fills the parts from the reverse geocode, one part is
 * edited, and the request is posted with the pin; the request page shows the composed line and Open in Maps by the
 * coordinates. MapTiler is answered by `stubMapTiler` (e2e/fixtures.ts) with the answers recorded on 2026-11-23; the
 * page raises no CSP error. Posting with typed fields only is in post-request; the provider's address at onboarding in
 * provider-onboarding; both sides' cards and the agreement's addresses in service-agreement.
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

function sql(query: string): Record<string, unknown>[] {
  const file = join(tmpdir(), `asma-e2e-address-${process.pid}-${Date.now()}-${randomUUID()}.sql`);
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

/** One flat priced service and one district (İstanbul, Kadıköy) per project. */
function seed(locale: string) {
  const d = { ar: '1', tr: '2', en: '3' }[locale] ?? '9';
  const id = (kind: string) => `00000000-0000-4000-8000-0020b0${kind}000${d}`;
  const names = {
    category: `Adres ${locale}`,
    service: `Adres hizmet ${locale}`,
    zone: `Adres semt ${locale}`,
  };
  sql(
    `do $seed$ begin perform set_config('pricing.publishing', 'on', true);` +
      ` insert into public.service_categories (id, region, name, display_order, active) values ('${id('c1')}', 'TR', '{"tr": "${names.category}"}', 980, true) on conflict (id) do nothing;` +
      ` insert into public.services (id, category_id, region, name, hours_min, hours_max, display_order, active) values ('${id('51')}', '${id('c1')}', 'TR', '{"tr": "${names.service}"}', 2, 3, 1, true) on conflict (id) do nothing;` +
      ` insert into public.zones (id, region, name, multiplier, display_order, active, il, ilce) values ('${id('21')}', 'TR', '{"tr": "${names.zone}"}', 1.00, 980, true, 'İstanbul', 'Kadıköy') on conflict (id) do nothing;` +
      ` insert into public.pricing_formulas (id, service_id, region, version, base_price, active) values ('${id('f1')}', '${id('51')}', 'TR', 1, 150000, true) on conflict (id) do nothing;` +
      ` perform set_config('pricing.publishing', 'off', true); end $seed$;`,
  );
  return names;
}

async function axe(page: Page) {
  await page.evaluate(() => Promise.allSettled(document.getAnimations().map((a) => a.finished)));
  const scan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .exclude('.maplibregl-canvas-container')
    .analyze();
  expect(scan.violations).toEqual([]);
}

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

async function pickDistrict(page: Page, locale: string, zone: string) {
  const legend = m(locale, 'Requests.form.district');
  const select = page.locator('select#district');
  await expect(select.or(page.getByRole('group', { name: legend, exact: true }))).toBeVisible();
  if ((await select.count()) > 0) await select.selectOption({ label: zone });
  else await pick(page, legend, zone);
}

test('a customer posts with the map: search, a pin that fills the parts, one edit, Open in Maps', async ({
  page,
  telemetry,
}, testInfo) => {
  test.setTimeout(240_000);
  const locale = testInfo.project.name;
  const names = seed(locale);

  await signIn(page, locale, testPhone(locale, 'addressCustomer'));
  await onboard(page, `Adres ${locale}`);
  await expect(page).toHaveURL(new RegExp(`/${locale}/requests/new$`), { timeout: 20_000 });
  const card = page.getByRole('region', { name: m(locale, 'Requests.price.eyebrow') });
  await expect(card).toContainText(m(locale, 'Requests.price.needService'));
  const categories = page.getByRole('group', { name: m(locale, 'Requests.form.category'), exact: true });
  if ((await categories.count()) > 0) await pick(page, m(locale, 'Requests.form.category'), names.category);
  await page.locator('label').filter({ hasText: names.service }).click();
  await pickDistrict(page, locale, names.zone);

  // AC-4: il and ilçe from the district, read only; no map code loaded before the map opens (AC-10).
  await expect(page.getByText('İstanbul', { exact: true })).toBeVisible();
  await expect(page.getByText('Kadıköy', { exact: true })).toBeVisible();
  expect(mapTilerCalls.filter((path) => path.startsWith('/geocoding/'))).toEqual([]);

  // The map: a sheet on a phone, centred on the zone's ilçe, then a search.
  await page.getByRole('button', { name: m(locale, 'Address.map.open') }).click();
  const sheet = page.getByRole('dialog', { name: m(locale, 'Address.map.title') });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('searchbox', { name: m(locale, 'Address.map.search') }).fill('Kadıköy');
  const results = sheet.getByRole('list', { name: m(locale, 'Address.map.results') });
  await expect(results.getByRole('button')).toHaveCount(5, { timeout: 10_000 });
  await axe(page);
  await results.getByRole('button', { name: 'Kadıköy, Türkiye' }).click();
  // The pin settles: the reverse geocode fills the parts and the change is announced.
  await expect(sheet.getByText(m(locale, 'Address.map.filled'))).toBeAttached();
  await sheet.getByRole('button', { name: m(locale, 'Address.map.done') }).click();
  await expect(sheet).toBeHidden();

  await expect(page.locator('#address-mahalle')).toHaveValue('Caferağa Mahallesi');
  await expect(page.locator('#address-street')).toHaveValue('Neşe Sokağı');
  await expect(page.locator('#address-building_no')).toHaveValue('3');
  await expect(page.locator('#address-postal_code')).toHaveValue('34710');
  await expect(page.getByText(m(locale, 'Address.map.pinned'))).toBeVisible();
  // The geocoder's ilçe is the zone's, so no mismatch note.
  await expect(
    page.getByText(m(locale, 'Address.map.mismatch', { found: 'Kadıköy', zone: 'Kadıköy' })),
  ).toHaveCount(0);
  // Every field stays editable after the pin.
  await page.locator('#address-building_no').fill('3A');
  await page.locator('#address-directions').fill('Kapıda mavi zil');

  await pick(page, m(locale, 'Requests.form.date'), 'first');
  await pick(page, m(locale, 'Requests.form.hour'), 'first');
  await axe(page);
  await page.getByRole('button', { name: m(locale, 'Requests.form.toReview') }).click();
  await expect(
    page.getByText('Caferağa Mahallesi, Neşe Sokağı, No: 3A, 34710 Kadıköy/İstanbul'),
  ).toBeVisible();
  await page.getByRole('button', { name: m(locale, 'Requests.review.publish') }).click();
  await expect(page).toHaveURL(new RegExp(`/${locale}/requests/[0-9a-f-]{36}\\?posted=1$`), {
    timeout: 20_000,
  });
  const id = /requests\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? '';

  // AC-2: the parts, the pin and il and ilçe from the zone, stored by Postgres.
  const row = sql(
    `select line, il, ilce, building_no, directions, lat::text as lat, lng::text as lng from public.request_addresses where request_id = '${id}';`,
  )[0];
  expect(row).toMatchObject({
    line: 'Caferağa Mahallesi, Neşe Sokağı, No: 3A, 34710 Kadıköy/İstanbul',
    il: 'İstanbul',
    ilce: 'Kadıköy',
    building_no: '3A',
    directions: 'Kapıda mavi zil',
  });
  expect(Number(row?.lat)).toBeCloseTo(40.991296, 5);
  expect(Number(row?.lng)).toBeCloseTo(29.024563, 5);

  // AC-6: the customer sees their own address, directions and pin.
  await expect(page.getByText('Kapıda mavi zil')).toBeVisible();
  await expect(page.getByRole('link', { name: m(locale, 'Address.card.openInMaps') })).toHaveAttribute(
    'href',
    `https://www.google.com/maps/search/?api=1&query=${row?.lat},${row?.lng}`.replace(
      /(\.\d*?)0+(?=,|$)/g,
      '$1',
    ),
  );
  await axe(page);

  // X-22: MapTiler only through the stub, and no CSP violation on the way.
  expect(await telemetry.cspViolations()).toEqual([]);
});
