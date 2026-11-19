import { describe, expect, it } from 'vitest';

import { ANALYTICS_EVENTS, type AnalyticsEvents } from '@/lib/analytics/events';
import { filterAnalyticsEvent, withoutIds } from '@/lib/analytics/filter';

/**
 * Spec 0004 AC-3, AC-6, AC-7 (D68): PostHog sends only the allow listed events, each with its typed
 * properties, scrubbed URLs and `app_env`, and nothing that names a person. The runtime allow list in
 * before_send drops every other name, including events the SDK generates on its own.
 */

function captured(event: string, properties: Record<string, unknown>) {
  return { uuid: '0192d1a4-7b1e-7c1a-9b5a-1f2e3d4c5b6a', event, properties, timestamp: new Date(0) };
}

const SDK_PROPS = {
  token: 'phc_test',
  distinct_id: '$posthog_cookieless',
  $lib: 'web',
  $lib_version: '1.418.11',
  $browser: 'Chrome',
  $os: 'Android',
  $device_type: 'Mobile',
  $cookieless_mode: true,
  $insert_id: 'abc123',
  $time: 1730120000,
};

describe('the allow list (AC-7)', () => {
  it('names exactly the 00b events, the sign in events of spec 0005 and the onboarding events of spec 0006, request_posted of spec 0008, and the two of spec 0009', () => {
    expect([...ANALYTICS_EVENTS].sort()).toEqual([
      '$pageview',
      'application_submitted',
      'code_limited',
      'code_requested',
      'code_verified',
      'contacts_unlocked',
      'document_upload_failed',
      'job_confirmed',
      'job_done',
      'job_started',
      'locale_changed',
      'onboarding_completed',
      'payment_started',
      'payment_succeeded',
      'phone_rejected',
      'provider_chosen',
      'provider_decided',
      'provider_file_submitted',
      'provider_setup_saved',
      'request_posted',
    ]);
  });

  it.each([
    '$autocapture',
    '$pageleave',
    '$exception',
    '$web_vitals',
    '$dead_click',
    '$rageclick',
    '$identify',
    '$set',
    'survey shown',
    'signup',
  ])('drops %s', (name) => {
    expect(filterAnalyticsEvent(captured(name, { ...SDK_PROPS }), 'preview')).toBeNull();
  });

  it('rejects any other event name at build time', () => {
    // @ts-expect-error: 'signup' is not in the AnalyticsEvent union.
    const name: keyof AnalyticsEvents = 'signup';
    expect(name).toBe('signup');
  });
});

describe('what an allowed event carries (AC-3, AC-6)', () => {
  it('a custom event carries no record id in any URL property (spec 0010, found by the 06 e2e)', () => {
    const id = '00000000-0000-4000-8000-0006000e1001';
    const out = filterAnalyticsEvent(
      captured('provider_chosen', {
        ...SDK_PROPS,
        $current_url: `https://aldebyani.test/ar/requests/${id}?after=x`,
        $pathname: `/ar/requests/${id}`,
        $referrer: `https://aldebyani.test/tr/provider/feed/${id}/`,
      }),
      'preview',
    );
    expect(JSON.stringify(out)).not.toContain(id);
    expect(out?.properties.$pathname).toBe('/ar/requests/[id]');
  });

  it("drops the SDK's own page ids, so no event carries an id shaped value", () => {
    const out = filterAnalyticsEvent(
      captured('contacts_unlocked', {
        ...SDK_PROPS,
        side: 'customer',
        $pageview_id: '01a1f48d-06fd-7e8c-8176-7d61ce1b276a',
        $prev_pageview_id: '01a1f48d-06fd-7e8c-8176-7d61ce1b2700',
      }),
      'preview',
    );
    expect(out?.properties).not.toHaveProperty('$pageview_id');
    expect(out?.properties).not.toHaveProperty('$prev_pageview_id');
    expect(JSON.stringify(out?.properties)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect(out?.properties.side).toBe('customer');
  });

  it('a payment event carries only which fee, and no attempt id from the pay pages (spec 0011-09 AC-14)', () => {
    const id = '00000000-0000-4000-8000-0009000a1001';
    const out = filterAnalyticsEvent(
      captured('payment_succeeded', {
        ...SDK_PROPS,
        fee: 'commission',
        attempt_id: id,
        $current_url: `https://aldebyani.test/tr/pay/${id}/return`,
        $pathname: `/tr/pay/${id}/return`,
      }),
      'preview',
    );
    expect(JSON.stringify(out)).not.toContain(id);
    expect(out?.properties.fee).toBe('commission');
    expect(out?.properties).not.toHaveProperty('attempt_id');
  });

  it('a pageview: SDK $ properties, scrubbed URLs, app_env, nothing else', () => {
    const out = filterAnalyticsEvent(
      captured('$pageview', {
        ...SDK_PROPS,
        $current_url: 'https://aldebyani.test/tr/auth/callback?code=abc&page=2#access_token=zzz',
        $pathname: '/tr/auth/callback',
        $referrer: 'https://mail.example/?email=ali%40example.com',
        $initial_current_url: 'https://aldebyani.test/tr?token=t0k',
        $set: { email: 'ali@example.com' },
        $set_once: { $initial_referrer: 'x' },
        utm_source: 'newsletter',
        gclid: 'g123',
        email: 'ali@example.com',
      }),
      'preview',
    );
    expect(out?.event).toBe('$pageview');
    expect(out?.properties).toEqual({
      ...SDK_PROPS,
      $current_url: 'https://aldebyani.test/tr/auth/callback?page=2',
      $pathname: '/tr/auth/callback',
      $referrer: 'https://mail.example/',
      $initial_current_url: 'https://aldebyani.test/tr',
      app_env: 'preview',
      $geoip_disable: true,
    });
  });

  it('drops the person fields the SDK sets beside the properties, and asks PostHog for no location', () => {
    const out = filterAnalyticsEvent(
      {
        ...captured('$pageview', { ...SDK_PROPS }),
        $set: { email: 'ali@example.com' },
        $set_once: { name: 'Ali' },
        $unset: ['x'],
      },
      'production',
    );
    expect(out).not.toHaveProperty('$set');
    expect(out).not.toHaveProperty('$set_once');
    expect(out).not.toHaveProperty('$unset');
    expect(out?.properties.$geoip_disable).toBe(true);
  });

  it('locale_changed keeps its two typed properties', () => {
    const out = filterAnalyticsEvent(
      captured('locale_changed', { ...SDK_PROPS, from_locale: 'ar', to_locale: 'tr', name: 'Ali' }),
      'production',
    );
    expect(out?.properties).toEqual({
      ...SDK_PROPS,
      from_locale: 'ar',
      to_locale: 'tr',
      app_env: 'production',
      $geoip_disable: true,
    });
  });

  it('fails closed: an event it cannot read is dropped', () => {
    const hostile = {
      event: '$pageview',
      get properties(): Record<string, unknown> {
        throw new Error('boom');
      },
    };
    expect(filterAnalyticsEvent(hostile, 'local')).toBeNull();
    expect(filterAnalyticsEvent(null, 'local')).toBeNull();
  });
});

describe('spec 0011-08 S7: the fake card page path loses its token', () => {
  it('replaces the token segment in a path or a URL', () => {
    expect(withoutIds('/tr/dev/fake-checkout/fk1_abc_def')).toBe('/tr/dev/fake-checkout/[token]');
    expect(withoutIds('http://localhost:3100/en/dev/fake-checkout/fk1_x?chosen=success')).toBe(
      'http://localhost:3100/en/dev/fake-checkout/[token]?chosen=success',
    );
  });
});
