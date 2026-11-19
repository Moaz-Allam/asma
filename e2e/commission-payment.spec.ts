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
import { TEST_CODE, testE164, testPhone } from './numbers';

/**
 * Spec 0011-09 AC-15 on the real local stack with the fake PSP, at 390px with axe, in every locale. A customer
 * pays the commission of a chosen request: the split and the agreement line, the pay page that opens the fake
 * card page, the return page that waits for the relay's verified result, the receipt, and the request moved to
 * COMMISSION_PAID. Also: a failure then a retry, a slow (pending) payment, a duplicate payment refunded, a late
 * payment refunded (the deadline moved into the past here), a commission of 0, payments paused for an attempt,
 * a cancel refused while a card page is open, and another customer getting 404 on the pay, return and receipt
 * pages.
 *
 * Requests, the provider and the choose are written as `postgres` in the shapes their own positions leave
 * (04, 05, 06 have their own e2e). The relay is woken by posting to /api/relay with the e2e secret, as pg_net does
 * on a deployment. Payments stay on for TR (the seed): the projects run in parallel, so no test turns them off;
 * the paused case fails one attempt `payments_disabled` the way the relay does when they are off.
 */

const SECRET = 'e2e-relay-secret-0000000000000000000000';

// The fake card page and the callback live on the app origin, which the e2e wrapper sets to localhost
// (APP_ORIGIN; the relay and the card URL check allow http there only). The customer signs in on the same
// host, so the callback brings the browser back where its session cookies are.
test.use({ baseURL: `http://localhost:${process.env.E2E_PORT || 3100}` });

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
  const file = join(tmpdir(), `asma-e2e-pay-${process.pid}-${Date.now()}-${randomUUID()}.sql`);
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

type Who = 'payCustomer' | 'payCustomerB';

function ids(locale: string) {
  const d = { ar: '1', tr: '2', en: '3' }[locale] ?? '9';
  const id = (kind: string) => `00000000-0000-4000-8000-0009000${kind}00${d}`;
  return {
    id,
    category: id('c1'),
    service: id('51'),
    zone: id('21'),
    provider: id('a1'),
    providerPhone: `9055592090${d}0`,
    names: { service: `Ödeme hizmet ${locale}`, zone: `Ödeme semt ${locale}`, category: `Ödeme ${locale}` },
  };
}

/** The catalog and an approved provider, once per project. */
function seed(locale: string) {
  const f = ids(locale);
  script(
    `insert into public.service_categories (id, region, name, display_order, active) values ('${f.category}', 'TR', '{"tr": "${f.names.category}"}', 950, true) on conflict (id) do nothing;` +
      ` insert into public.services (id, category_id, region, name, hours_min, hours_max, display_order, active) values ('${f.service}', '${f.category}', 'TR', '{"tr": "${f.names.service}"}', 2, 3, 1, true) on conflict (id) do nothing;` +
      ` insert into public.zones (id, region, name, multiplier, display_order, active) values ('${f.zone}', 'TR', '{"tr": "${f.names.zone}"}', 1.00, 950, true) on conflict (id) do nothing;` +
      ` insert into auth.users (id, aud, role, phone, phone_confirmed_at, raw_app_meta_data) values ('${f.provider}', 'authenticated', 'authenticated', '${f.providerPhone}', now(), '{"role": "provider", "region": "TR"}') on conflict (id) do nothing;` +
      ` insert into public.profiles (id, role, region, phone, full_name, locale) values ('${f.provider}', 'provider', 'TR', '+${f.providerPhone}', 'Ödeme Usta', 'tr') on conflict (id) do nothing;` +
      ` update public.providers set status = 'approved', approved_at = now(), approved_name = 'Ödeme Usta' where id = '${f.provider}';`,
  );
  return f;
}

const customerId = (locale: string, who: Who) =>
  `(select id from public.profiles where phone = '${testE164(locale, who)}')`;

/** A request as create_request leaves it, an offer as apply_to_request leaves it, chosen as choose_provider does. */
function chosenRequest(locale: string, who: Who, key: string, commission: number): string {
  const f = ids(locale);
  const request = f.id(`e${key}`);
  const offer = f.id(`f${key}`);
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
      ` select '${request}', 'TR', ${customerId(locale, who)}, gen_random_uuid(), '${f.service}', '${f.zone}', '{}', '[]',` +
      ` '${snapshot}', 300000, ${commission}, ${300000 - commission}, 'TRY',` +
      ` ((now() at time zone 'Europe/Istanbul')::date + 3 + time '10:00') at time zone 'Europe/Istanbul',` +
      ` ((now() at time zone 'Europe/Istanbul')::date + 3 + time '13:00') at time zone 'Europe/Istanbul';` +
      ` insert into public.request_addresses (request_id, region, customer_id, line)` +
      ` select '${request}', 'TR', ${customerId(locale, who)}, 'Moda Cad. No 5';` +
      ` insert into public.applications (id, region, request_id, provider_id, message) values` +
      ` ('${offer}', 'TR', '${request}', '${f.provider}', 'I can start at ten with my own tools, two people.');` +
      ` perform set_config('request.jwt.claims', json_build_object('sub', ${customerId(locale, who)}, 'role', 'authenticated')::text, true);` +
      ` perform public.choose_provider('${request}', '${offer}');`,
  );
  return request;
}

async function axe(page: Page) {
  await page.evaluate(() => Promise.allSettled(document.getAnimations().map((a) => a.finished)));
  const scan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(scan.violations).toEqual([]);
}

async function signIn(page: Page, locale: string, phone: string) {
  await page.goto(`/${locale}/login`);
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

async function customer(page: Page, locale: string, who: Who | 'payOther', name: string) {
  await signIn(page, locale, testPhone(locale, who));
  await onboard(page, name);
  await expect(page).toHaveURL(new RegExp(`/${locale}/requests/new$`), { timeout: 20_000 });
}

async function kick(request: APIRequestContext) {
  await request.post('/api/relay', { headers: { 'x-relay-secret': SECRET }, data: { task: 'drain' } });
}

const money = (amount: number, locale: string) => formatMoney(amount, 'TRY', locale as Locale);
const attemptOf = (page: Page) => /\/pay\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? '';

/** Press Pay on the request page and land on the pay page; returns the attempt id. */
async function pressPay(page: Page, locale: string, requestId: string, amount = 30000) {
  await page.goto(`/${locale}/requests/${requestId}`);
  return toPayPage(page, locale, requestId, () =>
    page
      .getByRole('button', { name: m(locale, 'Requests.next.pay', { amount: money(amount, locale) }) })
      .click(),
  );
}

/**
 * Run the click that opens a pay page and return its attempt id. Listens before the click: a fast relay can
 * send the browser on to the card page within a second, so the id may have to come from the database (the
 * payer's newest attempt on that request).
 */
async function toPayPage(page: Page, locale: string, requestId: string, click: () => Promise<void>) {
  const payUrl = page.waitForURL(new RegExp(`/${locale}/pay/[0-9a-f-]{36}$`), { timeout: 20_000 });
  await click();
  await payUrl;
  const id = attemptOf(page);
  if (id) return id;
  const [row] = sql(
    `select a.id from public.checkout_attempts a join public.fee_payments f on f.id = a.fee_payment_id where f.request_id = '${requestId}' order by a.started_at desc limit 1;`,
  );
  return String(row?.id ?? '');
}

/** Wake the relay until the pay page has left for the fake card page (AC-11). */
async function toCardPage(page: Page, request: APIRequestContext, locale: string) {
  const opening = m(locale, 'Payment.opening');
  await expect
    .poll(
      async () => {
        if (page.url().includes(`/${locale}/dev/fake-checkout/`)) return true;
        await kick(request);
        // The page polls for 15 seconds only; under a full parallel run the relay can be slower. A reload reads
        // the attempt again, and a ready one sends the browser on at once.
        // The slow view keeps the opening title but has stopped polling, so its Try again button counts too.
        // Short timeouts: once the browser is on the card page these elements never appear.
        const title = await page
          .locator('#checkout-title')
          .textContent({ timeout: 1000 })
          .catch(() => opening);
        const stopped = await page
          .getByRole('button', { name: m(locale, 'Payment.tryAgain') })
          .isVisible()
          .catch(() => false);
        if (title !== opening || stopped) await page.reload().catch(() => undefined);
        return page.url().includes(`/${locale}/dev/fake-checkout/`);
      },
      { timeout: 60_000, intervals: [500, 1000, 2000] },
    )
    .toBe(true);
  await page.waitForLoadState();
}

/** On the fake card page: pick the outcome and come back through the callback to the return page (AC-12). */
async function chooseAndReturn(page: Page, locale: string, outcome: string, attempt: string) {
  await page.getByRole('button', { name: m(locale, `DevFakeCheckout.outcomes.${outcome}`) }).click();
  await expect(page.getByRole('status')).toBeVisible();
  await page.getByRole('button', { name: m(locale, 'DevFakeCheckout.returnToShop') }).click();
  await expect(page).toHaveURL(new RegExp(`/${locale}/pay/${attempt}/return$`), { timeout: 20_000 });
}

/** Wake the relay until the return page shows the title (the page polls every 2 seconds). */
async function untilTitle(page: Page, request: APIRequestContext, title: string) {
  await expect
    .poll(
      async () => {
        await kick(request);
        return (
          (await page
            .locator('#checkout-title')
            .textContent({ timeout: 2000 })
            .catch(() => '')) ?? ''
        );
      },
      { timeout: 90_000, intervals: [1000, 2000, 3000] },
    )
    .toBe(title);
}

/** A check queued by hand, as the callback or a webhook would queue it. */
function queueVerify(attempt: string) {
  sql(
    `select public.enqueue_outbox('payment.verify', 'e2e-verify:${attempt}:${randomUUID()}', jsonb_build_object('attempt_id', '${attempt}', 'final', false, 'origin', 'callback'), 'TR');`,
  );
}

async function newCustomerPage(browser: Browser) {
  return (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
}

test('a customer pays the commission, gets a receipt, and the request moves on', async ({
  page,
  browser,
  request,
  telemetry,
}, testInfo) => {
  test.setTimeout(480_000);
  const locale = testInfo.project.name;
  seed(locale);
  await customer(page, locale, 'payCustomer', 'Ödeme müşteri');
  const paid = chosenRequest(locale, 'payCustomer', '1', 30000);
  const twice = chosenRequest(locale, 'payCustomer', '2', 30000);
  const zero = chosenRequest(locale, 'payCustomer', '3', 0);
  const open = chosenRequest(locale, 'payCustomer', '4', 30000);

  // The pay panel (AC-10): the split, the deadline, the agreement line with its link, the button.
  await page.goto(`/${locale}/requests/${paid}`);
  const next = page.getByRole('region', { name: m(locale, 'Requests.next.title') });
  for (const text of [money(300000, locale), money(30000, locale), money(270000, locale)]) {
    await expect(next).toContainText(text);
  }
  await expect(
    next.getByRole('link', { name: m(locale, 'Payment.agreement').match(/<terms>(.*)<\/terms>/)?.[1] ?? '' }),
  ).toHaveAttribute('href', `/${locale}/terms`);
  if (locale === 'ar') await expect(next).toContainText(m(locale, 'Requests.next.cardEnglish'));
  await axe(page);

  // Success (AC-11, AC-12, AC-6): pay page, card page, return page, verified paid.
  const attempt = await pressPay(page, locale, paid);
  // The pay page may leave for the card page at any moment; its scan counts only while it is still there.
  // A scan cut by that navigation is fine only if the browser does arrive on the card page.
  await axe(page).catch(async (error: unknown) => {
    await page.waitForURL(new RegExp(`/${locale}/dev/fake-checkout/`), { timeout: 15_000 }).catch(() => {
      throw error;
    });
  });
  // Analytics (AC-14): posthog-js queues the event in the browser, and toCardPage may reload a stalled pay page,
  // which drops a queue not yet sent. So the start is counted here, before anything can reload.
  await expect
    .poll(() => telemetry.posthog.filter((e) => e.event === 'payment_started').length, { timeout: 20_000 })
    .toBe(1);
  await toCardPage(page, request, locale);
  await chooseAndReturn(page, locale, 'success', attempt);
  await untilTitle(page, request, m(locale, 'Payment.successTitle'));
  await axe(page);
  await page.getByRole('link', { name: m(locale, 'Payment.toReceipt') }).click();

  // The receipt (AC-13): our fee id, the amount, not a tax invoice.
  await expect(page).toHaveURL(new RegExp(`/${locale}/receipts/[0-9a-f-]{36}$`));
  const feeId = /receipts\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? '';
  await expect(page.locator('main')).toContainText(feeId);
  await expect(page.locator('main')).toContainText(money(30000, locale));
  await expect(page.locator('main')).toContainText(m(locale, 'Payment.receipt.notInvoice'));
  await expect(page.locator('main')).not.toContainText('fp1_');
  await axe(page);

  // The request (AC-10): commission paid, waiting for the provider's fee, the receipt link, the timeline.
  await page.goto(`/${locale}/requests/${paid}`);
  await expect(page.locator('#paid-title')).toHaveText(m(locale, 'Requests.next.paidTitle'));
  await expect(page.getByRole('link', { name: m(locale, 'Requests.next.receipt') })).toBeVisible();
  const timeline = page.getByRole('region', { name: m(locale, 'Requests.timeline.title') });
  await expect(timeline).toContainText(m(locale, 'Requests.timeline.commissionPaid'));
  await expect(timeline).toContainText(m(locale, 'Requests.timeline.providerFee'));
  await axe(page);
  expect(sql(`select status from public.requests where id = '${paid}';`)[0]).toEqual({
    status: 'COMMISSION_PAID',
  });

  // Analytics (AC-14): one start, one success, which fee only.
  // posthog-js sends in batches, so under a busy runner an event can take longer than the default 5 seconds.
  await expect
    .poll(() => telemetry.posthog.filter((e) => e.event === 'payment_succeeded').length, { timeout: 20_000 })
    .toBe(1);
  expect(telemetry.posthog.filter((e) => e.event === 'payment_started').length).toBe(1);
  for (const event of telemetry.posthog.filter((e) => e.event.startsWith('payment_'))) {
    expect(event.properties.fee).toBe('commission');
    expect(JSON.stringify(event.properties)).not.toContain(attempt);
    expect(JSON.stringify(event.properties)).not.toContain(paid);
  }

  // Another customer (R-13): the same 404 on the pay, return and receipt pages.
  const other = await newCustomerPage(browser);
  await customer(other, locale, 'payOther', 'Başka müşteri');
  for (const path of [
    `/pay/${attempt}`,
    `/pay/${attempt}/return`,
    `/receipts/${feeId}`,
    `/pay/${randomUUID()}`,
  ]) {
    expect((await other.goto(`/${locale}${path}`))?.status()).toBe(404);
  }
  await other.context().close();

  // A duplicate (R-3): paid once, the second payment refunded, and the return page says so.
  const second = await pressPay(page, locale, twice);
  await toCardPage(page, request, locale);
  await chooseAndReturn(page, locale, 'duplicate', second);
  await untilTitle(page, request, m(locale, 'Payment.successTitle'));
  queueVerify(second);
  await expect
    .poll(
      async () => {
        await kick(request);
        return sql(
          `select count(*)::int as n from public.fee_refunds where request_id = '${twice}' and kind = 'late' and status = 'done';`,
        )[0];
      },
      { timeout: 60_000, intervals: [1000, 2000] },
    )
    .toEqual({ n: 1 });
  await page.reload();
  await expect(page.getByText(m(locale, 'Payment.secondRefunded'))).toBeVisible();

  // A commission of 0 (D171, R-4): Continue, no card page, no fee row.
  await page.goto(`/${locale}/requests/${zero}`);
  await page.getByRole('button', { name: m(locale, 'Requests.next.continue') }).click();
  await expect(page.locator('#paid-title')).toHaveText(m(locale, 'Requests.next.paidTitle'), {
    timeout: 20_000,
  });
  await expect(page.getByRole('link', { name: m(locale, 'Requests.next.receipt') })).toHaveCount(0);
  expect(sql(`select count(*)::int as n from public.fee_payments where request_id = '${zero}';`)[0]).toEqual({
    n: 0,
  });

  // A cancel while the card page is open (AC-2): refused with its message.
  await pressPay(page, locale, open);
  // Let the pay page finish leaving for the card page, so the next navigation is not cut.
  await toCardPage(page, request, locale);
  await page.goto(`/${locale}/requests/${open}`);
  await page.getByRole('button', { name: m(locale, 'Requests.detail.cancel') }).click();
  const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'));
  await dialog.getByRole('button', { name: m(locale, 'Requests.cancel.confirm') }).click();
  await expect(page.getByText(m(locale, 'Requests.errors.checkout_open'))).toBeVisible();
  expect(sql(`select status from public.requests where id = '${open}';`)[0]).toEqual({ status: 'SELECTED' });
});

test('a failure then a retry, a slow payment, a late payment, and payments paused', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(480_000);
  const locale = testInfo.project.name;
  seed(locale);
  await customer(page, locale, 'payCustomerB', 'Ödeme ikinci');
  const retried = chosenRequest(locale, 'payCustomerB', '5', 30000);
  const slow = chosenRequest(locale, 'payCustomerB', '6', 30000);
  const late = chosenRequest(locale, 'payCustomerB', '7', 30000);
  const paused = chosenRequest(locale, 'payCustomerB', '8', 30000);

  // A failure, then Try again opens a new attempt that succeeds (AC-12, AC-11).
  const failed = await pressPay(page, locale, retried);
  await toCardPage(page, request, locale);
  await chooseAndReturn(page, locale, 'failure', failed);
  await untilTitle(page, request, m(locale, 'Payment.failedTitle'));
  await axe(page);
  const retry = await toPayPage(page, locale, retried, () =>
    page.getByRole('button', { name: m(locale, 'Payment.tryAgain') }).click(),
  );
  expect(retry).not.toBe(failed);
  await toCardPage(page, request, locale);
  await chooseAndReturn(page, locale, 'success', retry);
  await untilTitle(page, request, m(locale, 'Payment.successTitle'));

  // Slow: pending at the PSP, the page keeps waiting, then paid.
  const pending = await pressPay(page, locale, slow);
  await toCardPage(page, request, locale);
  await chooseAndReturn(page, locale, 'pending', pending);
  await kick(request);
  await expect(page.locator('#checkout-title')).toHaveText(m(locale, 'Payment.pendingTitle'));
  for (let n = 0; n < 3; n += 1) queueVerify(pending);
  await untilTitle(page, request, m(locale, 'Payment.successTitle'));

  // Late: the window closes while the card page is open; the payment is refunded and the page says so (AC-5, AC-8).
  const lateAttempt = await pressPay(page, locale, late);
  await toCardPage(page, request, locale);
  script(
    `alter table public.requests disable trigger requests_guard;` +
      ` update public.requests set selected_at = now() - interval '2 days', payment_deadline = now() - interval '1 hour' where id = '${late}';` +
      ` alter table public.requests enable trigger requests_guard;`,
  );
  await chooseAndReturn(page, locale, 'success', lateAttempt);
  await untilTitle(page, request, m(locale, 'Payment.lateTitle'));
  await expect(page.getByText(m(locale, 'Payment.lateBody'))).toBeVisible();
  await axe(page);
  expect(
    sql(`select status, failure_reason from public.checkout_attempts where id = '${lateAttempt}';`)[0],
  ).toEqual({ status: 'failed', failure_reason: 'late_payment' });

  // Paused: the relay fails the attempt payments_disabled; the pay page says payments are paused.
  const pausedAttempt = await pressPay(page, locale, paused);
  sql(`select public.mark_checkout_failed('${pausedAttempt}', 'payments_disabled');`);
  await page.reload();
  await expect(page.getByText(m(locale, 'Requests.errors.payments_disabled'))).toBeVisible({
    timeout: 20_000,
  });
  await axe(page);
});
