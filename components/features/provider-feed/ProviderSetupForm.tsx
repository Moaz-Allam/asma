'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import { saveProviderSetup } from '@/actions/provider-feed';
import { FormField } from '@/components/shared/FormField';
import { ToggleChips } from '@/components/shared/ToggleChips';
import { Button } from '@/components/ui/button';
import { track } from '@/lib/analytics/client';
import { localized } from '@/lib/catalog/localized';
import { useRouter } from '@/lib/i18n/navigation';
import { dayOrder, type SetupField } from '@/lib/provider-feed/constants';
import type { ProviderSetup } from '@/lib/provider-feed/schemas';
import { hourLabel, regionDefaultLocale } from '@/lib/requests/view';

/**
 * `p4` (ui-registry `ProviderSetupForm`, spec 0009 AC-2, AC-3): the services, districts, work days and hours a
 * provider covers. A pick admin turned off is shown greyed as no longer offered and is not sent again, so the
 * next save drops it. Suspended: read only. The database holds every rule; the form only shapes the input.
 */

const FIELD_OF: Readonly<Record<string, SetupField>> = {
  setup_invalid_services: 'services',
  setup_invalid_zones: 'zones',
  setup_invalid_work_days: 'work_days',
  setup_invalid_hours: 'hours',
};

const selectClass =
  'h-15.25 w-full rounded-field border-2 border-input bg-surface px-4.5 text-body text-text-primary disabled:opacity-50';

export function ProviderSetupForm({ setup, readOnly }: { setup: ProviderSetup; readOnly: boolean }) {
  const t = useTranslations('ProviderFeed');
  const locale = useLocale();
  const router = useRouter();
  const text = (value: unknown) => localized(value, locale, regionDefaultLocale(setup.region));

  const offeredServices = setup.categories.flatMap((c) => c.services.filter((s) => !s.inactive));
  const goneServices = setup.categories.flatMap((c) => c.services.filter((s) => s.inactive && s.selected));
  const offeredZones = setup.zones.filter((z) => !z.inactive);
  const goneZones = setup.zones.filter((z) => z.inactive && z.selected);

  const [services, setServices] = useState<string[]>(
    offeredServices.filter((s) => s.selected).map((s) => s.id),
  );
  const [zones, setZones] = useState<string[]>(offeredZones.filter((z) => z.selected).map((z) => z.id));
  const [days, setDays] = useState<string[]>((setup.availability?.work_days ?? []).map(String));
  const [startHour, setStartHour] = useState(setup.availability?.start_hour ?? 8);
  const [endHour, setEndHour] = useState(setup.availability?.end_hour ?? 18);
  const [errors, setErrors] = useState<Partial<Record<SetupField, string>>>({});
  const [banner, setBanner] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [pending, start] = useTransition();

  const hourText = (hour: number) => (hour === 24 ? '24:00' : hourLabel(hour, locale));

  function save() {
    start(async () => {
      setBanner(null);
      setErrors({});
      let result: Awaited<ReturnType<typeof saveProviderSetup>>;
      try {
        result = await saveProviderSetup({
          serviceIds: services,
          zoneIds: zones,
          workDays: days.map(Number),
          startHour,
          endHour,
        });
      } catch {
        result = { success: false, error: 'action_failed' };
      }
      if (result.success) {
        track('provider_setup_saved', { services: services.length, zones: zones.length });
        setBanner({ tone: 'ok', text: t('setup.saved') });
        router.refresh();
        return;
      }
      const message = t(`errors.${result.error}` as 'errors.action_failed');
      const field = FIELD_OF[result.error];
      if (field) setErrors({ [field]: message });
      setBanner({ tone: 'error', text: message });
    });
  }

  const fieldError = (field: SetupField) =>
    errors[field] ? <p className="text-meta text-error">{errors[field]}</p> : null;

  return (
    <div className="grid items-start gap-3.5 lg:grid-cols-[1.5fr_1fr]">
      <div className="flex min-w-0 flex-col gap-7">
        {readOnly ? (
          <p
            role="status"
            className="rounded-block bg-warning-light p-4 text-body-s font-semibold text-text-primary"
          >
            {t('setup.readOnly')}
          </p>
        ) : null}

        <section className="flex flex-col gap-5">
          <h2 className="font-display text-title-s text-text-primary">{t('setup.services')}</h2>
          {setup.categories.length === 0 ? (
            <p className="text-body-s text-text-secondary">{t('setup.noOptions')}</p>
          ) : null}
          {setup.categories.map((category) => {
            const options = category.services
              .filter((s) => !s.inactive)
              .map((s) => ({ value: s.id, label: text(s.name) }));
            return options.length > 0 ? (
              <ToggleChips
                key={category.id}
                name={`services-${category.id}`}
                legend={text(category.name)}
                options={options}
                values={services.filter((id) => options.some((o) => o.value === id))}
                onChange={(picked) =>
                  setServices((all) => [
                    ...all.filter((id) => !options.some((o) => o.value === id)),
                    ...picked,
                  ])
                }
                invalid={Boolean(errors.services)}
                disabled={readOnly || pending}
              />
            ) : null;
          })}
          {goneServices.length > 0 ? (
            <ul className="flex flex-wrap gap-2" aria-label={t('setup.inactiveNote')}>
              {goneServices.map((s) => (
                <li
                  key={s.id}
                  className="rounded-full bg-surface-secondary px-5 py-3 text-btn-sm text-text-secondary"
                >
                  {t('setup.inactive', { name: text(s.name) })}
                </li>
              ))}
            </ul>
          ) : null}
          {fieldError('services')}
        </section>

        <section className="flex flex-col gap-3">
          <ToggleChips
            name="zones"
            legend={t('setup.zones')}
            options={offeredZones.map((z) => ({ value: z.id, label: text(z.name) }))}
            values={zones}
            onChange={setZones}
            invalid={Boolean(errors.zones)}
            disabled={readOnly || pending}
          />
          {goneZones.length > 0 ? (
            <ul className="flex flex-wrap gap-2" aria-label={t('setup.inactiveNote')}>
              {goneZones.map((z) => (
                <li
                  key={z.id}
                  className="rounded-full bg-surface-secondary px-5 py-3 text-btn-sm text-text-secondary"
                >
                  {t('setup.inactive', { name: text(z.name) })}
                </li>
              ))}
            </ul>
          ) : null}
          {goneServices.length + goneZones.length > 0 ? (
            <p className="text-meta text-text-secondary">{t('setup.inactiveNote')}</p>
          ) : null}
          {fieldError('zones')}
        </section>

        <section className="flex flex-col gap-3">
          <ToggleChips
            name="days"
            legend={t('setup.days')}
            options={dayOrder(locale).map((d) => ({
              value: String(d),
              label: t(`days.${d}` as 'days.0'),
            }))}
            values={days}
            onChange={setDays}
            invalid={Boolean(errors.work_days)}
            disabled={readOnly || pending}
          />
          {fieldError('work_days')}
          <div className="grid gap-3.5 sm:grid-cols-2">
            <FormField id="start-hour" label={t('setup.from')}>
              <select
                id="start-hour"
                className={selectClass}
                value={startHour}
                disabled={readOnly || pending}
                aria-invalid={errors.hours ? true : undefined}
                onChange={(e) => setStartHour(Number(e.target.value))}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {hourText(h)}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField id="end-hour" label={t('setup.to')}>
              <select
                id="end-hour"
                className={selectClass}
                value={endHour}
                disabled={readOnly || pending}
                aria-invalid={errors.hours ? true : undefined}
                onChange={(e) => setEndHour(Number(e.target.value))}
              >
                {Array.from({ length: 24 }, (_, i) => i + 1).map((h) => (
                  <option key={h} value={h}>
                    {hourText(h)}
                  </option>
                ))}
              </select>
            </FormField>
          </div>
          {fieldError('hours')}
        </section>
      </div>

      <aside className="flex flex-col gap-3.5 lg:sticky lg:top-4">
        <section
          aria-label={t('setup.summary')}
          className="flex flex-col gap-4 rounded-panel bg-accent-light p-5 lg:p-7.5"
        >
          <p className="text-body-s font-semibold text-text-primary">{t('setup.summary')}</p>
          <ul className="flex flex-col gap-2 rounded-block bg-surface p-4 text-body-s font-semibold text-text-primary">
            <li>{t('setup.summaryServices', { count: services.length })}</li>
            <li>{t('setup.summaryZones', { count: zones.length })}</li>
            <li>{t('setup.summaryDays', { count: days.length })}</li>
          </ul>
        </section>
        {!readOnly ? (
          <Button size="block" onClick={save} disabled={pending}>
            {pending ? t('setup.saving') : t('setup.save')}
          </Button>
        ) : null}
        {banner ? (
          <p
            role={banner.tone === 'ok' ? 'status' : 'alert'}
            className={
              banner.tone === 'ok'
                ? 'rounded-block bg-success-light p-4 text-body-s font-semibold text-success-foreground'
                : 'rounded-block bg-error-light p-4 text-body-s font-semibold text-error'
            }
          >
            {banner.text}
          </p>
        ) : null}
        <p className="rounded-panel border-2 border-border-light p-5 text-body-s text-text-secondary">
          {t('setup.noReview')}
        </p>
      </aside>
    </div>
  );
}
