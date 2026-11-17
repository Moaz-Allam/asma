import { describe, expect, it } from 'vitest';

import { ANALYTICS_EVENTS, type AnalyticsEvents } from '@/lib/analytics/events';
import { filterAnalyticsEvent } from '@/lib/analytics/filter';

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
      'document_upload_failed',
      'locale_changed',
      'onboarding_completed',
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
