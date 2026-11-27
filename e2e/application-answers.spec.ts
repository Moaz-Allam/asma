import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import type { Browser, Page } from '@playwright/test';

import { expect, test } from './fixtures';
import { onboard, signIn } from './auth';
import { testE164, testPhone } from './numbers';
import { withoutDraftLabel } from '../lib/i18n/draft-label';

/**
 * Spec 0011-19b AC-9 at 390px with axe in every locale, on the real local database: admin adds two questions for
 * providers to a category (a text and a yes or no) and turns them on; a provider answers them on a request of that
 * category and reads their own answers back; the customer reads the answers on the offer card. A request in a
 * category with no question keeps the free message, for the provider and the customer.
 *
 * The catalog and the two requests are written as `postgres` in the shape the earlier positions leave them; the
 * questions, the answers and the message go through the real pages. Each project has its own catalog, so nothing
 * crosses. Fixture figures only.
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
  return withoutDraftLabel(node.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? `{${key}}`)));
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

function ids(locale: string) {
  const d = { ar: '1', tr: '2', en: '3' }[locale] ?? '9';
  const id = (kind: string) => `00000000-0000-4000-8000-0019b00${kind}00${d}`;
  return {
    asked: id('c1'),
    plain: id('c2'),
    askedService: id('51'),
    plainService: id('52'),
    zone: id('21'),
    askedRequest: id('e1'),
    plainRequest: id('e2'),
    names: {
      asked: `Soru kategori ${locale}`,
      plain: `Mesaj kategori ${locale}`,
      askedService: `Soru hizmet ${locale}`,
      plainService: `Mesaj hizmet ${locale}`,
      zone: `Soru semt ${locale}`,
    },
  };
}
type Ids = ReturnType<typeof ids>;

const profileId = (locale: string, who: 'answersCustomer' | 'answersProvider') =>
  `(select id from public.profiles where phone = '${testE164(locale, who)}')`;

function seedCatalog(f: Ids) {
  sql(
    `do $s$ begin` +
      ` insert into public.service_categories (id, region, name, display_order, active) values` +
      ` ('${f.asked}', 'TR', '{"tr": "${f.names.asked}"}', 995, true), ('${f.plain}', 'TR', '{"tr": "${f.names.plain}"}', 996, true)` +
      ` on conflict (id) do nothing;` +
      ` insert into public.services (id, category_id, region, name, hours_min, hours_max, display_order, active) values` +
      ` ('${f.askedService}', '${f.asked}', 'TR', '{"tr": "${f.names.askedService}"}', 2, 3, 1, true),` +
      ` ('${f.plainService}', '${f.plain}', 'TR', '{"tr": "${f.names.plainService}"}', 2, 3, 1, true) on conflict (id) do nothing;` +
      ` insert into public.zones (id, region, name, multiplier, display_order, active) values` +
      ` ('${f.zone}', 'TR', '{"tr": "${f.names.zone}"}', 1.00, 995, true) on conflict (id) do nothing;` +
      ` end $s$;`,
  );
}

/** The provider approved, with a setup covering both services and the district, every day, all hours. */
function approveProvider(locale: string, f: Ids) {
  const provider = profileId(locale, 'answersProvider');
  sql(
    `do $s$ begin` +
      ` update public.providers set status = 'approved', approved_at = now() - interval '40 days', approved_name = 'Cevap Usta' where id = ${provider};` +
      // Spec 0011-20b AC-5: an approved provider applies only with an address.
      ` insert into public.provider_addresses (provider_id, region, il, ilce, mahalle, street, building_no) select p.id, p.region, 'İstanbul', 'Kadıköy', 'Caferağa', 'Moda Cad.', '1' from public.providers p where p.id = ${provider} on conflict (provider_id) do nothing;` +
      ` insert into public.provider_services (provider_id, service_id, region) select ${provider}, s, 'TR' from unnest(array['${f.askedService}', '${f.plainService}']::uuid[]) s;` +
      ` insert into public.provider_zones (provider_id, zone_id, region) select ${provider}, '${f.zone}', 'TR';` +
      ` insert into public.provider_availability (provider_id, region, work_days, start_hour, end_hour) select ${provider}, 'TR', '{0,1,2,3,4,5,6}', 0, 24;` +
      ` end $s$;`,
  );
}

/** Two OPEN requests of the customer, as create_request leaves them: one per category. */
function postRequests(locale: string, f: Ids) {
  const customer = profileId(locale, 'answersCustomer');
  const one = (id: string, service: string, serviceName: string, category: string) => {
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
      service: { id: service, name: { tr: serviceName }, category_name: { tr: category } },
    });
    return (
      ` insert into public.requests (id, region, customer_id, client_key, service_id, zone_id, answers, questions_snapshot, pricing_snapshot,` +
      ` fixed_price, commission_amount, cash_due, currency, scheduled_start_at, scheduled_end_at)` +
      ` select '${id}', 'TR', ${customer}, gen_random_uuid(), '${service}', '${f.zone}', '{}', '[]', '${snapshot}', 300000, 30000, 270000, 'TRY',` +
      ` ((now() at time zone 'Europe/Istanbul')::date + 3 + time '10:00') at time zone 'Europe/Istanbul',` +
      ` ((now() at time zone 'Europe/Istanbul')::date + 3 + time '13:00') at time zone 'Europe/Istanbul' on conflict (id) do nothing;` +
      ` insert into public.request_addresses (request_id, region, customer_id, line)` +
      ` select '${id}', 'TR', ${customer}, 'Moda Cad. No 5' on conflict (request_id) do nothing;`
    );
  };
  sql(
    `do $s$ begin` +
      one(f.askedRequest, f.askedService, f.names.askedService, f.names.asked) +
      one(f.plainRequest, f.plainService, f.names.plainService, f.names.plain) +
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
  return (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
}

async function newAdmin(browser: Browser, locale: string): Promise<Page> {
  const page = await newPage(browser);
  await signIn(page, locale, testPhone(locale, 'answersAdmin'));
  await expect(page).toHaveURL(new RegExp(`/${locale}/onboarding$`), { timeout: 20_000 });
  await onboard(page, `Admin ${locale}`);
  await expect(page).toHaveURL(new RegExp(`/${locale}/requests/new$`), { timeout: 20_000 });
  sql(`select public.promote_to_admin('${testE164(locale, 'answersAdmin')}')`);
  await page.context().clearCookies();
  await signIn(page, locale, testPhone(locale, 'answersAdmin'));
  await expect(page).toHaveURL(new RegExp(`/${locale}/admin$`), { timeout: 20_000 });
  return page;
}

async function addProviderQuestion(
  page: Page,
  locale: string,
  q: { key: string; type: 'textarea' | 'boolean'; label: string; required: boolean },
) {
  await page.getByRole('button', { name: m(locale, 'AdminCatalog.newProviderQuestion') }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await sheet.locator('#question-key').fill(q.key);
  await sheet.locator('#question-type').selectOption(q.type);
  await sheet.locator('#question-label-tr').fill(q.label);
  const required = sheet.getByRole('switch', { name: m(locale, 'AdminCatalog.fieldRequired') });
  if ((await required.getAttribute('aria-checked')) !== String(q.required)) await required.click();
  await sheet.getByRole('button', { name: m(locale, 'AdminCatalog.save'), exact: true }).click();
  await expect(sheet).toBeHidden({ timeout: 20_000 });
  await page.getByRole('switch', { name: m(locale, 'AdminCatalog.turnOn', { name: q.label }) }).click();
  await expect(
    page.getByRole('switch', { name: m(locale, 'AdminCatalog.turnOff', { name: q.label }) }),
  ).toBeVisible({ timeout: 20_000 });
}

const APPROACH = 'Nasıl çalışırsınız?';
const INSURED = 'Sigortanız var mı?';
const ANSWER = 'Two of us come at ten and finish the same day, tools included.';
const MESSAGE = 'I can start at ten with two people and all the tools.';

test('admin asks providers two questions; a provider answers; the customer reads the answers', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(300_000);
  const locale = testInfo.project.name;
  const f = ids(locale);
  seedCatalog(f);

  // AC-2: admin writes the questions in the category's sheet, below the request questions.
  const admin = await newAdmin(browser, locale);
  await admin.goto(`/${locale}/admin/catalog?category=${f.asked}&tab=questions`);
  await expect(
    admin.getByRole('heading', { name: m(locale, 'AdminCatalog.providerQuestions') }),
  ).toBeVisible();
  await expect(admin.getByText(m(locale, 'AdminCatalog.providerQuestionsNote', { limit: 5 }))).toBeVisible();
  await addProviderQuestion(admin, locale, {
    key: 'approach',
    type: 'textarea',
    label: APPROACH,
    required: true,
  });
  await addProviderQuestion(admin, locale, {
    key: 'insured',
    type: 'boolean',
    label: INSURED,
    required: true,
  });
  await axe(admin);

  // The customer and their two requests.
  await signIn(page, locale, testPhone(locale, 'answersCustomer'));
  await onboard(page, 'Cevap müşteri');
  await expect(page).toHaveURL(new RegExp(`/${locale}/requests/new$`), { timeout: 20_000 });
  postRequests(locale, f);

  // AC-7: the provider answers the questions instead of the message.
  const provider = await newPage(browser);
  await signIn(provider, locale, testPhone(locale, 'answersProvider'), `/${locale}/login?as=provider`);
  await onboard(provider, `Cevap Usta ${locale}`);
  await expect(provider).toHaveURL(new RegExp(`/${locale}/provider/profile$`), { timeout: 20_000 });
  approveProvider(locale, f);

  await provider.goto(`/${locale}/provider/feed/${f.askedRequest}`);
  await expect(provider.locator('#application-message')).toHaveCount(0);
  await expect(provider.getByLabel(APPROACH)).toBeVisible();
  await expect(provider.locator('fieldset', { hasText: INSURED })).toBeVisible();
  await axe(provider);
  await provider.locator('#answer-approach').fill(ANSWER);
  await provider
    .locator('fieldset', { hasText: INSURED })
    .getByText(m(locale, 'ProviderFeed.form.yes'), { exact: true })
    .click();
  await provider.getByRole('button', { name: m(locale, 'ProviderFeed.form.submit') }).click();
  const confirm = provider.getByRole('alertdialog').or(provider.getByRole('dialog'));
  await confirm.getByRole('button', { name: m(locale, 'ProviderFeed.form.confirmSend') }).click();
  await expect(provider.getByText(m(locale, 'ProviderFeed.form.applied'))).toBeVisible({ timeout: 20_000 });
  // Their own answers, read only.
  await provider.reload();
  await expect(provider.getByText(m(locale, 'ProviderFeed.form.yourAnswers'))).toBeVisible();
  await expect(provider.getByText(ANSWER)).toBeVisible();
  await axe(provider);
  expect(
    sql(
      `select message is null and answers ->> 'approach' = '${ANSWER}' and (answers -> 'insured')::boolean as ok` +
        ` from public.applications where request_id = '${f.askedRequest}';`,
    ),
  ).toContain('true');

  // A category with no question keeps the free message.
  await provider.goto(`/${locale}/provider/feed/${f.plainRequest}`);
  await provider.locator('#application-message').fill(MESSAGE);
  await provider.getByRole('button', { name: m(locale, 'ProviderFeed.form.submit') }).click();
  const confirmPlain = provider.getByRole('alertdialog').or(provider.getByRole('dialog'));
  await confirmPlain.getByRole('button', { name: m(locale, 'ProviderFeed.form.confirmSend') }).click();
  await expect(provider.getByText(m(locale, 'ProviderFeed.form.applied'))).toBeVisible({ timeout: 20_000 });

  // AC-6: the customer reads the answers on the card, labels from the snapshot, yes in words.
  await page.goto(`/${locale}/requests/${f.askedRequest}`);
  const card = page.locator('section[aria-labelledby="offers-title"] > ul > li');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText(APPROACH);
  await expect(card).toContainText(ANSWER);
  await expect(card).toContainText(INSURED);
  await expect(card).toContainText(m(locale, 'Requests.offers.answerYes'));
  await axe(page);

  await page.goto(`/${locale}/requests/${f.plainRequest}`);
  await expect(page.locator('section[aria-labelledby="offers-title"] > ul > li')).toContainText(MESSAGE);

  await admin.context().close();
  await provider.context().close();
});
