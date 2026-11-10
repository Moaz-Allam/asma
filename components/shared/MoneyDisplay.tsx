import { useLocale } from 'next-intl';

import { formatMoney } from '@/lib/format/money';
import { isLocale, DEFAULT_LOCALE } from '@/lib/i18n/direction';
import { cn } from '@/lib/utils';

/**
 * Money from minor units and a currency. Never computes (rule 4). Always `font-display`, because Cairo has
 * no `₺`, with tabular figures, left to right inside any text (ui-tokens.md §5, ui-rules.md §21).
 */
export function MoneyDisplay({
  amount,
  currency,
  className,
}: {
  amount: number;
  currency: 'TRY' | 'SAR';
  className?: string;
}) {
  const locale = useLocale();
  const text = formatMoney(amount, currency, isLocale(locale) ? locale : DEFAULT_LOCALE);
  return (
    <span dir="ltr" className={cn('font-display tabular-nums', className)}>
      {text}
    </span>
  );
}
