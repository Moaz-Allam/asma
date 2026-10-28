import type { AppEnv } from '@/lib/deployment';
import { ANALYTICS_EVENTS, EVENT_PROPERTIES, type AnalyticsEvent } from '@/lib/analytics/events';
import { scrubUrl } from '@/lib/observability/scrub';

/**
 * PostHog's `before_send` (spec 0004 AC-3, AC-6, AC-7). No SDK import, so it is tested on its own.
 *
 * Only allow listed events pass, whatever generated them. Each keeps the SDK's own `$` properties (with
 * every URL among them scrubbed), the two fields the SDK needs (`token`, `distinct_id`), its own typed
 * properties, and `app_env`. Person properties (`$set`, `$set_once`), campaign parameters and anything
 * else are dropped. A failure drops the event.
 */

type Captured = { event: string; properties: Record<string, unknown> };

const SDK_FIELDS: ReadonlySet<string> = new Set(['token', 'distinct_id']);
const PERSON_PROPERTIES: ReadonlySet<string> = new Set(['$set', '$set_once']);

function isUrlProperty(key: string): boolean {
  return /url|referrer|pathname/i.test(key);
}

export function filterAnalyticsEvent<T extends Captured>(event: T | null, appEnv: AppEnv): T | null {
  if (event === null) return null;
  try {
    if (!ANALYTICS_EVENTS.has(event.event)) return null;
    const typed = new Set(EVENT_PROPERTIES[event.event as AnalyticsEvent]);
    const properties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(event.properties)) {
      if (PERSON_PROPERTIES.has(key)) continue;
      if (!key.startsWith('$') && !SDK_FIELDS.has(key) && !typed.has(key)) continue;
      properties[key] = typeof value === 'string' && isUrlProperty(key) ? scrubUrl(value) : value;
    }
    properties.app_env = appEnv;
    return { ...event, properties };
  } catch {
    return null;
  }
}
