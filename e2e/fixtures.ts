import { test as base, type Request } from '@playwright/test';
import { gunzipSync } from 'node:zlib';

/**
 * Every journey runs with both telemetry SDKs on (dummy keys from scripts/e2e.mjs) and both telemetry
 * paths stubbed in the browser, so nothing ever leaves the origin (spec 0004 AC-2, AC-6). The fixture
 * records what reached each stub, every request to another origin, and every CSP violation.
 *
 * Two origins are expected since spec 0005 (AC-24). The browser talks to the local Supabase Auth directly
 * (D98), and Cloudflare's script is stubbed here, so no journey depends on Cloudflare. The stub answers
 * with a fresh token after every render and reset, as the real widget does.
 */

const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';
const SUPABASE_ORIGIN = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54421';

const TURNSTILE_STUB = `(() => {
  let callback = () => undefined;
  let count = 0;
  const issue = () => setTimeout(() => callback('e2e-token-' + (count += 1)));
  window.turnstile = {
    render(element, options) { callback = options.callback; issue(); return 'e2e-widget'; },
    reset() { issue(); },
    remove() {},
  };
})();`;

declare global {
  interface Window {
    __cspViolations?: string[];
  }
}

export type PostHogEvent = { event: string; properties: Record<string, unknown> };

export type Telemetry = {
  /** Raw Sentry envelopes posted to the /api/e tunnel. */
  sentry: string[];
  /** Events posted to the /api/a relay, decoded. */
  posthog: PostHogEvent[];
  /** The same calls as the SDK sent them, for the relay's own parser: the stub hides the handler. */
  posthogCalls: Array<{ body: Buffer; compression: string | null }>;
  /** Requests to any other origin (blob: and data: aside). */
  offOrigin: string[];
  cspViolations: () => Promise<string[]>;
};

function isEvent(value: unknown): value is PostHogEvent {
  return typeof value === 'object' && value !== null && 'event' in value && 'properties' in value;
}

/** posthog-js posts gzip by default; the payload is one event, an array, or a `batch`. */
function decodePostHog(request: Request): PostHogEvent[] {
  const buffer = request.postDataBuffer();
  if (!buffer) return [];
  let text: string;
  try {
    text = gunzipSync(buffer).toString('utf8');
  } catch {
    text = buffer.toString('utf8');
  }
  try {
    const parsed: unknown = JSON.parse(text);
    const items = Array.isArray(parsed)
      ? parsed
      : typeof parsed === 'object' && parsed !== null && 'batch' in parsed && Array.isArray(parsed.batch)
        ? parsed.batch
        : [parsed];
    return items.filter(isEvent);
  } catch {
    return [];
  }
}

export const test = base.extend<{ telemetry: Telemetry }>({
  telemetry: [
    async ({ page, baseURL }, use) => {
      const origin = new URL(baseURL ?? 'http://127.0.0.1').origin;
      const telemetry: Telemetry = {
        sentry: [],
        posthog: [],
        posthogCalls: [],
        offOrigin: [],
        cspViolations: () => page.evaluate(() => window.__cspViolations ?? []),
      };

      page.on('request', (request) => {
        const url = request.url();
        const expected = [origin, SUPABASE_ORIGIN, TURNSTILE_ORIGIN, 'blob:', 'data:'];
        if (!expected.some((start) => url.startsWith(start))) telemetry.offOrigin.push(url);
      });
      await page.addInitScript(() => {
        // posthog-js drops every event from what looks like a bot (right in production): navigator.webdriver
        // set, or a "HeadlessChrome" brand in userAgentData. The journeys hide both, so the real
        // production config is what gets tested.
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        Object.defineProperty(navigator, 'userAgentData', { get: () => undefined });
        window.__cspViolations = [];
        document.addEventListener('securitypolicyviolation', (event) => {
          window.__cspViolations?.push(`${event.violatedDirective} ${event.blockedURI}`);
        });
      });
      await page.route(`${TURNSTILE_ORIGIN}/**`, (route) =>
        route.fulfill({ status: 200, contentType: 'text/javascript', body: TURNSTILE_STUB }),
      );
      await page.route(
        (url) => url.pathname === '/api/e',
        async (route) => {
          telemetry.sentry.push(route.request().postData() ?? '');
          await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        },
      );
      await page.route(
        (url) => url.pathname.startsWith('/api/a/'),
        async (route) => {
          const request = route.request();
          telemetry.posthog.push(...decodePostHog(request));
          const body = request.postDataBuffer();
          if (body) {
            const compression = new URL(request.url()).searchParams.get('compression');
            telemetry.posthogCalls.push({ body, compression });
          }
          await route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":1}' });
        },
      );

      await use(telemetry);
    },
    { auto: true },
  ],
});

export { TURNSTILE_STUB };
export { expect } from '@playwright/test';
