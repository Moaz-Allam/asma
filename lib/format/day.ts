const DAY = /^(?:2\d{3}|[3-9]\d{3})-\d{2}-\d{2}$/;

/**
 * A `YYYY-MM-DD` day from the year 2000 on that exists on the calendar, or null. Used for the admin list's date filters and the revenue
 * range (spec 0011-16 R-2, R-9); Postgres checks every range again.
 */
export function dayFrom(value: unknown): string | null {
  if (typeof value !== 'string' || !DAY.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}
