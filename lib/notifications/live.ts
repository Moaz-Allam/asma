'use client';

import { useEffect, useRef } from 'react';

import { createSupabaseBrowser } from '@/lib/db/client';

/**
 * Live pings (spec 0011-18 R-9, AC-10, X-4). One private channel per tab, `notices:<own id>`, which only that user can
 * join (RLS on `realtime.messages`). A ping carries nothing; `onPing` asks the server for the truth. The id comes from
 * the server's session read, passed down as a prop. `realtime.setAuth()` with no argument reads the cookie session
 * inside supabase-js. If Realtime cannot connect, nothing is shown: the count stays right on each navigation.
 */

export const PING_DEBOUNCE_MS = 500;

export function useNoticePings(userId: string, onPing: () => void): void {
  const latest = useRef(onPing);
  useEffect(() => {
    latest.current = onPing;
  }, [onPing]);

  useEffect(() => {
    let supabase: ReturnType<typeof createSupabaseBrowser>;
    try {
      supabase = createSupabaseBrowser();
    } catch {
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    const channel = supabase
      .channel(`notices:${userId}`, { config: { private: true } })
      .on('broadcast', { event: 'notice' }, () => {
        clearTimeout(timer);
        timer = setTimeout(() => latest.current(), PING_DEBOUNCE_MS);
      });

    void (async () => {
      try {
        await supabase.realtime.setAuth();
        if (!closed) channel.subscribe();
      } catch {
        // Realtime is a nicety here (AC-10): the page still works without it.
      }
    })();

    return () => {
      closed = true;
      clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [userId]);
}
