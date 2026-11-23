import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import type { Browser, Page } from '@playwright/test';

import { formatMoney } from '../lib/format/money';
import type { Locale } from '../lib/i18n/direction';
import { expect, test } from './fixtures';
import { onboard, signIn } from './auth';
import { testE164, testPhone } from './numbers';

/**
 * Spec 0011-12 AC-14 on the real local stack, at 390px with axe, in every locale.
 *
 * Request A: a pick whose commission window passes reopens it (row 4); a paid pick whose fee window passes reopens it
 * with the commission carried (row 6); the customer picks the signed in provider in the browser with no payment step
 * (AC-4); that provider withdraws from Chosen (row 6, AC-5); a third failed pick cancels the request and queues the
 * commission refund (AC-3). Request B: the customer cancels a paid request and the dialog states the exact refund
 * (row 5). Request C: the unlocked provider cancels the job, and the customer is led to "Post again" (row 9).
 *
 * The catalog, three providers who never sign in, the requests, the offers and the payments (applied as the relay
 * would) are written as `postgres`; deadlines are moved into the past and `expire_windows()` is run once, as the
 * clock and the cron would.
 */

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

const money = (amount: number, locale: string) => formatMoney(amount, 'TRY', locale as Locale);

function sql(query: string): Record<string, unknown>[] {
  const file = join(tmpdir(), `asma-e2e-cancel-${process.pid}-${Date.now()}-${randomUUID()}.sql`);
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

const script = (statements: string) =>
  sql(`do $s$ declare v_attempt uuid; v_fee uuid; v_amount bigint; begin ${statements} end $s$;`);

type Who = 'cancelCustomer' | 'cancelProvider';
const profileId = (locale: string, who: Who) =>
  `(select id from public.profiles where phone = '${testE164(locale, who)}')`;
const as = (subject: string) =>
  ` perform set_config('request.jwt.claims', json_build_object('sub', ${subject}, 'role', 'authenticated')::text, true);`;

function ids(locale: string) {
  const d = { ar: '1', tr: '2', en: '3' }[locale] ?? '9';
  // The last group is 12 hex digits: 0012, the kind padded to 7, the project digit.
  const id = (kind: string) => `00000000-0000-4000-8000-0012${kind.padStart(7, '0')}${d}`;
  return {
    id,
    category: id('c1'),
    service: id('51'),
    zone: id('21'),
    provider: (n: number) => id(`a${n}`),
    providerPhone: (n: number) => `9055593${d}000${n}`,
    request: (key: string) => id(`e${key}`),
    offer: (key: string) => id(`f${key}`),
    names: {
      service: `İptal hizmet ${locale}`,
      zone: `İptal semt ${locale}`,
      category: `İptal ${locale}`,
    },
  };
}

/** The catalog and three approved providers who never sign in, once per project. */
function seed(f: ReturnType<typeof ids>) {
  const provider = (n: number) =>
    ` insert into auth.users (id, aud, role, phone, phone_confirmed_at, raw_app_meta_data) values ('${f.provider(n)}', 'authenticated', 'authenticated', '${f.providerPhone(n)}', now(), '{"role": "provider", "region": "TR"}') on conflict (id) do nothing;` +
    ` insert into public.profiles (id, role, region, phone, full_name, locale) values ('${f.provider(n)}', 'provider', 'TR', '+${f.providerPhone(n)}', 'İptal Usta ${n}', 'tr') on conflict (id) do nothing;` +
    ` update public.providers set status = 'approved', approved_at = now(), approved_name = 'Usta${n} Kaya' where id = '${f.provider(n)}';`;
  script(
    ` insert into public.service_categories (id, region, name, display_order, active) values ('${f.category}', 'TR', '{"tr": "${f.names.category}"}', 980, true) on conflict (id) do nothing;` +
      ` insert into public.services (id, category_id, region, name, hours_min, hours_max, display_order, active) values ('${f.service}', '${f.category}', 'TR', '{"tr": "${f.names.service}"}', 2, 3, 1, true) on conflict (id) do nothing;` +
      ` insert into public.zones (id, region, name, multiplier, display_order, active) values ('${f.zone}', 'TR', '{"tr": "${f.names.zone}"}', 1.00, 980, true) on conflict (id) do nothing;` +
      provider(1) +
      provider(2) +
      provider(3),
  );
}

/** A request as create_request leaves it, with one offer per provider as apply_to_request leaves it. */
function request(
  locale: string,
  f: ReturnType<typeof ids>,
  key: string,
  commission: number,
  providers: { offer: string; provider: string }[],
) {
  const customer = profileId(locale, 'cancelCustomer');
  const snapshot = JSON.stringify({
    price: 300000,
    currency: 'TRY',
    commission_percent: commission === 0 ? '0' : '10',
    rounding_minor: 100,
    breakdown: {
      base: 300000,
      modifiers: [],
      addons: [],
      zone: { id: f.zone, name: { tr: f.names.zone }, multiplier: '1.00' },
      unrounded: '300000',
      rounding_minor: 100,
    },
    service: {
      id: f.service,
      name: { tr: f.names.service },
      category_name: { tr: f.names.category },
    },
  });
  return (
    ` insert into public.requests (id, region, customer_id, client_key, service_id, zone_id, answers, questions_snapshot, pricing_snapshot,` +
    ` fixed_price, commission_amount, cash_due, currency, scheduled_start_at, scheduled_end_at)` +
    ` select '${f.request(key)}', 'TR', ${customer}, gen_random_uuid(), '${f.service}', '${f.zone}', '{}', '[]', '${snapshot}',` +
    ` 300000, ${commission}, ${300000 - commission}, 'TRY', now() + interval '3 days', now() + interval '3 days 2 hours';` +
    ` insert into public.request_addresses (request_id, region, customer_id, line) select '${f.request(key)}', 'TR', ${customer}, 'Bağdat Cad. No ${key}';` +
    providers
      .map(
        (p) =>
          ` insert into public.applications (id, region, request_id, provider_id, message) values` +
          ` ('${p.offer}', 'TR', '${f.request(key)}', ${p.provider}, 'I can start at ten with my own tools, two people.');`,
      )
      .join('')
  );
}

/** The customer picks, and for a commission above 0 pays it as the relay applies a verified payment. */
function pickAndPay(locale: string, f: ReturnType<typeof ids>, key: string, offer: string, pay: boolean) {
  const customer = profileId(locale, 'cancelCustomer');
  return (
    as(customer) +
    ` perform public.choose_provider('${f.request(key)}', '${offer}', 'draft-1');` +
    (pay
      ? ` v_attempt := (public.pay_commission('${f.request(key)}', 'tr', null, 'draft-1') ->> 'attempt_id')::uuid;` +
        ` if v_attempt is not null then` +
        ` select id, amount into v_fee, v_amount from public.fee_payments where request_id = '${f.request(key)}' and kind = 'commission';` +
        ` perform public.apply_fee_paid(v_fee, v_attempt, 'e2e-cancel-${locale}-${key}-' || gen_random_uuid(), v_amount, 'TRY', 0);` +
        ` end if;`
      : '')
  );
}

/** Move a window past its end and the checkout hold, then run the expiry once, as the cron would. */
function expire(f: ReturnType<typeof ids>, key: string, column: 'payment_deadline' | 'fee_deadline') {
  script(
    ` alter table public.requests disable trigger requests_guard;` +
      ` update public.requests set selected_at = now() - interval '3 hours', ${column} = now() - interval '2 hours'` +
      ` where id = '${f.request(key)}';` +
      ` alter table public.requests enable trigger requests_guard;` +
      ` perform public.expire_windows();`,
  );
}

const state = (f: ReturnType<typeof ids>, key: string) =>
  sql(`select status, failed_picks, closed_by from public.requests where id = '${f.request(key)}';`)[0];

async function axe(page: Page) {
  await page.evaluate(() => Promise.allSettled(document.getAnimations().map((a) => a.finished)));
  const scan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(scan.violations).toEqual([]);
}

async function newPage(browser: Browser) {
  return (
    await browser.newContext({
      viewport: { width: 390, height: 844 },
      baseURL: ORIGIN,
    })
  ).newPage();
}

/** The text of a message before its first placeholder, for a line that carries a formatted value. */
const lead = (locale: string, path: string) =>
  (m(locale, path, { amount: '@@' }).split('@@')[0] ?? '').trim();

test('a window that passes reopens, the commission carries, a third failed pick and the cancels refund', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(420_000);
  const locale = testInfo.project.name;
  const f = ids(locale);
  const me = profileId(locale, 'cancelProvider');
  const customer = profileId(locale, 'cancelCustomer');

  const provider = await newPage(browser);
  await signIn(provider, locale, testPhone(locale, 'cancelProvider'), `/${locale}/login?as=provider`);
  await onboard(provider, `İptal Usta ${locale}`);
  await expect(provider).toHaveURL(new RegExp(`/${locale}/provider/profile$`), {
    timeout: 20_000,
  });
  sql(
    `update public.providers set status = 'approved', approved_at = now(), approved_name = 'Ben Yılmaz' where id = ${me};`,
  );
  await signIn(page, locale, testPhone(locale, 'cancelCustomer'));
  await onboard(page, 'İptal Müşteri');
  await expect(page).toHaveURL(new RegExp(`/${locale}/requests/new$`), {
    timeout: 20_000,
  });
  seed(f);

  // Request A: offers from providers 1, 2, 3 and the signed in provider. A provider whose pick ended on a request is
  // never picked there again, so each step picks another one.
  script(
    request(locale, f, 'a', 30000, [
      { offer: f.offer('a1'), provider: `'${f.provider(1)}'` },
      { offer: f.offer('a2'), provider: `'${f.provider(2)}'` },
      { offer: f.offer('a3'), provider: me },
      { offer: f.offer('a4'), provider: `'${f.provider(3)}'` },
    ]),
  );

  // Row 4: picked, never paid, the commission window passes: back to OPEN, not a failed pick.
  script(pickAndPay(locale, f, 'a', f.offer('a1'), false));
  expire(f, 'a', 'payment_deadline');
  expect(state(f, 'a')).toEqual({
    status: 'OPEN',
    failed_picks: 0,
    closed_by: null,
  });

  // Row 6: provider 2 picked and the commission paid; the provider fee window passes: OPEN, one failed pick.
  script(pickAndPay(locale, f, 'a', f.offer('a2'), true));
  expect(state(f, 'a')).toMatchObject({ status: 'COMMISSION_PAID' });
  expire(f, 'a', 'fee_deadline');
  expect(state(f, 'a')).toEqual({
    status: 'OPEN',
    failed_picks: 1,
    closed_by: null,
  });

  // AC-4: the customer picks the signed in provider in the browser; the paid commission carries, no payment step.
  await page.goto(`/${locale}/requests/${f.request('a')}`);
  await axe(page);
  await page
    .getByRole('button', {
      name: m(locale, 'Requests.offers.choose', { name: 'Ben' }),
    })
    .click();
  const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'));
  // Spec 0011-20 AC-4: the carried re-pick takes the agreement tick; the confirm waits for it.
  await expect(dialog.getByRole('button', { name: m(locale, 'Requests.offers.confirm') })).toBeDisabled();
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: m(locale, 'Requests.offers.confirm') }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => state(f, 'a')?.status, { timeout: 20_000 }).toBe('COMMISSION_PAID');
  await expect(
    page.getByRole('button', {
      name: m(locale, 'Requests.next.pay', { amount: money(30000, locale) }),
    }),
  ).toHaveCount(0);

  // AC-5, row 6: the chosen provider withdraws from Chosen; a second failed pick.
  await provider.goto(`/${locale}/provider/applications?tab=chosen`);
  await expect(provider.getByRole('button', { name: m(locale, 'Cancel.withdraw') })).toBeVisible();
  await axe(provider);
  await provider.getByRole('button', { name: m(locale, 'Cancel.withdraw') }).click();
  await expect(provider.getByRole('dialog')).toContainText(m(locale, 'Cancel.withdrawBody.AWAITING_FEE'));
  await axe(provider);
  await provider
    .getByRole('dialog')
    .getByRole('button', { name: m(locale, 'Cancel.withdrawConfirm') })
    .click();
  await expect.poll(() => state(f, 'a')?.failed_picks, { timeout: 20_000 }).toBe(2);
  expect(state(f, 'a')).toMatchObject({ status: 'OPEN' });

  // AC-3: provider 3 picked (carried), its fee window passes: the third failed pick cancels and refunds.
  script(pickAndPay(locale, f, 'a', f.offer('a4'), false));
  expect(state(f, 'a')).toMatchObject({ status: 'COMMISSION_PAID' });
  expire(f, 'a', 'fee_deadline');
  expect(state(f, 'a')).toEqual({
    status: 'CANCELLED',
    failed_picks: 3,
    closed_by: 'platform',
  });
  expect(
    sql(
      `select r.amount, r.reason from public.fee_refunds r join public.fee_payments p on p.id = r.fee_payment_id` +
        ` where p.request_id = '${f.request('a')}';`,
    ),
  ).toEqual([{ amount: 30000, reason: 'failed_picks' }]);
  await page.goto(`/${locale}/requests/${f.request('a')}`);
  await axe(page);

  // Request B, row 5: paid, the customer cancels; the dialog states the exact refund before the confirm.
  script(
    request(locale, f, 'b', 30000, [{ offer: f.offer('b1'), provider: `'${f.provider(3)}'` }]) +
      pickAndPay(locale, f, 'b', f.offer('b1'), true),
  );
  await page.goto(`/${locale}/requests/${f.request('b')}`);
  await page.getByRole('button', { name: m(locale, 'Requests.detail.cancel') }).click();
  const cancel = page.getByRole('alertdialog').or(page.getByRole('dialog'));
  await expect(cancel).toContainText(
    m(locale, 'Requests.cancel.bodyRefund', { amount: money(30000, locale) }),
  );
  await axe(page);
  await cancel.getByRole('button', { name: m(locale, 'Requests.cancel.confirm') }).click();
  await expect(
    page.getByRole('status').filter({ hasText: lead(locale, 'Requests.cancel.refunded') }),
  ).toBeVisible({
    timeout: 20_000,
  });
  expect(state(f, 'b')).toEqual({
    status: 'CANCELLED',
    failed_picks: 0,
    closed_by: 'customer',
  });
  expect(
    sql(
      `select r.amount, r.reason from public.fee_refunds r join public.fee_payments p on p.id = r.fee_payment_id` +
        ` where p.request_id = '${f.request('b')}';`,
    ),
  ).toEqual([{ amount: 30000, reason: 'customer_cancel' }]);

  // Request C, row 9: unlocked with the signed in provider (a commission of 0, the provider fee as the relay
  // applies it); the provider cancels the job from Active; the customer sees "Post again".
  script(
    request(locale, f, 'c', 0, [{ offer: f.offer('c1'), provider: me }]) +
      pickAndPay(locale, f, 'c', f.offer('c1'), true) +
      as(me) +
      ` v_attempt := (public.pay_provider_fee('${f.offer('c1')}', 'tr', null, 'draft-1') ->> 'attempt_id')::uuid;` +
      ` select id, amount into v_fee, v_amount from public.fee_payments where request_id = '${f.request('c')}' and kind = 'provider_fee';` +
      ` perform public.apply_fee_paid(v_fee, v_attempt, 'e2e-cancel-fee-${locale}', v_amount, 'TRY', 0);` +
      as(customer),
  );
  expect(state(f, 'c')).toMatchObject({ status: 'UNLOCKED' });
  await provider.goto(`/${locale}/provider/applications?tab=active`);
  const job = provider.locator('li', { hasText: 'Bağdat Cad. No c' }).first();
  await job.getByRole('button', { name: m(locale, 'Cancel.cancelJob') }).click();
  await expect(provider.getByRole('dialog')).toContainText(m(locale, 'Cancel.noRefund'));
  await axe(provider);
  await provider
    .getByRole('dialog')
    .getByRole('button', { name: m(locale, 'Cancel.cancelJobConfirm') })
    .click();
  await expect.poll(() => state(f, 'c')?.status, { timeout: 20_000 }).toBe('CANCELLED');
  expect(state(f, 'c')).toMatchObject({ closed_by: 'provider' });
  expect(
    sql(`select count(*)::int as n from public.fee_refunds where request_id = '${f.request('c')}';`),
  ).toEqual([{ n: 0 }]);
  await page.goto(`/${locale}/requests/${f.request('c')}`);
  await expect(page.getByRole('link', { name: m(locale, 'Requests.detail.postAgain') })).toBeVisible();
  await axe(page);
});
