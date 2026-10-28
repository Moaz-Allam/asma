import { initAnalytics, trackPageview } from '@/lib/analytics/client';
import { initClient, routerTransitionStart } from '@/lib/observability/client';

/**
 * Runs in the browser after the HTML loads and before React hydrates (Next.js file convention).
 *
 * It only calls door functions: Sentry is imported in lib/observability alone and PostHog in
 * lib/analytics alone (spec 0004 AC-8). Each door swallows its own failures, so nothing here can stop
 * the page from hydrating. Sentry starts now; PostHog and Sentry Replay wait until after hydration.
 */
initClient();
initAnalytics();

export function onRouterTransitionStart(url: string, navigationType: 'push' | 'replace' | 'traverse') {
  routerTransitionStart(url, navigationType);
  trackPageview(url);
}
