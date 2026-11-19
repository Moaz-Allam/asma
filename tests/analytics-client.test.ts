import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Spec 0004 AC-6, AC-7: PostHog starts only after hydration, so an event fired before it starts waits in a bounded
 * queue and goes once it does (found by 09's e2e, 2026-11-19: Pay pressed, and the return page's first sight of a
 * paid fee, both came before the SDK and were lost).
 */

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  init: vi.fn(),
  start: undefined as (() => void) | undefined,
}));
vi.mock('posthog-js', () => ({ default: { init: mocks.init, capture: mocks.capture } }));
vi.mock('@/lib/browser/after-hydration', () => ({
  afterHydration: (task: () => void) => {
    mocks.start = task;
  },
}));

async function load() {
  vi.resetModules();
  return import('@/lib/analytics/client');
}

/** Runs the hydration task and waits for its dynamic import of posthog-js. */
async function start() {
  mocks.start?.();
  await vi.waitFor(() => expect(mocks.init).toHaveBeenCalled());
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  mocks.capture.mockClear();
  mocks.init.mockClear();
  mocks.start = undefined;
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test0000000000000000000000000');
  vi.stubGlobal('window', {
    location: { href: 'https://aldebyani.test/tr/requests', origin: 'https://aldebyani.test' },
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('events fired before PostHog starts', () => {
  it('wait, then go after the first pageview, a leaving one as a beacon', async () => {
    const { initAnalytics, track } = await load();
    track('payment_started', { fee: 'commission' }, { leaving: true });
    track('provider_chosen', {});
    initAnalytics();
    expect(mocks.capture).not.toHaveBeenCalled();
    await start();
    expect(mocks.capture.mock.calls.map(([event]) => event)).toEqual([
      '$pageview',
      'payment_started',
      'provider_chosen',
    ]);
    expect(mocks.capture).toHaveBeenCalledWith(
      'payment_started',
      { fee: 'commission' },
      { send_instantly: true, transport: 'sendBeacon' },
    );
    expect(mocks.capture).toHaveBeenCalledWith('provider_chosen', {}, undefined);
  });

  it('wait at most PENDING_LIMIT events', async () => {
    const { initAnalytics, track, PENDING_LIMIT } = await load();
    for (let i = 0; i < PENDING_LIMIT + 5; i += 1) track('provider_chosen', {});
    initAnalytics();
    await start();
    expect(mocks.capture.mock.calls.filter(([event]) => event === 'provider_chosen')).toHaveLength(
      PENDING_LIMIT,
    );
  });

  it('go at once after PostHog started, and never queue a second time', async () => {
    const { initAnalytics, track } = await load();
    initAnalytics();
    await start();
    mocks.capture.mockClear();
    track('payment_succeeded', { fee: 'provider_fee' });
    expect(mocks.capture).toHaveBeenCalledWith('payment_succeeded', { fee: 'provider_fee' }, undefined);
    expect(mocks.capture).toHaveBeenCalledTimes(1);
  });

  it('are dropped, not queued, when analytics is off (no key)', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', '');
    const { initAnalytics, track } = await load();
    track('provider_chosen', {});
    initAnalytics();
    expect(mocks.start).toBeUndefined();
    expect(mocks.capture).not.toHaveBeenCalled();
  });
});
