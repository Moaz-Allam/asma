import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import type { Browser, Page } from '@playwright/test';

import { formatMoney } from '../lib/format/money';
import { expect, test } from './fixtures';
import { onboard, signIn } from './auth';
import { testE164, testPhone, type NUMBER } from './numbers';

/**
 * Spec 0007 AC-25 at 390px in every locale, on the real local database: admin follows the links on
 * `/admin`, adds a category, a number question, a select question, a service, an addon and a zone,
 * publishes a formula, sees the expected figure in the test panel, changes a modifier, sees version 2, and
 * is refused turning off a question in use. A second journey keeps a customer and a provider out of both
 * pages. Each project has its own admin and its own names, because the projects share one region and run
 * in parallel. No test counts a whole list.
 *
 * Fixture figures only: base 1200, rooms × 400, villa × 1.30, addon 400, zone × 1.15, so rooms 3 and villa
 * give (120000 + 120000) × 1.30 + 40000 = 352000, × 1.15 = 404800 (4048.00 TRY) before rounding.
 */

const CATALOGUES: Record<string, unknown> = Object.fromEntries(
  ['ar', 'tr', 'en'].map((l) => [
    l,
    JSON.parse(readFileSync(join(process.cwd(), 'messages', `${l}.json`), 'utf8')),
  ]),
);

/** A catalogue string, with `{name}` placeholders filled. */
function m(locale: string, path: string, vars: Record<string, string> = {}): string {
  let node: unknown = CATALOGUES[locale];
  for (const part of path.split('.')) node = (node as Record<string, unknown>)[part];
  if (typeof node !== 'string') throw new Error(`no message ${path}`);
  return node.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? `{${key}}`);
}

function sql(query: string): string {
  let last = '';
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const run = spawnSync(`npx supabase db query --local "${query.replace(/"/g, '\\"')}"`, {
      encoding: 'utf8',
      shell: true,
    });
    if (run.status === 0) return run.stdout;
    last = run.stderr;
  }
  throw new Error(`db query failed: ${last}`);
}

async function axe(page: Page) {
  await page.evaluate(() =>
    Promise.allSettled(document.getAnimations().map((animation) => animation.finished)),
  );
  const scan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(scan.violations).toEqual([]);
}

/** AC-23: no horizontal overflow at 360, 390, 430 and 1280 px, then back to the phone width. */
async function noOverflow(page: Page) {
  for (const width of [360, 390, 430, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `overflow at ${width}px`).toBeLessThanOrEqual(0);
  }
  await page.setViewportSize({ width: 390, height: 844 });
}

/**
 * ui-rules: every touch target is at least 44px. A switch is 22px tall, so it must sit inside a label of
 * 44px or more, which is what a tap actually hits.
 */
async function switchTargets(page: Page) {
  const small = await page.evaluate(() =>
    [...document.querySelectorAll('[role="switch"]')]
      .map((el) => {
        const target = el.closest('label') ?? el;
        const box = target.getBoundingClientRect();
        return { name: el.getAttribute('aria-label') ?? '', width: box.width, height: box.height };
      })
      .filter((t) => t.width > 0 && (t.width < 44 || t.height < 44)),
  );
  expect(small).toEqual([]);
}

async function newAdmin(browser: Browser, locale: string, test: keyof typeof NUMBER): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await signIn(page, locale, testPhone(locale, test));
  await expect(page).toHaveURL(new RegExp(`/${locale}/onboarding$`), { timeout: 20_000 });
  await onboard(page, `Admin ${locale}`);
  await expect(page).toHaveURL(new RegExp(`/${locale}/requests/new$`), { timeout: 20_000 });
  sql(`select public.promote_to_admin('${testE164(locale, test)}')`);
  await context.clearCookies();
  await signIn(page, locale, testPhone(locale, test));
  await expect(page).toHaveURL(new RegExp(`/${locale}/admin$`), { timeout: 20_000 });
  return page;
}

/** Fill the sheet's default locale field (TR is live, so `tr`) and save. */
async function saveSheet(page: Page, locale: string) {
  await page.getByRole('button', { name: m(locale, 'AdminCatalog.save'), exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 20_000 });
}

async function turnOn(page: Page, locale: string, name: string) {
  const toggle = page.getByRole('switch', { name: m(locale, 'AdminCatalog.turnOn', { name }) }).first();
  await toggle.click();
  await expect(
    page.getByRole('switch', { name: m(locale, 'AdminCatalog.turnOff', { name }) }).first(),
  ).toBeVisible({
    timeout: 20_000,
  });
}

async function openTab(page: Page, locale: string, tab: string) {
  await page.getByRole('link', { name: m(locale, `AdminCatalog.tab.${tab}`), exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`tab=${tab}`));
}

test('admin builds a catalog, publishes a formula and is held to it', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const locale = testInfo.project.name;
  const category = `Kategori ${locale}`;
  const service = `Hizmet ${locale}`;
  const zone = `Merkez ${locale}`;
  const page = await newAdmin(browser, locale, 'catalogAdmin');

  // AC-16: below lg the bottom bar keeps three tabs, and /admin links to the catalog.
  await page.getByRole('link', { name: m(locale, 'Nav.pricing'), exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/${locale}/admin/pricing`));
  await page.goto(`/${locale}/admin`);
  await page.getByRole('link', { name: m(locale, 'Nav.catalog'), exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/${locale}/admin/catalog`));

  // A category, turned on.
  await page.getByRole('button', { name: m(locale, 'AdminCatalog.newCategory') }).click();
  await page.locator('#category-name-tr').fill(category);
  await saveSheet(page, locale);
  await page.getByRole('link', { name: new RegExp(category) }).click();
  await expect(page.getByRole('heading', { name: category })).toBeVisible();
  await turnOn(page, locale, category);

  // A service, turned on.
  await openTab(page, locale, 'services');
  await page.getByRole('button', { name: m(locale, 'AdminCatalog.newService') }).click();
  await page.locator('#service-name-tr').fill(service);
  await saveSheet(page, locale);
  await turnOn(page, locale, service);

  // A number question and a select question, both priced and required, turned on.
  await openTab(page, locale, 'questions');
  await page.getByRole('button', { name: m(locale, 'AdminCatalog.newQuestion'), exact: true }).click();
  await page.locator('#question-key').fill('rooms');
  await page.locator('#question-label-tr').fill('Oda sayısı');
  await page.locator('#question-min').fill('1');
  await page.getByRole('switch', { name: m(locale, 'AdminCatalog.fieldAffectsPrice') }).click();
  await saveSheet(page, locale);
  await turnOn(page, locale, 'Oda sayısı');

  await page.getByRole('button', { name: m(locale, 'AdminCatalog.newQuestion'), exact: true }).click();
  await page.locator('#question-key').fill('kind');
  await page.locator('#question-type').selectOption('single_select');
  await page.locator('#question-label-tr').fill('Ev tipi');
  await page.getByRole('switch', { name: m(locale, 'AdminCatalog.fieldAffectsPrice') }).click();
  await page.getByRole('button', { name: m(locale, 'AdminCatalog.addOption') }).click();
  await page.locator('#option-0-value').fill('villa');
  await page.locator('#option-0-label-tr').fill('Villa');
  await page.getByRole('button', { name: m(locale, 'AdminCatalog.addOption') }).click();
  await page.locator('#option-1-value').fill('flat');
  await page.locator('#option-1-label-tr').fill('Daire');
  await saveSheet(page, locale);
  await turnOn(page, locale, 'Ev tipi');
  await axe(page);
  await noOverflow(page);
  await switchTargets(page);

  // An addon and a zone.
  await openTab(page, locale, 'addons');
  await page.getByRole('button', { name: m(locale, 'AdminCatalog.newAddon') }).click();
  await page.locator('#addon-name-tr').fill('Cam');
  await page.locator('#addon-price').fill('400');
  await saveSheet(page, locale);
  await expect(page.getByText('Cam', { exact: true })).toBeVisible();

  await openTab(page, locale, 'zones');
  await page.getByRole('button', { name: m(locale, 'AdminCatalog.newZone') }).click();
  await page.locator('#zone-name-tr').fill(zone);
  await page.locator('#zone-multiplier').fill('1,15');
  await page.locator('#zone-il').fill('İstanbul');
  await page.locator('#zone-ilce').fill('Kadıköy');
  await saveSheet(page, locale);
  await expect(page.getByText(zone, { exact: true })).toBeVisible();
  await axe(page);

  // AC-19: the service has no formula yet, and its chip opens the pricing page for it.
  await openTab(page, locale, 'services');
  await page
    .getByRole('link', { name: m(locale, 'AdminCatalog.state.no_formula') })
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(`/${locale}/admin/pricing\\?service=`));
  await expect(page.getByText(m(locale, 'AdminPricing.notPublished'))).toBeVisible();

  // The formula: base 1200, rooms × 400, villa × 1.30.
  await page.locator('#base-price').fill('1200');
  await page.locator('#add-modifier-question').selectOption('rooms');
  await page.getByRole('button', { name: m(locale, 'AdminPricing.addModifier') }).click();
  const first = page.locator('article').nth(0);
  await first.getByText(m(locale, 'AdminPricing.effectType.PER_UNIT'), { exact: true }).click();
  await first.locator('input[id$="-value"]').fill('400');
  await page.locator('#add-modifier-question').selectOption('kind');
  await page.getByRole('button', { name: m(locale, 'AdminPricing.addModifier') }).click();
  const second = page.locator('article').nth(1);
  await second.getByText(m(locale, 'AdminPricing.effectType.MULTIPLIER'), { exact: true }).click();
  await second.locator('input[id$="-value"]').fill('1.30');

  // AC-21: no total until every required priced question is answered; then the server's figure.
  const panel = page.locator('aside[aria-labelledby="preview-title"]');
  await expect(panel.getByText(m(locale, 'AdminPricing.preview.answerFirst'))).toBeVisible();
  await page.locator('#preview-rooms').fill('3');
  await panel.getByText('Villa', { exact: true }).click();
  await page.getByRole('switch', { name: m(locale, 'AdminPricing.addonLabel', { name: 'Cam' }) }).click();
  await panel.getByText(new RegExp(`^${zone}`)).click();
  // The server's total, as MoneyDisplay shows it, and the line before rounding in major units.
  await expect(
    panel.getByText(formatMoney(404800, 'TRY', locale as 'ar' | 'tr' | 'en'), { exact: true }).first(),
  ).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText('4048.00 TRY', { exact: true })).toBeVisible();
  await axe(page);
  await noOverflow(page);
  await switchTargets(page);

  // Publish version 1, then change a modifier and publish version 2.
  await page.getByRole('button', { name: m(locale, 'AdminPricing.publish', { version: '1' }) }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: m(locale, 'AdminPricing.publish', { version: '1' }) })
    .click();
  await expect(
    page.getByText(m(locale, 'AdminPricing.version', { version: '1' }), { exact: true }),
  ).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    page.getByRole('button', { name: m(locale, 'AdminPricing.publishedNoChanges') }),
  ).toBeDisabled();
  await page.locator('article').nth(0).locator('input[id$="-value"]').fill('450');
  await page.getByRole('button', { name: m(locale, 'AdminPricing.publish', { version: '2' }) }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: m(locale, 'AdminPricing.publish', { version: '2' }) })
    .click();
  await expect(
    page.getByText(m(locale, 'AdminPricing.version', { version: '2' }), { exact: true }),
  ).toBeVisible({
    timeout: 20_000,
  });

  // AC-4: a question the active formula reads cannot be turned off.
  await page.goto(`/${locale}/admin/catalog`);
  await page.getByRole('link', { name: new RegExp(category) }).click();
  await page.getByRole('switch', { name: m(locale, 'AdminCatalog.turnOff', { name: 'Oda sayısı' }) }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: m(locale, 'CatalogErrors.question_in_use') }),
  ).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    page.getByRole('switch', { name: m(locale, 'AdminCatalog.turnOff', { name: 'Oda sayısı' }) }),
  ).toBeVisible();
  await page.context().close();
});

test('a customer and a provider never reach the catalog or the pricing page', async ({
  page,
  browser,
}, testInfo) => {
  const locale = testInfo.project.name;
  await signIn(page, locale, testPhone(locale, 'catalogCustomer'));
  await onboard(page, `Müşteri ${locale}`);
  await expect(page).toHaveURL(new RegExp(`/${locale}/requests/new$`), { timeout: 20_000 });
  for (const path of ['/admin/catalog', '/admin/pricing']) {
    await page.goto(`/${locale}${path}`);
    await expect(page).toHaveURL(new RegExp(`/${locale}/requests$`), { timeout: 20_000 });
  }

  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const provider = await context.newPage();
  await signIn(provider, locale, testPhone(locale, 'catalogProvider'), `/${locale}/login?as=provider`);
  await onboard(provider, `Usta ${locale}`);
  await expect(provider).toHaveURL(new RegExp(`/${locale}/provider/profile$`), { timeout: 20_000 });
  for (const path of ['/admin/catalog', '/admin/pricing']) {
    await provider.goto(`/${locale}${path}`);
    await expect(provider).toHaveURL(new RegExp(`/${locale}/provider$`), { timeout: 20_000 });
  }
  await context.close();
});
