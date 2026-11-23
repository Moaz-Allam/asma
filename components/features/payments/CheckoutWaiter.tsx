'use client';

import { CircleCheck, CircleX, LoaderCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, useTransition } from 'react';

import { checkoutStatusAction, payCommissionAction, payProviderFeeAction } from '@/actions/payments';
import { Button } from '@/components/ui/button';
import { track } from '@/lib/analytics/client';
import { Link, useRouter } from '@/lib/i18n/navigation';
import { FINAL_VIEWS, viewOf, type CheckoutMode, type CheckoutView } from '@/lib/payments/checkout-view';
import type { CheckoutStatus } from '@/lib/requests/schemas';

/**
 * The pay page and the return page (ui-registry `CheckoutWaiter`, spec 0011-09 AC-11, AC-12, R-3, R-11). Both
 * poll the payer's own attempt and show only what the relay verified: a redirect back from the card page never
 * shows a paid state by itself.
 *
 * - `open` (the pay page): every second for up to 15 seconds; a card page URL replaces this page in the history,
 *   so Back never lands on a page that bounces to the card page again.
 * - `return` (the callback lands here): every 2 seconds for up to 2 minutes, then a Refresh.
 */

type Mode = CheckoutMode;
type View = CheckoutView;

const TIMING: Record<Mode, { every: number; limit: number }> = {
  open: { every: 1000, limit: 15_000 },
  return: { every: 2000, limit: 120_000 },
};

const FINAL = FINAL_VIEWS;

export function CheckoutWaiter({
  mode,
  initial,
  receiptHref,
  canRetry,
  agreementVersion = null,
}: {
  mode: Mode;
  initial: CheckoutStatus;
  receiptHref: string | null;
  canRetry: boolean;
  /** Spec 0011-20 AC-2, AC-3: the version the payer accepted, sent again by Try again. */
  agreementVersion?: string | null;
}) {
  const t = useTranslations('Payment');
  const tr = useTranslations('Requests');
  const router = useRouter();
  const [status, setStatus] = useState(initial);
  const [timedOut, setTimedOut] = useState(false);
  const [round, setRound] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const left = useRef(false);
  const view = viewOf(mode, status, timedOut);
  // Spec 0011-10 AC-9, R-7: back to the request for a commission, to My jobs for a provider fee.
  const requestHref =
    status.fee_kind === 'commission'
      ? `/requests/${status.request_id}`
      : `/provider/applications?tab=${status.fee_status === 'paid' ? 'active' : 'chosen'}`;

  // Poll until a final view or the time limit; a new round restarts it.
  useEffect(() => {
    if (FINAL.includes(viewOf(mode, status, false))) return;
    const { every, limit } = TIMING[mode];
    const startedAt = Date.now();
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (stopped) return;
      if (Date.now() - startedAt >= limit) {
        setTimedOut(true);
        return;
      }
      try {
        const result = await checkoutStatusAction({ attemptId: status.attempt_id });
        if (stopped) return;
        if (result.success) {
          setStatus(result.data);
          if (FINAL.includes(viewOf(mode, result.data, false))) return;
          if (mode === 'open' && result.data.url) return;
        }
      } catch {
        // A dropped poll is tried again on the next tick.
      }
      timer = setTimeout(tick, every);
    };
    timer = setTimeout(tick, every);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
    // Only a new round or a new attempt restarts the poll; each tick reads the latest answer itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round, status.attempt_id, mode]);

  // The card page replaces the pay page (AC-11).
  useEffect(() => {
    if (mode === 'open' && view === 'waiting' && status.url && !left.current) {
      left.current = true;
      window.location.replace(status.url);
    }
  }, [mode, view, status.url]);

  // The receipt link comes from the server render (review F1): when the poll turns the page to success, ask
  // the server once for the link, keeping this component's state.
  const askedReceipt = useRef(false);
  useEffect(() => {
    if (view !== 'success' || receiptHref || askedReceipt.current) return;
    askedReceipt.current = true;
    router.refresh();
  }, [view, receiptHref, router]);

  // Once per attempt, the first time the return page sees the fee paid (AC-14).
  useEffect(() => {
    if (mode !== 'return' || view !== 'success') return;
    const key = `payment_succeeded:${status.attempt_id}`;
    try {
      if (window.sessionStorage.getItem(key)) return;
      window.sessionStorage.setItem(key, '1');
    } catch {
      // Without storage the event may repeat on a reload; it carries no id either way.
    }
    track('payment_succeeded', { fee: status.fee_kind });
  }, [mode, view, status.attempt_id, status.fee_kind]);

  function again() {
    setError(null);
    start(async () => {
      let result: Awaited<ReturnType<typeof payCommissionAction>>;
      try {
        // Spec 0011-10 AC-9 (R14): Try again pays the fee this attempt was for.
        result =
          agreementVersion === null
            ? { success: false as const, error: 'agreement_required' }
            : status.fee_kind === 'provider_fee' && status.application_id
              ? await payProviderFeeAction({ applicationId: status.application_id, agreementVersion })
              : await payCommissionAction({ requestId: status.request_id, agreementVersion });
      } catch {
        result = { success: false, error: 'action_failed' };
      }
      if (!result.success) {
        setError(tr(`errors.${result.error}` as 'errors.action_failed'));
        return;
      }
      if (result.data.status === 'settled') {
        router.replace(requestHref);
        return;
      }
      if (!result.data.reused) track('payment_started', { fee: status.fee_kind }, { leaving: true });
      if (result.data.attemptId === status.attempt_id) {
        setTimedOut(false);
        setRound((r) => r + 1);
        return;
      }
      router.replace(`/pay/${result.data.attemptId}`);
    });
  }

  function refresh() {
    setTimedOut(false);
    setRound((r) => r + 1);
  }

  const waiting = view === 'waiting';
  const title =
    view === 'success'
      ? t('successTitle')
      : view === 'late' || view === 'refunded'
        ? t('lateTitle')
        : view === 'failed' || view === 'openFailed' || view === 'paused'
          ? t('failedTitle')
          : mode === 'open' && view !== 'pendingLong'
            ? t('opening')
            : t('pendingTitle');
  const body: Record<View, string> = {
    waiting: mode === 'open' ? t('openingBody') : t('pendingBody'),
    slow: t('slow'),
    openFailed: t('openFailed'),
    paused: tr('errors.payments_disabled'),
    success: status.fee_kind === 'commission' ? t('successBody') : t('successBodyFee'),
    late: t('lateBody'),
    refunded: t('refundedBody'),
    failed: t('failedBody'),
    pendingLong: t('pendingLong'),
  };
  const retryable = view === 'slow' || view === 'openFailed' || view === 'paused' || view === 'failed';

  return (
    <section
      aria-labelledby="checkout-title"
      className="flex flex-col gap-4 rounded-panel border border-border-light bg-surface p-5 lg:p-7.5"
    >
      <div className="flex items-start gap-3">
        {view === 'success' ? (
          <CircleCheck aria-hidden className="mt-1 size-6 shrink-0 text-success" />
        ) : retryable || view === 'late' || view === 'refunded' ? (
          <CircleX aria-hidden className="mt-1 size-6 shrink-0 text-error" />
        ) : (
          <LoaderCircle
            aria-hidden
            className="mt-1 size-6 shrink-0 text-text-secondary motion-safe:animate-spin"
          />
        )}
        <h1 id="checkout-title" className="font-display text-title-s text-text-primary">
          {title}
        </h1>
      </div>
      <div role="status" aria-live="polite" className="flex flex-col gap-2">
        <p className="text-body text-text-primary">{body[view]}</p>
        {view === 'success' && status.late_refund ? (
          <p className="text-body-s text-text-secondary">{t('secondRefunded')}</p>
        ) : null}
        {retryable && !canRetry ? <p className="text-body-s text-text-secondary">{t('ended')}</p> : null}
      </div>
      {error ? (
        <p role="alert" className="rounded-block bg-error-light p-4 text-body-s text-error-foreground">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        {retryable && canRetry ? (
          <Button disabled={busy} onClick={again}>
            {t('tryAgain')}
          </Button>
        ) : null}
        {view === 'pendingLong' ? <Button onClick={refresh}>{t('refresh')}</Button> : null}
        {view === 'success' && receiptHref ? (
          <Button asChild>
            <Link href={receiptHref}>{t('toReceipt')}</Link>
          </Button>
        ) : null}
        {!waiting ? (
          <Button asChild variant="outline">
            <Link href={requestHref}>{status.fee_kind === 'commission' ? t('toRequest') : t('toJobs')}</Link>
          </Button>
        ) : null}
      </div>
    </section>
  );
}
