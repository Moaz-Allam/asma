import { Mail, MessageCircle, Phone } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { Button } from '@/components/ui/button';
import { localized } from '@/lib/catalog/localized';
import type { Contacts } from '@/lib/requests';
import { instantLabel } from '@/lib/requests/view';

import { ContactsSeen } from './ContactsSeen';

/**
 * The other side's contacts after both fees (ui-registry `ContactCard`, spec 0011-10 AC-5, AC-12, R-10). Renders
 * only what `request_contacts` returned: Postgres decides who sees what (rule 2), this never filters. Inside a
 * `data-pii` container (replay stays off, D68; the marker is ready if it is ever turned on). An email with no
 * confirmation is labelled; a missing email shows no row. The phone and links are LTR isolated.
 */
export async function ContactCard({
  contacts,
  requestId,
  locale,
  fallbackLocale,
}: {
  contacts: Contacts;
  requestId: string;
  locale: string;
  fallbackLocale: string;
}) {
  const t = await getTranslations('Contacts');
  const title = contacts.side === 'customer' ? t('titleProvider') : t('titleCustomer');

  return (
    <section
      aria-label={title}
      data-pii
      className="flex flex-col gap-4 rounded-panel border border-border-light bg-surface p-5 lg:p-7.5"
    >
      <ContactsSeen side={contacts.side} requestId={requestId} />
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-title-s text-text-primary">{title}</h2>
        {contacts.name ? <p className="text-body font-semibold text-text-primary">{contacts.name}</p> : null}
      </div>
      <dl className="flex flex-col gap-3 text-body-s">
        <div className="flex flex-col gap-0.5">
          <dt className="text-text-secondary">{t('phone')}</dt>
          <dd className="text-text-primary">
            <bdi dir="ltr">{contacts.phone}</bdi>
          </dd>
        </div>
        {contacts.email ? (
          <div className="flex flex-col gap-0.5">
            <dt className="text-text-secondary">{t('email')}</dt>
            <dd className="text-text-primary">
              <bdi dir="ltr" className="break-all">
                {contacts.email}
              </bdi>
              {contacts.email_confirmed ? null : (
                <span className="ms-2 text-text-secondary">({t('unconfirmed')})</span>
              )}
            </dd>
          </div>
        ) : null}
        {contacts.side === 'provider' ? (
          <>
            <div className="flex flex-col gap-0.5">
              <dt className="text-text-secondary">{t('address')}</dt>
              <dd className="text-text-primary">
                {[contacts.street, contacts.zone ? localized(contacts.zone, locale, fallbackLocale) : null]
                  .filter(Boolean)
                  .join(' · ')}
              </dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-text-secondary">{t('when')}</dt>
              <dd className="text-text-primary">
                {instantLabel(contacts.scheduled_start_at, contacts.timezone, locale)}
              </dd>
            </div>
            {contacts.notes ? (
              <div className="flex flex-col gap-0.5">
                <dt className="text-text-secondary">{t('notes')}</dt>
                <dd className="whitespace-pre-line text-text-primary">{contacts.notes}</dd>
              </div>
            ) : null}
          </>
        ) : null}
      </dl>
      <div className="flex flex-wrap gap-3">
        <Button asChild>
          <a href={`tel:${contacts.phone}`}>
            <Phone aria-hidden className="size-4" />
            {t('call')}
          </a>
        </Button>
        <Button asChild variant="secondary">
          <a href={contacts.whatsapp} target="_blank" rel="noopener noreferrer">
            <MessageCircle aria-hidden className="size-4" />
            {t('whatsapp')}
          </a>
        </Button>
        {contacts.email ? (
          <Button asChild variant="outline">
            <a href={`mailto:${contacts.email}`}>
              <Mail aria-hidden className="size-4" />
              {t('emailAction')}
            </a>
          </Button>
        ) : null}
      </div>
    </section>
  );
}
