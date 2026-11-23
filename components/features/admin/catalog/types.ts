import type { CatalogLocale, LocalizedText } from '@/lib/catalog/localized';
import type { QuestionType } from '@/lib/catalog/options';

/**
 * What the catalog page hands its Client Components (spec 0007 AC-2): each text already in the page's
 * locale (`name`), plus the three locales as stored (`values`) for the edit sheet, and the locales a row
 * is missing. Money is integer minor units and its form text, both made on the server.
 */

type Texts = { name: string; values: LocalizedText; missing: CatalogLocale[] };

export type CatalogCategory = Texts & { id: string; active: boolean; services: number; questions: number };

export type CatalogService = Texts & {
  id: string;
  note: string;
  noteValues: LocalizedText;
  hoursMin: number;
  hoursMax: number;
  active: boolean;
  state: 'off' | 'no_formula' | 'live';
};

export type CatalogAddon = Texts & {
  id: string;
  serviceId: string;
  price: number;
  priceText: string;
  active: boolean;
};

export type CatalogZone = Texts & {
  id: string;
  multiplier: string;
  active: boolean;
  il: string | null;
  ilce: string | null;
};

export type CatalogOption = { value: string; label: string; values: LocalizedText };

export type CatalogQuestion = Texts & {
  id: string;
  key: string;
  type: QuestionType;
  help: string;
  helpValues: LocalizedText;
  required: boolean;
  affectsPricing: boolean;
  options: CatalogOption[] | null;
  validation: { min?: number; max?: number; step?: number; maxLength?: number } | null;
  serviceId: string | null;
  /** Option values an active formula matches: these cannot be removed (AC-4, AC-18). */
  inUseValues: string[];
  /** The service's name when the question is for one service only. */
  scopeName: string | null;
  active: boolean;
};
