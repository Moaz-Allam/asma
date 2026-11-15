'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import { useRouter } from '@/lib/i18n/navigation';
import type { ActionResult } from '@/lib/auth/action';
import { settle } from '@/lib/catalog/settle';

const KNOWN = new Set([
  'network',
  'validation_failed',
  'forbidden',
  'key_taken',
  'question_in_use',
  'stale_formula',
  'service_unavailable',
  'zone_unavailable',
  'addon_unavailable',
  'rate_limited',
]);

/**
 * Runs one admin action, then refreshes the page so every figure comes back from the server. A refusal
 * shows as a stable message from `CatalogErrors`; anything else reads as a plain failure.
 */
export function useCatalogAction() {
  const t = useTranslations('CatalogErrors');
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);

  function run<T>(call: () => Promise<ActionResult<T>>, onDone?: (data: T) => void) {
    setError(null);
    setCode(null);
    startTransition(async () => {
      // A dropped connection settles as `network`: the sheet stays open with what was typed.
      const result = await settle(call);
      if (result.success) {
        onDone?.(result.data);
        router.refresh();
        return;
      }
      setCode(result.error);
      setError(t(KNOWN.has(result.error) ? result.error : 'action_failed'));
    });
  }

  return { busy, error, code, run, clear: () => setError(null) };
}
