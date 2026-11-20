import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AdminReasonAction } from '@/components/features/admin/requests/AdminReasonAction';
import {
  AdminAddressButton,
  AdminCancelAction,
  AdminExtendAction,
} from '@/components/features/admin/requests/AdminRequestActions';
import { MoneyDisplay } from '@/components/shared/MoneyDisplay';
import { PageHeader } from '@/components/shared/PageHeader';
import { StatusChip, type ChipTone } from '@/components/shared/StatusChip';
import { loadAdminRequest } from '@/lib/admin-requests';
import { adminMayCancel, extendableDeadline } from '@/lib/admin-requests/constants';
import { guardPage } from '@/lib/auth/session';
import { localized } from '@/lib/catalog/localized';
import { instantLabel, regionDefaultLocale } from '@/lib/requests/view';

/** Money and audit rows render here; never cached. */
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string; id: string }> };

const REFUND_TONE: Record<string, ChipTone> = {
  queued: 'waiting',
  done: 'info',
  done_by_hand: 'info',
  failed: 'negative',
};
const FEE_TONE: Record<string, ChipTone> = { pending: 'waiting', paid: 'info', refunded: 'neutral' };
const REVEALED = ['UNLOCKED', 'IN_PROGRESS', 'AWAITING_CONFIRMATION', 'COMPLETED'];

/**
 * One request as admin reads it (spec 0011-12 AC-12): the summary without the address, the pick and past picks, the
 * fees, refunds, ledger lines, deadline flags and the audit timeline, with refund by hand (AC-8) and a refused refund
 * recorded as done by hand (AC-9). `admin_request_detail` checks `is_admin()` again; a malformed or unknown id is
 * 404. Status and account codes are shown as the data they are. Spec 0011-16 adds the actions: cancel with an
 * attribution (R-3), extend the deadline the state allows (R-5), the street line on click once revealed (R-8), and a
 * Clear button on each open flag (R-7). The line is never read here: only the client component that asks holds it.
 */
export default async function Page({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await guardPage(['admin']);
  const detail = await loadAdminRequest(id);
  if (!detail) notFound();

  const t = await getTranslations('AdminRequests');
  const { request, applications, fees, refunds, ledger, flags, timeline } = detail;
  const tz = request.timezone;
  const at = (value: string | null) => (value ? instantLabel(value, tz, locale) : '—');
  const fallback = regionDefaultLocale(request.region);
  const text = (value: unknown) => localized(value, locale, fallback);
  const refundedFees = new Set(refunds.map((r) => r.fee_payment_id).filter(Boolean));
  const canRefund = (fee: (typeof fees)[number]) => {
    if (fee.status !== 'paid' || refundedFees.has(fee.id)) return false;
    if (fee.kind === 'commission') return request.status === 'CANCELLED' || REVEALED.includes(request.status);
    return applications.some((a) => a.id === fee.application_id && a.unlocked_at !== null);
  };

  const pick = applications.find((a) => a.selected) ?? null;
  const which = extendableDeadline(request.status, pick !== null);
  const whichDeadline =
    which === 'payment'
      ? request.payment_deadline
      : which === 'fee'
        ? request.fee_deadline
        : which === 'confirm'
          ? request.confirm_deadline
          : null;
  const paidFees = fees
    .filter((fee) => fee.status === 'paid')
    .map(({ id: feeId, kind, amount, currency }) => ({ id: feeId, kind, amount, currency }));
  const revealed = pick?.unlocked_at != null;

  const section = 'flex flex-col gap-3 rounded-block bg-surface-secondary p-5';
  const heading = 'text-meta font-bold text-text-secondary';
  const row = 'flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-body-s';

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('title')} intro={t('intro')} />

      <section className={section} aria-labelledby="req-summary">
        <h2 id="req-summary" className={heading}>
          {t('summary')}
        </h2>
        <dl className="flex flex-col gap-2">
          <div className={row}>
            <dt className="text-text-secondary">{t('id')}</dt>
            <dd className="font-mono text-meta break-all text-text-primary">{request.id}</dd>
          </div>
          <div className={row}>
            <dt className="text-text-secondary">{t('status')}</dt>
            <dd>
              <code className="text-text-primary">{request.status}</code>
            </dd>
          </div>
          <div className={row}>
            <dt className="text-text-secondary">{t('service')}</dt>
            <dd className="text-text-primary">
              {text(request.service_name)} · {text(request.zone_name)} · {request.region}
            </dd>
          </div>
          <div className={row}>
            <dt className="text-text-secondary">{t('start')}</dt>
            <dd className="text-text-primary">{at(request.scheduled_start_at)}</dd>
          </div>
          <div className={row}>
            <dt className="text-text-secondary">{t('price')}</dt>
            <dd className="text-text-primary">
              <MoneyDisplay amount={request.fixed_price} currency={request.currency} />
            </dd>
          </div>
          <div className={row}>
            <dt className="text-text-secondary">{t('commission')}</dt>
            <dd className="text-text-primary">
              <MoneyDisplay amount={request.commission_amount} currency={request.currency} />
            </dd>
          </div>
          <div className={row}>
            <dt className="text-text-secondary">{t('failedPicks')}</dt>
            <dd className="text-text-primary">{request.failed_picks}</dd>
          </div>
          <div className={row}>
            <dt className="text-text-secondary">{t('deadlines')}</dt>
            <dd className="text-text-primary">
              {t('deadlineLine', { pay: at(request.payment_deadline), fee: at(request.fee_deadline) })}
            </dd>
          </div>
          {request.confirm_deadline ? (
            <div className={row}>
              <dt className="text-text-secondary">{t('confirmBy')}</dt>
              <dd className="text-text-primary">{at(request.confirm_deadline)}</dd>
            </div>
          ) : null}
          {request.cancelled_at ? (
            <div className={row}>
              <dt className="text-text-secondary">{t('cancelled')}</dt>
              <dd className="text-text-primary">
                {at(request.cancelled_at)} · <code>{request.cancelled_by}</code>
                {request.cancel_reason ? ` · ${request.cancel_reason}` : ''}
              </dd>
            </div>
          ) : null}
          {request.closed_at ? (
            <div className={row}>
              <dt className="text-text-secondary">{t('closed')}</dt>
              <dd className="text-text-primary">
                {at(request.closed_at)} · <code>{request.closed_by}</code>
              </dd>
            </div>
          ) : null}
        </dl>
      </section>

      {adminMayCancel(request.status) || which || revealed ? (
        <section className={section} aria-labelledby="req-actions">
          <h2 id="req-actions" className={heading}>
            {t('actions')}
          </h2>
          <div className="flex flex-wrap items-start gap-2.5">
            {which && whichDeadline ? (
              <AdminExtendAction requestId={request.id} which={which} deadlineLabel={at(whichDeadline)} />
            ) : null}
            {adminMayCancel(request.status) ? (
              <AdminCancelAction requestId={request.id} paidFees={paidFees} />
            ) : null}
            {revealed ? <AdminAddressButton requestId={request.id} /> : null}
          </div>
        </section>
      ) : null}

      <section className={section} aria-labelledby="req-picks">
        <h2 id="req-picks" className={heading}>
          {t('applications')}
        </h2>
        {applications.length === 0 ? (
          <p className="text-body-s text-text-secondary">{t('none')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {applications.map((a) => (
              <li key={a.id} className={row}>
                <span className="text-text-primary">
                  {a.provider_name ?? '—'}
                  {a.selected ? ` · ${t('current')}` : ''}
                </span>
                <span className="text-text-secondary">
                  <code>{a.status}</code> · {at(a.status_changed_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={section} aria-labelledby="req-fees">
        <h2 id="req-fees" className={heading}>
          {t('fees')}
        </h2>
        {fees.length === 0 ? (
          <p className="text-body-s text-text-secondary">{t('none')}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {fees.map((fee) => (
              <li key={fee.id} className="flex flex-col gap-2">
                <div className={row}>
                  <span className="text-text-primary">
                    {t(`kind.${fee.kind}`)} · <MoneyDisplay amount={fee.amount} currency={fee.currency} />
                  </span>
                  <StatusChip tone={FEE_TONE[fee.status] ?? 'neutral'} label={fee.status} />
                </div>
                <p className="text-meta text-text-secondary">
                  {t('paidAt', { date: at(fee.paid_at) })}
                  {fee.psp_payment_id ? ` · ${fee.psp_payment_id}` : ''}
                </p>
                {canRefund(fee) ? (
                  <AdminReasonAction
                    mode="refund"
                    targetId={fee.id}
                    label={t('refund')}
                    amount={fee.amount}
                    currency={fee.currency}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={section} aria-labelledby="req-refunds">
        <h2 id="req-refunds" className={heading}>
          {t('refunds')}
        </h2>
        {refunds.length === 0 ? (
          <p className="text-body-s text-text-secondary">{t('none')}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {refunds.map((refund) => (
              <li key={refund.id} className="flex flex-col gap-2">
                <div className={row}>
                  <span className="text-text-primary">
                    <MoneyDisplay amount={refund.amount} currency={refund.currency} />
                    {refund.reason ? (
                      <>
                        {' '}
                        · <code>{refund.reason}</code>
                      </>
                    ) : null}
                  </span>
                  <StatusChip tone={REFUND_TONE[refund.status] ?? 'neutral'} label={refund.status} />
                </div>
                <p className="text-meta text-text-secondary">
                  {at(refund.created_at)} → {at(refund.finished_at)}
                </p>
                {refund.status === 'failed' ? (
                  <>
                    <p
                      role="status"
                      className="rounded-block bg-error-light p-3 text-body-s text-error-foreground"
                    >
                      {t('byHand')}
                    </p>
                    <AdminReasonAction
                      mode="done"
                      targetId={refund.id}
                      label={t('markDone')}
                      amount={refund.amount}
                      currency={refund.currency}
                    />
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={section} aria-labelledby="req-ledger">
        <h2 id="req-ledger" className={heading}>
          {t('ledger')}
        </h2>
        {ledger.length === 0 ? (
          <p className="text-body-s text-text-secondary">{t('none')}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {ledger.map((journal) => (
              <li key={journal.journal_id} className="flex flex-col gap-1">
                <p className="text-body-s text-text-primary">
                  <code>{journal.kind}</code> · {at(journal.created_at)}
                </p>
                <ul className="flex flex-col gap-0.5 ps-4">
                  {journal.entries.map((entry, index) => (
                    <li key={index} className={row}>
                      <code className="text-meta text-text-secondary">{entry.account}</code>
                      <span className="text-meta text-text-primary" dir="ltr">
                        <MoneyDisplay amount={entry.amount} currency={journal.currency} />
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={section} aria-labelledby="req-flags">
        <h2 id="req-flags" className={heading}>
          {t('flags')}
        </h2>
        {flags.length === 0 ? (
          <p className="text-body-s text-text-secondary">{t('none')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {flags.map((flag) => (
              <li key={flag.id} className="flex flex-col gap-2">
                <div className={row}>
                  <span className="text-text-primary">{t(`flag.${flag.kind}`)}</span>
                  <span className="text-text-secondary">
                    {at(flag.raised_at)}
                    {flag.cleared_at ? ` → ${at(flag.cleared_at)}` : ` · ${t('flagOpen')}`}
                  </span>
                </div>
                {flag.note && flag.note !== 'auto' ? (
                  <p className="text-meta text-text-secondary">{flag.note}</p>
                ) : null}
                {flag.cleared_at ? null : (
                  <AdminReasonAction mode="clear" targetId={flag.id} label={t('flagClear')} />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={section} aria-labelledby="req-timeline">
        <h2 id="req-timeline" className={heading}>
          {t('timeline')}
        </h2>
        {timeline.length === 0 ? (
          <p className="text-body-s text-text-secondary">{t('none')}</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {timeline.map((entry) => (
              <li key={String(entry.id)} className={row}>
                <code className="text-text-primary">{entry.action}</code>
                <span className="text-meta text-text-secondary">{at(entry.created_at)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
