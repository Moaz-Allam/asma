'use client';

import { useTranslations } from 'next-intl';

import { useRouter } from '@/lib/i18n/navigation';

/** The service whose formula is open (spec 0007 AC-20). Picking one changes `?service=`. */
export function ServicePicker({
  services,
  value,
}: {
  services: { id: string; name: string; group: string }[];
  value: string;
}) {
  const t = useTranslations('AdminPricing');
  const router = useRouter();
  const groups = [...new Set(services.map((s) => s.group))];

  return (
    <div className="flex flex-col gap-1.5 lg:w-80">
      <label htmlFor="pricing-service" className="text-body-s font-bold text-text-primary">
        {t('service')}
      </label>
      <select
        id="pricing-service"
        className="h-15.25 w-full rounded-field border-2 border-input bg-surface px-4.5 text-body text-text-primary"
        value={value}
        onChange={(event) =>
          router.push({ pathname: '/admin/pricing', query: { service: event.target.value } })
        }
      >
        {groups.map((group) => (
          <optgroup key={group} label={group}>
            {services
              .filter((s) => s.group === group)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
