import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import type { APIRequestContext, Browser, Page } from '@playwright/test';

import { expect, stubMapTiler, test } from './fixtures';
import { onboard, signIn } from './auth';
import { testE164, testPhone } from './numbers';

/**
 * Spec 0011-20 AC-14 on the real local stack, at 390px with axe, in every locale. The customer ticks the service
 * agreement and pays (Pay waits for the tick); the chosen provider ticks the version the customer accepted and pays;
 * the reveal queues the agreement, the relay renders the PDF and mails both sides with it attached (the fake mail
 * file); both download it from their card; admin lists it and views it (audited first).
 *
 * The request, the offer and the choose are written as `postgres` in the shapes their own positions leave; both fees
 * are 0 (D171), so each side's tick and pay settles at once and the journey needs no card page (09 and 10 have their
 * own e2e for that). The full text page shows the version each checkbox links to.
 */

const SECRET = 'e2e-relay-secret-0000000000000000000000';
// Spec 0011-20b AC-6, AC-8: both addresses as Postgres composes them.
const CUSTOMER_LINE = 'Caferağa Mah., Sözleşme Sok., No: 7, Kadıköy/İstanbul';
const PROVIDER_LINE = 'Sinanpaşa Mah., Çarşı Cad., No: 8, Beşiktaş/İstanbul';
const ORIGIN = `http://localhost:${process.env.E2E_PORT || 3100}`;
const MAIL_FILE = process.env.EMAIL_FAKE_FILE ?? '';
test.use({ baseURL: ORIGIN });

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

/** A rich message's plain text, its tags dropped. */
const plain = (text: string) => text.replace(/<\/?[a-z]+>/g, '');

function sql(query: string): Record<string, unknown>[] {
  const file = join(tmpdir(), `asma-e2e-agreement-${process.pid}-${Date.now()}-${randomUUID()}.sql`);
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

const script = (statements: string) => sql(`do $s$ begin ${statements} end $s$;`);

type Who = 'agreementCustomer' | 'agreementProvider' | 'agreementAdmin';
const profileId = (locale: string, who: Who) =>
  `(select id from public.profiles where phone = '${testE164(locale, who)}')`;

function ids(locale: string) {
  const d = { ar: '1', tr: '2', en: '3' }[locale] ?? '9';
  const id = (kind: string) => `00000000-0000-4000-8000-0020000${kind}00${d}`;
  return {
    category: id('c1'),
    service: id('51'),
    zone: id('21'),
    request: id('e1'),
    offer: id('f1'),
    names: {
      service: `Sözleşme hizmet ${locale}`,
      zone: `Sözleşme semt ${locale}`,
      category: `Sözleşme ${locale}`,
    },
  };
}

/** The catalog, the request with both fees of 0, the offer and the choose; the customer and provider addresses. */
function chosen(locale: string, f: ReturnType<typeof ids>) {
  const snapshot = JSON.stringify({
    price: 250000,
    currency: 'TRY',
    commission_percent: '0',
    rounding_minor: 100,
    breakdown: {
      base: 250000,
      modifiers: [],
      addons: [],
      zone: { id: f.zone, name: { tr: f.names.zone }, multiplier: '1.00' },
      unrounded: '250000',
      rounding_minor: 100,
    },
    service: { id: f.service, name: { tr: f.names.service }, category_name: { tr: f.names.category } },
  });
  script(
    `insert into public.service_categories (id, region, name, display_order, active) values ('${f.category}', 'TR', '{"tr": "${f.names.category}"}', 970, true) on conflict (id) do nothing;` +
      ` insert into public.services (id, category_id, region, name, hours_min, hours_max, display_order, active) values ('${f.service}', '${f.category}', 'TR', '{"tr": "${f.names.service}"}', 2, 3, 1, true) on conflict (id) do nothing;` +
      ` insert into public.zones (id, region, name, multiplier, display_order, active) values ('${f.zone}', 'TR', '{"tr": "${f.names.zone}"}', 1.00, 970, true) on conflict (id) do nothing;` +
      ` insert into public.requests (id, region, customer_id, client_key, service_id, zone_id, answers, questions_snapshot, pricing_snapshot,` +
      ` fixed_price, commission_amount, cash_due, currency, scheduled_start_at, scheduled_end_at)` +
      ` select '${f.request}', 'TR', ${profileId(locale, 'agreementCustomer')}, gen_random_uuid(), '${f.service}', '${f.zone}', '{}', '[]',` +
      ` '${snapshot}', 250000, 0, 250000, 'TRY',` +
      ` ((now() at time zone 'Europe/Istanbul')::date + 3 + time '10:00') at time zone 'Europe/Istanbul',` +
      ` ((now() at time zone 'Europe/Istanbul')::date + 3 + time '13:00') at time zone 'Europe/Istanbul';` +
      // Spec 0011-20b: the customer's address as parts with a pin, and the provider's own address.
      ` insert into public.request_addresses (request_id, region, customer_id, line, il, ilce, mahalle, street, building_no, directions, lat, lng)` +
      ` select '${f.request}', 'TR', ${profileId(locale, 'agreementCustomer')}, '${CUSTOMER_LINE}', 'İstanbul', 'Kadıköy', 'Caferağa', 'Sözleşme Sok.', '7', 'Mavi kapı', 40.986345, 29.0252;` +
      ` insert into public.provider_addresses (provider_id, region, il, ilce, mahalle, street, building_no)` +
      ` select ${profileId(locale, 'agreementProvider')}, 'TR', 'İstanbul', 'Beşiktaş', 'Sinanpaşa', 'Çarşı Cad.', '8'` +
      ` on conflict (provider_id) do nothing;` +
      ` insert into public.applications (id, region, request_id, provider_id, message) values` +
      ` ('${f.offer}', 'TR', '${f.request}', ${profileId(locale, 'agreementProvider')}, 'I can come at ten with my own tools and a helper.');` +
      ` perform set_config('request.jwt.claims', json_build_object('sub', ${profileId(locale, 'agreementCustomer')}, 'role', 'authenticated')::text, true);` +
      ` perform public.choose_provider('${f.request}', '${f.offer}');` +
      // Both fees 0 (D171): the provider fee is frozen at the choose, so it is set here past the guard.
      ` alter table public.applications disable trigger applications_guard;` +
      ` update public.applications set provider_fee_amount = 0 where id = '${f.offer}';` +
      ` alter table public.applications enable trigger applications_guard;` +
      // The address first, then its confirmation: the profile guard clears email_confirmed_at on an address change.
      ` update public.profiles set email = 'e2e20-c-${locale}@example.com' where id = ${profileId(locale, 'agreementCustomer')};` +
      ` update public.profiles set email = 'e2e20-p-${locale}@example.com' where id = ${profileId(locale, 'agreementProvider')};` +
      ` update public.profiles set email_confirmed_at = now() where id in (${profileId(locale, 'agreementCustomer')}, ${profileId(locale, 'agreementProvider')});`,
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
  const page = await (
    await browser.newContext({
      viewport: { width: 390, height: 844 },
      baseURL: ORIGIN,
      acceptDownloads: true,
    })
  ).newPage();
  await stubMapTiler(page);
  return page;
}

async function relay(request: APIRequestContext, task: 'drain' | 'email') {
  const response = await request.post('/api/relay', {
    headers: { 'x-relay-secret': SECRET },
    data: { task },
  });
  expect(response.status()).toBe(202);
}

type Mail = {
  key: string;
  to: string;
  template: string;
  attachments?: { filename: string; size: number; sha256: string }[];
};
function mails(): Mail[] {
  if (!MAIL_FILE || !existsSync(MAIL_FILE)) return [];
  return readFileSync(MAIL_FILE, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Mail);
}

/** Download from a card and return the file's name and first bytes. */
async function downloadFrom(page: Page, label: string) {
  const card = page.getByRole('region', { name: label });
  const download = page.waitForEvent('download', { timeout: 20_000 });
  await card.getByRole('button').click();
  const file = await download;
  const path = await file.path();
  return { name: file.suggestedFilename(), head: readFileSync(path).subarray(0, 5).toString('latin1') };
}

test('both sides tick and pay, the reveal renders the agreement, both download it, admin views it', async ({
  page,
  browser,
  request,
}, testInfo) => {
  test.setTimeout(480_000);
  const locale = testInfo.project.name;
  const f = ids(locale);
  expect(MAIL_FILE, 'the e2e wrapper sets EMAIL_FAKE_FILE').not.toBe('');

  // The provider, approved; the customer; the request chosen.
  const provider = await newPage(browser);
  await signIn(provider, locale, testPhone(locale, 'agreementProvider'), `/${locale}/login?as=provider`);
  await onboard(provider, `Sözleşme Usta ${locale}`);
  await expect(provider).toHaveURL(new RegExp(`/${locale}/provider/profile$`), { timeout: 20_000 });
  sql(
    `update public.providers set status = 'approved', approved_at = now(), approved_name = 'Sözleşme Kaya'` +
      ` where id = ${profileId(locale, 'agreementProvider')};`,
  );
  await signIn(page, locale, testPhone(locale, 'agreementCustomer'));
  await onboard(page, 'Sözleşme Müşteri');
  await expect(page).toHaveURL(new RegExp(`/${locale}/requests/new$`), { timeout: 20_000 });
  chosen(locale, f);

  // AC-2: the tick with its two links; Continue is disabled until it is ticked.
  await page.goto(`/${locale}/requests/${f.request}`);
  const next = page.getByRole('region', { name: m(locale, 'Requests.next.title') });
  const tick = next.getByRole('checkbox', { name: plain(m(locale, 'Agreement.checkbox')) });
  await expect(tick).toBeVisible();
  const go = next.getByRole('button', { name: m(locale, 'Requests.next.continue') });
  await expect(go).toBeDisabled();
  await expect(
    next.getByRole('link', {
      name: m(locale, 'Agreement.checkbox').match(/<agreement>(.*)<\/agreement>/)?.[1] ?? '',
    }),
  ).toHaveAttribute('href', `/${locale}/agreement/draft-2`);
  await axe(page);
  await tick.check();
  await expect(go).toBeEnabled();
  await go.click();
  await expect(page.locator('#paid-title')).toHaveText(m(locale, 'Requests.next.paidTitle'), {
    timeout: 20_000,
  });
  expect(
    sql(
      `select c.role, t.version from public.agreement_acceptances c join public.agreement_templates t on t.id = c.template_id` +
        ` where c.application_id = '${f.offer}' order by c.role;`,
    ),
  ).toEqual([{ role: 'customer', version: 'draft-2' }]);

  // AC-12: the full text page of that version, its fields shown as labels, the Turkish note in the reader's locale.
  await page.goto(`/${locale}/agreement/draft-2`);
  await expect(page.locator('h1')).toHaveText(m(locale, 'Agreement.page.title'));
  await expect(page.getByText(m(locale, 'Agreement.page.turkish'))).toBeVisible();
  await expect(page.locator('article[lang="tr"]')).toContainText('[Hizmet alanın adı]');
  await expect(page.locator('article[lang="tr"]')).not.toContainText('{{');
  await axe(page);

  // AC-3: the provider ticks the customer's version on My jobs (Chosen) and pays the fee of 0.
  await provider.goto(`/${locale}/provider/applications?tab=chosen`);
  const fee = provider.getByRole('button', { name: m(locale, 'ProviderFeed.jobs.continue') });
  await expect(fee).toBeDisabled();
  await axe(provider);
  await provider.locator('main').getByRole('checkbox').check();
  await fee.click();
  await expect
    .poll(() => sql(`select status from public.requests where id = '${f.request}';`)[0]?.status, {
      timeout: 20_000,
    })
    .toBe('UNLOCKED');

  // AC-5, AC-6: the reveal queued the agreement; the relay renders it.
  const agreement = () =>
    sql(
      `select id, number, rendered_at is not null as rendered, storage_path from public.service_agreements where request_id = '${f.request}';`,
    )[0] as { id: string; number: string; rendered: boolean; storage_path: string | null } | undefined;
  expect(agreement()?.number).toMatch(/^HS-TR-\d{4}-\d{6}$/);
  await expect
    .poll(
      async () => {
        await relay(request, 'drain');
        return agreement()?.rendered ?? false;
      },
      { timeout: 60_000, intervals: [1000, 2000, 3000] },
    )
    .toBe(true);
  const number = agreement()!.number;
  // Spec 0011-20b AC-8: the frozen content names both addresses and the directions (draft-2 prints them).
  expect(
    sql(
      `select content ->> 'customer_address' as c, content ->> 'customer_directions' as d, content ->> 'provider_address' as p, content ->> 'template_version' as v from public.service_agreements where request_id = '${f.request}';`,
    )[0],
  ).toEqual({ c: CUSTOMER_LINE, d: 'Mavi kapı', p: PROVIDER_LINE, v: 'draft-2' });

  // AC-8: both mails, each with the PDF attached (the fake driver records name, size and hash only).
  await expect
    .poll(
      async () => {
        await relay(request, 'email');
        return mails()
          .filter((mail) => mail.key.startsWith(`agreement:${agreement()!.id}:`))
          .map((mail) => `${mail.template}:${mail.attachments?.[0]?.filename ?? ''}`)
          .sort();
      },
      { timeout: 60_000, intervals: [1000, 2000, 3000] },
    )
    .toEqual([
      `agreement_ready_customer:Hizmet-Sozlesmesi-${number}.pdf`,
      `agreement_ready_provider:Hizmet-Sozlesmesi-${number}.pdf`,
    ]);
  for (const mail of mails().filter((mail) => mail.key.startsWith(`agreement:${agreement()!.id}:`))) {
    expect(mail.attachments?.[0]?.size ?? 0).toBeGreaterThan(1000);
    expect(mail.attachments?.[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
  }

  // AC-9: the customer's card downloads the PDF once, then says the copy is in the mail.
  await page.goto(`/${locale}/requests/${f.request}`);
  const title = m(locale, 'Agreement.card.title');
  await expect(page.getByRole('region', { name: title })).toContainText(number);
  // Spec 0011-20b AC-6: the customer's card shows the provider's address, never a pin or a map.
  const customerCard = page
    .getByRole('region', { name: m(locale, 'Contacts.titleProvider') })
    .and(page.locator('[data-pii]'));
  await expect(customerCard).toContainText(PROVIDER_LINE);
  await expect(customerCard.getByRole('link', { name: m(locale, 'Address.card.openInMaps') })).toHaveCount(0);
  await axe(page);
  const customerFile = await downloadFrom(page, title);
  expect(customerFile).toEqual({ name: `Hizmet-Sozlesmesi-${number}.pdf`, head: '%PDF-' });
  await page.goto(`/${locale}/requests/${f.request}`);
  await expect(page.getByRole('region', { name: title }).getByRole('button')).toHaveText(
    m(locale, 'Agreement.card.again'),
  );

  // AC-9: the provider's card on My jobs (Active).
  await provider.goto(`/${locale}/provider/applications?tab=active`);
  await expect(provider.getByRole('region', { name: title })).toContainText(number);
  // Spec 0011-20b AC-6: the provider's card shows the customer's address, the directions and Open in Maps by the pin.
  const providerCard = provider
    .getByRole('region', { name: m(locale, 'Contacts.titleCustomer') })
    .and(provider.locator('[data-pii]'));
  await expect(providerCard).toContainText(CUSTOMER_LINE);
  await expect(providerCard).toContainText('Mavi kapı');
  await expect(
    providerCard.getByRole('link', { name: m(locale, 'Address.card.openInMaps') }),
  ).toHaveAttribute('href', 'https://www.google.com/maps/search/?api=1&query=40.986345,29.0252');
  await axe(provider);
  const providerFile = await downloadFrom(provider, title);
  expect(providerFile.head).toBe('%PDF-');
  expect(
    sql(
      `select customer_opened_at is not null and provider_opened_at is not null as both from public.service_agreements where request_id = '${f.request}';`,
    )[0],
  ).toEqual({ both: true });

  // AC-10: admin lists it, by its number, and views it; the view is audited first.
  const admin = await newPage(browser);
  await signIn(admin, locale, testPhone(locale, 'agreementAdmin'));
  await onboard(admin, `Admin ${locale}`);
  await expect(admin).toHaveURL(new RegExp(`/${locale}/requests/new$`), { timeout: 20_000 });
  sql(`select public.promote_to_admin('${testE164(locale, 'agreementAdmin')}')`);
  await admin.context().clearCookies();
  await signIn(admin, locale, testPhone(locale, 'agreementAdmin'));
  await expect(admin).toHaveURL(new RegExp(`/${locale}/admin$`), { timeout: 20_000 });
  await admin.goto(`/${locale}/admin/agreements?q=${encodeURIComponent(number)}`);
  const row = admin.locator('li', { hasText: number });
  await expect(row).toContainText('Sözleşme Müşteri');
  await expect(row).toContainText('Sözleşme Kaya');
  await axe(admin);
  const popup = admin.waitForEvent('popup', { timeout: 20_000 });
  await row.getByRole('button', { name: m(locale, 'Agreement.admin.view') }).click();
  await popup;
  expect(
    sql(
      `select count(*)::int as n from public.audit_log where action = 'agreement.viewed' and entity_id = '${agreement()!.id}';`,
    )[0],
  ).toEqual({ n: 1 });

  // AC-11: the one stored file is still there, under the path the row names.
  const objects = () =>
    sql(
      `select count(*)::int as n from storage.objects where bucket_id = 'service-agreements' and name = '${agreement()!.storage_path}';`,
    )[0];
  expect(objects()).toEqual({ n: 1 });
});
