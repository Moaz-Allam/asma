import type { CatalogQuestion, RequestCatalog } from './schemas';

/**
 * Repeat a past request (spec 0008 AC-16, D56): its choices filtered against the catalog as it is now. An
 * answer to a question no longer asked, or no longer valid, is dropped; so is an addon no longer active and a
 * district no longer active. The date and hour are never copied. The price is always a fresh quote.
 * Pure: the caller loads the row through RLS.
 */

export type RequestSource = {
  serviceId: string;
  zoneId: string;
  addonIds: readonly string[];
  answers: Record<string, unknown>;
  notes: string | null;
  addressLine: string | null;
};

export type Prefill =
  | {
      kind: 'prefilled';
      categoryId: string;
      serviceId: string;
      zoneId: string | null;
      addonIds: string[];
      answers: Record<string, unknown>;
      addressLine: string;
      notes: string;
    }
  | { kind: 'service_unavailable' };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Is this answer still valid for this question, by the same rules the database applies? */
export function answerStillValid(question: CatalogQuestion, answer: unknown): boolean {
  const options = new Set((question.options ?? []).map((o) => o.value));
  switch (question.type) {
    case 'number': {
      if (typeof answer !== 'number' || !Number.isInteger(answer)) return false;
      const min = question.validation?.min ?? 0;
      const max = question.validation?.max ?? 0;
      const step = question.validation?.step ?? 1;
      return answer >= min && answer <= max && (answer - min) % step === 0;
    }
    case 'single_select':
      return typeof answer === 'string' && options.has(answer);
    case 'multi_select':
      return (
        Array.isArray(answer) &&
        answer.every((v) => typeof v === 'string' && options.has(v)) &&
        new Set(answer).size === answer.length
      );
    case 'boolean':
      return typeof answer === 'boolean';
    case 'text':
    case 'textarea': {
      if (typeof answer !== 'string') return false;
      const limit = question.validation?.maxLength ?? (question.type === 'text' ? 200 : 500);
      return [...answer.trim()].length <= limit;
    }
    case 'date':
      return typeof answer === 'string' && DATE.test(answer);
    case 'time':
      return typeof answer === 'string' && TIME.test(answer);
  }
}

export function prefillFrom(catalog: RequestCatalog, source: RequestSource): Prefill {
  for (const category of catalog.categories) {
    const service = category.services.find((s) => s.id === source.serviceId);
    if (!service) continue;
    const answers: Record<string, unknown> = {};
    for (const question of service.questions) {
      const answer = source.answers[question.key];
      if (answer !== undefined && answer !== null && answerStillValid(question, answer)) {
        answers[question.key] = answer;
      }
    }
    const active = new Set(service.addons.map((a) => a.id));
    return {
      kind: 'prefilled',
      categoryId: category.id,
      serviceId: service.id,
      zoneId: catalog.zones.some((z) => z.id === source.zoneId) ? source.zoneId : null,
      addonIds: source.addonIds.filter((id) => active.has(id)),
      answers,
      addressLine: source.addressLine ?? '',
      notes: source.notes ?? '',
    };
  }
  return { kind: 'service_unavailable' };
}
