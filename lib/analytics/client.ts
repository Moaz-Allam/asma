import posthog, { type CaptureResult, type PostHogConfig } from 'posthog-js';

import type { AnalyticsEvent, AnalyticsEvents } from '@/lib/analytics/events';
import { filterAnalyticsEvent } from '@/lib/analytics/filter';
import { afterHydration } from '@/lib/browser/after-hydration';
import { scrubUrl } from '@/lib/observability/scrub';
import { appEnvOf } from '@/lib/observability/shared';

/**
 * The PostHog door (spec 0004 AC-6, AC-7, AC-8; D68). Only lib/analytics imports `posthog-*`;
 * `instrumentation-client.ts` and `LocaleSwitcher` call the functions below.
 *
 * Cookieless and anonymous: nothing is written to a cookie, localStorage or sessionStorage, nobody is
 * ever identified, and every optional feature is off by an explicit option, so a project setting can
 * never switch one on remotely. Every function does nothing without a key or under test, and swallows
 * its own failures.
 */

// Inlined by Next at build: the project key is public by design.
const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const APP_ENV = appEnvOf(process.env.NEXT_PUBLIC_APP_ENV);

const CONFIG: Partial<PostHogConfig> = {
  // Same origin through the /api/a rewrites (next.config.ts), so a tracker blocker loses nothing; the
  // UI links point at EU Cloud (D62).
  api_host: '/api/a',
  ui_host: 'https://eu.posthog.com',
  // No consent banner: nothing stored on the device, nobody identified (legal confirmation, S16).
  cookieless_mode: 'always',
  persistence: 'memory',
  person_profiles: 'never',
  // Pageviews are sent manually with a scrubbed URL; nothing else is captured on its own.
  capture_pageview: false,
  capture_pageleave: false,
  autocapture: false,
  capture_heatmaps: false,
  capture_dead_clicks: false,
  capture_exceptions: false,
  capture_performance: false,
  disable_session_recording: true,
  disable_surveys: true,
  disable_product_tours: true,
  disable_conversations: true,
  disable_web_experiments: true,
  // No remote config and no feature flags, so the project settings cannot turn a feature back on, and
  // no script is ever loaded from PostHog.
  advanced_disable_flags: true,
  disable_external_dependency_loading: true,
  // URL hygiene before our own scrub in before_send: no fragments, no personal data parameters.
  disable_capture_url_hashes: true,
  mask_personal_data_properties: true,
  // The client IP: posthog-js has no client option for it any more (`ip` is a no op); the project
  // setting "Discard client IP data" is on (D68).
  before_send: (event: CaptureResult | null) => filterAnalyticsEvent(event, APP_ENV),
  debug: false,
};

let started = false;

function inactive(): boolean {
  return !KEY || process.env.NODE_ENV === 'test';
}

/** Starts PostHog after hydration (AC-6), then sends the first pageview. */
export function initAnalytics(): void {
  if (started || inactive() || !KEY) return;
  const key = KEY;
  afterHydration(() => {
    try {
      posthog.init(key, CONFIG);
      started = true;
      trackPageview(window.location.href);
    } catch (error) {
      // Analytics never breaks the page; the console says why it is off.
      console.warn('[analytics] PostHog did not start', error instanceof Error ? error.message : 'unknown');
    }
  });
}

/**
 * Sends one allow listed event with its typed properties (AC-7). `leaving`: a full page load follows, so
 * the event goes now, as a beacon that outlives the page, instead of waiting for the next batch.
 */
export function track<E extends AnalyticsEvent>(
  event: E,
  properties: AnalyticsEvents[E],
  options?: { leaving: boolean },
): void {
  if (!started) return;
  try {
    posthog.capture(
      event,
      properties,
      options?.leaving ? { send_instantly: true, transport: 'sendBeacon' } : undefined,
    );
  } catch (error) {
    // Analytics never breaks the page; the console says why an event was lost.
    console.warn('[analytics] event not captured', error instanceof Error ? error.message : 'unknown');
  }
}

/** One `$pageview` per page, its URL scrubbed (AC-3). Called on start and on every route change. */
export function trackPageview(href: string): void {
  if (!started) return;
  try {
    const url = new URL(scrubUrl(href), window.location.origin);
    track('$pageview', { $current_url: url.href, $pathname: url.pathname });
  } catch (error) {
    // A pageview that cannot be read is lost, but never silently.
    console.warn('[analytics] pageview not captured', error instanceof Error ? error.message : 'unknown');
  }
}
