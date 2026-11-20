import { localized } from '@/lib/catalog/localized';

import type { RequestCatalog, RequestQuote } from './schemas';

/**
 * What the request pages hand to Client Components (spec 0008): the catalog with every text already in the
 * page's locale, so a client gets strings, never the localised objects (lib/catalog/localized.ts), and the
 * pure helpers the form and the pages share. No `server-only`; no money arithmetic (rule 4).
 */

/** One line of a price card. A per unit line shows its amount and its count, never their product. */
export type PriceLine = {
  key: string;
  label: string;
  amount?: number;
  units?: number;
  /** A multiplier as the server sent it, such as `1.30`. */
  factor?: string;
};

export type FormQuestion = {
  key: string;
  type: RequestCatalog['categories'][number]['services'][number]['questions'][number]['type'];
  label: string;
  help: string | null;
  required: boolean;
  /** Asked for this service only, not for every service of the category. */
  serviceScoped: boolean;
  options: { value: string; label: string }[] | null;
  validation: Record<string, number> | null;
};

export type FormService = {
  id: string;
  name: string;
  note: string | null;
  hoursMin: number;
  hoursMax: number;
  questions: FormQuestion[];
  addons: { id: string; name: string; price: number }[];
};

export type FormCatalog = {
  currency: 'TRY' | 'SAR';
  timezone: string;
  today: string;
  schedule: { leadDays: number; horizonDays: number; firstHour: number; lastHour: number };
  zones: { id: string; name: string }[];
  categories: { id: string; name: string; services: FormService[] }[];
};

export function regionDefaultLocale(region: 'TR' | 'KSA'): string {
  return region === 'TR' ? 'tr' : 'ar';
}

export function localizeCatalog(catalog: RequestCatalog, locale: string): FormCatalog {
  const fallback = regionDefaultLocale(catalog.region);
  const text = (value: unknown) => localized(value, locale, fallback);
  return {
    currency: catalog.currency,
    timezone: catalog.timezone,
    today: catalog.today,
    schedule: {
      leadDays: catalog.schedule.lead_days,
      horizonDays: catalog.schedule.horizon_days,
      firstHour: catalog.schedule.first_hour,
      lastHour: catalog.schedule.last_hour,
    },
    zones: catalog.zones.map((z) => ({ id: z.id, name: text(z.name) })),
    categories: catalog.categories.map((c) => ({
      id: c.id,
      name: text(c.name),
      services: c.services.map((s) => ({
        id: s.id,
        name: text(s.name),
        note: s.note ? text(s.note) : null,
        hoursMin: s.hours_min,
        hoursMax: s.hours_max,
        questions: s.questions.map((q) => ({
          key: q.key,
          type: q.type,
          label: text(q.label),
          help: q.help_text ? text(q.help_text) : null,
          required: q.required,
          serviceScoped: q.service_id !== null,
          options: q.options ? q.options.map((o) => ({ value: o.value, label: text(o.label) })) : null,
          validation: q.validation,
        })),
        addons: s.addons.map((a) => ({ id: a.id, name: text(a.name), price: a.price })),
      })),
    })),
  };
}

/** `YYYY-MM-DD` plus whole days, on the calendar alone (no time zone involved). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The days a start may fall on: today plus the lead to today plus the horizon (AC-7). */
export function allowedDates(today: string, leadDays: number, horizonDays: number): string[] {
  const out: string[] = [];
  for (let n = leadDays; n <= horizonDays; n += 1) out.push(addDays(today, n));
  return out;
}

export function allowedHours(firstHour: number, lastHour: number): number[] {
  const out: number[] = [];
  for (let h = firstHour; h <= lastHour; h += 1) out.push(h);
  return out;
}

/** The expected end as a local wall clock date and hour: the start plus `hours_max` (AC-8). Display only. */
export function expectedEnd(date: string, hour: number, hoursMax: number): { date: string; hour: number } {
  const total = hour + hoursMax;
  return { date: addDays(date, Math.floor(total / 24)), hour: total % 24 };
}

/** Western digits in all three locales (D52). */
export const NUMBER_LOCALE: Readonly<Record<string, string>> = { ar: 'ar-u-nu-latn', tr: 'tr', en: 'en' };

/** A calendar day, such as "Thu 13", in the page's locale. */
export function dayParts(date: string, locale: string): { weekday: string; day: string; long: string } {
  const at = new Date(`${date}T12:00:00Z`);
  const tag = NUMBER_LOCALE[locale] ?? locale;
  return {
    weekday: new Intl.DateTimeFormat(tag, { weekday: 'short', timeZone: 'UTC' }).format(at),
    day: new Intl.DateTimeFormat(tag, { day: 'numeric', timeZone: 'UTC' }).format(at),
    long: new Intl.DateTimeFormat(tag, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    }).format(at),
  };
}

/** A whole hour on the wall clock, such as "10:00". */
export function hourLabel(hour: number, locale: string): string {
  const tag = NUMBER_LOCALE[locale] ?? locale;
  return new Intl.DateTimeFormat(tag, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(2000, 0, 1, hour)));
}

/** A stored instant in the region's time zone, such as "Thursday 13 November, 10:00". */
export function instantLabel(iso: string, timezone: string, locale: string): string {
  const tag = NUMBER_LOCALE[locale] ?? locale;
  return new Intl.DateTimeFormat(tag, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: timezone,
  }).format(new Date(iso));
}

/**
 * The fired lines of a quote, named for the page: the base, each fired modifier by its question's label,
 * each addon and the district when it moves the price. Amounts are the server's; nothing is multiplied.
 */
export function quoteLines(
  breakdown: RequestQuote['breakdown'],
  names: { questions: Record<string, string>; addons: Record<string, string>; zones: Record<string, string> },
  labels: { base: string; adjustment: string },
): PriceLine[] {
  const lines: PriceLine[] = [{ key: 'base', label: labels.base, amount: breakdown.base }];
  breakdown.modifiers.forEach((m, i) => {
    const label = (m.question_key ? names.questions[m.question_key] : undefined) ?? labels.adjustment;
    const key = `m${i}`;
    if (m.effect_type === 'MULTIPLIER' && m.factor) lines.push({ key, label, factor: m.factor });
    else if (m.effect_type === 'PER_UNIT' && m.amount !== null)
      lines.push({ key, label, amount: m.amount, units: m.units ?? undefined });
    else if (m.amount !== null) lines.push({ key, label, amount: m.amount });
  });
  for (const a of breakdown.addons)
    lines.push({ key: `a${a.id}`, label: names.addons[a.id] ?? '', amount: a.price });
  if (breakdown.zone && breakdown.zone.multiplier !== '1.00' && breakdown.zone.multiplier !== '1') {
    lines.push({
      key: 'zone',
      label: names.zones[breakdown.zone.id] ?? '',
      factor: breakdown.zone.multiplier,
    });
  }
  return lines;
}

/** A month start (`YYYY-MM-01`) as its month and year, such as "November 2026" (spec 0011-15 AC-2). */
export function monthLabel(monthStart: string, locale: string): string {
  const tag = NUMBER_LOCALE[locale] ?? locale;
  return new Intl.DateTimeFormat(tag, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${monthStart}T00:00:00Z`),
  );
}
