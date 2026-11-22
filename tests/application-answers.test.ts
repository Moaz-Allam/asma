import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Spec 0011-19b, the door side of structured application answers. The rules themselves are proven in pgTAP (40,
 * 41); here the database answers are stubs, so each branch can be driven on purpose: the four arguments always sent,
 * a refusal naming its question, the strict parses of the new keys, the answers never reaching an event, the admin
 * action's codes, and the pure renderers of the apply form, the provider's own answers and the offer card.
 */

const m = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  alert: vi.fn(),
  report: vi.fn(),
  requireRole: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock('@/lib/db/server', () => ({
  createSupabaseServer: vi.fn(async () => ({ rpc: m.rpc, from: m.from })),
}));
vi.mock('@/lib/observability/alert', () => ({ raiseAlert: m.alert }));
vi.mock('@/lib/observability/server', () => ({ reportServerError: m.report }));
vi.mock('next/cache', () => ({ revalidatePath: m.revalidate }));
vi.mock('@/lib/auth/session', async (original) => ({
  ...(await original<typeof import('@/lib/auth/session')>()),
  requireRole: m.requireRole,
}));

import { applyToRequest as applyAction } from '@/actions/provider-feed';
import { catalogCode } from '@/lib/catalog/writes';
import { SaveApplicationQuestionSchema } from '@/lib/catalog/schemas';
import { applyToRequest, loadRequest } from '@/lib/provider-feed';
import { formQuestions, ownAnswerRows, splitAnswerCode } from '@/lib/provider-feed/answers';
import { scrubEvent } from '@/lib/observability/scrub';
import { offerAnswerLines } from '@/lib/requests/offer-answers';
import { Offer } from '@/lib/requests/schemas';

const PROVIDER = '00000000-0000-4000-8000-0000000000a1';
const REQUEST = '00000000-0000-4000-8000-0000000000d1';
const CATEGORY = '00000000-0000-4000-8000-0000000000c1';
const VERSION = 'd41d8cd98f00b204e9800998ecf8427e';
const CONTEXT = { region: 'TR' as const };
const APPLICATION = {
  id: '00000000-0000-4000-8000-0000000000e1',
  status: 'APPLIED',
  created_at: '2026-11-17T08:00:00.123456+00:00',
};
const ANSWERS = { approach: 'FIXTURE_ANSWER two people, one day', materials: 'own', insured: true };

const DETAIL = {
  id: REQUEST,
  service_id: '00000000-0000-4000-8000-000000000501',
  zone_id: '00000000-0000-4000-8000-000000000201',
  service_name: { tr: 'Boya' },
  zone_name: { tr: 'Kadıköy' },
  addon_names: [],
  scheduled_start_at: '2026-11-19T07:00:00+00:00',
  scheduled_end_at: '2026-11-19T12:00:00+00:00',
  fixed_price: 350000,
  cash_due: 315000,
  currency: 'TRY',
  applied_count: 1,
  cap: 10,
  full: false,
  outside_hours: false,
  application: null,
  closed: false,
  timezone: 'Europe/Istanbul',
  answers: [],
  payment_deadline: null,
  questions: [
    {
      key: 'approach',
      label: { tr: 'Nasıl?', en: 'How?' },
      help_text: { tr: 'Kısaca' },
      type: 'textarea',
      required: true,
      options: null,
      max_length: 600,
    },
    {
      key: 'materials',
      label: { tr: 'Malzeme' },
      help_text: null,
      type: 'single_select',
      required: false,
      options: [
        { value: 'own', label: { tr: 'Benim', en: 'Mine' } },
        { value: 'customer', label: { tr: 'Müşteri' } },
      ],
      max_length: null,
    },
  ],
  questions_version: VERSION,
};

const text = (value: unknown) => {
  const v = value as Record<string, string>;
  return v.en ?? v.tr ?? '';
};

beforeEach(() => {
  vi.clearAllMocks();
  m.requireRole.mockResolvedValue({ id: PROVIDER, role: 'provider', region: 'TR' });
});

describe('applyToRequest with answers (AC-4, X-7)', () => {
  it('sends all four arguments: no message, the answers and the version', async () => {
    m.rpc.mockResolvedValue({
      data: { status: 'ok', replayed: false, application: APPLICATION },
      error: null,
    });
    const result = await applyToRequest(
      {
        requestId: REQUEST,
        applicationMessage: null,
        applicationAnswers: ANSWERS,
        questionsVersion: VERSION,
      },
      CONTEXT,
    );
    expect(m.rpc).toHaveBeenCalledWith('apply_to_request', {
      p_request_id: REQUEST,
      p_message: null,
      p_answers: ANSWERS,
      p_questions_version: VERSION,
    });
    expect(result).toEqual({ ok: true, replayed: false, application: APPLICATION });
  });

  it('keeps the key of a refusal about one answer', async () => {
    m.rpc.mockResolvedValue({
      data: { status: 'refused', code: 'contact_info_in_answer', key: 'approach' },
      error: null,
    });
    expect(
      await applyToRequest(
        { requestId: REQUEST, applicationAnswers: ANSWERS, questionsVersion: VERSION },
        CONTEXT,
      ),
    ).toEqual({ ok: false, code: 'contact_info_in_answer', key: 'approach' });
  });

  it('maps questions_changed with no key', async () => {
    m.rpc.mockResolvedValue({ data: { status: 'refused', code: 'questions_changed' }, error: null });
    expect(await applyToRequest({ requestId: REQUEST, applicationAnswers: ANSWERS }, CONTEXT)).toEqual({
      ok: false,
      code: 'questions_changed',
    });
  });

  it('the action names the question in the code, answers_invalid:<key>', async () => {
    m.rpc.mockResolvedValue({
      data: { status: 'refused', code: 'answers_invalid', key: 'insured' },
      error: null,
    });
    expect(
      await applyAction({ requestId: REQUEST, applicationAnswers: ANSWERS, questionsVersion: VERSION }),
    ).toEqual({ success: false, error: 'answers_invalid:insured' });
    expect(m.report).not.toHaveBeenCalled();
  });

  it('refuses a malformed key, a non hex version or a number answer before any database call', async () => {
    for (const input of [
      { requestId: REQUEST, applicationAnswers: { 'Bad Key': 'x' } },
      { requestId: REQUEST, applicationAnswers: ANSWERS, questionsVersion: 'not-a-digest' },
      { requestId: REQUEST, applicationAnswers: { rooms: 3 } },
      {
        requestId: REQUEST,
        applicationAnswers: Object.fromEntries([...Array(17)].map((_, i) => [`k${i}`, 'x'])),
      },
    ]) {
      expect(await applyAction(input)).toEqual({ success: false, error: 'validation_failed' });
    }
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it('an event built from a failing apply keeps no answer text', async () => {
    m.rpc.mockResolvedValue({ data: null, error: { message: 'connection reset', code: '08006' } });
    const input = { requestId: REQUEST, applicationAnswers: ANSWERS, questionsVersion: VERSION };
    await applyAction(input);
    const event = scrubEvent({
      request: { data: input },
      extra: { input, rpc: { p_request_id: REQUEST, p_answers: ANSWERS } },
      contexts: { reply: { application_answers: ANSWERS } },
    });
    const json = JSON.stringify(event);
    expect(json).not.toContain('FIXTURE_ANSWER');
    expect(json).toContain(REQUEST);
  });
});

describe('loadRequest (AC-3)', () => {
  it("parses the questions, the version and the caller's own answers", async () => {
    m.rpc.mockResolvedValue({
      data: {
        ...DETAIL,
        application: {
          ...APPLICATION,
          application_answers: { approach: 'Two people, one day.', materials: 'own' },
          questions_snapshot: [
            { key: 'approach', label: { tr: 'Nasıl?' }, type: 'textarea', required: true },
            {
              key: 'materials',
              label: { tr: 'Malzeme' },
              type: 'single_select',
              required: false,
              choice: { value: 'own', label: { tr: 'Benim' } },
            },
          ],
        },
      },
      error: null,
    });
    const result = await loadRequest(REQUEST, CONTEXT);
    expect(result.ok && result.request?.questions.map((q) => q.key)).toEqual(['approach', 'materials']);
    expect(result.ok && result.request?.questions_version).toBe(VERSION);
    expect(result.ok && result.request?.application?.application_answers?.materials).toBe('own');
  });

  it('refuses an unknown key on a question, so nothing unplanned reaches the page', async () => {
    m.rpc.mockResolvedValue({
      data: { ...DETAIL, questions: [{ ...DETAIL.questions[0], affects_pricing: false }] },
      error: null,
    });
    await expect(loadRequest(REQUEST, CONTEXT)).rejects.toThrow();
  });

  it('refuses a number question type', async () => {
    m.rpc.mockResolvedValue({
      data: { ...DETAIL, questions: [{ ...DETAIL.questions[0], type: 'number' }] },
      error: null,
    });
    await expect(loadRequest(REQUEST, CONTEXT)).rejects.toThrow();
  });
});

describe('the apply form pieces (AC-7)', () => {
  it('localises each question for the client', () => {
    expect(formQuestions(DETAIL.questions as never, text)).toEqual([
      {
        key: 'approach',
        label: 'How?',
        help: 'Kısaca',
        type: 'textarea',
        required: true,
        options: null,
        maxLength: 600,
      },
      {
        key: 'materials',
        label: 'Malzeme',
        help: null,
        type: 'single_select',
        required: false,
        options: [
          { value: 'own', label: 'Mine' },
          { value: 'customer', label: 'Müşteri' },
        ],
        maxLength: null,
      },
    ]);
  });

  it('renders the own answers in snapshot order: a choice by its label, yes or no in words', () => {
    const rows = ownAnswerRows(
      {
        ...APPLICATION,
        status: 'APPLIED',
        application_answers: { approach: 'Two people, one day.', materials: 'own', insured: false },
        questions_snapshot: [
          { key: 'approach', label: { en: 'How?' }, type: 'textarea', required: true },
          {
            key: 'materials',
            label: { en: 'Materials' },
            type: 'single_select',
            required: false,
            choice: { value: 'own', label: { en: 'Mine' } },
          },
          { key: 'skipped', label: { en: 'Skipped' }, type: 'textarea', required: false },
          { key: 'insured', label: { en: 'Insured?' }, type: 'boolean', required: true },
        ],
      },
      text,
      { yes: 'Yes', no: 'No' },
    );
    expect(rows).toEqual([
      { key: 'approach', label: 'How?', value: 'Two people, one day.' },
      { key: 'materials', label: 'Materials', value: 'Mine' },
      { key: 'insured', label: 'Insured?', value: 'No' },
    ]);
  });

  it('a message application has no own answers', () => {
    expect(
      ownAnswerRows(
        { ...APPLICATION, status: 'APPLIED', application_answers: null, questions_snapshot: null },
        text,
        { yes: 'Yes', no: 'No' },
      ),
    ).toBeNull();
    expect(ownAnswerRows(null, text, { yes: 'Yes', no: 'No' })).toBeNull();
  });

  it('splits a refusal code and its question', () => {
    expect(splitAnswerCode('answers_invalid:approach')).toEqual({ code: 'answers_invalid', key: 'approach' });
    expect(splitAnswerCode('questions_changed')).toEqual({ code: 'questions_changed', key: null });
  });
});

describe('the offer card answers (AC-6)', () => {
  const words = { yes: 'Yes', no: 'No', hidden: 'Hidden: it contained contact details' };

  it('renders a choice by its option label, yes or no in words, and a hidden answer as its line', () => {
    expect(
      offerAnswerLines(
        [
          {
            key: 'approach',
            label: { en: 'How?' },
            type: 'textarea',
            choice: null,
            value: 'Two people.',
            hidden: false,
          },
          {
            key: 'materials',
            label: { en: 'Materials' },
            type: 'single_select',
            choice: { value: 'own', label: { en: 'Mine' } },
            value: null,
            hidden: false,
          },
          {
            key: 'insured',
            label: { en: 'Insured?' },
            type: 'boolean',
            choice: null,
            value: true,
            hidden: false,
          },
          { key: 'notes', label: { en: 'Notes' }, type: 'textarea', choice: null, value: null, hidden: true },
        ],
        text,
        words,
      ),
    ).toEqual([
      { key: 'approach', label: 'How?', value: 'Two people.', hidden: false },
      { key: 'materials', label: 'Materials', value: 'Mine', hidden: false },
      { key: 'insured', label: 'Insured?', value: 'Yes', hidden: false },
      { key: 'notes', label: 'Notes', value: 'Hidden: it contained contact details', hidden: true },
    ]);
  });

  it('a message card has no answer lines', () => {
    expect(offerAnswerLines(null, text, words)).toBeNull();
  });

  it('the offer schema takes answers or null, and refuses an extra key in one', () => {
    const base = {
      application_id: APPLICATION.id,
      display_name: 'Ayşe K.',
      first_name: 'Ayşe',
      approved_since: '2026-03-01',
      message: null,
      message_hidden: false,
      created_at: '2026-11-17T08:05:00+00:00',
      rating: { state: 'new', count: 0 },
      quality: null,
    };
    const answer = {
      key: 'approach',
      label: { tr: 'Nasıl?' },
      type: 'textarea',
      choice: null,
      value: 'x',
      hidden: false,
    };
    expect(Offer.safeParse({ ...base, answers: null }).success).toBe(true);
    expect(Offer.safeParse({ ...base, answers: [answer] }).success).toBe(true);
    expect(Offer.safeParse({ ...base, answers: [{ ...answer, provider_id: PROVIDER }] }).success).toBe(false);
  });
});

describe('the admin builder (AC-2)', () => {
  const question = {
    categoryId: CATEGORY,
    key: 'approach',
    type: 'textarea',
    label: { tr: 'Nasıl?' },
    helpText: null,
    required: true,
    options: null,
    validation: null,
  };

  it('takes the three types only', () => {
    expect(SaveApplicationQuestionSchema.safeParse(question).success).toBe(true);
    for (const type of ['single_select', 'boolean'])
      expect(SaveApplicationQuestionSchema.safeParse({ ...question, type }).success).toBe(true);
    for (const type of ['number', 'date', 'time', 'text', 'multi_select'])
      expect(SaveApplicationQuestionSchema.safeParse({ ...question, type }).success).toBe(false);
  });

  it('holds a text limit to 10 to 600', () => {
    expect(
      SaveApplicationQuestionSchema.safeParse({ ...question, validation: { maxLength: 600 } }).success,
    ).toBe(true);
    expect(
      SaveApplicationQuestionSchema.safeParse({ ...question, validation: { maxLength: 601 } }).success,
    ).toBe(false);
    expect(
      SaveApplicationQuestionSchema.safeParse({ ...question, validation: { maxLength: 9 } }).success,
    ).toBe(false);
  });

  it('maps the guard refusals to stable codes', () => {
    expect(catalogCode({ code: 'P0001', message: 'too_many_questions' })).toBe('too_many_questions');
    expect(catalogCode({ code: 'P0001', message: 'application_question_retire' })).toBe(
      'application_question_retire',
    );
    expect(catalogCode({ code: '23514', message: 'check' })).toBe('validation_failed');
  });
});
