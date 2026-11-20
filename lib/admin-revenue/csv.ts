import { formatMinorFixed } from '@/lib/money/parse';

import { REVENUE_COLUMNS, type RevenueReport } from './schemas';

/**
 * The revenue rows as CSV for the accountant (spec 0011-16 R-10, X-14): a header row, one line per region, currency
 * and bucket, amounts as decimal text built from minor units by integer arithmetic (rule 4). Every cell is a code, a
 * day or a number, never free text or personal data, so no cell can start a formula.
 */
export const REVENUE_CSV_HEADER = ['region', 'currency', 'period', ...REVENUE_COLUMNS] as const;

export function revenueCsv(report: RevenueReport): string {
  const lines = [REVENUE_CSV_HEADER.join(',')];
  for (const row of report.rows) {
    lines.push(
      [
        row.region,
        row.currency,
        row.bucket,
        ...REVENUE_COLUMNS.map((column) => formatMinorFixed(row[column])),
      ].join(','),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}

/** R-10: `revenue-<from>-<to>-<grain>.csv`. */
export function revenueFileName(report: Pick<RevenueReport, 'from' | 'to' | 'grain'>): string {
  return `revenue-${report.from}-${report.to}-${report.grain}.csv`;
}
