/**
 * Settings both Sentry runtimes share (spec 0004). No SDK import: the browser door and the server door
 * each import only their own SDK entry, and both read these values from one place.
 */
import type { AppEnv } from '@/lib/deployment';

/**
 * The same origin path browser reports travel through (AC-2): the browser SDK's `tunnel`, served by our
 * own Route Handler, which forwards only our envelopes to the EU ingest (app/api/e, D83).
 */
export const SENTRY_TUNNEL_ROUTE = '/api/e';

export function appEnvOf(value: string | undefined): AppEnv {
  return value === 'production' || value === 'preview' ? value : 'local';
}

/** 10% of traces in production, every trace on a preview, none locally (D67). */
export function tracesSampleRate(environment: AppEnv): number {
  if (environment === 'production') return 0.1;
  if (environment === 'preview') return 1;
  return 0;
}

/** The telemetry paths: Sentry's tunnel, PostHog's relay and the CSP reports never get a span (AC-2). */
export function isTelemetryPath(url: string): boolean {
  return /^(?:https?:\/\/[^/]+)?\/api\/(?:e|a|csp)(?:[/?#]|$)/.test(url);
}

/** The same paths as span and transaction names, such as `POST /api/e` or `POST /api/a/[...path]`. */
export const TELEMETRY_SPAN_NAMES: RegExp[] = [/\/api\/(?:e|a|csp)(?:[/?#\s]|$)/];

/**
 * Known noise from browser extensions and injected scripts (AC-21), after Sentry's own declutter list.
 * Sentry's inbound filters (extensions, localhost, legacy browsers) are dashboard settings on top.
 */
export const IGNORE_ERRORS: (string | RegExp)[] = [
  'top.GLOBALS',
  'originalCreateNotification',
  'canvas.contentDocument',
  'MyApp_RemoveAllHighlights',
  "Can't find variable: ZiteReader",
  'jigsaw is not defined',
  'ComboSearch is not defined',
  'atomicFindClose',
  'fb_xd_fragment',
  'bmi_SafeAddOnload',
  'EBCallBackMessageReceived',
  'conduitPage',
  /^Non-Error promise rejection captured with value: Object Not Found Matching Id/,
];

/** Errors whose frames come from an extension, not from our code (AC-21). */
export const DENY_URLS: RegExp[] = [
  /^(?:chrome|chrome-extension|moz-extension|safari-extension|safari-web-extension|ms-browser-extension):\/\//i,
  /^webkit-masked-url:\/\//i,
  /\/extensions\//i,
];
