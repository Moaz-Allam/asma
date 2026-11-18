'use client';

import { useEffect } from 'react';

import { track } from '@/lib/analytics/client';

/**
 * `contacts_unlocked` once per side and request in this browser session (spec 0011-10 AC-13). The event carries
 * the side only; the request id stays in session storage as the "already sent" mark and never leaves the device.
 */
export function ContactsSeen({ side, requestId }: { side: 'customer' | 'provider'; requestId: string }) {
  useEffect(() => {
    const key = `contacts_unlocked:${requestId}`;
    try {
      if (window.sessionStorage.getItem(key)) return;
      window.sessionStorage.setItem(key, '1');
    } catch {
      // Without storage the event may repeat on a reload; it carries no id either way.
    }
    track('contacts_unlocked', { side });
  }, [side, requestId]);
  return null;
}
