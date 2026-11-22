import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import type { Browser, Page, WebSocket } from '@playwright/test';
import { createTranslator } from 'next-intl';

import { expect, test } from './fixtures';
import { onboard, signIn } from './auth';
import { testE164, testPhone } from './numbers';

/**
 * Spec 0011-18 AC-14 on the real local stack, at 390px with axe, in every locale. Two offers on the customer's requests
 * leave two notices. The provider waits on My jobs; the customer's pick (written through `choose_provider` as the
 * customer, as 05's e2e does) raises the provider's bell without a reload, through a ping on the private channel.
 * The provider opens the notice from the popover and lands on My jobs with the count gone. The customer opens one
 * offer notice from the page, lands on its request, and "Mark all as read" clears the rest.
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

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function sql(query: string): Record<string, unknown>[] {
  const file = join(tmpdir(), `asma-e2e-notices-${process.pid}-${Date.now()}-${randomUUID()}.sql`);
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

type Who = 'noticeCustomer' | 'noticeProvider';
const profileId = (locale: string, who: Who) =>
  `(select id from public.profiles where phone = '${testE164(locale, who)}')`;

function ids(locale: string) {
  const d = { ar: '1', tr: '2', en: '3' }[locale] ?? '9';
  const id = (kind: string) => `00000000-0000-4000-8000-0018000${kind}00${d}`;
  return {
    category: id('c1'),
    service: id('51'),
    zone: id('21'),
    request: (n: number) => id(`e${n}`),
    offer: (n: number) => id(`f${n}`),
    names: {
      service: `Bildirim hizmet ${locale}`,
      zone: `Bildirim semt ${locale}`,
      category: `Bildirim ${locale}`,
    },
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

/** A request of the customer with the provider's offer on it, starting in three days. The offer writes a notice. */
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

function seed(locale: string, f: ReturnType<typeof ids>) {
  const customer = profileId(locale, 'noticeCustomer');
  const provider = profileId(locale, 'noticeProvider');
  sql(
    `do $s$ begin` +
      ` insert into public.service_categories (id, region, name, display_order, active) values ('${f.category}', 'TR', '{"tr": "${f.names.category}"}', 981, true) on conflict (id) do nothing;` +
      ` insert into public.services (id, category_id, region, name, hours_min, hours_max, display_order, active) values ('${f.service}', '${f.category}', 'TR', '{"tr": "${f.names.service}"}', 2, 3, 1, true) on conflict (id) do nothing;` +
      ` insert into public.zones (id, region, name, multiplier, display_order, active) values ('${f.zone}', 'TR', '{"tr": "${f.names.zone}"}', 1.00, 981, true) on conflict (id) do nothing;` +
      request(f, 1, customer, provider) +
      request(f, 2, customer, provider) +
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

test('the bell rises live, a notice opens its page, and mark all clears the count', async ({
  page,
  browser,
  telemetry,
}, testInfo) => {
  test.setTimeout(300_000);
  const locale = testInfo.project.name;
  const f = ids(locale);

  const provider = await newPage(browser);
  await signIn(provider, locale, testPhone(locale, 'noticeProvider'), `/${locale}/login?as=provider`);
  await onboard(provider, `Bildirim Usta ${locale}`);
  await expect(provider).toHaveURL(new RegExp(`/${locale}/provider/profile$`), { timeout: 20_000 });
  sql(
    `update public.providers set status = 'approved', approved_at = now() - interval '60 days', approved_name = 'Bildirim Kaya'` +
      ` where id = ${profileId(locale, 'noticeProvider')};`,
  );
  await signIn(page, locale, testPhone(locale, 'noticeCustomer'));
  await onboard(page, 'Bildirim Müşteri');
  await expect(page).toHaveURL(new RegExp(`/${locale}/requests/new$`), { timeout: 20_000 });
  seed(locale, f);

  // The provider waits on My jobs with no unread notice, and the private channel joins (R-9).
  const joined = provider
    .waitForEvent('websocket', {
      predicate: (ws: WebSocket) => ws.url().includes('/realtime/v1/websocket'),
      timeout: 30_000,
    })
    .then((ws: WebSocket) =>
      ws.waitForEvent('framereceived', {
        predicate: (frame: { payload: string | Buffer }) => {
          const text = String(frame.payload);
          return text.includes('phx_reply') && text.includes('notices:') && text.includes('"ok"');
        },
        timeout: 30_000,
      }),
    );
  await provider.goto(`/${locale}/provider/applications`);
  await expect(provider.getByRole('button', { name: m(locale, 'Notices.bell'), exact: true })).toBeVisible();
  await expect(provider.getByTestId('bell-count')).toHaveCount(0);
  await joined;

  // AC-10, AC-14: the customer's pick raises the provider's bell without a reload.
  sql(
    `do $s$ begin` +
      ` perform set_config('request.jwt.claims', json_build_object('sub', ${profileId(locale, 'noticeCustomer')}, 'role', 'authenticated')::text, true);` +
      ` perform public.choose_provider('${f.request(1)}', '${f.offer(1)}');` +
      ` end $s$;`,
  );
  await expect(provider.getByTestId('bell-count')).toHaveText('1', { timeout: 20_000 });

  // AC-8: the popover lists it; opening it leads to My jobs and the count goes (AC-6, AC-7).
  await provider.getByRole('button', { name: m(locale, 'Notices.bellUnread', { count: '1' }) }).click();
  const chosen = provider.getByRole('link', {
    name: new RegExp(escape(m(locale, 'NoticeKinds.chosen.title'))),
  });
  await expect(chosen).toBeVisible();
  await axe(provider);
  await chosen.click();
  await expect(provider).toHaveURL(new RegExp(`/${locale}/provider/applications$`));
  await expect(provider.getByTestId('bell-count')).toHaveCount(0, { timeout: 15_000 });

  // AC-9: the customer's page lists the two offers, newest first, both unread.
  await page.goto(`/${locale}/notifications`);
  await expect(page.getByRole('heading', { level: 1, name: m(locale, 'Notices.title') })).toBeVisible();
  await expect(page.getByTestId('notices-unread')).toHaveText('2');
  await expect(page.getByTestId('bell-count')).toHaveText('2');
  const offers = page.getByRole('link', {
    name: new RegExp(escape(m(locale, 'NoticeKinds.new_offer.title'))),
  });
  await expect(offers).toHaveCount(2);
  await expect(page.getByRole('heading', { name: m(locale, 'Notices.today') })).toBeVisible();
  await axe(page);

  // Opening one leads to its request (AC-7).
  await offers.first().click();
  await expect(page).toHaveURL(new RegExp(`/${locale}/requests/(${f.request(1)}|${f.request(2)})$`));
  await page.goto(`/${locale}/notifications`);
  await expect(page.getByTestId('notices-unread')).toHaveText('1');

  // "Mark all as read" clears the rest, and the bell with it (AC-6, AC-9).
  await page.getByRole('button', { name: m(locale, 'Notices.markAll') }).click();
  await expect(page.getByTestId('notices-unread')).toHaveText('0');
  await expect(page.getByTestId('bell-count')).toHaveCount(0);

  // R-8: the table is out of reach of the API; the notices exist only for their own people.
  const rows = sql(
    `select count(*)::int as n from public.notifications where recipient_id = ${profileId(locale, 'noticeCustomer')} and read_at is null;`,
  );
  expect(Number(rows[0]?.n)).toBe(0);

  // The live socket and the pages raise no CSP violation and call nothing off our origins.
  expect(await telemetry.cspViolations()).toEqual([]);
  expect(telemetry.offOrigin).toEqual([]);
});
