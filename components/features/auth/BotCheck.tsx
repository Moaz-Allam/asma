'use client';

import { useTranslations } from 'next-intl';
import Script from 'next/script';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { TURNSTILE_ORIGIN } from '@/lib/security/csp';

/**
 * The Turnstile widget (spec 0005 AC-4, AC-23, D98). Supabase Auth redeems the token, so nothing here
 * talks to siteverify and the app holds no secret. A token works once and lives 300 seconds: `attempt`
 * resets the widget after every send, and an expired token is dropped while the widget refreshes itself.
 * `interaction-only`: most people never see it. Explicit render, per `turnstile-spin`.
 */

type WidgetOptions = {
  sitekey: string;
  language: string;
  theme: 'light';
  size: 'flexible';
  appearance: 'interaction-only';
  'refresh-expired': 'auto';
  callback: (token: string) => void;
  'expired-callback': () => void;
  'timeout-callback': () => void;
  'error-callback': () => void;
};

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: WidgetOptions) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

type Props = {
  siteKey: string | undefined;
  nonce: string | undefined;
  locale: string;
  /** Goes up by one after each send. */
  attempt: number;
  onToken: (token: string | null) => void;
};

export function BotCheck({ siteKey, nonce, locale, attempt, onToken }: Props) {
  const t = useTranslations('Login');
  const container = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [loads, setLoads] = useState(0);

  const render = useCallback(() => {
    if (!siteKey || !container.current || !window.turnstile || widget.current !== null) return;
    widget.current = window.turnstile.render(container.current, {
      sitekey: siteKey,
      language: locale,
      theme: 'light',
      size: 'flexible',
      appearance: 'interaction-only',
      'refresh-expired': 'auto',
      callback: (token) => {
        setFailed(false);
        onToken(token);
      },
      'expired-callback': () => onToken(null),
      'timeout-callback': () => onToken(null),
      'error-callback': () => {
        onToken(null);
        setFailed(true);
      },
    });
  }, [siteKey, locale, onToken]);

  useEffect(() => {
    if (attempt === 0 || widget.current === null) return;
    onToken(null);
    window.turnstile?.reset(widget.current);
  }, [attempt, onToken]);

  useEffect(() => {
    render();
    return () => {
      if (widget.current !== null) window.turnstile?.remove(widget.current);
      widget.current = null;
    };
  }, [render]);

  function retry() {
    setFailed(false);
    if (widget.current !== null) window.turnstile?.reset(widget.current);
    else setLoads((count) => count + 1);
  }

  return (
    <div className="flex flex-col gap-2">
      {siteKey ? (
        <Script
          key={loads}
          src={`${TURNSTILE_ORIGIN}/turnstile/v0/api.js?render=explicit`}
          strategy="afterInteractive"
          nonce={nonce}
          onReady={render}
          onError={() => setFailed(true)}
        />
      ) : null}
      <div ref={container} />
      {failed || !siteKey ? (
        <div role="alert" className="flex flex-col gap-2 rounded-row bg-error-light px-4 py-3">
          <p className="text-body-s text-error">{t('errors.bot_unavailable')}</p>
          {siteKey ? (
            <Button variant="white" size="sm" onClick={retry} className="self-start">
              {t('botRetry')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
