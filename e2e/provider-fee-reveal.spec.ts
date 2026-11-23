import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import type { APIRequestContext, Browser, Page } from '@playwright/test';

import { formatMoney } from '../lib/format/money';
import type { Locale } from '../lib/i18n/direction';
import { expect, test } from './fixtures';
import { onboard, signIn } from './auth';
import { testE164, testPhone } from './numbers';

/**
 * Spec 0011-10 AC-14 on the real local stack with the fake PSP, at 390px with axe, in every locale. The chosen
 * provider pays the provider fee from My jobs (Chosen), through 09's pay page, the fake card page and the return
 * page; then both sides see each other's contacts: the provider on My jobs (Active), the customer on the request
 * page. The rival who was not chosen reads NOT_SELECTED in Done, sees no contact, and gets 404 on the chosen
 * provider's pay, return and receipt pages.
 *
 * The request, both offers, the choose and a commission of 0 (settled at once, D171) are written as `postgres`
 * in the shapes their own positions leave (04 to 09 have their own e2e). A provider fee of 0 is proven in pgTAP 23:
 * it needs the region's fee settings at 0, which this parallel run must not touch.
 */

const SECRET = 'e2e-relay-secret-0000000000000000000000';

// The fake card page and the callback live on the app origin, which the e2e wrapper sets to localhost; the
// browsers sign in on the same host so the callback brings them back to their session (D176).
const ORIGIN = `http://localhost:${process.env.E2E_PORT || 3100}`;
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

function sql(query: string): Record<string, unknown>[] {
  const file = join(tmpdir(), `asma-e2e-reveal-${process.pid}-${Date.now()}-${randomUUID()}.sql`);
  writeFileSync(file, query);
  let last = '';
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const run = spawnSync('npx', ['supabase', 'db', 'query', '--local', '-o', 'json', '-f', file], {
      encoding: 'utf8',
      shell: true,
    });
    if (run.status === 0) {
      // `-o json` (D189): without it the CLI prints a table outside an agent session, as in CI. An array or `{ rows }`.
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

type Who = 'revealCustomer' | 'revealProvider' | 'revealRival';
const profileId = (locale: string, who: Who) =>
  `(select id from public.profiles where phone = '${testE164(locale, who)}')`;

function ids(locale: string) {
  const d = { ar: '1', tr: '2', en: '3' }[locale] ?? '9';
  const id = (kind: string) => `00000000-0000-4000-8000-0010000${kind}00${d}`;
  return {
    category: id('c1'),
    service: id('51'),
    zone: id('21'),
    request: id('e1'),
    offerA: id('f1'),
    offerB: id('f2'),
    names: {
      service: `Açılış hizmet ${locale}`,
      zone: `Açılış semt ${locale}`,
      category: `Açılış ${locale}`,
    },
  };
}

/** The catalog, then the request as create_request leaves it, two offers, the choose, and a commission of 0. */
function chosenAndSettled(locale: string, f: ReturnType<typeof ids>) {
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
  script(
    `insert into public.service_categories (id, region, name, display_order, active) values ('${f.category}', 'TR', '{"tr": "${f.names.category}"}', 960, true) on conflict (id) do nothing;` +
      ` insert into public.services (id, category_id, region, name, hours_min, hours_max, display_order, active) values ('${f.service}', '${f.category}', 'TR', '{"tr": "${f.names.service}"}', 2, 3, 1, true) on conflict (id) do nothing;` +
      ` insert into public.zones (id, region, name, multiplier, display_order, active) values ('${f.zone}', 'TR', '{"tr": "${f.names.zone}"}', 1.00, 960, true) on conflict (id) do nothing;` +
      ` insert into public.requests (id, region, customer_id, client_key, service_id, zone_id, answers, questions_snapshot, pricing_snapshot,` +
      ` fixed_price, commission_amount, cash_due, currency, scheduled_start_at, scheduled_end_at, notes)` +
      ` select '${f.request}', 'TR', ${profileId(locale, 'revealCustomer')}, gen_random_uuid(), '${f.service}', '${f.zone}', '{}', '[]',` +
      ` '${snapshot}', 300000, 0, 300000, 'TRY',` +
      ` ((now() at time zone 'Europe/Istanbul')::date + 3 + time '10:00') at time zone 'Europe/Istanbul',` +
      ` ((now() at time zone 'Europe/Istanbul')::date + 3 + time '13:00') at time zone 'Europe/Istanbul', 'Ring twice, third floor';` +
      ` insert into public.request_addresses (request_id, region, customer_id, line)` +
      ` select '${f.request}', 'TR', ${profileId(locale, 'revealCustomer')}, 'Moda Cad. No 5';` +
      ` insert into public.applications (id, region, request_id, provider_id, message) values` +
      ` ('${f.offerA}', 'TR', '${f.request}', ${profileId(locale, 'revealProvider')}, 'I can start at ten with my own tools, two people.'),` +
      ` ('${f.offerB}', 'TR', '${f.request}', ${profileId(locale, 'revealRival')}, 'Free that day, I live close to your district.');` +
      ` perform set_config('request.jwt.claims', json_build_object('sub', ${profileId(locale, 'revealCustomer')}, 'role', 'authenticated')::text, true);` +
      ` perform public.choose_provider('${f.request}', '${f.offerA}', 'draft-1');` +
      ` perform public.pay_commission('${f.request}', 'tr', null, 'draft-1');`,
  );
}

function approve(locale: string, who: 'revealProvider' | 'revealRival', name: string) {
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

async function newPage(browser: Browser) {
  return (await browser.newContext({ viewport: { width: 390, height: 844 }, baseURL: ORIGIN })).newPage();
}

async function provider(
  browser: Browser,
  locale: string,
  who: 'revealProvider' | 'revealRival',
  name: string,
) {
  const page = await newPage(browser);
  await signIn(page, locale, testPhone(locale, who), `/${locale}/login?as=provider`);
  await onboard(page, name);
  await expect(page).toHaveURL(new RegExp(`/${locale}/provider/profile$`), { timeout: 20_000 });
  return page;
}

async function kick(request: APIRequestContext) {
  await request.post('/api/relay', { headers: { 'x-relay-secret': SECRET }, data: { task: 'drain' } });
}

const money = (amount: number, locale: string) => formatMoney(amount, 'TRY', locale as Locale);

test('the chosen provider pays the fee and both sides see each other; the rival sees nothing', async ({
  page,
  browser,
  request,
  telemetry,
}, testInfo) => {
  test.setTimeout(480_000);
  const locale = testInfo.project.name;
  const f = ids(locale);

  const chosen = await provider(browser, locale, 'revealProvider', `Açılış Usta ${locale}`);
  const rival = await provider(browser, locale, 'revealRival', `Rakip Usta ${locale}`);
  approve(locale, 'revealProvider', 'Açılış Kaya');
  approve(locale, 'revealRival', 'Rakip Demir');
  await signIn(page, locale, testPhone(locale, 'revealCustomer'));
  await onboard(page, 'Açılış Müşteri');
  await expect(page).toHaveURL(new RegExp(`/${locale}/requests/new$`), { timeout: 20_000 });
  chosenAndSettled(locale, f);

  // Before the fee: the customer sees no contact (AC-11, A-3).
  await page.goto(`/${locale}/requests/${f.request}`);
  await expect(page.locator('#paid-title')).toHaveText(m(locale, 'Requests.next.paidTitle'));
  await expect(page.locator('[data-pii]')).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText(testPhone(locale, 'revealProvider'));

  // Chosen (AC-10): the frozen fee (5% of 300000), the deadline, the agreement line, Pay.
  await chosen.goto(`/${locale}/provider/applications?tab=chosen`);
  await expect(chosen.locator('main')).toContainText(money(15000, locale));
  await expect(chosen.locator('main')).toContainText(money(300000, locale));
  await axe(chosen);
  const payUrl = chosen.waitForURL(new RegExp(`/${locale}/pay/[0-9a-f-]{36}$`), { timeout: 20_000 });
  // Spec 0011-20 AC-3: the provider ticks the version the customer accepted.
  await chosen.locator('main').getByRole('checkbox').check();
  await chosen
    .getByRole('button', { name: m(locale, 'ProviderFeed.jobs.pay', { amount: money(15000, locale) }) })
    .click();
  await payUrl;
  const attempt = /\/pay\/([0-9a-f-]{36})/.exec(chosen.url())?.[1] ?? '';
  expect(attempt).not.toBe('');

  // The pay page sends the provider on to the fake card page (09's AC-11, R-7 for both payers).
  await expect
    .poll(
      async () => {
        if (chosen.url().includes(`/${locale}/dev/fake-checkout/`)) return true;
        await kick(request);
        const stopped = await chosen
          .getByRole('button', { name: m(locale, 'Payment.tryAgain') })
          .isVisible()
          .catch(() => false);
        if (stopped) await chosen.reload().catch(() => undefined);
        return chosen.url().includes(`/${locale}/dev/fake-checkout/`);
      },
      { timeout: 60_000, intervals: [500, 1000, 2000] },
    )
    .toBe(true);
  await chosen.waitForLoadState();
  await chosen.getByRole('button', { name: m(locale, 'DevFakeCheckout.outcomes.success') }).click();
  await expect(chosen.getByRole('status')).toBeVisible();
  await chosen.getByRole('button', { name: m(locale, 'DevFakeCheckout.returnToShop') }).click();
  await expect(chosen).toHaveURL(new RegExp(`/${locale}/pay/${attempt}/return$`), { timeout: 20_000 });
  await expect
    .poll(
      async () => {
        await kick(request);
        return (
          (await chosen
            .locator('#checkout-title')
            .textContent({ timeout: 2000 })
            .catch(() => '')) ?? ''
        );
      },
      { timeout: 90_000, intervals: [1000, 2000, 3000] },
    )
    .toBe(m(locale, 'Payment.successTitle'));
  await expect(chosen.getByText(m(locale, 'Payment.successBodyFee'))).toBeVisible();
  await axe(chosen);

  // The receipt of the provider fee (09's AC-13, for both payers).
  await chosen.getByRole('link', { name: m(locale, 'Payment.toReceipt') }).click();
  await expect(chosen).toHaveURL(new RegExp(`/${locale}/receipts/[0-9a-f-]{36}$`));
  const receipt = chosen.url();
  await expect(chosen.locator('main')).toContainText(m(locale, 'Payment.receipt.kinds.provider_fee'));
  await expect(chosen.locator('main')).toContainText(money(15000, locale));

  // Active (AC-12): the customer's contacts, street line and notes, with Call and WhatsApp.
  const active = await chosen.goto(`/${locale}/provider/applications?tab=active`);
  expect(active?.headers()['cache-control'] ?? '').toContain('no-store');
  const card = chosen.locator('[data-pii]');
  await expect(card).toContainText('Açılış Müşteri');
  await expect(card).toContainText(testE164(locale, 'revealCustomer'));
  await expect(card).toContainText('Moda Cad. No 5');
  await expect(card).toContainText('Ring twice, third floor');
  await expect(card.getByRole('link', { name: m(locale, 'Contacts.whatsapp') })).toHaveAttribute(
    'href',
    `https://wa.me/${testE164(locale, 'revealCustomer').slice(1)}`,
  );
  await axe(chosen);

  // The customer (AC-11): the provider's approved name and phone, no address field of their own shown back.
  const detail = await page.goto(`/${locale}/requests/${f.request}`);
  expect(detail?.headers()['cache-control'] ?? '').toContain('no-store');
  const mine = page.locator('[data-pii]');
  await expect(mine).toContainText('Açılış Kaya');
  await expect(mine).toContainText(testE164(locale, 'revealProvider'));
  await expect(mine).not.toContainText('Moda Cad. No 5');
  await expect(page.getByText(m(locale, 'Requests.timeline.contacts'))).toBeVisible();
  await axe(page);

  // The rival (R-12, R-7): NOT_SELECTED in Done, no contact anywhere, 404 on the chosen one's pages.
  await rival.goto(`/${locale}/provider/applications?tab=done`);
  await expect(rival.locator('main')).toContainText(m(locale, 'ProviderFeed.chosen.notChosen'));
  await rival.goto(`/${locale}/provider/applications?tab=active`);
  await expect(rival.locator('[data-pii]')).toHaveCount(0);
  for (const path of [
    `/${locale}/pay/${attempt}`,
    `/${locale}/pay/${attempt}/return`,
    receipt.replace(ORIGIN, ''),
  ]) {
    const response = await rival.goto(path);
    expect(response?.status(), path).toBe(404);
  }
  await expect(rival.locator('main')).not.toContainText(testE164(locale, 'revealCustomer'));

  // Telemetry: the reveal events carry the side only, never a phone or an id (AC-13).
  const events = telemetry.posthog.filter((e) => e.event === 'contacts_unlocked');
  for (const e of events) {
    expect(JSON.stringify((e as { properties?: unknown }).properties ?? {})).not.toMatch(
      /\+90|wa\.me|Moda|[0-9a-f]{8}-[0-9a-f]{4}-/,
    );
  }
});
